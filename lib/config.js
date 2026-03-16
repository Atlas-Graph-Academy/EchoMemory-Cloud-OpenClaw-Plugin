import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_WEB_BASE_URL = "https://www.iditor.com";
const DEFAULT_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || join(homedir(), ".openclaw", "openclaw.json");
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

function invalidateEnvCache() {
  cachedEnv = null;
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

function resolveConfigValue(pluginConfig, configKey, envKey, fallback) {
  if (pluginConfig?.[configKey] !== undefined && pluginConfig?.[configKey] !== null && pluginConfig?.[configKey] !== "") {
    return {
      source: "plugin_config",
      value: pluginConfig[configKey],
    };
  }
  const env = loadEnvFiles();
  if (env.values.has(envKey)) {
    return {
      source: "env_file",
      value: env.values.get(envKey),
    };
  }
  if (process.env[envKey] !== undefined && process.env[envKey] !== "") {
    return {
      source: "process_env",
      value: process.env[envKey],
    };
  }
  return {
    source: "default",
    value: fallback,
  };
}

function maskValue(value, { keepStart = 2, keepEnd = 2 } = {}) {
  const raw = String(value ?? "");
  if (!raw) return "";
  if (raw.length <= keepStart + keepEnd) {
    return "*".repeat(raw.length);
  }
  return `${raw.slice(0, keepStart)}${"*".repeat(Math.max(4, raw.length - keepStart - keepEnd))}${raw.slice(-keepEnd)}`;
}

export function getLocalUiSetupState(pluginConfig = {}, cfg = null) {
  const runtimeCfg = cfg ?? buildConfig(pluginConfig);
  const envStatus = getEnvFileStatus();
  const targetEnvPath = envStatus.paths[0] || envStatus.searchPaths[0];
  const localOnlyMode = resolveConfigValue(
    pluginConfig,
    "localOnlyMode",
    "ECHOMEM_LOCAL_ONLY_MODE",
    runtimeCfg.localOnlyMode,
  );
  const baseUrl = resolveConfigValue(pluginConfig, "baseUrl", "ECHOMEM_BASE_URL", runtimeCfg.baseUrl);
  const webBaseUrl = resolveConfigValue(pluginConfig, "webBaseUrl", "ECHOMEM_WEB_BASE_URL", runtimeCfg.webBaseUrl);
  const apiKey = resolveConfigValue(pluginConfig, "apiKey", "ECHOMEM_API_KEY", runtimeCfg.apiKey);
  const memoryDir = resolveConfigValue(pluginConfig, "memoryDir", "ECHOMEM_MEMORY_DIR", runtimeCfg.memoryDir);

  return {
    configFile: {
      targetPath: DEFAULT_CONFIG_PATH,
    },
    envFile: {
      targetPath: targetEnvPath,
      foundPaths: envStatus.paths,
      searchPaths: envStatus.searchPaths,
    },
    localOnlyMode: {
      enabled: Boolean(runtimeCfg.localOnlyMode),
      source: localOnlyMode.source,
      envKey: "ECHOMEM_LOCAL_ONLY_MODE",
    },
    fields: {
      baseUrl: {
        value: String(baseUrl.value ?? runtimeCfg.baseUrl ?? ""),
        maskedValue: maskValue(baseUrl.value, { keepStart: 12, keepEnd: 8 }),
        source: baseUrl.source,
        envKey: "ECHOMEM_BASE_URL",
      },
      webBaseUrl: {
        value: String(webBaseUrl.value ?? runtimeCfg.webBaseUrl ?? ""),
        maskedValue: maskValue(webBaseUrl.value, { keepStart: 12, keepEnd: 8 }),
        source: webBaseUrl.source,
        envKey: "ECHOMEM_WEB_BASE_URL",
      },
      apiKey: {
        value: String(apiKey.value ?? runtimeCfg.apiKey ?? ""),
        maskedValue: maskValue(apiKey.value, { keepStart: 3, keepEnd: 3 }),
        source: apiKey.source,
        envKey: "ECHOMEM_API_KEY",
      },
      memoryDir: {
        value: String(memoryDir.value ?? runtimeCfg.memoryDir ?? ""),
        maskedValue: maskValue(memoryDir.value, { keepStart: 10, keepEnd: 8 }),
        source: memoryDir.source,
        envKey: "ECHOMEM_MEMORY_DIR",
      },
    },
  };
}

export function saveLocalUiSetup(values = {}) {
  const envStatus = getEnvFileStatus();
  const targetPath = envStatus.paths[0] || envStatus.searchPaths[0];
  mkdirSync(dirname(targetPath), { recursive: true });

  let lines = [];
  try {
    lines = readFileSync(targetPath, "utf8").split(/\r?\n/);
  } catch {
    lines = [];
  }

  const nextValues = new Map();
  const managedKeys = new Set();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string") continue;
    managedKeys.add(key);
    nextValues.set(key, value.trim());
  }

  const seen = new Set();
  const updatedLines = lines.map((line) => {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) return line;
    const key = line.slice(0, separatorIndex).trim();
    if (!managedKeys.has(key)) return line;
    seen.add(key);
    const nextValue = nextValues.get(key);
    if (!nextValue) {
      return null;
    }
    return `${key}=${nextValue}`;
  }).filter((line) => line !== null);

  for (const [key, value] of nextValues.entries()) {
    if (value && !seen.has(key)) {
      updatedLines.push(`${key}=${value}`);
    }
    if (value) {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }

  writeFileSync(targetPath, `${updatedLines.filter(Boolean).join("\n")}\n`, "utf8");
  invalidateEnvCache();
  return {
    targetPath,
    savedKeys: [...managedKeys],
  };
}

export function buildConfig(pluginConfig = {}) {
  const cfg = pluginConfig ?? {};
  const localOnlyMode = parseBoolean(
    cfg.localOnlyMode ?? loadEnvVar("ECHOMEM_LOCAL_ONLY_MODE"),
    false,
  );
  return {
    baseUrl: String(cfg.baseUrl || loadEnvVar("ECHOMEM_BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    webBaseUrl: String(cfg.webBaseUrl || loadEnvVar("ECHOMEM_WEB_BASE_URL") || DEFAULT_WEB_BASE_URL).replace(/\/+$/, ""),
    apiKey: localOnlyMode ? "" : String(cfg.apiKey || loadEnvVar("ECHOMEM_API_KEY") || "").trim(),
    localOnlyMode,
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
