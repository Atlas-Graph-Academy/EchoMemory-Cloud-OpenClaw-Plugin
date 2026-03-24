import { scanOpenClawMemoryDir } from "./openclaw-memory-scan.js";
import {
  migrateStateFile,
  resolveStatePath,
  readLastSyncState,
  writeLastSyncState,
} from "./state.js";

function resolveRuntimeStateDir(api) {
  return api?.runtime?.state?.resolveStateDir?.() || null;
}

function buildRunId() {
  return `echo-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildEmptySummary(fileCount = 0) {
  return {
    file_count: fileCount,
    skipped_count: 0,
    new_source_count: 0,
    new_memory_count: 0,
    duplicate_count: 0,
    failed_file_count: 0,
  };
}

function mergeSummary(target, next) {
  target.file_count += next.file_count ?? 0;
  target.skipped_count += next.skipped_count ?? 0;
  target.new_source_count += next.new_source_count ?? 0;
  target.new_memory_count += next.new_memory_count ?? 0;
  target.duplicate_count += next.duplicate_count ?? 0;
  target.failed_file_count += next.failed_file_count ?? 0;
  return target;
}

function countStatuses(results = []) {
  const counts = {
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
  };

  for (const result of results) {
    if (!result?.status) continue;
    if (result.status === "failed") {
      counts.failedCount += 1;
      continue;
    }
    if (result.status === "skipped") {
      counts.skippedCount += 1;
      counts.successCount += 1;
      continue;
    }
    if (result.status === "duplicate") {
      counts.duplicateCount += 1;
      counts.successCount += 1;
      continue;
    }
    counts.successCount += 1;
  }

  return counts;
}

function applyManualFileSummary(summary, status) {
  summary.file_count += 1;
  if (status === "failed") {
    summary.failed_file_count += 1;
  } else if (status === "skipped") {
    summary.skipped_count += 1;
  } else if (status === "duplicate") {
    summary.duplicate_count += 1;
  } else {
    summary.new_source_count += 1;
  }
}

function normalizeStatus(rawStatus, fallback = "imported") {
  const normalized = String(rawStatus || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["failed", "error"].includes(normalized)) return "failed";
  if (["skipped", "unchanged"].includes(normalized)) return "skipped";
  if (["duplicate", "deduped"].includes(normalized)) return "duplicate";
  if (["imported", "processed", "success", "saved", "synced"].includes(normalized)) return "imported";
  return fallback;
}

function selectMatchingResult(response, filePath) {
  const results = Array.isArray(response?.results)
    ? response.results
    : Array.isArray(response?.file_results)
      ? response.file_results
      : [];
  if (results.length === 0) {
    return null;
  }

  const exactMatch = results.find((result) => {
    const candidate = result?.file_path || result?.filePath || result?.path;
    return candidate === filePath;
  });
  if (exactMatch) {
    return exactMatch;
  }

  return results.length === 1 ? results[0] : null;
}

function buildFileResult({
  file,
  response = null,
  attemptAt,
  previousResult = null,
  error = null,
}) {
  const matchedResult = response ? selectMatchingResult(response, file.filePath) : null;
  const rawError =
    error
    ?? matchedResult?.error
    ?? matchedResult?.error_message
    ?? matchedResult?.reason
    ?? response?.error
    ?? response?.message
    ?? null;
  const responseSummary = response?.summary ?? null;

  let status = matchedResult?.status ? normalizeStatus(matchedResult.status) : null;
  if (!status) {
    if ((responseSummary?.failed_file_count ?? 0) > 0) {
      status = "failed";
    } else if ((responseSummary?.duplicate_count ?? 0) > 0) {
      status = "duplicate";
    } else if ((responseSummary?.skipped_count ?? 0) > 0) {
      status = "skipped";
    } else {
      status = error ? "failed" : "imported";
    }
  }

  const lastSuccessAt =
    status === "failed"
      ? previousResult?.lastSuccessAt ?? previousResult?.last_success_at ?? null
      : attemptAt;
  const lastSuccessfulContentHash =
    status === "failed"
      ? previousResult?.lastSuccessfulContentHash
        ?? previousResult?.last_successful_content_hash
        ?? previousResult?.contentHash
        ?? previousResult?.content_hash
        ?? null
      : file.contentHash;

  return {
    filePath: file.filePath,
    contentHash: file.contentHash,
    status,
    lastAttemptAt: attemptAt,
    lastSuccessAt,
    lastSuccessfulContentHash,
    lastError: status === "failed" ? String(rawError || "Unknown import failure") : null,
    stage: matchedResult?.stage ?? matchedResult?.stage_reached ?? null,
    summary: {
      file_count: responseSummary?.file_count ?? 1,
      skipped_count: responseSummary?.skipped_count ?? (status === "skipped" ? 1 : 0),
      new_source_count: responseSummary?.new_source_count ?? (status === "imported" ? 1 : 0),
      new_memory_count: responseSummary?.new_memory_count ?? 0,
      duplicate_count: responseSummary?.duplicate_count ?? (status === "duplicate" ? 1 : 0),
      failed_file_count: responseSummary?.failed_file_count ?? (status === "failed" ? 1 : 0),
    },
  };
}

function buildProgressPayload({
  phase,
  runId,
  trigger,
  startedAt,
  totalFiles,
  completedFiles,
  currentFileIndex = 0,
  currentFilePath = null,
  currentStage = null,
  currentFilePaths = [],
  completedFilePaths = [],
  failedFilePaths = [],
  runResults = [],
  error = null,
}) {
  const startedAtMs = new Date(startedAt).getTime();
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const remainingFiles = Math.max(0, totalFiles - completedFiles);
  const etaMs =
    completedFiles > 0 && remainingFiles > 0
      ? Math.round((elapsedMs / completedFiles) * remainingFiles)
      : null;
  const counts = countStatuses(runResults);
  const recentFileResult = runResults.length > 0 ? runResults[runResults.length - 1] : null;

  return {
    phase,
    runId,
    trigger,
    startedAt,
    totalFiles,
    completedFiles,
    remainingFiles,
    currentFileIndex,
    currentFilePath,
    currentStage,
    currentFilePaths,
    completedFilePaths,
    failedFilePaths,
    elapsedMs,
    etaMs,
    successCount: counts.successCount,
    failedCount: counts.failedCount,
    skippedCount: counts.skippedCount,
    duplicateCount: counts.duplicateCount,
    recentFileResult,
    error,
  };
}

export function formatStatusText(localState, remoteStatus = null) {
  const lines = [];
  lines.push("Echo Memory status:");

  if (localState) {
    lines.push(`- last_sync_at: ${localState.finished_at || "(unknown)"}`);
    lines.push(`- last_sync_mode: ${localState.trigger || "(unknown)"}`);
    lines.push(`- files_scanned: ${localState.summary?.file_count ?? 0}`);
    lines.push(`- skipped: ${localState.summary?.skipped_count ?? 0}`);
    lines.push(`- new_sources: ${localState.summary?.new_source_count ?? 0}`);
    lines.push(`- new_memories: ${localState.summary?.new_memory_count ?? 0}`);
    lines.push(`- duplicates: ${localState.summary?.duplicate_count ?? 0}`);
    lines.push(`- failed_files: ${localState.summary?.failed_file_count ?? 0}`);
    if (localState.error) {
      lines.push(`- last_error: ${localState.error}`);
    }
  } else {
    lines.push("- last_sync_at: (none)");
  }

  if (remoteStatus) {
    lines.push("");
    lines.push("Echo backend:");
    lines.push(`- total_sources: ${remoteStatus.total_source_versions ?? 0}`);
    lines.push(`- processed_sources: ${remoteStatus.processed_source_versions ?? 0}`);
    lines.push(`- recent_memories: ${remoteStatus.recent_memory_count ?? 0}`);
    lines.push(`- latest_imported_at: ${remoteStatus.latest_imported_at || "(none)"}`);
  }

  return lines.join("\n");
}

export function createSyncRunner({ api, cfg, client, fallbackStateDir = null, stableStateDir = null }) {
  let intervalHandle = null;
  let statePath = null;
  let activeRun = null;
  let activeRunInfo = null;
  const progressListeners = new Set();

  function resolveStateDirectories(overrideStateDir = null) {
    const runtimeStateDir = overrideStateDir || resolveRuntimeStateDir(api);
    const primaryStateDir = stableStateDir || runtimeStateDir || fallbackStateDir;
    const legacyStateDirs = [];

    for (const candidate of [runtimeStateDir, fallbackStateDir]) {
      if (!candidate || candidate === primaryStateDir || legacyStateDirs.includes(candidate)) {
        continue;
      }
      legacyStateDirs.push(candidate);
    }

    return {
      primaryStateDir,
      legacyStateDirs,
    };
  }

  async function initialize(stateDir) {
    const { primaryStateDir, legacyStateDirs } = resolveStateDirectories(stateDir);
    if (!primaryStateDir) {
      throw new Error("Echo memory state directory is unavailable");
    }
    statePath = resolveStatePath(primaryStateDir);

    const migratedFrom = await migrateStateFile(
      statePath,
      legacyStateDirs.map((legacyStateDir) => resolveStatePath(legacyStateDir)),
    );
    if (migratedFrom) {
      api.logger?.info?.(`[echo-memory] migrated sync state from ${migratedFrom} to ${statePath}`);
    }
  }

  function getStatePath() {
    if (statePath) {
      return statePath;
    }
    const { primaryStateDir } = resolveStateDirectories();
    if (!primaryStateDir) {
      throw new Error("Echo memory state directory is unavailable");
    }
    return resolveStatePath(primaryStateDir);
  }

  function emitProgress(event) {
    for (const listener of progressListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener failures.
      }
    }
  }

  function onProgress(listener) {
    progressListeners.add(listener);
    return () => progressListeners.delete(listener);
  }

  async function runSync(trigger = "manual", filterPaths = null) {
    if (activeRun) {
      return activeRun;
    }

    activeRun = (async () => {
      const runId = buildRunId();
      const startedAt = new Date().toISOString();
      activeRunInfo = { runId, trigger, startedAt };

      let totalFiles = 0;
      let completedFiles = 0;
      let currentFilePath = null;
      let currentFileIndex = 0;
      const successfulPaths = [];
      const failedPaths = [];
      const runResults = [];

      let prevState = null;
      let prevResults = [];
      const resultMap = new Map();

      try {
        prevState = await readLastSyncState(getStatePath());
        prevResults = Array.isArray(prevState?.results) ? prevState.results : [];
        for (const entry of prevResults) {
          const key = entry?.filePath || entry?.file_path;
          if (!key) continue;
          resultMap.set(key, entry);
        }
      } catch {
        prevState = null;
        prevResults = [];
      }

      try {
        if (!cfg.apiKey) {
          const message = "Missing Echo API key";
          emitProgress(buildProgressPayload({
            phase: "failed",
            runId,
            trigger,
            startedAt,
            totalFiles: 0,
            completedFiles: 0,
            runResults,
            error: message,
          }));
          const state = {
            trigger,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            error: message,
            summary: buildEmptySummary(0),
            results: prevResults,
            run_results: [],
          };
          await writeLastSyncState(getStatePath(), state);
          return state;
        }

        await client.whoami();

        let files = [];
        try {
          files = await scanOpenClawMemoryDir(cfg.memoryDir);
        } catch (error) {
          const message = error?.code === "ENOENT"
            ? `OpenClaw memory directory not found: ${cfg.memoryDir}`
            : String(error?.message ?? error);
          emitProgress(buildProgressPayload({
            phase: "failed",
            runId,
            trigger,
            startedAt,
            totalFiles: 0,
            completedFiles: 0,
            runResults,
            error: message,
          }));
          const state = {
            trigger,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            error: message,
            summary: buildEmptySummary(0),
            results: prevResults,
            run_results: [],
          };
          await writeLastSyncState(getStatePath(), state);
          return state;
        }

        if (filterPaths instanceof Set && filterPaths.size > 0) {
          files = files.filter((file) => filterPaths.has(file.filePath));
        }

        totalFiles = files.length;
        if (totalFiles === 0) {
          emitProgress(buildProgressPayload({
            phase: "finished",
            runId,
            trigger,
            startedAt,
            totalFiles: 0,
            completedFiles: 0,
            runResults,
          }));
          const state = {
            trigger,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            summary: buildEmptySummary(0),
            results: prevResults,
            run_results: [],
          };
          await writeLastSyncState(getStatePath(), state);
          return state;
        }

        emitProgress(buildProgressPayload({
          phase: "started",
          runId,
          trigger,
          startedAt,
          totalFiles,
          completedFiles: 0,
          currentFilePaths: files.map((file) => file.filePath),
          runResults,
        }));

        const summary = buildEmptySummary(0);

        for (const [index, file] of files.entries()) {
          currentFileIndex = index + 1;
          currentFilePath = file.filePath;
          emitProgress(buildProgressPayload({
            phase: "file-started",
            runId,
            trigger,
            startedAt,
            totalFiles,
            completedFiles,
            currentFileIndex,
            currentFilePath,
            currentStage: "parse",
            currentFilePaths: [file.filePath],
            completedFilePaths: successfulPaths,
            failedFilePaths: failedPaths,
            runResults,
          }));

          const attemptAt = new Date().toISOString();
          const previousResult = resultMap.get(file.filePath) ?? null;

          try {
            const response = await client.importMarkdown([file], {
              onStageEvent: (stageEvent) => {
                emitProgress(buildProgressPayload({
                  phase: "file-stage",
                  runId,
                  trigger,
                  startedAt,
                  totalFiles,
                  completedFiles,
                  currentFileIndex,
                  currentFilePath,
                  currentStage: stageEvent?.stage || null,
                  currentFilePaths: [file.filePath],
                  completedFilePaths: successfulPaths,
                  failedFilePaths: failedPaths,
                  runResults,
                }));
              },
            });
            if (response?.summary) {
              mergeSummary(summary, response.summary);
            }

            const fileResult = buildFileResult({
              file,
              response,
              attemptAt,
              previousResult,
            });

            if (!response?.summary) {
              applyManualFileSummary(summary, fileResult.status);
            }

            runResults.push(fileResult);
            resultMap.set(file.filePath, fileResult);
            completedFiles += 1;

            if (fileResult.status === "failed") {
              failedPaths.push(file.filePath);
            } else {
              successfulPaths.push(file.filePath);
            }

            emitProgress(buildProgressPayload({
              phase: "file-finished",
              runId,
              trigger,
              startedAt,
              totalFiles,
              completedFiles,
              currentFileIndex,
              currentFilePath,
              currentStage: fileResult.stage,
              currentFilePaths: [file.filePath],
              completedFilePaths: fileResult.status === "failed" ? [] : [file.filePath],
              failedFilePaths: fileResult.status === "failed" ? [file.filePath] : [],
              runResults,
            }));
          } catch (error) {
            const fileResult = buildFileResult({
              file,
              attemptAt,
              previousResult,
              error: String(error?.message ?? error),
            });

            applyManualFileSummary(summary, fileResult.status);
            runResults.push(fileResult);
            resultMap.set(file.filePath, fileResult);
            completedFiles += 1;
            failedPaths.push(file.filePath);

            emitProgress(buildProgressPayload({
              phase: "file-finished",
              runId,
              trigger,
              startedAt,
              totalFiles,
              completedFiles,
              currentFileIndex,
              currentFilePath,
              currentStage: fileResult.stage,
              currentFilePaths: [file.filePath],
              failedFilePaths: [file.filePath],
              runResults,
            }));
          }
        }

        const mergedResults = [...resultMap.values()];
        const state = {
          trigger,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          summary,
          results: mergedResults,
          run_results: runResults,
        };
        await writeLastSyncState(getStatePath(), state);

        emitProgress(buildProgressPayload({
          phase: "finished",
          runId,
          trigger,
          startedAt,
          totalFiles,
          completedFiles,
          currentFileIndex,
          currentFilePath,
          completedFilePaths: successfulPaths,
          failedFilePaths: failedPaths,
          runResults,
        }));

        api.logger?.info?.(
          `[echo-memory] sync complete: files=${summary.file_count} new_memories=${summary.new_memory_count} skipped=${summary.skipped_count} failed=${summary.failed_file_count}`,
        );
        return state;
      } catch (error) {
        const message = String(error?.message ?? error);
        emitProgress(buildProgressPayload({
          phase: "failed",
          runId,
          trigger,
          startedAt,
          totalFiles,
          completedFiles,
          currentFileIndex,
          currentFilePath,
          currentFilePaths: currentFilePath ? [currentFilePath] : [],
          failedFilePaths: currentFilePath ? [currentFilePath] : [],
          runResults,
          error: message,
        }));

        const state = {
          trigger,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          error: message,
          summary: buildEmptySummary(0),
          results: [...resultMap.values()],
          run_results: runResults,
        };
        await writeLastSyncState(getStatePath(), state);
        return state;
      }
    })().finally(() => {
      activeRun = null;
      activeRunInfo = null;
    });

    return activeRun;
  }

  function startInterval() {
    stopInterval();
    const intervalMs = cfg.syncIntervalMinutes * 60 * 1000;
    intervalHandle = setInterval(() => {
      runSync("scheduled").catch((error) => {
        api.logger?.warn?.(`[echo-memory] scheduled sync failed: ${String(error?.message ?? error)}`);
      });
    }, intervalMs);
    intervalHandle.unref?.();
  }

  function stopInterval() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  function isRunning() {
    return Boolean(activeRun);
  }

  function getActiveRunInfo() {
    return activeRunInfo;
  }

  return {
    initialize,
    getStatePath,
    onProgress,
    runSync,
    startInterval,
    stopInterval,
    isRunning,
    getActiveRunInfo,
  };
}
