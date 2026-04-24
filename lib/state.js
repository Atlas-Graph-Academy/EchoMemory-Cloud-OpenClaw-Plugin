import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const STATE_FILE_NAME = "echo-memory-last-sync.json";
const UI_PRESENCE_FILE_NAME = "echo-memory-ui-presence.json";
const CANVAS_LAYOUT_FILE_NAME = "echo-memory-canvas-layout.md";
const CANVAS_LAYOUT_JSON_RE = /```json\s*([\s\S]*?)```/i;

function hashAccountId(accountId) {
  return crypto.createHash("sha256").update(String(accountId)).digest("hex").slice(0, 16);
}

export function resolveStatePath(stateDir, accountId = null) {
  if (accountId) {
    return path.join(stateDir, `echo-memory-last-sync-${hashAccountId(accountId)}.json`);
  }
  return path.join(stateDir, STATE_FILE_NAME);
}

export function resolveDefaultStatePath(stateDir) {
  return path.join(stateDir, STATE_FILE_NAME);
}

export async function adoptLegacyStateForAccount(stateDir, accountId) {
  if (!stateDir || !accountId) return false;
  const legacyPath = resolveDefaultStatePath(stateDir);
  const accountPath = resolveStatePath(stateDir, accountId);
  if (legacyPath === accountPath) return false;
  if (await pathExists(accountPath)) return false;
  if (!(await pathExists(legacyPath))) return false;
  try {
    await fs.mkdir(path.dirname(accountPath), { recursive: true });
    await fs.rename(legacyPath, accountPath);
    return true;
  } catch {
    return false;
  }
}

export function resolveUiPresencePath(stateDir) {
  return path.join(stateDir, UI_PRESENCE_FILE_NAME);
}

export function resolveCanvasLayoutPath(stateDir) {
  return path.join(stateDir, CANVAS_LAYOUT_FILE_NAME);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(targetPath) {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonFile(targetPath, payload) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function readLastSyncState(statePath) {
  return readJsonFile(statePath);
}

export async function writeLastSyncState(statePath, state) {
  await writeJsonFile(statePath, state);
}

export async function clearLastSyncState(statePath) {
  if (!statePath) return false;
  try {
    await fs.unlink(statePath);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

export async function readLocalUiPresence(presencePath) {
  return readJsonFile(presencePath);
}

export async function writeLocalUiPresence(presencePath, presence) {
  await writeJsonFile(presencePath, presence);
}

export async function readCanvasLayoutState(layoutPath) {
  try {
    const raw = await fs.readFile(layoutPath, "utf8");
    const match = raw.match(CANVAS_LAYOUT_JSON_RE);
    const jsonText = match?.[1] || raw;
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

export async function writeCanvasLayoutState(layoutPath, layout) {
  await fs.mkdir(path.dirname(layoutPath), { recursive: true });
  const payload = {
    ...layout,
    kind: "echo-memory-canvas-layout",
    updatedAt: new Date().toISOString(),
  };
  const body = [
    "# Echo Memory Canvas Layout",
    "",
    "Local-only UI state for the OpenClaw canvas. This file stores card pile positions and names.",
    "It is not uploaded to Echo Cloud and does not affect memory sync state.",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
  ].join("\n");
  await fs.writeFile(layoutPath, body, "utf8");
  return payload;
}

export async function migrateStateFile(targetPath, sourcePaths = []) {
  if (!targetPath) {
    return null;
  }
  if (await pathExists(targetPath)) {
    return null;
  }

  for (const sourcePath of sourcePaths) {
    if (!sourcePath || sourcePath === targetPath) {
      continue;
    }
    try {
      const raw = await fs.readFile(sourcePath, "utf8");
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, raw, "utf8");
      return sourcePath;
    } catch {
      // Ignore missing or unreadable migration sources.
    }
  }

  return null;
}
