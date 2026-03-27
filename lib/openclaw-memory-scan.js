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

  // --- Main workspace files (workspace/...) ---
  if (topDir === "workspace") {
    const innerPath = parts.slice(1).join("/");
    const innerParts = parts.slice(1);
    const innerDir = innerParts.length > 1 ? innerParts[0] : null;

    // workspace/memory/private/ → always private
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

export async function scanOpenClawMemoryDir(memoryDir, { logger } = {}) {
  const entries = await fs.readdir(memoryDir, { withFileTypes: true });
  const markdownEntries = entries.filter(isMarkdownFile).sort((left, right) => left.name.localeCompare(right.name));
  const files = [];

  for (const entry of markdownEntries) {
    const filePath = path.join(memoryDir, entry.name);
    try {
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, "utf8");
      const sectionTitle = path.basename(entry.name, ".md");
      const modifiedTime = stats.mtime.toISOString();
      const createdTime =
        Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0
          ? stats.birthtime.toISOString()
          : modifiedTime;
      files.push({
        filePath,
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

  return files;
}
