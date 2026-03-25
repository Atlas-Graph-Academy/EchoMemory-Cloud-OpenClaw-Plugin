import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { getLocalUiSetupState, saveLocalUiSetup } from "./config.js";
import { scanFullWorkspace, scanWorkspaceMarkdownFile } from "./openclaw-memory-scan.js";
import {
  readLastSyncState,
  readLocalUiPresence,
  resolveUiPresencePath,
  writeLocalUiPresence,
} from "./state.js";

const BASE_PORT = 17823;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_HTML_PATH = path.join(__dirname, "local-ui.html");
const UI_WORKDIR = path.join(__dirname, "local-ui");
const UI_DIST_DIR = path.join(__dirname, "local-ui", "dist");
const UI_NODE_MODULES_DIR = path.join(UI_WORKDIR, "node_modules");

let _instance = null;
let _bootstrapPromise = null;
let _lastOpenedUrl = null;
const BACKEND_SOURCE_LOOKUP_TIMEOUT_MS = 4000;
const LOCAL_UI_PRESENCE_STALE_MS = 75000;

/* â”€â”€ File Watcher + SSE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", "logs", "completions", "delivery-queue", "browser", "canvas", "cron", "media"]);

/** Debounced file-change broadcaster */
function createFileWatcher(workspaceDir) {
  const sseClients = new Set();
  const clientWaiters = new Set();
  const watchers = [];
  let debounceTimer = null;
  const DEBOUNCE_MS = 500;

  function settleClientWaiters(didConnect) {
    for (const finish of [...clientWaiters]) {
      finish(didConnect);
    }
  }

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
    addSseClient(res) {
      sseClients.add(res);
      settleClientWaiters(true);
    },
    removeSseClient(res) {
      sseClients.delete(res);
    },
    waitForClient(timeoutMs = 0) {
      if (sseClients.size > 0) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        let timer = null;
        const finish = (didConnect) => {
          if (!clientWaiters.delete(finish)) {
            return;
          }
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          resolve(didConnect);
        };
        clientWaiters.add(finish);
        if (timeoutMs > 0) {
          timer = setTimeout(() => finish(false), timeoutMs);
        }
      });
    },
    broadcast,
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) { try { w.close(); } catch {} }
      watchers.length = 0;
      for (const res of sseClients) { try { res.end(); } catch {} }
      sseClients.clear();
      settleClientWaiters(false);
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

async function readLegacyUiHtml(logger) {
  try {
    return await fs.readFile(UI_HTML_PATH, "utf8");
  } catch (error) {
    logger?.warn?.(
      `[echo-memory] legacy local-ui fallback HTML unavailable at ${UI_HTML_PATH}: ${String(error?.message ?? error)}`,
    );
    return null;
  }
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
  if (!force && _lastOpenedUrl === url) {
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
      const rawText = Buffer.concat(chunks).toString("utf8");
      if (!rawText.trim()) {
        resolve({
          ok: true,
          body: {},
          rawText,
          parseError: null,
        });
        return;
      }
      try {
        resolve({
          ok: true,
          body: JSON.parse(rawText),
          rawText,
          parseError: null,
        });
      } catch (error) {
        resolve({
          ok: false,
          body: null,
          rawText,
          parseError: String(error?.message ?? error),
        });
      }
    });
    req.on("error", reject);
  });
}

function resolveStoredFilePath(workspaceDir, entry) {
  const rawPath = entry?.filePath || entry?.file_path || entry?.path || null;
  if (!rawPath) {
    return null;
  }
  return path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(workspaceDir, rawPath);
}

function toPathKey(targetPath) {
  const normalized = path.normalize(String(targetPath || ""));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function resolveBackendFilePath(workspaceDir, rawPath) {
  if (!rawPath) {
    return null;
  }
  return path.isAbsolute(rawPath)
    ? path.normalize(rawPath)
    : path.resolve(workspaceDir, String(rawPath));
}

async function readBackendSourceMap(apiClient, workspaceDir) {
  const sources = new Map();
  if (!apiClient) {
    return sources;
  }

  const addSource = (sourcePath, latestAt = null) => {
    const resolvedPath = resolveBackendFilePath(workspaceDir, sourcePath);
    if (!resolvedPath) {
      return;
    }
    const pathKey = toPathKey(resolvedPath);
    const existing = sources.get(pathKey);
    if (!existing || (latestAt && (!existing.latestAt || latestAt > existing.latestAt))) {
      sources.set(pathKey, {
        latestAt: latestAt || existing?.latestAt || null,
      });
    }
  };

  try {
    const data = await apiClient.listAllSources();
    for (const source of data?.paths || []) {
      addSource(source?.file_path, source?.latest_at ?? null);
    }
    return sources;
  } catch {
    // Fall through to import-status fallback.
  }

  try {
    const status = await apiClient.getImportStatus();
    for (const source of status?.recent_sources || []) {
      addSource(source?.file_path, source?.created_at ?? null);
    }
  } catch {
    // Ignore backend status fallback failures in the local UI.
  }

  return sources;
}

function resolveWithin(timeoutMs, value) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), timeoutMs);
  });
}

function getLocalUiPresencePath(syncRunner) {
  try {
    const statePath = syncRunner?.getStatePath?.();
    return statePath ? resolveUiPresencePath(path.dirname(statePath)) : null;
  } catch {
    return null;
  }
}

async function updateLocalUiPresence(syncRunner, payload = {}) {
  const presencePath = getLocalUiPresencePath(syncRunner);
  if (!presencePath) {
    return null;
  }

  const previous = await readLocalUiPresence(presencePath);
  const next = {
    clientId: payload.clientId || previous?.clientId || null,
    serverInstanceId: payload.serverInstanceId || previous?.serverInstanceId || null,
    active: payload.active !== undefined ? Boolean(payload.active) : true,
    lastSeenAt: payload.lastSeenAt || new Date().toISOString(),
  };
  await writeLocalUiPresence(presencePath, next);
  return next;
}

export async function hasRecentLocalUiPresence(syncRunner, { maxAgeMs = LOCAL_UI_PRESENCE_STALE_MS } = {}) {
  const presencePath = getLocalUiPresencePath(syncRunner);
  if (!presencePath) {
    return false;
  }

  const presence = await readLocalUiPresence(presencePath);
  if (!presence?.lastSeenAt || presence.active === false) {
    return false;
  }

  const ageMs = Date.now() - new Date(presence.lastSeenAt).getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMs;
}

async function buildWorkspaceSyncView({ workspaceDir, syncMemoryDir, statePath, apiClient }) {
  const backendSourcesPromise = readBackendSourceMap(apiClient, workspaceDir).catch(() => new Map());
  const [lastState, files, backendSources] = await Promise.all([
    statePath ? readLastSyncState(statePath) : Promise.resolve(null),
    scanFullWorkspace(workspaceDir),
    Promise.race([
      backendSourcesPromise,
      resolveWithin(BACKEND_SOURCE_LOOKUP_TIMEOUT_MS, new Map()),
    ]),
  ]);

  const storedResults = Array.isArray(lastState?.results) ? lastState.results : [];
  const resultMap = new Map();
  for (const entry of storedResults) {
    const storedPath = resolveStoredFilePath(workspaceDir, entry);
    if (!storedPath) continue;
    resultMap.set(toPathKey(storedPath), entry);
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
  const eligibleAbsolutePaths = new Set();
  const eligibleRelativePaths = [];

  const fileStatuses = files.map((f) => {
    const absPath = path.resolve(workspaceDir, f.relativePath);
    const pathKey = toPathKey(absPath);
    const isPrivate =
      f.relativePath.startsWith("memory/private/") ||
      f.privacyLevel === "private";
    const isSyncTarget =
      Boolean(syncMemoryDir) && path.dirname(absPath) === syncMemoryDir;
    const isDaily =
      f.relativePath.startsWith("memory/") && DATE_RE.test(f.fileName);
    const stored = resultMap.get(pathKey) ?? null;
    const storedStatus = String(stored?.status || "").trim().toLowerCase() || null;
    const attemptedHash = stored?.contentHash || stored?.content_hash || null;
    const successfulHash =
      stored?.lastSuccessfulContentHash
      || stored?.last_successful_content_hash
      || (storedStatus && storedStatus !== "failed" ? attemptedHash : null);
    const lastError = stored?.lastError || stored?.last_error || stored?.error || null;
    const lastAttemptAt = stored?.lastAttemptAt || stored?.last_attempt_at || null;
    const backendSource = backendSources.get(pathKey) ?? null;
    const lastSuccessAt =
      stored?.lastSuccessAt
      || stored?.last_success_at
      || backendSource?.latestAt
      || lastState?.finished_at
      || null;

    if (isPrivate) {
      return {
        fileName: f.fileName,
        relativePath: f.relativePath,
        status: null,
        syncEligible: false,
        syncReason: f.privacyAutoUpgraded ? "sensitive_content" : "private",
      };
    }

    if (!isSyncTarget) {
      return {
        fileName: f.fileName,
        relativePath: f.relativePath,
        status: "local",
        syncEligible: false,
        syncReason: "outside_memory_dir",
      };
    }

    eligibleAbsolutePaths.add(absPath);
    eligibleRelativePaths.push(f.relativePath);

    let status = "new";
    if (storedStatus === "failed" && attemptedHash && attemptedHash === f.contentHash) {
      status = "failed";
    } else if (successfulHash) {
      status = isDaily || successfulHash === f.contentHash ? "synced" : "modified";
    } else if (backendSource) {
      status = "synced";
    } else if (storedStatus === "failed") {
      status = "modified";
    }

    return {
      fileName: f.fileName,
      relativePath: f.relativePath,
      status,
      syncEligible: true,
      syncReason: "eligible",
      lastError,
      lastAttemptAt,
      lastSuccessAt,
    };
  });

  return {
    lastState,
    fileStatuses,
    eligibleAbsolutePaths,
    eligibleRelativePaths,
  };
}

function createRequestHandler(workspaceDir, htmlContent, opts = {}) {
  const normalizedBase = path.resolve(workspaceDir) + path.sep;
  const { apiClient, syncRunner, cfg, fileWatcher, logger, serverInstanceId } = opts;
  const syncMemoryDir = cfg?.memoryDir ? path.resolve(cfg.memoryDir) : null;

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

    // SSE endpoint â€” push file-change events to the frontend
    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write("retry: 1000\n");
      res.write(`data: ${JSON.stringify({
        type: "server-connected",
        serverInstanceId,
        connectedAt: new Date().toISOString(),
      })}\n\n`);
      if (fileWatcher) {
        fileWatcher.addSseClient(res);
        req.on("close", () => fileWatcher.removeSseClient(res));
      }
      return;
    }

    if (url.pathname === "/api/ui-presence" && req.method === "POST") {
      try {
        const bodyResult = await readBody(req);
        if (!bodyResult.ok) {
          sendJson(res, { ok: false, error: "invalid_json" });
          return;
        }
        await updateLocalUiPresence(syncRunner, {
          clientId: typeof bodyResult.body?.clientId === "string" ? bodyResult.body.clientId : null,
          serverInstanceId: typeof bodyResult.body?.serverInstanceId === "string" ? bodyResult.body.serverInstanceId : serverInstanceId,
          active: bodyResult.body?.active,
        });
        sendJson(res, { ok: true });
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
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
      if (!content) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end("Local UI build assets are unavailable.");
        return;
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

      let fileScan;
      try {
        fileScan = await scanWorkspaceMarkdownFile(workspaceDir, resolved, { includeContent: true });
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
        return;
      }

      sendJson(res, {
        fileName: fileScan.fileName,
        content: fileScan.content,
        privacyLevel: fileScan.privacyLevel,
        privacyAutoUpgraded: fileScan.privacyAutoUpgraded,
        hasSensitiveContent: fileScan.hasSensitiveContent,
        hasHighRiskSensitiveContent: fileScan.hasHighRiskSensitiveContent,
        sensitiveSummary: fileScan.sensitiveSummary,
        sensitiveFindings: fileScan.sensitiveFindings,
      });
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
        const bodyResult = await readBody(req);
        if (!bodyResult.ok) {
          logger?.warn?.(
            `[echo-memory] invalid JSON for ${url.pathname}: ${bodyResult.parseError}; body=${JSON.stringify(bodyResult.rawText.slice(0, 400))}`,
          );
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({
            ok: false,
            error: "Invalid JSON body",
            details: bodyResult.parseError,
          }));
          return;
        }
        const body = bodyResult.body;
        const payload = {
          ECHOMEM_API_KEY: typeof body.apiKey === "string" ? body.apiKey : "",
          ECHOMEM_MEMORY_DIR: typeof body.memoryDir === "string" ? body.memoryDir : "",
          ECHOMEM_DISABLE_OPENCLAW_MEMORY_TOOLS:
            typeof body.disableOpenClawMemoryToolsWhenConnected === "boolean"
              ? String(body.disableOpenClawMemoryToolsWhenConnected)
              : (typeof body.disableOpenClawMemoryToolsWhenConnected === "string"
                  ? body.disableOpenClawMemoryToolsWhenConnected
                  : "false"),
          ECHOMEM_LOCAL_ONLY_MODE:
            typeof body.apiKey === "string" && body.apiKey.trim()
              ? "false"
              : "true",
        };
        const saveResult = saveLocalUiSetup(payload);
        if (saveResult.migratedFrom) {
          logger?.info?.(
            `[echo-memory] Migrated local UI setup from ${saveResult.migratedFrom} to ${saveResult.targetPath}`,
          );
        }
        if (cfg) {
          cfg.apiKey = payload.ECHOMEM_API_KEY.trim();
          cfg.localOnlyMode = payload.ECHOMEM_LOCAL_ONLY_MODE === "true";
          cfg.memoryDir = payload.ECHOMEM_MEMORY_DIR.trim() || cfg.memoryDir;
          cfg.disableOpenClawMemoryToolsWhenConnected = payload.ECHOMEM_DISABLE_OPENCLAW_MEMORY_TOOLS === "true";
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

    // Backend sources â€” authoritative COMPLETE list of files already synced to Echo cloud
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
        const syncView = await buildWorkspaceSyncView({
          workspaceDir,
          syncMemoryDir,
          statePath,
          apiClient,
        });
        sendJson(res, {
          lastSyncAt: syncView.lastState?.finished_at ?? null,
          syncedFileCount: syncView.fileStatuses.filter((status) => status.status === 'synced').length,
          syncTargetRoot: syncMemoryDir,
          runInProgress: syncRunner?.isRunning?.() ?? false,
          activeRun: syncRunner?.getActiveRunInfo?.() ?? null,
          fileStatuses: syncView.fileStatuses,
        });
        return;

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
      if (syncRunner.isRunning?.()) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "A sync run is already in progress",
          activeRun: syncRunner.getActiveRunInfo?.() ?? null,
        }));
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
      if (!syncRunner) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Sync not available" }));
        return;
      }
      if (syncRunner.isRunning?.()) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "A sync run is already in progress",
          activeRun: syncRunner.getActiveRunInfo?.() ?? null,
        }));
        return;
      }
      try {
        const bodyResult = await readBody(req);
        if (!bodyResult.ok) {
          logger?.warn?.(
            `[echo-memory] invalid JSON for ${url.pathname}: ${bodyResult.parseError}; body=${JSON.stringify(bodyResult.rawText.slice(0, 400))}`,
          );
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "Invalid JSON body for sync-selected",
            details: bodyResult.parseError,
            receivedBodyPreview: bodyResult.rawText.slice(0, 400),
          }));
          return;
        }

        const body = bodyResult.body;
        const relativePaths = body.paths;
        if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
          logger?.warn?.(
            `[echo-memory] invalid sync-selected payload: expected non-empty paths array; body=${JSON.stringify(body).slice(0, 400)}`,
          );
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "paths array required",
            details: "Expected request body like {\"paths\":[\"memory/2026-03-17.md\"]}",
            receivedBody: body,
          }));
          return;
        }

        const statePath = syncRunner?.getStatePath() ?? null;
        const syncView = await buildWorkspaceSyncView({
          workspaceDir,
          syncMemoryDir,
          statePath,
          apiClient,
        });
        const statusMap = new Map(syncView.fileStatuses.map((status) => [status.relativePath, status]));
        const requestedFilterPaths = new Set();
        const requestedInvalidPaths = [];
        for (const rp of relativePaths) {
          if (typeof rp !== "string" || !rp.trim()) {
            requestedInvalidPaths.push({ path: rp, reason: "invalid_path" });
            continue;
          }
          const absPath = path.resolve(workspaceDir, rp);
          if (!absPath.startsWith(path.resolve(workspaceDir) + path.sep) || !absPath.endsWith(".md")) {
            requestedInvalidPaths.push({ path: rp, reason: "invalid_path" });
            continue;
          }
          const status = statusMap.get(rp);
          if (!status?.syncEligible || !syncView.eligibleAbsolutePaths.has(absPath)) {
            requestedInvalidPaths.push({
              path: rp,
              reason: status?.syncReason || "not_sync_eligible",
            });
            continue;
          }
          requestedFilterPaths.add(absPath);
        }

        if (requestedInvalidPaths.length > 0) {
          logger?.warn?.(
            `[echo-memory] sync-selected rejected invalid or ineligible paths; requested=${JSON.stringify(relativePaths).slice(0, 400)}`,
          );
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "One or more selected files cannot be synced",
            details: "Selected files must be markdown files directly inside the configured memory directory.",
            invalidPaths: requestedInvalidPaths,
            requestedPaths: relativePaths,
          }));
          return;
        }

        if (requestedFilterPaths.size === 0) {
          logger?.warn?.(
            `[echo-memory] sync-selected contained no valid markdown paths; requested=${JSON.stringify(relativePaths).slice(0, 400)}`,
          );
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "No valid markdown paths to sync",
            details: "All provided paths were outside the configured memory directory or were not sync-eligible.",
            requestedPaths: relativePaths,
          }));
          return;
        }

        const result = await syncRunner.runSync("local-ui-selected", requestedFilterPaths);
        sendJson(res, result);
        return;
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
  const htmlContent = await readLegacyUiHtml(opts.logger);
  const fileWatcher = createFileWatcher(workspaceDir);
  const serverInstanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const unsubscribeSyncProgress = typeof opts.syncRunner?.onProgress === "function"
    ? opts.syncRunner.onProgress((event) => {
        const mapPath = (targetPath) => {
          if (!targetPath) return null;
          const relativePath = path.relative(workspaceDir, targetPath);
          if (!relativePath || relativePath.startsWith("..")) return null;
          return relativePath.replace(/\\/g, "/");
        };

        fileWatcher.broadcast({
          type: "sync-progress",
          progress: {
            ...event,
            queuedRelativePaths: event.phase === "started"
              ? (event.currentFilePaths || []).map(mapPath).filter(Boolean)
              : [],
            currentRelativePath: mapPath(event.currentFilePath),
            currentRelativePaths: (event.currentFilePaths || []).map(mapPath).filter(Boolean),
            completedRelativePaths: (event.completedFilePaths || []).map(mapPath).filter(Boolean),
            failedRelativePaths: (event.failedFilePaths || []).map(mapPath).filter(Boolean),
            recentFileResult: event.recentFileResult
              ? {
                  ...event.recentFileResult,
                  relativePath: mapPath(event.recentFileResult.filePath),
                }
              : null,
          },
        });
      })
    : null;
  const handler = createRequestHandler(workspaceDir, htmlContent, { ...opts, fileWatcher, serverInstanceId });
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
    throw new Error(`Could not bind to ports ${BASE_PORT}â€“${BASE_PORT + 2}. All in use.`);
  }

  const url = `http://127.0.0.1:${port}`;
  _instance = { server, url, fileWatcher, unsubscribeSyncProgress, serverInstanceId };
  return url;
}

export async function waitForLocalUiClient({ timeoutMs = 0 } = {}) {
  return _instance?.fileWatcher?.waitForClient(timeoutMs) ?? false;
}

export function stopLocalServer() {
  if (_instance) {
    _instance.server.close();
    if (_instance.fileWatcher) _instance.fileWatcher.close();
    if (_instance.unsubscribeSyncProgress) _instance.unsubscribeSyncProgress();
    _instance = null;
  }
}
