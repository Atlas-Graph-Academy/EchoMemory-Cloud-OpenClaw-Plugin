import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { getLocalUiSetupState, saveLocalUiSetup } from "./config.js";
import { scanFullWorkspace } from "./openclaw-memory-scan.js";
import { readLastSyncState } from "./state.js";

const BASE_PORT = 17823;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_HTML_PATH = path.join(__dirname, "local-ui.html");
const UI_WORKDIR = path.join(__dirname, "local-ui");
const UI_DIST_DIR = path.join(__dirname, "local-ui", "dist");
const UI_NODE_MODULES_DIR = path.join(UI_WORKDIR, "node_modules");

let _instance = null;
let _bootstrapPromise = null;
let _lastOpenedUrl = null;

/* ── File Watcher + SSE ────────────────────────────────── */

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", "logs", "completions", "delivery-queue", "browser", "canvas", "cron", "media"]);

/** Debounced file-change broadcaster */
function createFileWatcher(workspaceDir) {
  const sseClients = new Set();
  const watchers = [];
  let debounceTimer = null;
  const DEBOUNCE_MS = 500;

  function broadcast(eventData) {
    const payload = `data: ${JSON.stringify(eventData)}\n\n`;
    for (const res of sseClients) {
      try { res.write(payload); } catch { sseClients.delete(res); }
    }
  }

  function onFileChange(eventType, filename) {
    if (!filename || !filename.endsWith(".md")) return;
    // Debounce: batch rapid changes into one event
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      broadcast({ type: "files-changed", file: filename, at: new Date().toISOString() });
    }, DEBOUNCE_MS);
  }

  function watchRecursive(dir) {
    let entries;
    try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    // Watch this directory
    try {
      const w = fsSync.watch(dir, { persistent: false }, onFileChange);
      watchers.push(w);
    } catch { /* ignore permission errors */ }
    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        watchRecursive(path.join(dir, entry.name));
      }
    }
  }

  // Start watching
  watchRecursive(workspaceDir);

  return {
    sseClients,
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) { try { w.close(); } catch {} }
      watchers.length = 0;
      for (const res of sseClients) { try { res.end(); } catch {} }
      sseClients.clear();
    },
  };
}

function tryListen(server, port) {
  return new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => resolve(true));
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res, data) {
  const body = JSON.stringify(data);
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isLocalUiBuildReady() {
  const indexPath = path.join(UI_DIST_DIR, "index.html");
  if (!(await pathExists(indexPath))) {
    return false;
  }
  const assetDir = path.join(UI_DIST_DIR, "assets");
  if (!(await pathExists(assetDir))) {
    return false;
  }
  try {
    const assetNames = await fs.readdir(assetDir);
    return assetNames.some((name) => name.endsWith(".js"));
  } catch {
    return false;
  }
}

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runNpmCommand(args, logger) {
  return new Promise((resolve, reject) => {
    const child = spawn(getNpmCommand(), args, {
      cwd: UI_WORKDIR,
      env: process.env,
      stdio: "pipe",
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const output = [...stderr, ...stdout].join("").trim();
      reject(new Error(output || `npm ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  }).catch((error) => {
    logger?.warn?.(`[echo-memory] local-ui npm ${args.join(" ")} failed: ${String(error?.message ?? error)}`);
    throw error;
  });
}

export async function ensureLocalUiReady(cfg = {}, logger) {
  if (await isLocalUiBuildReady()) {
    return;
  }
  if (_bootstrapPromise) {
    return _bootstrapPromise;
  }

  _bootstrapPromise = (async () => {
    const hasNodeModules = await pathExists(UI_NODE_MODULES_DIR);
    if (!hasNodeModules) {
      if (!cfg?.localUiAutoInstall) {
        throw new Error("local-ui dependencies are missing and auto-install is disabled");
      }
      logger?.info?.("[echo-memory] Installing local-ui dependencies...");
      await runNpmCommand(["install"], logger);
    }

    if (!(await isLocalUiBuildReady())) {
      logger?.info?.("[echo-memory] Building local-ui frontend...");
      await runNpmCommand(["run", "build"], logger);
    }

    if (!(await isLocalUiBuildReady())) {
      throw new Error("local-ui build did not produce expected dist assets");
    }
  })();

  try {
    await _bootstrapPromise;
  } finally {
    _bootstrapPromise = null;
  }
}

function detectBrowserOpenSkipReason() {
  if (process.env.CI) {
    return "ci_environment";
  }
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) {
    return "ssh_session";
  }
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return "missing_display";
  }
  return null;
}

function getBrowserOpenCommand(url) {
  if (process.platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", "\"\"", url],
    };
  }
  if (process.platform === "darwin") {
    return {
      command: "open",
      args: [url],
    };
  }
  if (process.platform === "linux") {
    return {
      command: "xdg-open",
      args: [url],
    };
  }
  return null;
}

export async function openUrlInDefaultBrowser(url, opts = {}) {
  const { logger, force = false } = opts;
  if (!force) {
    const skipReason = detectBrowserOpenSkipReason();
    if (skipReason) {
      return { opened: false, reason: skipReason };
    }
  }
  if (_lastOpenedUrl === url) {
    return { opened: false, reason: "already_opened" };
  }
  const command = getBrowserOpenCommand(url);
  if (!command) {
    return { opened: false, reason: "unsupported_platform" };
  }

  try {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    _lastOpenedUrl = url;
    return { opened: true, reason: "opened" };
  } catch (error) {
    logger?.warn?.(`[echo-memory] browser open failed: ${String(error?.message ?? error)}`);
    return { opened: false, reason: "spawn_failed" };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

function createRequestHandler(workspaceDir, htmlContent, opts = {}) {
  const normalizedBase = path.resolve(workspaceDir) + path.sep;
  const { apiClient, syncRunner, cfg, fileWatcher } = opts;

  return async function handler(req, res) {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    let url;
    try {
      url = new URL(req.url, "http://127.0.0.1");
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    // SSE endpoint — push file-change events to the frontend
    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(": connected\n\n");
      if (fileWatcher) {
        fileWatcher.sseClients.add(res);
        req.on("close", () => fileWatcher.sseClients.delete(res));
      }
      return;
    }

    if (url.pathname === "/") {
      // Always serve the built React app from dist/
      let content;
      try {
        content = await fs.readFile(path.join(UI_DIST_DIR, "index.html"), "utf8");
      } catch {
        content = htmlContent; // legacy fallback
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(content);
      return;
    }

    // Serve static assets from dist/ (JS, CSS)
    if (url.pathname.startsWith("/assets/")) {
      const assetPath = path.join(UI_DIST_DIR, url.pathname);
      const resolved = path.resolve(assetPath);
      if (!resolved.startsWith(path.resolve(UI_DIST_DIR))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      try {
        const data = await fs.readFile(resolved);
        const ext = path.extname(resolved);
        const mimeTypes = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html" };
        const ct = mimeTypes[ext] || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": ct + "; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
        });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("Not Found");
      }
      return;
    }

    if (url.pathname === "/api/files") {
      let files;
      try {
        files = await scanFullWorkspace(workspaceDir);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
        return;
      }
      sendJson(res, { workspaceDir, files });
      return;
    }

    if (url.pathname === "/api/file") {
      const requestedPath = url.searchParams.get("path");
      if (!requestedPath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing path parameter" }));
        return;
      }

      // Path traversal guard
      const resolved = path.resolve(workspaceDir, requestedPath);
      if (!resolved.startsWith(normalizedBase) || !resolved.endsWith(".md")) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden" }));
        return;
      }

      let content;
      try {
        content = await fs.readFile(resolved, "utf8");
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
        return;
      }

      sendJson(res, { fileName: path.basename(resolved), content });
      return;
    }

    if (url.pathname === "/api/auth-status") {
      if (!apiClient) {
        sendJson(res, { connected: false, reason: "no_client" });
        return;
      }
      const hasKey = !!(cfg && cfg.apiKey);
      if (!hasKey) {
        sendJson(res, { connected: false, reason: "no_api_key" });
        return;
      }
      try {
        const whoami = await apiClient.whoami();
        sendJson(res, {
          connected: true,
          userId: whoami.user_id,
          tokenType: whoami.token_type,
          scopes: whoami.scopes,
        });
      } catch (e) {
        sendJson(res, { connected: false, reason: "auth_failed", error: String(e?.message ?? e) });
      }
      return;
    }

    if (url.pathname === "/api/setup-status") {
      sendJson(res, getLocalUiSetupState(opts.pluginConfig ?? {}, cfg));
      return;
    }

    if (url.pathname === "/api/setup-config" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const payload = {
          ECHOMEM_BASE_URL: typeof body.baseUrl === "string" ? body.baseUrl : "",
          ECHOMEM_WEB_BASE_URL: typeof body.webBaseUrl === "string" ? body.webBaseUrl : "",
          ECHOMEM_API_KEY: typeof body.apiKey === "string" ? body.apiKey : "",
          ECHOMEM_MEMORY_DIR: typeof body.memoryDir === "string" ? body.memoryDir : "",
        };
        const saveResult = saveLocalUiSetup(payload);
        if (cfg) {
          if (payload.ECHOMEM_BASE_URL.trim()) cfg.baseUrl = payload.ECHOMEM_BASE_URL.trim().replace(/\/+$/, "");
          if (payload.ECHOMEM_WEB_BASE_URL.trim()) cfg.webBaseUrl = payload.ECHOMEM_WEB_BASE_URL.trim().replace(/\/+$/, "");
          if (payload.ECHOMEM_API_KEY.trim()) cfg.apiKey = payload.ECHOMEM_API_KEY.trim();
          if (payload.ECHOMEM_MEMORY_DIR.trim()) cfg.memoryDir = payload.ECHOMEM_MEMORY_DIR.trim();
        }
        sendJson(res, {
          ok: true,
          ...saveResult,
          setup: getLocalUiSetupState(opts.pluginConfig ?? {}, cfg),
        });
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
      }
      return;
    }

    // Backend sources — authoritative COMPLETE list of files already synced to Echo cloud
    if (url.pathname === "/api/backend-sources") {
      if (!apiClient) {
        sendJson(res, { ok: false, sources: [], error: "no_client" });
        return;
      }
      try {
        const data = await apiClient.listAllSources();
        sendJson(res, {
          ok: true,
          total: data.total || 0,
          sources: (data.paths || []).map(s => ({
            filePath: s.file_path,
            isProcessed: s.is_processed,
            latestAt: s.latest_at,
          })),
        });
      } catch (e) {
        // Fallback to import-status if new endpoint not deployed yet
        try {
          const status = await apiClient.getImportStatus();
          const sources = (status.recent_sources || []).map(s => ({
            filePath: s.file_path,
            isProcessed: s.is_processed,
            latestAt: s.created_at,
          }));
          sendJson(res, { ok: true, total: sources.length, sources });
        } catch (e2) {
          sendJson(res, { ok: false, sources: [], error: String(e2?.message ?? e2) });
        }
      }
      return;
    }

    if (url.pathname === "/api/sync-status") {
      try {
        const statePath = syncRunner?.getStatePath() ?? null;
        const [lastState, files] = await Promise.all([
          statePath ? readLastSyncState(statePath) : Promise.resolve(null),
          scanFullWorkspace(workspaceDir),
        ]);
        // Pure local comparison — no backend calls.
        // Build map: absFilePath -> contentHash from last sync results
        const lastSyncedMap = new Map();
        if (Array.isArray(lastState?.results)) {
          for (const r of lastState.results) {
            // Support both camelCase (local dry-run) and snake_case (API response)
            const fp = r.filePath || r.file_path;
            if (fp && (r.status === "imported" || !r.status)) {
              // Store contentHash if available; otherwise mark as synced without hash
              // Note: older sync states may not have status field — treat as imported
              lastSyncedMap.set(fp, r.contentHash || "__synced__");
            }
          }
        }

        // Daily files (YYYY-MM-DD*.md in memory/) are agent-generated and
        // effectively immutable once written. We only check whether they've
        // been synced before. Mutable files (root-level MEMORY.md, SOUL.md,
        // etc.) need a content-hash comparison to detect edits.
        const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

        const fileStatuses = files.map((f) => {
          const absPath = path.resolve(workspaceDir, f.relativePath);
          const isPrivate =
            f.relativePath.startsWith("memory/private/") ||
            f.privacyLevel === "private";

          // Private files are never syncable
          if (isPrivate) {
            return { fileName: f.fileName, relativePath: f.relativePath, status: null };
          }

          const isDaily =
            f.relativePath.startsWith("memory/") && DATE_RE.test(f.fileName);

          if (!lastState) {
            // Never synced at all — everything is new (except private)
            return { fileName: f.fileName, relativePath: f.relativePath, status: "new" };
          }

          if (lastSyncedMap.has(absPath)) {
            // Daily files don't change, skip expensive hash compare
            if (isDaily) {
              return {
                fileName: f.fileName,
                relativePath: f.relativePath,
                status: "synced",
                lastSynced: lastState.finished_at,
              };
            }
            // Mutable file — compare hash if available
            const savedHash = lastSyncedMap.get(absPath);
            const status =
              savedHash === "__synced__" || savedHash === f.contentHash
                ? "synced"
                : "modified";
            return {
              fileName: f.fileName,
              relativePath: f.relativePath,
              status,
              lastSynced: lastState.finished_at,
            };
          }

          // Not in sync state → new
          return { fileName: f.fileName, relativePath: f.relativePath, status: "new" };
        });

        sendJson(res, {
          lastSyncAt: lastState?.finished_at ?? null,
          syncedFileCount: lastSyncedMap.size,
          fileStatuses,
        });
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
      }
      return;
    }

    if (url.pathname === "/api/sync" && req.method === "POST") {
      if (!syncRunner) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Sync not available" }));
        return;
      }
      try {
        const result = await syncRunner.runSync("local-ui");
        sendJson(res, result);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e?.message ?? e) }));
      }
      return;
    }

    if (url.pathname === "/api/sync-selected" && req.method === "POST") {
      if (!apiClient) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Sync not available (no API client)" }));
        return;
      }
      try {
        const body = await readBody(req);
        const relativePaths = body.paths;
        if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "paths array required" }));
          return;
        }

        // Read each selected file directly — not limited to memoryDir
        const crypto = await import("node:crypto");
        const files = [];
        for (const rp of relativePaths) {
          const absPath = path.resolve(workspaceDir, rp);
          // Security: must be within workspaceDir and be .md
          if (!absPath.startsWith(path.resolve(workspaceDir) + path.sep) || !absPath.endsWith(".md")) continue;
          try {
            const content = await fs.readFile(absPath, "utf8");
            const stats = await fs.stat(absPath);
            const hash = crypto.createHash("sha256").update(content.replace(/\r\n/g, "\n").trim()).digest("hex");
            files.push({
              filePath: absPath,
              sectionTitle: path.basename(absPath, ".md"),
              content,
              modifiedTime: stats.mtime.toISOString(),
              contentHash: hash,
            });
          } catch { /* skip unreadable files */ }
        }

        if (files.length === 0) {
          sendJson(res, { trigger: "local-ui-selected", summary: { file_count: 0 }, results: [] });
          return;
        }

        // Send directly to backend
        const batchSize = cfg?.batchSize || 10;
        const summary = { file_count: files.length, skipped_count: 0, new_source_count: 0, new_memory_count: 0, duplicate_count: 0, failed_file_count: 0 };
        for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize);
          const response = await apiClient.importMarkdown(batch);
          const s = response.summary || {};
          summary.skipped_count += s.skipped_count || 0;
          summary.new_source_count += s.new_source_count || 0;
          summary.new_memory_count += s.new_memory_count || 0;
          summary.duplicate_count += s.duplicate_count || 0;
          summary.failed_file_count += s.failed_file_count || 0;
        }

        // Merge results into local sync state
        if (syncRunner) {
          try {
            const { readLastSyncState, writeLastSyncState } = await import("./state.js");
            const statePath = syncRunner.getStatePath();
            const prevState = await readLastSyncState(statePath);
            const prevResults = Array.isArray(prevState?.results) ? prevState.results : [];
            const newResults = files.map(f => ({ filePath: f.filePath, contentHash: f.contentHash, status: "imported" }));
            const newPathSet = new Set(newResults.map(r => r.filePath));
            const mergedResults = [
              ...prevResults.filter(r => !newPathSet.has(r.filePath || r.file_path)),
              ...newResults,
            ];
            await writeLastSyncState(statePath, {
              trigger: "local-ui-selected",
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              summary,
              results: mergedResults,
            });
          } catch { /* state update is best-effort */ }
        }

        sendJson(res, { trigger: "local-ui-selected", summary, results: files.map(f => ({ filePath: f.filePath, contentHash: f.contentHash, status: "imported" })) });
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e?.message ?? e) }));
      }
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  };
}

export async function startLocalServer(workspaceDir, opts = {}) {
  if (_instance) {
    return _instance.url;
  }

  await ensureLocalUiReady(opts.cfg, opts.logger);
  const htmlContent = await fs.readFile(UI_HTML_PATH, "utf8");
  const fileWatcher = createFileWatcher(workspaceDir);
  const handler = createRequestHandler(workspaceDir, htmlContent, { ...opts, fileWatcher });
  const server = http.createServer(handler);

  let port = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = BASE_PORT + attempt;
    const ok = await tryListen(server, candidate);
    if (ok) {
      port = candidate;
      break;
    }
  }

  if (port === null) {
    fileWatcher.close();
    throw new Error(`Could not bind to ports ${BASE_PORT}–${BASE_PORT + 2}. All in use.`);
  }

  const url = `http://127.0.0.1:${port}`;
  _instance = { server, url, fileWatcher };
  return url;
}

export function stopLocalServer() {
  if (_instance) {
    _instance.server.close();
    if (_instance.fileWatcher) _instance.fileWatcher.close();
    _instance = null;
  }
}
