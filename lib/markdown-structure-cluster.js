const CLUSTER_LABELS = {
  identity: "Identity",
  "long-term": "Long-term",
  journal: "Journal",
  timeline: "Timeline",
  goals: "Goals",
  technical: "Technical",
  thematic: "Thematic",
  knowledge: "Knowledge",
  system: "System",
};

function countMatches(content, pattern) {
  const matches = content.match(pattern);
  return Array.isArray(matches) ? matches.length : 0;
}

function deriveBaseClass(fileType, relativePath) {
  const normalizedPath = String(relativePath || "").replace(/\\/g, "/");

  if (fileType === "identity") return "identity";
  if (fileType === "long-term") return "long-term";
  if (fileType === "daily") return "journal";
  if (fileType === "memory" || normalizedPath.includes("/memory/")) return "journal";
  if (fileType === "tasks" || fileType === "projects" || fileType === "research" || fileType === "skills") return "knowledge";
  if (String(fileType || "").startsWith("agent:")) return "system";
  if (fileType === "config" || fileType === "private" || fileType === "other") return "system";
  return "knowledge";
}

function analyzeMarkdownStructure(content) {
  const safeContent = typeof content === "string" ? content : "";
  const h2Matches = Array.from(safeContent.matchAll(/^##\s+(.+)$/gm));
  const codeBlockCount = countMatches(safeContent, /```[\s\S]*?```/g);
  const checkboxCount = countMatches(safeContent, /^\s*[-*]\s+\[(?: |x|X)\]\s+/gm);
  const uncheckedCheckboxCount = countMatches(safeContent, /^\s*[-*]\s+\[\s\]\s+/gm);
  const checkedCheckboxCount = countMatches(safeContent, /^\s*[-*]\s+\[[xX]\]\s+/gm);
  const dateMarkerCount =
    countMatches(safeContent, /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g) +
    countMatches(safeContent, /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi);
  const h2DateCount = h2Matches.filter((match) => /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/.test(match[1])).length;
  const codeFenceLanguageCount = countMatches(safeContent, /^```[A-Za-z0-9_-]+\s*$/gm);

  return {
    h2Count: h2Matches.length,
    checkboxCount,
    uncheckedCheckboxCount,
    checkedCheckboxCount,
    codeBlockCount,
    codeFenceLanguageCount,
    dateMarkerCount,
    h2DateCount,
  };
}

function finalizeCluster(clusterKey, sectionKey, confidence, signals, reason) {
  const signalStrength =
    signals.h2Count +
    signals.checkboxCount +
    signals.codeBlockCount +
    signals.dateMarkerCount;

  return {
    clusterKey,
    clusterLabel: CLUSTER_LABELS[clusterKey] || CLUSTER_LABELS.knowledge,
    sectionKey,
    confidence,
    needsSemanticFallback: confidence === "low" && signalStrength <= 1,
    reason,
  };
}

function chooseDominantCluster(baseClass, signals) {
  if (baseClass === "identity") {
    return finalizeCluster("identity", "identity", "high", signals, "file_type_identity");
  }
  if (baseClass === "long-term") {
    return finalizeCluster("long-term", "long-term", "high", signals, "file_type_long_term");
  }
  if (baseClass === "journal") {
    const journalCluster = signals.dateMarkerCount > 0 || signals.h2DateCount > 0 ? "timeline" : "journal";
    return finalizeCluster(journalCluster, "journal", "high", signals, "file_type_journal");
  }
  if (baseClass === "system") {
    return finalizeCluster("system", "system", "high", signals, "file_type_system");
  }

  if (
    signals.uncheckedCheckboxCount >= 2 ||
    (signals.checkboxCount >= 3 && signals.checkboxCount >= Math.max(2, signals.codeBlockCount * 2))
  ) {
    return finalizeCluster("goals", "goals", "high", signals, "checkbox_structure");
  }

  if (
    signals.codeBlockCount >= 2 ||
    (signals.codeBlockCount >= 1 &&
      signals.codeFenceLanguageCount >= 1 &&
      signals.codeBlockCount >= signals.checkboxCount)
  ) {
    return finalizeCluster("technical", "technical", "medium", signals, "code_structure");
  }

  if (signals.dateMarkerCount >= 3 || signals.h2DateCount >= 2) {
    return finalizeCluster("timeline", "journal", "medium", signals, "date_structure");
  }

  if (signals.h2Count >= 2) {
    return finalizeCluster("thematic", "thematic", "medium", signals, "heading_structure");
  }

  return finalizeCluster("knowledge", "knowledge", baseClass === "knowledge" ? "medium" : "low", signals, "fallback_knowledge");
}

export function deriveMarkdownStructureCluster({ fileType, relativePath, content }) {
  const baseClass = deriveBaseClass(fileType, relativePath);
  const structureSignals = analyzeMarkdownStructure(content);
  const dominant = chooseDominantCluster(baseClass, structureSignals);

  return {
    baseClass,
    structureSignals,
    dominantCluster: dominant.clusterKey,
    clusterLabel: dominant.clusterLabel,
    clusterSectionKey: dominant.sectionKey,
    clusterConfidence: dominant.confidence,
    needsSemanticFallback: dominant.needsSemanticFallback,
    clusterReason: dominant.reason,
  };
}
