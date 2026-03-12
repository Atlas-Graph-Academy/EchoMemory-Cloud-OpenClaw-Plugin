import { scanOpenClawMemoryDir } from "./openclaw-memory-scan.js";
import { resolveStatePath, writeLastSyncState } from "./state.js";

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

  async function initialize(stateDir) {
    statePath = resolveStatePath(stateDir || api.runtime.state.resolveStateDir());
  }

  function getStatePath() {
    return statePath || resolveStatePath(api.runtime.state.resolveStateDir());
  }

  async function runSync(trigger = "manual") {
    if (activeRun) {
      return activeRun;
    }

    activeRun = (async () => {
      const startedAt = new Date().toISOString();
      try {
        if (!cfg.apiKey) {
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

        const summary = buildEmptySummary();
        const results = [];
        const batches = chunk(files, cfg.batchSize);

        for (const batch of batches) {
          const response = await client.importMarkdown(batch);
          mergeSummary(summary, response.summary ?? {});
          if (Array.isArray(response.results)) {
            results.push(...response.results);
          }
        }

        const state = {
          trigger,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          summary,
          results,
        };
        await writeLastSyncState(getStatePath(), state);
        api.logger?.info?.(
          `[echo-memory] sync complete: files=${summary.file_count} new_memories=${summary.new_memory_count} skipped=${summary.skipped_count} failed=${summary.failed_file_count}`,
        );
        return state;
      } catch (error) {
        const message = String(error?.message ?? error);
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
    runSync,
    startInterval,
    stopInterval,
  };
}
