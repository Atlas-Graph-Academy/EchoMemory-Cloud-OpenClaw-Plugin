import { scanOpenClawMemoryDir } from "./openclaw-memory-scan.js";
import {
  migrateStateFile,
  resolveStatePath,
  readLastSyncState,
  writeLastSyncState,
} from "./state.js";

const MIN_AUTO_SYNC_INTERVAL_MINUTES = 15;
const STARTUP_SYNC_TRIGGERS = new Set(["startup", "compat-startup"]);
const FILE_CHANGE_SYNC_DEBOUNCE_MS = 10000;

function resolveRuntimeStateDir(api) {
  return api?.runtime?.state?.resolveStateDir?.() || null;
}

function buildRunId() {
  return `echo-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildEmptySummary(fileCount = 0, scannedFileCount = fileCount, pendingFileCount = fileCount) {
  return {
    file_count: fileCount,
    scanned_file_count: scannedFileCount,
    pending_file_count: pendingFileCount,
    skipped_count: 0,
    new_source_count: 0,
    new_memory_count: 0,
    duplicate_count: 0,
    failed_file_count: 0,
  };
}

function mergeSummary(target, next) {
  target.file_count += next.file_count ?? 0;
  target.scanned_file_count += next.scanned_file_count ?? 0;
  target.pending_file_count += next.pending_file_count ?? 0;
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

function readStoredAttemptedContentHash(entry = null) {
  return entry?.contentHash ?? entry?.content_hash ?? null;
}

function readStoredSuccessfulContentHash(entry = null) {
  if (!entry) {
    return null;
  }
  const storedStatus = normalizeStatus(entry?.status, "");
  return entry?.lastSuccessfulContentHash
    ?? entry?.last_successful_content_hash
    ?? (storedStatus && storedStatus !== "failed" ? readStoredAttemptedContentHash(entry) : null);
}

function shouldSyncFile(file, previousResult = null) {
  if (!previousResult) {
    return true;
  }

  const previousStatus = normalizeStatus(previousResult?.status, "");
  const attemptedHash = readStoredAttemptedContentHash(previousResult);
  if (previousStatus === "failed" && attemptedHash && attemptedHash === file.contentHash) {
    return true;
  }

  const successfulHash = readStoredSuccessfulContentHash(previousResult);
  if (!successfulHash) {
    return true;
  }

  return successfulHash !== file.contentHash;
}

function chunkFiles(files, chunkSize) {
  const normalizedChunkSize = Math.max(1, Number.parseInt(String(chunkSize ?? 1), 10) || 1);
  const batches = [];
  for (let index = 0; index < files.length; index += normalizedChunkSize) {
    batches.push(files.slice(index, index + normalizedChunkSize));
  }
  return batches;
}

function readStateFinishedAtMs(state = null) {
  const finishedAt = state?.finished_at;
  if (!finishedAt) {
    return null;
  }
  const finishedAtMs = new Date(finishedAt).getTime();
  return Number.isFinite(finishedAtMs) ? finishedAtMs : null;
}

function isStartupSyncTrigger(trigger) {
  return STARTUP_SYNC_TRIGGERS.has(String(trigger || "").trim().toLowerCase());
}

function shouldThrottleStartupSync(prevState, trigger, intervalMs) {
  if (!isStartupSyncTrigger(trigger)) {
    return false;
  }

  const lastFinishedAtMs = readStateFinishedAtMs(prevState);
  if (!lastFinishedAtMs) {
    return false;
  }

  return (Date.now() - lastFinishedAtMs) < intervalMs;
}

function buildFileResult({
  file,
  response = null,
  attemptAt,
  previousResult = null,
  error = null,
  useResponseSummary = true,
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
  const responseSummary = useResponseSummary ? (response?.summary ?? null) : null;

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
    createdTime: file.createdTime ?? file.modifiedTime ?? null,
    updatedAt: file.updatedAt ?? file.modifiedTime ?? null,
    status,
    lastAttemptAt: attemptAt,
    lastSuccessAt,
    lastSuccessfulContentHash,
    lastError: status === "failed" ? String(rawError || "Unknown import failure") : null,
    stage: matchedResult?.stage ?? matchedResult?.stage_reached ?? null,
    sourceRecordId: matchedResult?.id ?? matchedResult?.source_id ?? null,
    remoteUpdatedAt: matchedResult?.updated_at ?? matchedResult?.updatedAt ?? null,
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
  latestMemory = null,
  totalMemoriesStreamed = 0,
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
    latestMemory,
    totalMemoriesStreamed,
  };
}

export function formatStatusText(localState, remoteStatus = null) {
  const lines = [];
  lines.push("Echo Memory status:");

  if (localState) {
    const scannedCount = localState.summary?.scanned_file_count ?? localState.summary?.file_count ?? 0;
    const pendingCount = localState.summary?.pending_file_count ?? localState.summary?.file_count ?? 0;
    const processedCount = localState.summary?.file_count ?? 0;
    lines.push(`- last_sync_at: ${localState.finished_at || "(unknown)"}`);
    lines.push(`- last_sync_mode: ${localState.trigger || "(unknown)"}`);
    lines.push(`- files_scanned: ${scannedCount}`);
    lines.push(`- files_selected: ${pendingCount}`);
    lines.push(`- files_processed: ${processedCount}`);
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
  let autoSyncHandle = null;
  let autoSyncEnabled = false;
  let pendingFileSyncHandle = null;
  const pendingFileSyncPaths = new Set();
  let statePath = null;
  let activeRun = null;
  let activeRunInfo = null;
  const progressListeners = new Set();

  function getAutoSyncIntervalMs() {
    return Math.max(
      MIN_AUTO_SYNC_INTERVAL_MINUTES,
      Number.parseInt(String(cfg.syncIntervalMinutes ?? MIN_AUTO_SYNC_INTERVAL_MINUTES), 10) || MIN_AUTO_SYNC_INTERVAL_MINUTES,
    ) * 60 * 1000;
  }

  function clearAutoSyncTimer() {
    if (autoSyncHandle) {
      clearTimeout(autoSyncHandle);
      autoSyncHandle = null;
    }
  }

  function clearPendingFileSyncTimer() {
    if (pendingFileSyncHandle) {
      clearTimeout(pendingFileSyncHandle);
      pendingFileSyncHandle = null;
    }
  }

  function scheduleNextAutoSync(delayMs = getAutoSyncIntervalMs()) {
    if (!autoSyncEnabled) {
      return;
    }
    clearAutoSyncTimer();
    autoSyncHandle = setTimeout(() => {
      autoSyncHandle = null;
      runSync("scheduled").catch((error) => {
        api.logger?.warn?.(`[echo-memory] scheduled sync failed: ${String(error?.message ?? error)}`);
      });
    }, Math.max(0, delayMs));
    autoSyncHandle.unref?.();
  }

  function flushPendingFileSync() {
    pendingFileSyncHandle = null;
    if (!autoSyncEnabled || pendingFileSyncPaths.size === 0) {
      pendingFileSyncPaths.clear();
      return;
    }
    if (activeRun) {
      schedulePendingFileSync();
      return;
    }
    const filterPaths = new Set(pendingFileSyncPaths);
    pendingFileSyncPaths.clear();
    runSync("file-change", filterPaths).catch((error) => {
      api.logger?.warn?.(`[echo-memory] file-change sync failed: ${String(error?.message ?? error)}`);
    });
  }

  function schedulePendingFileSync(delayMs = FILE_CHANGE_SYNC_DEBOUNCE_MS) {
    if (!autoSyncEnabled || pendingFileSyncPaths.size === 0) {
      return;
    }
    clearPendingFileSyncTimer();
    pendingFileSyncHandle = setTimeout(() => {
      flushPendingFileSync();
    }, Math.max(0, delayMs));
    pendingFileSyncHandle.unref?.();
  }

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

  async function runSync(trigger = "manual", filterPaths = null, options = {}) {
    const force = options?.force === true;
    if (activeRun) {
      return activeRun;
    }

    activeRun = (async () => {
      const runId = buildRunId();
      const startedAt = new Date().toISOString();
      activeRunInfo = { runId, trigger, startedAt };

      if (filterPaths instanceof Set && filterPaths.size > 0) {
        for (const filePath of filterPaths) {
          pendingFileSyncPaths.delete(filePath);
        }
        if (pendingFileSyncPaths.size === 0) {
          clearPendingFileSyncTimer();
        }
      } else {
        pendingFileSyncPaths.clear();
        clearPendingFileSyncTimer();
      }

      let totalFiles = 0;
      let completedFiles = 0;
      let currentFilePath = null;
      let currentFileIndex = 0;
      let totalMemoriesStreamed = 0;
      const successfulPaths = [];
      const failedPaths = [];
      const runResults = [];

      let prevState = null;
      let prevResults = [];
      const resultMap = new Map();
      const intervalMs = getAutoSyncIntervalMs();

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
        if (shouldThrottleStartupSync(prevState, trigger, intervalMs)) {
          api.logger?.info?.(
            `[echo-memory] skipped ${trigger} sync because the previous sync finished less than ${Math.round(intervalMs / 60000)} minutes ago`,
          );
          return prevState;
        }

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
            summary: buildEmptySummary(0, 0, 0),
            results: prevResults,
            run_results: [],
          };
          await writeLastSyncState(getStatePath(), state);
          return state;
        }

        await client.whoami();

        let scannedFiles = [];
        try {
          scannedFiles = await scanOpenClawMemoryDir(cfg.memoryDir, { logger: api.logger });
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
            summary: buildEmptySummary(0, 0, 0),
            results: prevResults,
            run_results: [],
          };
          await writeLastSyncState(getStatePath(), state);
          return state;
        }

        const scannedPathSet = new Set(scannedFiles.map((file) => file.filePath));
        if (!(filterPaths instanceof Set && filterPaths.size > 0)) {
          for (const existingPath of [...resultMap.keys()]) {
            if (!scannedPathSet.has(existingPath)) {
              resultMap.delete(existingPath);
            }
          }
        }

        let files = scannedFiles;
        if (filterPaths instanceof Set && filterPaths.size > 0) {
          files = files.filter((file) => filterPaths.has(file.filePath));
        }

        if (!force) {
          files = files.filter((file) => shouldSyncFile(file, resultMap.get(file.filePath) ?? null));
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
            summary: buildEmptySummary(0, scannedFiles.length, 0),
            results: [...resultMap.values()],
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

        const summary = buildEmptySummary(0, scannedFiles.length, files.length);
        // Force batchSize=1 during re-extract to avoid Vercel 60s timeout
        // (each file takes ~8-15s for Gemini extraction + embeddings)
        const effectiveBatchSize = force ? 1 : cfg.batchSize;
        const batches = chunkFiles(files, effectiveBatchSize);

        for (const batch of batches) {
          const batchPaths = batch.map((file) => file.filePath);
          currentFileIndex = completedFiles + 1;
          currentFilePath = batchPaths[0] ?? null;
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
            currentFilePaths: batchPaths,
            completedFilePaths: successfulPaths,
            failedFilePaths: failedPaths,
            runResults,
          }));

          const attemptAt = new Date().toISOString();

          try {
            const response = await client.importMarkdown(batch, {
              forceReextract: force,
              onStageEvent: (stageEvent) => {
                const stagePaths = Array.isArray(stageEvent?.file_paths)
                  ? stageEvent.file_paths.filter(Boolean)
                  : Array.isArray(stageEvent?.filePaths)
                    ? stageEvent.filePaths.filter(Boolean)
                    : [];
                const nextCurrentPath =
                  stageEvent?.file_path
                  ?? stageEvent?.filePath
                  ?? stageEvent?.path
                  ?? stagePaths[0]
                  ?? batchPaths[0]
                  ?? null;
                emitProgress(buildProgressPayload({
                  phase: "file-stage",
                  runId,
                  trigger,
                  startedAt,
                  totalFiles,
                  completedFiles,
                  currentFileIndex,
                  currentFilePath: nextCurrentPath,
                  currentStage: stageEvent?.stage || null,
                  currentFilePaths: stagePaths.length > 0 ? stagePaths : batchPaths,
                  completedFilePaths: successfulPaths,
                  failedFilePaths: failedPaths,
                  runResults,
                  totalMemoriesStreamed,
                }));
              },
              onMemoryEvent: (memoryEvent) => {
                totalMemoriesStreamed += 1;
                emitProgress(buildProgressPayload({
                  phase: "file-memory",
                  runId,
                  trigger,
                  startedAt,
                  totalFiles,
                  completedFiles,
                  currentFileIndex,
                  currentFilePath: memoryEvent?.file_path || currentFilePath,
                  currentStage: "generate",
                  currentFilePaths: batchPaths,
                  completedFilePaths: successfulPaths,
                  failedFilePaths: failedPaths,
                  runResults,
                  latestMemory: {
                    filePath: memoryEvent?.file_path || null,
                    memoryIndex: memoryEvent?.memory_index ?? 0,
                    description: memoryEvent?.description || "",
                    category: memoryEvent?.category || null,
                    object: memoryEvent?.object || null,
                    emotion: memoryEvent?.emotion || null,
                    location: memoryEvent?.location || null,
                    time: memoryEvent?.time || null,
                    elapsedMs: memoryEvent?.elapsed_ms ?? 0,
                    serial: totalMemoriesStreamed,
                  },
                  totalMemoriesStreamed,
                }));
              },
            });
            if (response?.summary) {
              mergeSummary(summary, response.summary);
            }

            for (const file of batch) {
              const previousResult = resultMap.get(file.filePath) ?? null;
              const fileResult = buildFileResult({
                file,
                response,
                attemptAt,
                previousResult,
                useResponseSummary: batch.length === 1,
              });

              if (!response?.summary) {
                applyManualFileSummary(summary, fileResult.status);
              }

              runResults.push(fileResult);
              resultMap.set(file.filePath, fileResult);
              completedFiles += 1;
              currentFileIndex = completedFiles;
              currentFilePath = file.filePath;

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
            }
          } catch (error) {
            for (const file of batch) {
              const previousResult = resultMap.get(file.filePath) ?? null;
              const fileResult = buildFileResult({
                file,
                attemptAt,
                previousResult,
                error: String(error?.message ?? error),
                useResponseSummary: false,
              });

              applyManualFileSummary(summary, fileResult.status);
              runResults.push(fileResult);
              resultMap.set(file.filePath, fileResult);
              completedFiles += 1;
              currentFileIndex = completedFiles;
              currentFilePath = file.filePath;
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
          `[echo-memory] sync complete: scanned=${summary.scanned_file_count} selected=${summary.pending_file_count} processed=${summary.file_count} new_memories=${summary.new_memory_count} skipped=${summary.skipped_count} failed=${summary.failed_file_count}`,
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
          summary: buildEmptySummary(0, 0, 0),
          results: [...resultMap.values()],
          run_results: runResults,
        };
        await writeLastSyncState(getStatePath(), state);
        return state;
      }
    })().finally(() => {
      activeRun = null;
      activeRunInfo = null;
      if (autoSyncEnabled) {
        scheduleNextAutoSync();
        if (pendingFileSyncPaths.size > 0 && !pendingFileSyncHandle) {
          schedulePendingFileSync();
        }
      }
    });

    return activeRun;
  }

  function startInterval() {
    autoSyncEnabled = true;
    clearPendingFileSyncTimer();
    scheduleNextAutoSync();
  }

  function stopInterval() {
    autoSyncEnabled = false;
    clearAutoSyncTimer();
    clearPendingFileSyncTimer();
    pendingFileSyncPaths.clear();
  }

  function isRunning() {
    return Boolean(activeRun);
  }

  function getActiveRunInfo() {
    return activeRunInfo;
  }

  function queueFileChangeSync(filePath) {
    if (!autoSyncEnabled || !filePath) {
      return false;
    }
    pendingFileSyncPaths.add(filePath);
    schedulePendingFileSync();
    return true;
  }

  return {
    initialize,
    getStatePath,
    onProgress,
    queueFileChangeSync,
    runSync,
    startInterval,
    stopInterval,
    isRunning,
    getActiveRunInfo,
  };
}
