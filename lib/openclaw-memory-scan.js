import fs from "node:fs/promises";
import path from "node:path";
import { normalizeContentForHash, sha256Hex } from "./hash.js";

const IDENTITY_FILES = new Set(["SOUL.md", "USER.md", "IDENTITY.md"]);
const LONG_TERM_FILES = new Set(["MEMORY.md"]);
const CONFIG_FILES = new Set(["AGENTS.md", "TOOLS.md", "HEARTBEAT.md"]);
const PRIVATE_FILES = new Set(["SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"]);
const REVIEW_FILES = new Set(["MEMORY.md", "AGENTS.md"]);

const DAILY_PATTERN = /^\d{4}-\d{2}-\d{2}(?:-.+)?\.md$/;

function classifyFile(fileName, isInMemoryDir, isInPrivateDir) {
  if (isInPrivateDir) {
    return { fileType: "private", privacyLevel: "private" };
  }
  if (isInMemoryDir) {
    if (DAILY_PATTERN.test(fileName)) {
      return { fileType: "daily", privacyLevel: "safe" };
    }
    return { fileType: "memory", privacyLevel: "review" };
  }
  if (IDENTITY_FILES.has(fileName)) {
    return { fileType: "identity", privacyLevel: "private" };
  }
  if (LONG_TERM_FILES.has(fileName)) {
    return { fileType: "long-term", privacyLevel: "review" };
  }
  if (CONFIG_FILES.has(fileName)) {
    return {
      fileType: "config",
      privacyLevel: PRIVATE_FILES.has(fileName) ? "private" : REVIEW_FILES.has(fileName) ? "review" : "safe",
    };
  }
  return { fileType: "other", privacyLevel: "safe" };
}

export async function scanFullWorkspace(workspaceDir) {
  const files = [];

  async function scanDir(dir, isMemoryDir, isPrivateDir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const mdEntries = entries.filter(isMarkdownFile).sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of mdEntries) {
      const filePath = path.join(dir, entry.name);
      const relativePath = isPrivateDir
        ? path.join("memory", "private", entry.name)
        : isMemoryDir
        ? path.join("memory", entry.name)
        : entry.name;
      let stats;
      let content;
      try {
        stats = await fs.stat(filePath);
        content = await fs.readFile(filePath, "utf8");
      } catch {
        continue;
      }
      const { fileType, privacyLevel } = classifyFile(entry.name, isMemoryDir, isPrivateDir);
      const h2Count = (content.match(/^## /gm) || []).length;
      const contentHash = sha256Hex(normalizeContentForHash(content));
      files.push({
        fileName: entry.name,
        relativePath,
        fileType,
        privacyLevel,
        sizeBytes: stats.size,
        modifiedTime: stats.mtime.toISOString(),
        h2Count,
        contentHash,
      });
    }
  }

  await scanDir(workspaceDir, false, false);
  await scanDir(path.join(workspaceDir, "memory"), true, false);
  await scanDir(path.join(workspaceDir, "memory", "private"), false, true);

  return files;
}

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
