import crypto from "node:crypto";

export function normalizeContentForHash(content) {
  return String(content ?? "").replace(/\r\n/g, "\n");
}

export function sha256Hex(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}
