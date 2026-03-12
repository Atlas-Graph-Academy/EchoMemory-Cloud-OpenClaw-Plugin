import fs from "node:fs/promises";
import path from "node:path";

const STATE_FILE_NAME = "echo-memory-last-sync.json";

export function resolveStatePath(stateDir) {
  return path.join(stateDir, STATE_FILE_NAME);
}

export async function readLastSyncState(statePath) {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeLastSyncState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
