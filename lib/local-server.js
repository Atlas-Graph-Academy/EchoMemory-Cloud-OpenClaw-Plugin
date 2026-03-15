import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { scanFullWorkspace, scanOpenClawMemoryDir } from "./openclaw-memory-scan.js";
import { readLastSyncState } from "./state.js";

const BASE_PORT = 17823;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_HTML_PATH = path.join(__dirname, "local-ui.html");

let _instance = null;

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
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlContent);
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
            if (fp && r.status === "imported") {
              // Store contentHash if available; otherwise mark as synced without hash
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

    res.writeHead(404);
    res.end("Not Found");
  };
}

export async function startLocalServer(workspaceDir, opts = {}) {
  if (_instance) {
    return _instance.url;
  }

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
