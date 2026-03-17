import { scanOpenClawMemoryDir } from "./openclaw-memory-scan.js";
import { resolveStatePath, readLastSyncState, writeLastSyncState } from "./state.js";

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
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

function buildProgressPayload({
  phase,
  trigger,
  startedAt,
  totalFiles,
  completedFiles,
  batchIndex = 0,
  batchCount = 0,
  currentFilePaths = [],
  completedFilePaths = [],
  failedFilePaths = [],
  error = null,
}) {
  const startedAtMs = new Date(startedAt).getTime();
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const remainingFiles = Math.max(0, totalFiles - completedFiles);
  const etaMs =
    completedFiles > 0 && remainingFiles > 0
      ? Math.round((elapsedMs / completedFiles) * remainingFiles)
      : null;

  return {
    phase,
    trigger,
    startedAt,
    totalFiles,
    completedFiles,
    remainingFiles,
    batchIndex,
    batchCount,
    currentFilePaths,
    completedFilePaths,
    failedFilePaths,
    elapsedMs,
    etaMs,
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

export function createSyncRunner({ api, cfg, client }) {
  let intervalHandle = null;
  let statePath = null;
  let activeRun = null;
  const progressListeners = new Set();

  async function initialize(stateDir) {
    statePath = resolveStatePath(stateDir || api.runtime.state.resolveStateDir());
  }

  function getStatePath() {
    return statePath || resolveStatePath(api.runtime.state.resolveStateDir());
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
      const startedAt = new Date().toISOString();
      let totalFiles = 0;
      let batchCount = 0;
      let completedFiles = 0;
      let currentBatchPaths = [];
      try {
        if (!cfg.apiKey) {
          emitProgress(buildProgressPayload({
            phase: "failed",
            trigger,
            startedAt,
            totalFiles: 0,
            completedFiles: 0,
            error: "Missing Echo API key",
          }));
          const state = {
            trigger,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            error: "Missing Echo API key",
            summary: buildEmptySummary(0),
            results: [],
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
            trigger,
            startedAt,
            totalFiles: 0,
            completedFiles: 0,
            error: message,
          }));
          const state = {
            trigger,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            error: message,
            summary: buildEmptySummary(0),
            results: [],
          };
          await writeLastSyncState(getStatePath(), state);
          return state;
        }

        // If filterPaths is provided (Set of absolute paths), only sync those files
        if (filterPaths instanceof Set && filterPaths.size > 0) {
          files = files.filter(f => filterPaths.has(f.filePath));
        }

        if (files.length === 0) {
          emitProgress(buildProgressPayload({
            phase: "finished",
            trigger,
            startedAt,
            totalFiles: 0,
            completedFiles: 0,
          }));
          const state = {
            trigger,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            summary: buildEmptySummary(0),
            results: [],
          };
          await writeLastSyncState(getStatePath(), state);
          return state;
        }

        const summary = buildEmptySummary();
        const batches = chunk(files, cfg.batchSize);
        totalFiles = files.length;
        batchCount = batches.length;

        emitProgress(buildProgressPayload({
          phase: "started",
          trigger,
          startedAt,
          totalFiles,
          completedFiles: 0,
          batchCount,
          currentFilePaths: files.map((file) => file.filePath),
        }));

        for (const [index, batch] of batches.entries()) {
          currentBatchPaths = batch.map((file) => file.filePath);
          emitProgress(buildProgressPayload({
            phase: "batch-started",
            trigger,
            startedAt,
            totalFiles,
            completedFiles,
            batchIndex: index + 1,
            batchCount,
            currentFilePaths: currentBatchPaths,
          }));
          const response = await client.importMarkdown(batch);
          mergeSummary(summary, response.summary ?? {});
          completedFiles += batch.length;
          emitProgress(buildProgressPayload({
            phase: "batch-finished",
            trigger,
            startedAt,
            totalFiles,
            completedFiles,
            batchIndex: index + 1,
            batchCount,
            completedFilePaths: currentBatchPaths,
          }));
        }

        const newResults = files.map((f) => ({ filePath: f.filePath, contentHash: f.contentHash, status: "imported" }));

        // Merge with existing state — preserve previously synced files
        let mergedResults = newResults;
        if (filterPaths instanceof Set && filterPaths.size > 0) {
          const prevState = await readLastSyncState(getStatePath());
          const prevResults = Array.isArray(prevState?.results) ? prevState.results : [];
          // Keep previous results that weren't in this batch, add new ones
          const newPathSet = new Set(newResults.map(r => r.filePath));
          mergedResults = [
            ...prevResults.filter(r => !newPathSet.has(r.filePath || r.file_path)),
            ...newResults,
          ];
        }

        const state = {
          trigger,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          summary,
          results: mergedResults,
        };
        await writeLastSyncState(getStatePath(), state);
        emitProgress(buildProgressPayload({
          phase: "finished",
          trigger,
          startedAt,
          totalFiles,
          completedFiles,
          batchIndex: batchCount,
          batchCount,
          completedFilePaths: files.map((file) => file.filePath),
        }));
        api.logger?.info?.(
          `[echo-memory] sync complete: files=${summary.file_count} new_memories=${summary.new_memory_count} skipped=${summary.skipped_count} failed=${summary.failed_file_count}`,
        );
        return state;
      } catch (error) {
        const message = String(error?.message ?? error);
        emitProgress(buildProgressPayload({
          phase: "failed",
          trigger,
          startedAt,
          totalFiles,
          completedFiles,
          batchCount,
          currentFilePaths: currentBatchPaths,
          failedFilePaths: currentBatchPaths,
          error: message,
        }));
        const state = {
          trigger,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          error: message,
          summary: buildEmptySummary(0),
          results: [],
        };
        await writeLastSyncState(getStatePath(), state);
        return state;
      }
    })().finally(() => {
      activeRun = null;
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

  return {
    initialize,
    getStatePath,
    onProgress,
    runSync,
    startInterval,
    stopInterval,
  };
}
