function truncateText(value, maxLength = 280) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeMemoryResults(payload) {
  return Array.isArray(payload?.memories) ? payload.memories : [];
}

export function buildSearchSummary(payload) {
  const memories = normalizeMemoryResults(payload);
  return {
    count: Number.isFinite(payload?.count) ? payload.count : memories.length,
    processingTimeMs: Number.isFinite(payload?.processingTimeMs) ? payload.processingTimeMs : null,
    retrievalMode: typeof payload?.retrievalMode === "string" ? payload.retrievalMode : null,
    thresholdUsed:
      typeof payload?.thresholdUsed === "number" && Number.isFinite(payload.thresholdUsed)
        ? payload.thresholdUsed
        : null,
    fallbackApplied: payload?.fallbackApplied === true,
    memories,
  };
}

export function formatSearchResultsText(query, payload) {
  const summary = buildSearchSummary(payload);
  const lines = [];
  lines.push(`Echo memory search: "${query}"`);
  lines.push(`- results: ${summary.count}`);
  if (summary.processingTimeMs !== null) {
    lines.push(`- processing_ms: ${summary.processingTimeMs}`);
  }
  if (summary.retrievalMode) {
    lines.push(`- mode: ${summary.retrievalMode}`);
  }
  if (summary.thresholdUsed !== null) {
    lines.push(`- threshold: ${summary.thresholdUsed}`);
  }
  if (summary.fallbackApplied) {
    lines.push(`- fallback_retry: true`);
  }

  if (summary.memories.length === 0) {
    lines.push("");
    lines.push("No relevant memories found.");
    return lines.join("\n");
  }

  for (const [index, memory] of summary.memories.entries()) {
    const rank = index + 1;
    const semanticScore =
      typeof memory?.similarity_score === "number" ? memory.similarity_score.toFixed(3) : "n/a";
    const lexicalScore =
      typeof memory?.match_score === "number" ? memory.match_score.toFixed(3) : null;
    const when = memory?.time || memory?.created_at || "unknown";
    const location = memory?.location || "Unknown";
    const category = memory?.category || "Unknown";
    const description = truncateText(memory?.description, 180) || "(no description)";
    const details = truncateText(memory?.details, 220);
    const scoreLabel = semanticScore !== "n/a"
      ? `score=${semanticScore}`
      : lexicalScore !== null
        ? `match=${lexicalScore}`
        : null;

    lines.push("");
    lines.push([`[${rank}]`, scoreLabel, `time=${when}`].filter(Boolean).join(" "));
    lines.push(`description: ${description}`);
    lines.push(`location: ${location} | category: ${category}`);
    if (details) {
      lines.push(`details: ${details}`);
    }
  }

  return lines.join("\n");
}

export function buildToolSearchResult(query, payload) {
  const summary = buildSearchSummary(payload);
  return {
    query,
    count: summary.count,
    processingTimeMs: summary.processingTimeMs,
    retrievalMode: summary.retrievalMode,
    thresholdUsed: summary.thresholdUsed,
    fallbackApplied: summary.fallbackApplied,
    memories: summary.memories.map((memory) => ({
      id: memory?.id || null,
      time: memory?.time || null,
      location: memory?.location || null,
      category: memory?.category || null,
      object: memory?.object || null,
      emotion: memory?.emotion || null,
      description: memory?.description || null,
      details: memory?.details || null,
      keys: memory?.keys || null,
      matchScore:
        typeof memory?.match_score === "number" ? memory.match_score : null,
      similarityScore:
        typeof memory?.similarity_score === "number" ? memory.similarity_score : null,
      sourceOfTruthIds: Array.isArray(memory?.source_of_truth_ids)
        ? memory.source_of_truth_ids
        : null,
    })),
  };
}
