import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scanFullWorkspace } from "./openclaw-memory-scan.js";

const BASE_PORT = 17823;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_HTML_PATH = path.join(__dirname, "local-ui.html");

let _instance = null;

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

function createRequestHandler(workspaceDir, htmlContent) {
  const normalizedBase = path.resolve(workspaceDir) + path.sep;

  return async function handler(req, res) {
    setCorsHeaders(res);

    let url;
    try {
      url = new URL(req.url, "http://127.0.0.1");
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
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

    res.writeHead(404);
    res.end("Not Found");
  };
}

export async function startLocalServer(workspaceDir) {
  if (_instance) {
    return _instance.url;
  }

  const htmlContent = await fs.readFile(UI_HTML_PATH, "utf8");
  const handler = createRequestHandler(workspaceDir, htmlContent);
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
    throw new Error(`Could not bind to ports ${BASE_PORT}–${BASE_PORT + 2}. All in use.`);
  }

  const url = `http://127.0.0.1:${port}`;
  _instance = { server, url };
  return url;
}

export function stopLocalServer() {
  if (_instance) {
    _instance.server.close();
    _instance = null;
  }
}
