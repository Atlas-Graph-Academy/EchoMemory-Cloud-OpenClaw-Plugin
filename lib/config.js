import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_WEB_BASE_URL = "https://www.iditor.com";
const ENV_SOURCES = [
  join(homedir(), ".openclaw", ".env"),
  join(homedir(), ".moltbot", ".env"),
  join(homedir(), ".clawdbot", ".env"),
];

let cachedEnv = null;

function parseEnvFile(content) {
  const values = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value =
      (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    values.set(key, value);
  }
  return values;
}

function loadEnvFiles() {
  if (cachedEnv) {
    return cachedEnv;
  }

  const values = new Map();
  const foundPaths = [];
  for (const envPath of ENV_SOURCES) {
    try {
      const fileContent = readFileSync(envPath, "utf8");
      const parsed = parseEnvFile(fileContent);
      for (const [key, value] of parsed.entries()) {
        if (!values.has(key)) {
          values.set(key, value);
        }
      }
      foundPaths.push(envPath);
    } catch {
      // Ignore missing env files.
    }
  }

  cachedEnv = {
    values,
    foundPaths,
    searchPaths: [...ENV_SOURCES],
  };
  return cachedEnv;
}

function loadEnvVar(name) {
  const env = loadEnvFiles();
  if (env.values.has(name)) {
    return env.values.get(name);
  }
  return process.env[name];
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

export function getEnvFileStatus() {
  const env = loadEnvFiles();
  return {
    found: env.foundPaths.length > 0,
    paths: env.foundPaths,
    searchPaths: env.searchPaths,
  };
}

export function buildConfig(pluginConfig = {}) {
  const cfg = pluginConfig ?? {};
  return {
    baseUrl: String(cfg.baseUrl || loadEnvVar("ECHOMEM_BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    webBaseUrl: String(cfg.webBaseUrl || loadEnvVar("ECHOMEM_WEB_BASE_URL") || DEFAULT_WEB_BASE_URL).replace(/\/+$/, ""),
    apiKey: String(cfg.apiKey || loadEnvVar("ECHOMEM_API_KEY") || "").trim(),
    autoSync: parseBoolean(cfg.autoSync, parseBoolean(loadEnvVar("ECHOMEM_AUTO_SYNC"), true)),
    syncIntervalMinutes: parseInteger(
      cfg.syncIntervalMinutes ?? loadEnvVar("ECHOMEM_SYNC_INTERVAL_MINUTES"),
      15,
      { min: 1, max: 1440 },
    ),
    batchSize: parseInteger(cfg.batchSize ?? loadEnvVar("ECHOMEM_BATCH_SIZE"), 10, { min: 1, max: 25 }),
    requestTimeoutMs: parseInteger(
      cfg.requestTimeoutMs ?? loadEnvVar("ECHOMEM_REQUEST_TIMEOUT_MS"),
      300000,
      { min: 1000, max: 900000 },
    ),
    localUiAutoOpenOnGatewayStart: parseBoolean(
      cfg.localUiAutoOpenOnGatewayStart,
      parseBoolean(loadEnvVar("ECHOMEM_LOCAL_UI_AUTO_OPEN_ON_GATEWAY_START"), true),
    ),
    localUiAutoInstall: parseBoolean(
      cfg.localUiAutoInstall,
      parseBoolean(loadEnvVar("ECHOMEM_LOCAL_UI_AUTO_INSTALL"), true),
    ),
    memoryDir: String(
      cfg.memoryDir
      || loadEnvVar("ECHOMEM_MEMORY_DIR")
      || join(homedir(), ".openclaw", "workspace", "memory"),
    ).trim(),
  };
}
