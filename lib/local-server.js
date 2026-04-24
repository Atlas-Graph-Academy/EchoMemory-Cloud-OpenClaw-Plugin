import http from "node:http";
import { spawn } from "node:child_process";
import https from "node:https";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { createApiClient } from "./api-client.js";
import { getLocalUiSetupState, saveLocalUiSetup } from "./config.js";
import { scanFullWorkspace, scanWorkspaceMarkdownFile } from "./openclaw-memory-scan.js";
import {
  readCanvasLayoutState,
  readLastSyncState,
  readLocalUiPresence,
  resolveCanvasLayoutPath,
  resolveUiPresencePath,
  writeCanvasLayoutState,
  writeLocalUiPresence,
} from "./state.js";

async function applyAccountIdentity(opts, logger, accountId, reason) {
  try {
    const setter = opts?.syncRunner?.setCurrentAccountId;
    if (typeof setter !== "function") return;
    await setter(accountId || null);
    logger?.info?.(
      accountId
        ? `[echo-memory] active sync account set to ${String(accountId).slice(0, 8)}… (${reason})`
        : `[echo-memory] active sync account cleared (${reason})`,
    );
  } catch (err) {
    logger?.warn?.(
      `[echo-memory] failed to apply sync account identity: ${String(err?.message ?? err)}`,
    );
  }
}

const BASE_PORT = 17823;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT_DIR = path.resolve(__dirname, "..");
const ROOT_PACKAGE_JSON_PATH = path.join(PLUGIN_ROOT_DIR, "package.json");
const UI_HTML_PATH = path.join(__dirname, "local-ui.html");
const UI_WORKDIR = path.join(__dirname, "local-ui");
const UI_DIST_DIR = path.join(__dirname, "local-ui", "dist");
const UI_NODE_MODULES_DIR = path.join(UI_WORKDIR, "node_modules");
// Dev mode: set DEV_UI_PORT env var, or create lib/local-ui/.devmode file
// containing the Vite port (default 5173). Gateway will redirect UI requests
// to the Vite dev server so you see live local changes.
function getDevUiPort() {
  if (process.env.DEV_UI_PORT) return process.env.DEV_UI_PORT;
  try {
    const flag = fsSync.readFileSync(path.join(UI_WORKDIR, ".devmode"), "utf8").trim();
    return flag || "5173";
  } catch { return null; }
}
const DEV_UI_PORT = getDevUiPort();

let _instance = null;
let _bootstrapPromise = null;
let _lastOpenedUrl = null;
let _pluginUpdatePromise = null;
const BACKEND_SOURCE_LOOKUP_TIMEOUT_MS = 4000;
const LOCAL_UI_PRESENCE_STALE_MS = 75000;
const PLUGIN_UPDATE_REGISTRY_TIMEOUT_MS = 5000;
const PLUGIN_UPDATE_UNSAFE_INSTALL_FLAG = "--dangerously-force-unsafe-install";
const MAX_CANVAS_LAYOUT_STACKS = 500;
const MAX_CANVAS_LAYOUT_CARDS = 5000;

/* â”€â”€ File Watcher + SSE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", "logs", "completions", "delivery-queue", "browser", "canvas", "cron", "media"]);

/** Debounced file-change broadcaster */
function createFileWatcher(workspaceDir, opts = {}) {
  const sseClients = new Set();
  const clientWaiters = new Set();
  const watchers = [];
  let debounceTimer = null;
  const DEBOUNCE_MS = 500;
  const changedMarkdownFiles = new Map();

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

  function onFileChange(dir, eventType, filename) {
    const normalizedFilename = typeof filename === "string" ? filename : String(filename || "");
    if (!normalizedFilename || path.extname(normalizedFilename).toLowerCase() !== ".md") return;
    const absolutePath = path.join(dir, normalizedFilename);
    const relativePath = path.relative(workspaceDir, absolutePath).replace(/\\/g, "/");
    changedMarkdownFiles.set(absolutePath, {
      absolutePath,
      relativePath,
      filename: normalizedFilename,
      eventType,
    });
    // Debounce: batch rapid changes into one event
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const changedEntries = [...changedMarkdownFiles.values()];
      changedMarkdownFiles.clear();
      const lastEntry = changedEntries[changedEntries.length - 1] ?? null;
      broadcast({
        type: "files-changed",
        file: lastEntry?.filename ?? filename,
        files: changedEntries.map((entry) => entry.relativePath),
        at: new Date().toISOString(),
      });
      for (const entry of changedEntries) {
        opts.onMarkdownChanged?.(entry);
      }
    }, DEBOUNCE_MS);
  }

  function watchRecursive(dir) {
    let entries;
    try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    // Watch this directory
    try {
      const w = fsSync.watch(dir, { persistent: false }, (eventType, filename) => onFileChange(dir, eventType, filename));
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

function sendJsonWithStatus(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
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

function resolveCanvasLayoutStatePath(opts = {}) {
  const syncStatePath = opts?.syncRunner?.getStatePath?.();
  if (!syncStatePath) return null;
  return resolveCanvasLayoutPath(path.dirname(syncStatePath));
}

function sanitizeCanvasLayout(rawLayout) {
  const source = rawLayout && typeof rawLayout === "object" ? rawLayout : {};
  const rawStacks = source.stacks && typeof source.stacks === "object" ? source.stacks : {};
  const stacks = {};
  let stackCount = 0;
  let cardCount = 0;

  for (const [rawId, rawStack] of Object.entries(rawStacks)) {
    if (stackCount >= MAX_CANVAS_LAYOUT_STACKS) break;
    if (!rawStack || typeof rawStack !== "object") continue;
    const id = String(rawStack.id || rawId || "").trim();
    if (!id) continue;
    const rawCardIds = Array.isArray(rawStack.cardIds) ? rawStack.cardIds : [];
    const cardIds = [];
    for (const cardId of rawCardIds) {
      if (cardCount >= MAX_CANVAS_LAYOUT_CARDS) break;
      const normalized = String(cardId || "").replace(/\\/g, "/").trim();
      if (!normalized || normalized.includes("\0")) continue;
      cardIds.push(normalized);
      cardCount += 1;
    }
    if (cardIds.length === 0) continue;

    const x = Number(rawStack.x);
    const y = Number(rawStack.y);
    stacks[id] = {
      id,
      name: typeof rawStack.name === "string" && rawStack.name.trim()
        ? rawStack.name.trim().slice(0, 120)
        : null,
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      cardIds,
    };
    stackCount += 1;
  }

  const nextStackNum = Number.parseInt(String(source.nextStackNum ?? ""), 10);
  return {
    version: 1,
    stacks,
    nextStackNum: Number.isFinite(nextStackNum) && nextStackNum > 0 ? nextStackNum : 1,
  };
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
    const child = process.platform === "win32"
      ? spawn("cmd.exe", [
          "/d",
          "/s",
          "/c",
          [getNpmCommand(), ...args].map(escapeWindowsShellArg).join(" "),
        ], {
          cwd: UI_WORKDIR,
          stdio: "pipe",
          windowsHide: true,
        })
      : spawn(getNpmCommand(), args, {
          cwd: UI_WORKDIR,
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

function normalizeErrorStatus(error, fallback = 500) {
  const status = Number.parseInt(String(error?.status ?? error?.payload?.status ?? ""), 10);
  if (Number.isFinite(status) && status >= 400 && status <= 599) {
    return status;
  }
  return fallback;
}

function getOpenClawCommand() {
  return process.platform === "win32" ? "openclaw.cmd" : "openclaw";
}

function escapeWindowsShellArg(value) {
  const stringValue = String(value ?? "");
  if (!/[ \t"&^|<>]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function findOpenClawHomeDir(startDir = PLUGIN_ROOT_DIR) {
  let currentDir = path.resolve(startDir);
  while (true) {
    if (fsSync.existsSync(path.join(currentDir, "gateway.cmd")) || fsSync.existsSync(path.join(currentDir, "openclaw.json"))) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function getGatewayLauncherPath() {
  const openClawHomeDir = findOpenClawHomeDir();
  if (!openClawHomeDir) {
    return null;
  }
  return process.platform === "win32"
    ? path.join(openClawHomeDir, "gateway.cmd")
    : null;
}

function runOpenClawCommand(args, logger) {
  return new Promise((resolve, reject) => {
    const child = process.platform === "win32"
      ? spawn("cmd.exe", [
          "/d",
          "/s",
          "/c",
          [getOpenClawCommand(), ...args].map(escapeWindowsShellArg).join(" "),
        ], {
          cwd: PLUGIN_ROOT_DIR,
          stdio: "pipe",
          windowsHide: true,
        })
      : spawn(getOpenClawCommand(), args, {
          cwd: PLUGIN_ROOT_DIR,
          stdio: "pipe",
          windowsHide: true,
        });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const output = [...stderr, ...stdout].join("").trim();
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(output || `openclaw ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  }).catch((error) => {
    logger?.warn?.(`[echo-memory] openclaw ${args.join(" ")} failed: ${String(error?.message ?? error)}`);
    throw error;
  });
}

function restartOpenClawGatewayDetached(logger) {
  if (process.platform === "win32") {
    const gatewayLauncherPath = getGatewayLauncherPath();
    if (!gatewayLauncherPath || !fsSync.existsSync(gatewayLauncherPath)) {
      return { ok: false, error: "Could not locate gateway.cmd for restart" };
    }
    try {
      const escapedLauncherPath = gatewayLauncherPath.replace(/'/g, "''");
      const child = spawn("powershell.exe", [
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-Command",
        `Start-Sleep -Seconds 1; Start-Process -FilePath '${escapedLauncherPath}'`,
      ], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      setTimeout(() => {
        process.exit(0);
      }, 250);
      return { ok: true };
    } catch (error) {
      logger?.warn?.(`[echo-memory] gateway.cmd relaunch failed: ${String(error?.message ?? error)}`);
      return { ok: false, error: String(error?.message ?? error) };
    }
  }

  try {
    const child = spawn(getOpenClawCommand(), ["gateway", "restart"], {
      cwd: PLUGIN_ROOT_DIR,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return { ok: true };
  } catch (error) {
    logger?.warn?.(`[echo-memory] openclaw gateway restart failed: ${String(error?.message ?? error)}`);
    return { ok: false, error: String(error?.message ?? error) };
  }
}

function readPluginPackageInfo() {
  try {
    const raw = fsSync.readFileSync(ROOT_PACKAGE_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      name: typeof parsed?.name === "string" ? parsed.name : "unknown",
      version: typeof parsed?.version === "string" ? parsed.version : "0.0.0",
      repositoryUrl:
        typeof parsed?.repository?.url === "string"
          ? parsed.repository.url
          : null,
    };
  } catch {
    return {
      name: "unknown",
      version: "0.0.0",
      repositoryUrl: null,
    };
  }
}

function compareSemverLoose(left, right) {
  const leftParts = String(left || "0.0.0").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || "0.0.0").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < len; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function detectPluginInstallSource() {
  const gitDir = path.join(PLUGIN_ROOT_DIR, ".git");
  if (fsSync.existsSync(gitDir)) {
    return {
      source: "local_checkout",
      label: "Local checkout / linked repo",
      canUpdate: false,
      reason: "This plugin appears to be running from a local checkout or linked repo. Use git/npm locally for development updates.",
    };
  }
  return {
    source: "packaged",
    label: "Packaged install",
    canUpdate: true,
    reason: null,
  };
}

function fetchJsonOverHttps(url, timeoutMs = PLUGIN_UPDATE_REGISTRY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "echomem-local-ui/1.0",
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 240)}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
  });
}

async function fetchLatestPluginReleaseInfo(packageName) {
  const encodedName = encodeURIComponent(packageName);
  const data = await fetchJsonOverHttps(`https://registry.npmjs.org/${encodedName}/latest`);
  return {
    packageName,
    latestVersion: typeof data?.version === "string" ? data.version : null,
    releaseUrl: typeof data?.homepage === "string" && data.homepage
      ? data.homepage
      : `https://www.npmjs.com/package/${packageName}`,
  };
}

async function getPluginUpdateStatus() {
  const packageInfo = readPluginPackageInfo();
  const installSource = detectPluginInstallSource();
  try {
    const latestInfo = await fetchLatestPluginReleaseInfo(packageInfo.name);
    const updateAvailable = latestInfo.latestVersion
      ? compareSemverLoose(latestInfo.latestVersion, packageInfo.version) > 0
      : false;
    return {
      ok: true,
      currentVersion: packageInfo.version,
      latestVersion: latestInfo.latestVersion,
      packageName: packageInfo.name,
      repositoryUrl: packageInfo.repositoryUrl,
      releaseUrl: latestInfo.releaseUrl,
      updateAvailable,
      installSource: installSource.source,
      installSourceLabel: installSource.label,
      canUpdate: installSource.canUpdate,
      updateDisabledReason: installSource.reason,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      currentVersion: packageInfo.version,
      latestVersion: null,
      packageName: packageInfo.name,
      repositoryUrl: packageInfo.repositoryUrl,
      releaseUrl: `https://www.npmjs.com/package/${packageInfo.name}`,
      updateAvailable: false,
      installSource: installSource.source,
      installSourceLabel: installSource.label,
      canUpdate: installSource.canUpdate,
      updateDisabledReason: installSource.reason,
      checkedAt: new Date().toISOString(),
      error: String(error?.message ?? error),
    };
  }
}

function formatPluginUpdateError(error) {
  const message = String(error?.message ?? error ?? "").trim();
  if (!message) {
    return "Plugin update failed";
  }
  if (message.includes('Unrecognized key: "dangerousAllow"')) {
    return [
      "OpenClaw config is invalid: remove `plugins.dangerousAllow` from `~/.openclaw/openclaw.json`.",
      "OpenClaw 2026.4.8 supports `plugins.allow`, but not `plugins.dangerousAllow`.",
    ].join(" ");
  }
  return message;
}

async function performPluginUpdate(logger, { restartGateway = false } = {}) {
  if (_pluginUpdatePromise) {
    return _pluginUpdatePromise;
  }

  _pluginUpdatePromise = (async () => {
    const status = await getPluginUpdateStatus();
    if (!status.canUpdate) {
      throw new Error(status.updateDisabledReason || "Plugin update is disabled for this install source");
    }
    if (!status.packageName || status.packageName === "unknown") {
      throw new Error("Could not determine package name for plugin update");
    }

    const installSpec = status.latestVersion
      ? `${status.packageName}@${status.latestVersion}`
      : `${status.packageName}@latest`;
    let output;
    try {
      output = await runOpenClawCommand(
        ["plugins", "install", PLUGIN_UPDATE_UNSAFE_INSTALL_FLAG, installSpec],
        logger,
      );
    } catch (error) {
      throw new Error(formatPluginUpdateError(error));
    }

    if (restartGateway) {
      const restartResult = restartOpenClawGatewayDetached(logger);
      if (!restartResult.ok) {
        throw new Error(restartResult.error || "Plugin updated, but gateway restart failed");
      }
    }

    return {
      ok: true,
      previousVersion: status.currentVersion,
      latestVersion: status.latestVersion,
      packageName: status.packageName,
      installSpec,
      restartTriggered: restartGateway,
      restartRecommended: !restartGateway,
      output,
      message: restartGateway
        ? `Installed ${installSpec} with OpenClaw's unsafe-install override and triggered openclaw gateway restart.`
        : `Installed ${installSpec} with OpenClaw's unsafe-install override. Restart openclaw gateway to load the new version.`,
    };
  })();

  try {
    return await _pluginUpdatePromise;
  } finally {
    _pluginUpdatePromise = null;
  }
}

function resolveWorkspaceMarkdownPath(workspaceDir, requestedPath) {
  if (!requestedPath) {
    return null;
  }

  const normalizedBase = path.resolve(workspaceDir) + path.sep;
  const resolved = path.resolve(workspaceDir, String(requestedPath));
  if (!resolved.startsWith(normalizedBase) || !resolved.toLowerCase().endsWith(".md")) {
    return null;
  }
  return resolved;
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
      addSource(source?.file_path, source?.latest_at ?? source?.updated_at ?? source?.created_at ?? null);
    }
    return sources;
  } catch {
    // Fall through to import-status fallback.
  }

  try {
    const status = await apiClient.getImportStatus();
    for (const source of status?.recent_sources || []) {
      addSource(source?.file_path, source?.updated_at ?? source?.created_at ?? null);
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
      status = successfulHash === f.contentHash ? "synced" : "modified";
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
  let { apiClient, syncRunner, cfg, fileWatcher, logger, serverInstanceId } = opts;
  const syncMemoryDir = cfg?.memoryDir ? path.resolve(cfg.memoryDir) : null;
  const resolveApiClient = () => {
    if (!apiClient && cfg) {
      apiClient = createApiClient(cfg);
    }
    return apiClient;
  };

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

    // ── Dev-mode redirect: when DEV_UI_PORT is set, send browser to Vite ──
    if (DEV_UI_PORT && (url.pathname === "/" || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/src/") || url.pathname.startsWith("/@") || url.pathname.startsWith("/node_modules/"))) {
      const devUrl = `http://localhost:${DEV_UI_PORT}${url.pathname}${url.search || ""}`;
      res.writeHead(302, { Location: devUrl, "Cache-Control": "no-store" });
      res.end();
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

    if (url.pathname === "/api/canvas-layout" && req.method === "GET") {
      const layoutPath = resolveCanvasLayoutStatePath(opts);
      if (!layoutPath) {
        sendJson(res, { ok: true, layout: null, path: null });
        return;
      }
      const layout = await readCanvasLayoutState(layoutPath);
      sendJson(res, {
        ok: true,
        layout: layout ? sanitizeCanvasLayout(layout) : null,
        path: layoutPath,
      });
      return;
    }

    if (url.pathname === "/api/canvas-layout" && req.method === "POST") {
      const layoutPath = resolveCanvasLayoutStatePath(opts);
      if (!layoutPath) {
        sendJsonWithStatus(res, 500, { ok: false, error: "Canvas layout state path unavailable" });
        return;
      }
      const bodyResult = await readBody(req);
      if (!bodyResult.ok) {
        sendJsonWithStatus(res, 400, {
          ok: false,
          error: "Invalid JSON body",
          details: bodyResult.parseError,
        });
        return;
      }

      const layout = sanitizeCanvasLayout(bodyResult.body?.layout ?? bodyResult.body);
      const saved = await writeCanvasLayoutState(layoutPath, layout);
      sendJson(res, {
        ok: true,
        layout: saved,
        path: layoutPath,
      });
      return;
    }

    if (url.pathname === "/api/file" && req.method === "GET") {
      const requestedPath = url.searchParams.get("path");
      if (!requestedPath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing path parameter" }));
        return;
      }

      const resolved = resolveWorkspaceMarkdownPath(workspaceDir, requestedPath);
      if (!resolved) {
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
        riskLevel: fileScan.riskLevel,
        hasSensitiveContent: fileScan.hasSensitiveContent,
        hasHighRiskSensitiveContent: fileScan.hasHighRiskSensitiveContent,
        sensitiveSummary: fileScan.sensitiveSummary,
        sensitiveFindings: fileScan.sensitiveFindings,
      });
      return;
    }

    if (url.pathname === "/api/file" && req.method === "POST") {
      try {
        const bodyResult = await readBody(req);
        if (!bodyResult.ok) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Invalid JSON body", details: bodyResult.parseError }));
          return;
        }

        const requestedPath =
          typeof bodyResult.body?.path === "string"
            ? bodyResult.body.path
            : typeof bodyResult.body?.relativePath === "string"
              ? bodyResult.body.relativePath
              : null;
        const content =
          typeof bodyResult.body?.content === "string"
            ? bodyResult.body.content
            : null;

        if (!requestedPath) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Missing path" }));
          return;
        }
        if (content == null) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Missing content" }));
          return;
        }

        const resolved = resolveWorkspaceMarkdownPath(workspaceDir, requestedPath);
        if (!resolved) {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Forbidden" }));
          return;
        }

        await fs.writeFile(resolved, content, "utf8");
        const fileScan = await scanWorkspaceMarkdownFile(workspaceDir, resolved, { includeContent: true });
        fileWatcher?.broadcast?.({
          type: "files-changed",
          file: fileScan.fileName,
          relativePath: fileScan.relativePath,
          at: new Date().toISOString(),
        });
        sendJson(res, {
          ok: true,
          file: fileScan,
          content: fileScan.content,
        });
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: String(error?.message ?? error) }));
      }
      return;
    }

    if (url.pathname === "/api/auth-status") {
      const activeApiClient = resolveApiClient();
      if (!activeApiClient) {
        sendJson(res, { connected: false, reason: "no_client" });
        return;
      }
      const hasKey = !!(cfg && cfg.apiKey);
      if (!hasKey) {
        sendJson(res, { connected: false, reason: "no_api_key" });
        return;
      }
      try {
        const whoami = await activeApiClient.whoami();
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
      sendJson(res, {
        ...getLocalUiSetupState(opts.pluginConfig ?? {}, cfg),
        capabilities: {
          cloudSidebarApi: true,
          emailQuickConnect: true,
          pluginUpdateUi: true,
        },
      });
      return;
    }

    if (url.pathname === "/api/auth/send-otp" && req.method === "POST") {
      try {
        const activeApiClient = resolveApiClient();
        if (!activeApiClient) {
          sendJsonWithStatus(res, 500, { ok: false, error: "Echo API client unavailable" });
          return;
        }

        const bodyResult = await readBody(req);
        if (!bodyResult.ok) {
          sendJsonWithStatus(res, 400, {
            ok: false,
            error: "Invalid JSON body",
            details: bodyResult.parseError,
          });
          return;
        }

        const email = typeof bodyResult.body?.email === "string"
          ? bodyResult.body.email.trim().toLowerCase()
          : "";
        if (!email) {
          sendJsonWithStatus(res, 400, { ok: false, error: "Email is required" });
          return;
        }

        const result = await activeApiClient.sendOtp(email);
        sendJson(res, result);
      } catch (error) {
        sendJsonWithStatus(res, normalizeErrorStatus(error), {
          ok: false,
          error: String(error?.message ?? error),
        });
      }
      return;
    }

    if (url.pathname === "/api/auth/verify-otp" && req.method === "POST") {
      try {
        const activeApiClient = resolveApiClient();
        if (!activeApiClient) {
          sendJsonWithStatus(res, 500, { ok: false, error: "Echo API client unavailable" });
          return;
        }

        const bodyResult = await readBody(req);
        if (!bodyResult.ok) {
          sendJsonWithStatus(res, 400, {
            ok: false,
            error: "Invalid JSON body",
            details: bodyResult.parseError,
          });
          return;
        }

        const email = typeof bodyResult.body?.email === "string"
          ? bodyResult.body.email.trim().toLowerCase()
          : "";
        const otp = typeof bodyResult.body?.otp === "string"
          ? bodyResult.body.otp.trim()
          : "";
        if (!email || !otp) {
          sendJsonWithStatus(res, 400, {
            ok: false,
            error: "Email and verification code are required",
          });
          return;
        }

        const result = await activeApiClient.verifyOtp(email, otp);
        if (!result?.ok || !result?.api_key) {
          sendJson(res, result ?? { ok: false, error: "Verification failed" });
          return;
        }

        if (result.user_id) {
          await applyAccountIdentity(opts, logger, String(result.user_id), "OTP verify");
        }

        const saveResult = saveLocalUiSetup({
          ECHOMEM_API_KEY: result.api_key,
          ECHOMEM_LOCAL_ONLY_MODE: "false",
        });
        if (saveResult.migratedFrom) {
          logger?.info?.(
            `[echo-memory] Migrated local UI setup from ${saveResult.migratedFrom} to ${saveResult.targetPath}`,
          );
        }
        if (cfg) {
          cfg.apiKey = result.api_key;
          cfg.localOnlyMode = false;
        }

        sendJson(res, {
          ok: true,
          connected: true,
          email: result.email || email,
          user_id: result.user_id || null,
          onboarding_completed: result.onboarding_completed === true,
          setup: getLocalUiSetupState(opts.pluginConfig ?? {}, cfg),
        });
      } catch (error) {
        sendJsonWithStatus(res, normalizeErrorStatus(error), {
          ok: false,
          error: String(error?.message ?? error),
        });
      }
      return;
    }

    if (url.pathname === "/api/plugin-update-status") {
      try {
        sendJson(res, await getPluginUpdateStatus());
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
      }
      return;
    }

    if (url.pathname === "/api/plugin-update" && req.method === "POST") {
      try {
        const bodyResult = await readBody(req);
        if (!bodyResult.ok) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Invalid JSON body", details: bodyResult.parseError }));
          return;
        }
        const restartGateway = bodyResult.body?.restartGateway === true;
        sendJson(res, await performPluginUpdate(logger, { restartGateway }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
      }
      return;
    }

    if (url.pathname === "/api/plugin-restart-gateway" && req.method === "POST") {
      const restartResult = restartOpenClawGatewayDetached(logger);
      if (!restartResult.ok) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: restartResult.error || "Gateway restart failed" }));
        return;
      }
      sendJson(res, {
        ok: true,
        message: "Triggered openclaw gateway restart.",
      });
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
        const resolvedAutoSync =
          typeof body.autoSync === "boolean"
            ? body.autoSync
            : (typeof body.autoSync === "string"
                ? !["0", "false", "no", "off"].includes(body.autoSync.trim().toLowerCase())
                : Boolean(cfg?.autoSync));
        const parsedSyncIntervalMinutes = Number.parseInt(
          String(
            typeof body.syncIntervalMinutes === "number" || typeof body.syncIntervalMinutes === "string"
              ? body.syncIntervalMinutes
              : (cfg?.syncIntervalMinutes ?? 15),
          ).trim(),
          10,
        );
        const resolvedSyncIntervalMinutes = Number.isFinite(parsedSyncIntervalMinutes)
          ? Math.max(15, Math.min(1440, parsedSyncIntervalMinutes))
          : Math.max(15, Math.min(1440, Number.parseInt(String(cfg?.syncIntervalMinutes ?? 15), 10) || 15));
        const parsedBatchSize = Number.parseInt(
          String(
            typeof body.batchSize === "number" || typeof body.batchSize === "string"
              ? body.batchSize
              : (cfg?.batchSize ?? 10),
          ).trim(),
          10,
        );
        const resolvedBatchSize = Number.isFinite(parsedBatchSize)
          ? Math.max(1, Math.min(25, parsedBatchSize))
          : Math.max(1, Math.min(25, Number.parseInt(String(cfg?.batchSize ?? 10), 10) || 10));
        const parsedRequestTimeoutMs = Number.parseInt(
          String(
            typeof body.requestTimeoutMs === "number" || typeof body.requestTimeoutMs === "string"
              ? body.requestTimeoutMs
              : (cfg?.requestTimeoutMs ?? 300000),
          ).trim(),
          10,
        );
        const resolvedRequestTimeoutMs = Number.isFinite(parsedRequestTimeoutMs)
          ? Math.max(1000, Math.min(900000, parsedRequestTimeoutMs))
          : Math.max(1000, Math.min(900000, Number.parseInt(String(cfg?.requestTimeoutMs ?? 300000), 10) || 300000));
        const payload = {
          ECHOMEM_API_KEY: typeof body.apiKey === "string" ? body.apiKey : "",
          ECHOMEM_MEMORY_DIR: typeof body.memoryDir === "string" ? body.memoryDir : "",
          ECHOMEM_AUTO_SYNC: String(resolvedAutoSync),
          ECHOMEM_SYNC_INTERVAL_MINUTES: String(resolvedSyncIntervalMinutes),
          ECHOMEM_BATCH_SIZE: String(resolvedBatchSize),
          ECHOMEM_REQUEST_TIMEOUT_MS: String(resolvedRequestTimeoutMs),
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
        const previousApiKey = typeof cfg?.apiKey === "string" ? cfg.apiKey.trim() : "";
        const nextApiKey = payload.ECHOMEM_API_KEY.trim();
        const apiKeyChanged = previousApiKey !== nextApiKey;

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
          cfg.autoSync = payload.ECHOMEM_AUTO_SYNC === "true";
          cfg.syncIntervalMinutes = resolvedSyncIntervalMinutes;
          cfg.batchSize = resolvedBatchSize;
          cfg.requestTimeoutMs = resolvedRequestTimeoutMs;
          cfg.disableOpenClawMemoryToolsWhenConnected = payload.ECHOMEM_DISABLE_OPENCLAW_MEMORY_TOOLS === "true";
        }

        if (apiKeyChanged) {
          if (!nextApiKey) {
            await applyAccountIdentity(opts, logger, null, "api key cleared via setup-config");
          } else if (cfg) {
            try {
              const probe = await createApiClient(cfg).whoami();
              const newUserId = probe?.user_id ? String(probe.user_id) : null;
              await applyAccountIdentity(opts, logger, newUserId, "api key changed via setup-config");
            } catch (err) {
              logger?.warn?.(
                `[echo-memory] whoami after setup-config failed: ${String(err?.message ?? err)}`,
              );
              await applyAccountIdentity(opts, logger, null, "api key changed; whoami failed");
            }
          }
        }

        if (opts.syncRunner) {
          opts.syncRunner.stopInterval?.();
          if (cfg?.autoSync) {
            opts.syncRunner.startInterval?.();
          }
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
      const activeApiClient = resolveApiClient();
      if (!activeApiClient) {
        sendJson(res, { ok: false, sources: [], error: "no_client" });
        return;
      }
      try {
        const data = await activeApiClient.listAllSources();
        sendJson(res, {
          ok: true,
          total: data.total || 0,
          sources: (data.paths || []).map(s => ({
            filePath: s.file_path,
            isProcessed: s.is_processed,
            latestAt: s.latest_at ?? s.updated_at ?? s.created_at ?? null,
          })),
        });
      } catch (e) {
        // Fallback to import-status if new endpoint not deployed yet
        try {
          const status = await activeApiClient.getImportStatus();
          const sources = (status.recent_sources || []).map(s => ({
            filePath: s.file_path,
            isProcessed: s.is_processed,
            latestAt: s.updated_at ?? s.created_at ?? null,
          }));
          sendJson(res, { ok: true, total: sources.length, sources });
        } catch (e2) {
          sendJson(res, { ok: false, sources: [], error: String(e2?.message ?? e2) });
        }
      }
      return;
    }

    if (url.pathname === "/api/cloud-memories") {
      const activeApiClient = resolveApiClient();
      if (!activeApiClient) {
        sendJson(res, { ok: false, data: [], count: 0, countWithSource: 0, error: "no_client" });
        return;
      }
      try {
        const data = await activeApiClient.listCloudMemories({ limit: 250, offset: 0 });
        sendJson(res, {
          ok: true,
          data: Array.isArray(data?.data) ? data.data : [],
          count: Number.isFinite(data?.count) ? data.count : 0,
          countWithSource: Number.isFinite(data?.countWithSource) ? data.countWithSource : 0,
        });
      } catch (e) {
        sendJson(res, {
          ok: false,
          data: [],
          count: 0,
          countWithSource: 0,
          error: String(e?.message ?? e),
        });
      }
      return;
    }

    if (url.pathname === "/api/cloud-sources") {
      const activeApiClient = resolveApiClient();
      if (!activeApiClient) {
        sendJson(res, { ok: false, data: [], count: 0, door_titles: {}, door_public_map: {}, error: "no_client" });
        return;
      }
      try {
        const data = await activeApiClient.listCloudSources({ limit: 250, offset: 0 });
        sendJson(res, {
          ok: true,
          data: Array.isArray(data?.data) ? data.data : [],
          count: Number.isFinite(data?.count) ? data.count : 0,
          door_titles: data?.door_titles && typeof data.door_titles === "object" ? data.door_titles : {},
          door_public_map: data?.door_public_map && typeof data.door_public_map === "object" ? data.door_public_map : {},
        });
      } catch (e) {
        sendJson(res, {
          ok: false,
          data: [],
          count: 0,
          door_titles: {},
          door_public_map: {},
          error: String(e?.message ?? e),
        });
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

    if (url.pathname === "/api/reextract-selected" && req.method === "POST") {
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
            error: "Invalid JSON body for reextract-selected",
            details: bodyResult.parseError,
            receivedBodyPreview: bodyResult.rawText.slice(0, 400),
          }));
          return;
        }

        const body = bodyResult.body;
        const relativePaths = body.paths;
        if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
          logger?.warn?.(
            `[echo-memory] invalid reextract-selected payload: expected non-empty paths array; body=${JSON.stringify(body).slice(0, 400)}`,
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
            `[echo-memory] reextract-selected rejected invalid or ineligible paths; requested=${JSON.stringify(relativePaths).slice(0, 400)}`,
          );
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "One or more selected files cannot be re-extracted",
            details: "Selected files must be markdown files directly inside the configured memory directory.",
            invalidPaths: requestedInvalidPaths,
            requestedPaths: relativePaths,
          }));
          return;
        }

        if (requestedFilterPaths.size === 0) {
          logger?.warn?.(
            `[echo-memory] reextract-selected contained no valid markdown paths; requested=${JSON.stringify(relativePaths).slice(0, 400)}`,
          );
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "No valid markdown paths to re-extract",
            details: "All provided paths were outside the configured memory directory or were not sync-eligible.",
            requestedPaths: relativePaths,
          }));
          return;
        }

        const result = await syncRunner.runSync(
          "local-ui-reextract",
          requestedFilterPaths,
          { force: true },
        );
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
  const fileWatcher = createFileWatcher(workspaceDir, {
    onMarkdownChanged: ({ absolutePath }) => {
      const syncMemoryDir = opts.cfg?.memoryDir ? path.resolve(opts.cfg.memoryDir) : null;
      if (!syncMemoryDir) {
        return;
      }
      const normalizeForCompare = (value) => path.normalize(value).toLowerCase();
      const normalizedPath = path.resolve(absolutePath);
      const normalizedMemoryDir = normalizeForCompare(syncMemoryDir);
      if (
        normalizeForCompare(path.dirname(normalizedPath)) !== normalizedMemoryDir
        || path.extname(normalizedPath).toLowerCase() !== ".md"
      ) {
        return;
      }
      opts.syncRunner?.queueFileChangeSync?.(normalizedPath);
    },
  });
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
            latestMemory: event.latestMemory
              ? {
                  ...event.latestMemory,
                  relativePath: mapPath(event.latestMemory.filePath),
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
