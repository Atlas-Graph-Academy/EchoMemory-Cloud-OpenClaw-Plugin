import fs from "node:fs/promises";
import path from "node:path";
import { normalizeContentForHash, sha256Hex } from "./hash.js";
import { deriveMarkdownStructureCluster } from "./markdown-structure-cluster.js";
import { scanSensitiveFields } from "./sensitive-field-scan.js";

const IDENTITY_FILES = new Set(["SOUL.md", "USER.md", "IDENTITY.md"]);
const LONG_TERM_FILES = new Set(["MEMORY.md"]);
const CONFIG_FILES = new Set(["AGENTS.md", "TOOLS.md", "HEARTBEAT.md"]);
const PRIVATE_FILES = new Set(["SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"]);
const REVIEW_FILES = new Set(["MEMORY.md", "AGENTS.md"]);

const DAILY_PATTERN = /^\d{4}-\d{2}-\d{2}(?:-.+)?\.md$/;

/** Directories to skip during recursive scan */
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", "logs", "completions", "delivery-queue", "browser", "canvas", "cron", "media"]);

/**
 * Classify a file based on its relative path from the .openclaw root.
 * Paths look like: workspace/MEMORY.md, workspace/memory/2026-03-15.md,
 * workspace-scout/SOUL.md, skills/agent-reach/SKILL.md, etc.
 */
function classifyFile(relativePath) {
  const fileName = path.basename(relativePath);
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const topDir = parts[0];

  // --- Universal PRIVATE conventions (apply at any depth) ---
  // Anything under a directory literally named "private" is private —
  // regardless of which workspace it lives in. Catches `workspace/foo/private/`,
  // `workspace-codex/notes/private/`, etc.
  if (parts.includes("private")) {
    return { fileType: "private", privacyLevel: "private" };
  }
  // File-name prefix `private-foo.md` lets users mark single files as private
  // without rearranging directory structure.
  if (fileName.startsWith("private-")) {
    return { fileType: "private", privacyLevel: "private" };
  }

  // --- Main workspace files (workspace/...) ---
  if (topDir === "workspace") {
    const innerPath = parts.slice(1).join("/");
    const innerParts = parts.slice(1);
    const innerDir = innerParts.length > 1 ? innerParts[0] : null;

    // workspace/memory/private/ → always private (kept for clarity, the
    // universal /private/ rule above catches it too)
    if (innerPath.startsWith("memory/private/")) {
      return { fileType: "private", privacyLevel: "private" };
    }

    // workspace/memory/ files
    if (innerDir === "memory") {
      if (innerParts.length === 2 && DAILY_PATTERN.test(fileName)) {
        return { fileType: "daily", privacyLevel: "safe" };
      }
      return { fileType: "memory", privacyLevel: "review" };
    }

    // Root workspace files (workspace/MEMORY.md, workspace/SOUL.md, etc.)
    if (!innerDir) {
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

    // Other workspace subdirs (workspace/research/, workspace/tasks/, etc.)
    return { fileType: innerDir, privacyLevel: "safe" };
  }

  // --- Agent workspaces (workspace-scout/, workspace-codex/, etc.) ---
  if (topDir.startsWith("workspace-")) {
    const agentName = topDir.replace("workspace-", "");
    // Identity/config files in agent workspaces are private
    if (IDENTITY_FILES.has(fileName) || PRIVATE_FILES.has(fileName)) {
      return { fileType: "agent:" + agentName, privacyLevel: "private" };
    }
    return { fileType: "agent:" + agentName, privacyLevel: "review" };
  }

  // --- Skills directory ---
  if (topDir === "skills") {
    return { fileType: "skills", privacyLevel: "safe" };
  }

  // --- Everything else grouped by top-level dir ---
  return { fileType: topDir, privacyLevel: "safe" };
}

async function buildWorkspaceFileRecord(workspaceDir, filePath, stats = null, content = null, options = {}) {
  const includeContent = options.includeContent === true;
  const fileName = path.basename(filePath);
  const relativePath = path.relative(workspaceDir, filePath);
  let resolvedStats = stats;
  let resolvedContent = content;

  if (!resolvedStats || typeof resolvedContent !== "string") {
    const [nextStats, nextContent] = await Promise.all([
      resolvedStats ? Promise.resolve(resolvedStats) : fs.stat(filePath),
      typeof resolvedContent === "string" ? Promise.resolve(resolvedContent) : fs.readFile(filePath, "utf8"),
    ]);
    resolvedStats = nextStats;
    resolvedContent = nextContent;
  }

  const { fileType, privacyLevel: basePrivacyLevel } = classifyFile(relativePath);
  const structureCluster = deriveMarkdownStructureCluster({
    fileType,
    relativePath,
    content: resolvedContent,
  });
  const sensitiveScan = scanSensitiveFields(resolvedContent);

  // riskLevel is the new tri-state authority for upload decisions:
  //   "secret"  — text scanner found a real credential. Hard block: sharing
  //               this file leaks an account, so the UI must never offer a
  //               manual override (the warning is the action).
  //   "private" — path/frontmatter signals that the user marked this content
  //               as personal. Soft block: not auto-uploaded, but the user
  //               can opt to share if they intentionally chose to.
  //   "safe"    — neither signal. Recommended for upload.
  // SECRET wins over PRIVATE when both apply (a private file with a leaked
  // key is still a leak risk first, privacy second).
  let riskLevel;
  if (sensitiveScan.hasSensitive) {
    riskLevel = "secret";
  } else if (basePrivacyLevel === "private") {
    riskLevel = "private";
  } else {
    riskLevel = "safe";
  }

  // Legacy `privacyLevel` field: pre-existing callers (sync eligibility,
  // server filtering) still treat "private" as a hard block. To keep them
  // working without a coordinated UI rollout, we continue marking SECRET
  // files as `privacyLevel: "private"` so they remain unsynced. The new
  // `riskLevel` field carries the finer-grained intent for new UI code.
  const privacyAutoUpgraded = basePrivacyLevel !== "private" && sensitiveScan.hasSensitive;
  const privacyLevel = privacyAutoUpgraded ? "private" : basePrivacyLevel;

  const h2Count = (resolvedContent.match(/^## /gm) || []).length;
  const contentHash = sha256Hex(normalizeContentForHash(resolvedContent));
  const modifiedTime = resolvedStats.mtime.toISOString();
  const createdTime =
    Number.isFinite(resolvedStats.birthtimeMs) && resolvedStats.birthtimeMs > 0
      ? resolvedStats.birthtime.toISOString()
      : modifiedTime;

  return {
    absolutePath: filePath,
    fileName,
    relativePath,
    fileType,
    privacyLevel,
    basePrivacyLevel,
    riskLevel,
    baseClass: structureCluster.baseClass,
    dominantCluster: structureCluster.dominantCluster,
    clusterLabel: structureCluster.clusterLabel,
    clusterSectionKey: structureCluster.clusterSectionKey,
    clusterConfidence: structureCluster.clusterConfidence,
    needsSemanticFallback: structureCluster.needsSemanticFallback,
    clusterReason: structureCluster.clusterReason,
    structureSignals: structureCluster.structureSignals,
    privacyAutoUpgraded,
    hasSensitiveContent: sensitiveScan.hasSensitive,
    hasHighRiskSensitiveContent: sensitiveScan.highRisk,
    sensitiveSummary: sensitiveScan.summary,
    sensitiveFindings: sensitiveScan.findings,
    sensitiveDetectionCount: sensitiveScan.totalCount,
    sizeBytes: resolvedStats.size,
    createdTime,
    updatedAt: modifiedTime,
    modifiedTime,
    h2Count,
    contentHash,
    ...(includeContent ? { content: resolvedContent } : {}),
  };
}

export async function scanFullWorkspace(workspaceDir) {
  const files = [];

  async function scanDirRecursive(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        await scanDirRecursive(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const filePath = path.join(dir, entry.name);
        let stats;
        let content;
        try {
          stats = await fs.stat(filePath);
          content = await fs.readFile(filePath, "utf8");
        } catch {
          continue;
        }
        files.push(await buildWorkspaceFileRecord(workspaceDir, filePath, stats, content));
      }
    }
  }

  await scanDirRecursive(workspaceDir);

  // Sort: root files first, then by path
  files.sort((a, b) => {
    const aDepth = a.relativePath.split(path.sep).length;
    const bDepth = b.relativePath.split(path.sep).length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.relativePath.localeCompare(b.relativePath);
  });

  return files;
}

export async function scanWorkspaceMarkdownFile(workspaceDir, filePath, options = {}) {
  return buildWorkspaceFileRecord(workspaceDir, filePath, null, null, options);
}

function isMarkdownFile(entry) {
  return entry.isFile() && entry.name.toLowerCase().endsWith(".md");
}

/**
 * Build upload-shape records for a specific list of absolute file paths.
 * Bypasses the recursive scan's private/secret filters — used by the
 * sync-selected path when the user has explicitly confirmed they want a
 * private/sensitive file uploaded. Caller is responsible for the
 * confirmation gate; this helper only does the I/O and hashing.
 */
export async function scanSelectedMarkdownFiles(rootDir, absolutePaths, { logger } = {}) {
  const root = path.resolve(rootDir);
  const records = [];
  for (const filePath of absolutePaths) {
    if (typeof filePath !== "string" || !filePath) continue;
    if (!filePath.toLowerCase().endsWith(".md")) continue;
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) continue;
      const content = await fs.readFile(filePath, "utf8");
      const relativePath = path.relative(root, filePath);
      const sectionTitle = path.basename(filePath, ".md");
      const modifiedTime = stats.mtime.toISOString();
      const createdTime =
        Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0
          ? stats.birthtime.toISOString()
          : modifiedTime;
      records.push({
        filePath,
        relativePath,
        sectionTitle,
        content,
        createdTime,
        updatedAt: modifiedTime,
        modifiedTime,
        contentHash: sha256Hex(normalizeContentForHash(content)),
      });
    } catch (error) {
      logger?.warn?.(
        `[echo-memory] skipped unreadable selected file ${filePath}: ${String(error?.message ?? error)}`,
      );
    }
  }
  return records;
}

export async function scanOpenClawMemoryDir(memoryDir, { logger } = {}) {
  const files = [];
  const rootDir = path.resolve(memoryDir);

  async function scanDirRecursive(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of sortedEntries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Keep explicit private folders out of automatic/selected import. The
        // local UI can show them as blocked, but the sync runner should never
        // upload them if called directly.
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".") || entry.name === "private") continue;
        await scanDirRecursive(filePath);
        continue;
      }

      if (!isMarkdownFile(entry) || entry.name.startsWith("private-")) {
        continue;
      }

      try {
        const stats = await fs.stat(filePath);
        const content = await fs.readFile(filePath, "utf8");
        const relativePath = path.relative(rootDir, filePath);
        const sectionTitle = path.basename(entry.name, ".md");
        const modifiedTime = stats.mtime.toISOString();
        const createdTime =
          Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0
            ? stats.birthtime.toISOString()
            : modifiedTime;
        files.push({
          filePath,
          relativePath,
          sectionTitle,
          content,
          createdTime,
          updatedAt: modifiedTime,
          modifiedTime,
          contentHash: sha256Hex(normalizeContentForHash(content)),
        });
      } catch (error) {
        logger?.warn?.(
          `[echo-memory] skipped unreadable markdown file ${filePath}: ${String(error?.message ?? error)}`,
        );
      }
    }
  }

  await scanDirRecursive(rootDir);
  return files;
}
