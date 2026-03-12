import fs from "node:fs/promises";
import path from "node:path";
import { normalizeContentForHash, sha256Hex } from "./hash.js";

function isMarkdownFile(entry) {
  return entry.isFile() && entry.name.toLowerCase().endsWith(".md");
}

export async function scanOpenClawMemoryDir(memoryDir) {
  const entries = await fs.readdir(memoryDir, { withFileTypes: true });
  const markdownEntries = entries.filter(isMarkdownFile).sort((left, right) => left.name.localeCompare(right.name));
  const files = [];

  for (const entry of markdownEntries) {
    const filePath = path.join(memoryDir, entry.name);
    const stats = await fs.stat(filePath);
    const content = await fs.readFile(filePath, "utf8");
    const sectionTitle = path.basename(entry.name, ".md");
    files.push({
      filePath,
      sectionTitle,
      content,
      modifiedTime: stats.mtime.toISOString(),
      contentHash: sha256Hex(normalizeContentForHash(content)),
    });
  }

  return files;
}
