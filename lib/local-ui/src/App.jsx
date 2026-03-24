import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Viewport } from './canvas/Viewport';
import { ReadingPanel } from './cards/ReadingPanel';
import { computeLayout, computeSystemLayout, getTier, isSessionLog } from './layout/masonry';
import {
  fetchFiles,
  fetchAllContents,
  fetchFileContent,
  fetchAuthStatus,
  fetchSyncStatus,
  fetchBackendSources,
  triggerSync,
  triggerSyncSelected,
  connectSSE,
  fetchSetupStatus,
  saveSetupConfig,
} from './sync/api';
import './styles/global.css';

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function timeAgo(iso) {
  if (!iso) return 'Never synced';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Synced just now';
  if (min < 60) return `Synced ${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `Synced ${hrs}h ago`;
  return `Synced ${Math.floor(hrs / 24)}d ago`;
}

function buildAuthLabel(authStatus, hasApiKey) {
  if (authStatus?.connected) return 'Connected';
  if (!hasApiKey || authStatus?.reason === 'no_api_key') return 'Local-only mode';
  if (authStatus?.reason === 'auth_failed') return 'Key needs attention';
  return 'Offline';
}

function formatSourceLabel(field, setupState) {
  if (!field?.source) return 'unknown';
  if (field.source === 'local_only_override') {
    return 'local-only override';
  }
  if (field.source === 'plugin_config') {
    return `plugin config (${setupState?.configFile?.targetPath || 'openclaw.json'})`;
  }
  if (field.source === 'env_file') {
    return `env file (${setupState?.envFile?.targetPath || '.env'})`;
  }
  return field.source;
}

function normalizePathKey(rawPath) {
  if (!rawPath) return '';
  const normalized = String(rawPath).replace(/\\/g, '/');
  return normalized.toLowerCase();
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function basenameFromPath(relativePath) {
  if (!relativePath) return '';
  const parts = String(relativePath).split(/[\\/]/);
  return parts[parts.length - 1] || relativePath;
}

function formatStageLabel(stage) {
  if (!stage) return null;
  const normalized = String(stage).trim().toLowerCase();
  if (!normalized) return null;
  return normalized.replace(/[_-]+/g, ' ');
}

function isViewerBlocked(file) {
  return file?.privacyLevel === 'private';
}

function buildSyncResultState(result) {
  const summary = result?.summary || {};
  const runResults = Array.isArray(result?.run_results) ? result.run_results : [];
  const failed = runResults.filter((item) => item?.status === 'failed');
  const parts = [];
  if (summary.new_memory_count > 0) parts.push(`${summary.new_memory_count} new memories`);
  if (summary.new_source_count > 0) parts.push(`${summary.new_source_count} files uploaded`);
  if (summary.skipped_count > 0) parts.push(`${summary.skipped_count} already synced`);
  if (summary.duplicate_count > 0) parts.push(`${summary.duplicate_count} duplicates`);
  if (summary.failed_file_count > 0) parts.push(`${summary.failed_file_count} failed`);

  let msg = parts.join(' | ') || 'Sync complete';
  if (failed.length > 0 && failed.length === runResults.length && runResults.length > 0) {
    msg = `All ${failed.length} selected file${failed.length === 1 ? '' : 's'} failed`;
  } else if (failed.length > 0) {
    msg = `Partial failure | ${msg}`;
  }

  return {
    ok: failed.length === 0,
    msg,
    failed,
  };
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [contentMap, setContentMap] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [authStatus, setAuthStatus] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);
  const [cardSyncState, setCardSyncState] = useState({});
  const [backendSources, setBackendSources] = useState(null);
  const [setupState, setSetupState] = useState(null);
  const [setupDraft, setSetupDraft] = useState({
    apiKey: '',
    memoryDir: '',
  });
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupMessage, setSetupMessage] = useState(null);
  const [view, setView] = useState('memories');
  const [selectedPath, setSelectedPath] = useState(null);
  const [readingPath, setReadingPath] = useState(null);
  const [readingContent, setReadingContent] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [syncSelection, setSyncSelection] = useState(new Set());
  const [expandedWarnings, setExpandedWarnings] = useState({});
  const now = useClock();
  const serverInstanceIdRef = useRef(null);

  const loadFiles = useCallback(async () => {
    try {
      const newFiles = await fetchFiles();
      setFiles(newFiles);
      fetchAllContents(newFiles)
        .then((contents) => {
          setContentMap(contents);
        })
        .catch(console.error);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadAuthStatus = useCallback(async () => {
    setAuthStatus(await fetchAuthStatus());
  }, []);

  const loadSyncStatus = useCallback(async () => {
    setSyncStatus(await fetchSyncStatus());
  }, []);

  const loadBackendSources = useCallback(async () => {
    const data = await fetchBackendSources();
    setBackendSources(data?.ok ? data : null);
  }, []);

  const loadSetupStatus = useCallback(async () => {
    const data = await fetchSetupStatus();
    setSetupState(data);
    if (data?.fields) {
      setSetupDraft({
        apiKey: data.fields.apiKey?.value || '',
        memoryDir: data.fields.memoryDir?.value || '',
      });
    }
  }, []);

  useEffect(() => {
    loadFiles();
    loadAuthStatus();
    loadSyncStatus();
    loadBackendSources();
    loadSetupStatus();
    const cleanup = connectSSE({
      onServerConnected: (event) => {
        const nextServerInstanceId = event?.serverInstanceId;
        if (!nextServerInstanceId) return;
        if (serverInstanceIdRef.current && serverInstanceIdRef.current !== nextServerInstanceId) {
          window.location.reload();
          return;
        }
        serverInstanceIdRef.current = nextServerInstanceId;
      },
      onFilesChanged: () => {
        loadFiles();
        loadSyncStatus();
      },
      onSyncProgress: (progress) => {
        if (!progress) return;
        setSyncProgress(progress);

        if (progress.phase === 'started') {
          setSyncing(true);
          setCardSyncState(() => {
            const next = {};
            for (const path of progress.queuedRelativePaths || []) {
              next[path] = 'queued';
            }
            return next;
          });
          return;
        }

        if (progress.phase === 'file-started') {
          setCardSyncState((prev) => {
            const next = { ...prev };
            for (const path of progress.currentRelativePaths || (progress.currentRelativePath ? [progress.currentRelativePath] : [])) {
              next[path] = 'syncing';
            }
            return next;
          });
          return;
        }

        if (progress.phase === 'file-stage') {
          setCardSyncState((prev) => {
            const next = { ...prev };
            for (const path of progress.currentRelativePaths || (progress.currentRelativePath ? [progress.currentRelativePath] : [])) {
              next[path] = 'syncing';
            }
            return next;
          });
          return;
        }

        if (progress.phase === 'file-finished') {
          setCardSyncState((prev) => {
            const next = { ...prev };
            const recentStatus = progress.recentFileResult?.status;
            const completedPaths = progress.completedRelativePaths || [];
            const failedPaths = progress.failedRelativePaths || [];
            for (const path of completedPaths) {
              next[path] = recentStatus === 'failed' ? 'failed' : 'done';
            }
            for (const path of failedPaths) {
              next[path] = 'failed';
            }
            return next;
          });
          return;
        }

        if (progress.phase === 'failed') {
          setSyncing(false);
          setCardSyncState((prev) => {
            const next = { ...prev };
            for (const path of progress.failedRelativePaths || progress.currentRelativePaths || []) {
              next[path] = 'failed';
            }
            return next;
          });
          return;
        }

        if (progress.phase === 'finished') {
          setSyncing(false);
          setCardSyncState((prev) => {
            const next = { ...prev };
            for (const path of progress.completedRelativePaths || []) {
              next[path] = 'done';
            }
            return next;
          });
        }
      },
    });
    return cleanup;
  }, [loadAuthStatus, loadBackendSources, loadFiles, loadSetupStatus, loadSyncStatus]);

  useEffect(() => {
    setExpandedWarnings((prev) => {
      const next = {};
      const validPaths = new Set(files.map((file) => file.relativePath));
      for (const [key, value] of Object.entries(prev)) {
        if (value && validPaths.has(key)) next[key] = true;
      }
      return next;
    });
  }, [files]);

  const annotated = useMemo(
    () =>
      files.map((file) => ({
        ...file,
        _tier: getTier(file, contentMap),
        _isSessionLog: isSessionLog(file, contentMap),
      })),
    [files, contentMap],
  );

  const filteredAnnotated = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return annotated;
    return annotated.filter((file) => {
      const content = contentMap?.get(file.relativePath) || '';
      const haystack = [
        file.fileName,
        file.relativePath,
        file.fileType,
        file.clusterLabel,
        file.dominantCluster,
        file.baseClass,
        content,
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [annotated, contentMap, searchQuery]);

  const [vpWidth, setVpWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handleResize = () => setVpWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const layout = useMemo(() => computeLayout(filteredAnnotated, vpWidth, contentMap), [filteredAnnotated, vpWidth, contentMap]);

  const systemLayout = useMemo(() => {
    if (view !== 'system') return null;
    return computeSystemLayout(layout.systemFiles || [], vpWidth, contentMap);
  }, [view, layout.systemFiles, vpWidth, contentMap]);

  const syncMetaByPath = useMemo(() => {
    const next = {};
    for (const status of syncStatus?.fileStatuses || []) {
      next[status.relativePath] = status;
    }
    return next;
  }, [syncStatus]);

  const syncMap = useMemo(() => {
    const next = {};

    if (syncStatus?.fileStatuses) {
      for (const status of syncStatus.fileStatuses) {
        if (status.status) next[status.relativePath] = status.status;
      }
    }

    if (backendSources?.sources) {
      const backendPaths = new Set(
        backendSources.sources
          .map((source) => normalizePathKey(source.filePath))
          .filter(Boolean),
      );
      for (const file of files) {
        const normalized = normalizePathKey(file.absolutePath || file.filePath);
        if (normalized && backendPaths.has(normalized) && !next[file.relativePath]) {
          next[file.relativePath] = 'synced';
        }
      }
    }

    for (const file of files) {
      if (file.privacyLevel === 'private') {
        next[file.relativePath] = 'sealed';
      } else if (!next[file.relativePath]) {
        next[file.relativePath] = 'new';
      }
    }

    return next;
  }, [syncStatus, backendSources, files]);

  const selectablePaths = useMemo(
    () =>
      new Set(
        (syncStatus?.fileStatuses || [])
          .filter((status) => status.syncEligible && ['new', 'modified', 'failed'].includes(status.status))
          .map((status) => status.relativePath),
      ),
    [syncStatus],
  );

  const toggleWarningExpansion = useCallback((filePath) => {
    if (!filePath) return;
    setExpandedWarnings((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  }, []);

  const systemFileCount = layout.systemFileCount || 0;
  const visibleFileCount = layout.visibleFileCount || 0;
  const visibleSectionCount = layout.visibleSectionCount || 0;

  const pendingCount = useMemo(() => {
    let count = 0;
    for (const status of Object.values(syncMap)) {
      if (status === 'new' || status === 'modified' || status === 'failed') count++;
    }
    return count;
  }, [syncMap]);

  const syncProgressPercent = useMemo(() => {
    if (!syncProgress?.totalFiles) return 0;
    return Math.max(0, Math.min(100, Math.round((syncProgress.completedFiles / syncProgress.totalFiles) * 100)));
  }, [syncProgress]);

  const readingFile = useMemo(
    () => files.find((file) => file.relativePath === readingPath) || null,
    [files, readingPath],
  );

  useEffect(() => {
    setSyncSelection((prev) => {
      const next = new Set([...prev].filter((path) => selectablePaths.has(path)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [selectablePaths]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncProgress(null);
    try {
      let result;
      if (selectMode && syncSelection.size > 0) {
        result = await triggerSyncSelected([...syncSelection]);
        setSyncSelection(new Set());
        setSelectMode(false);
      } else {
        result = await triggerSync();
      }
      setSyncResult(buildSyncResultState(result));
      loadSyncStatus();
      loadBackendSources();
    } catch (error) {
      setSyncResult({ ok: false, msg: String(error?.message || 'Sync failed') });
    } finally {
      setSyncing(false);
    }
  }, [loadBackendSources, loadSyncStatus, selectMode, syncSelection]);

  const toggleFileSelection = useCallback((filePath) => {
    if (!selectablePaths.has(filePath)) return;
    setSyncSelection((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, [selectablePaths]);

  const handleSetupFieldChange = useCallback((key, value) => {
    setSetupDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSetupSave = useCallback(async () => {
    setSetupSaving(true);
    setSetupMessage(null);
    try {
      const result = await saveSetupConfig(setupDraft);
      setSetupState(result.setup || null);
      setSetupMessage({ ok: true, text: `Saved to ${result.targetPath}` });
      await Promise.all([loadAuthStatus(), loadSyncStatus(), loadBackendSources(), loadSetupStatus()]);
    } catch (error) {
      setSetupMessage({ ok: false, text: String(error?.message ?? error) });
    } finally {
      setSetupSaving(false);
    }
  }, [loadAuthStatus, loadBackendSources, loadSetupStatus, loadSyncStatus, setupDraft]);

  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const hasApiKey = Boolean(setupDraft.apiKey);
  const isConnected = authStatus?.connected === true;
  const authLabel = buildAuthLabel(authStatus, hasApiKey);
  const activeLayout = view === 'system' && systemLayout ? systemLayout : layout;

  return (
    <>
      <aside className="setup-sidebar" aria-label="Echo setup">
        <div className="setup-sidebar__rail">Setup</div>
        <div className="setup-sidebar__panel">
          <div className="setup-sidebar__header">
            <div>
              <h2>Echo Cloud Setup</h2>
              <p>Browse local markdown now. Add credentials here when you want cloud sync.</p>
            </div>
            <span className={isConnected ? 'setup-pill setup-pill--ok' : 'setup-pill'}>{authLabel}</span>
          </div>

          <div className="setup-card">
            <p className="setup-card__title">Current mode</p>
            <p className="setup-copy">
              {isConnected
                ? 'Cloud sync, graph links, and import status are active.'
                : hasApiKey
                  ? 'The local UI is ready. Save or verify your key to re-enable cloud features.'
                  : 'The local UI is running in local-only mode. Files remain fully viewable without an Echo API key.'}
            </p>
          </div>

          <div className="setup-card">
            <p className="setup-card__title">Quick setup</p>
            <ol className="setup-steps">
              <li>Create an EchoMemory account.</li>
              <li>Enter the 6-digit OTP sent to your email to complete login.</li>
              <li>If this is your first login, enter referral code `openclawyay` and choose a user name to finish registration.</li>
              <li>Open `https://www.iditor.com/api`, click `API Keys` in the upper-left area, and create a named API key.</li>
              <li>In `~/.openclaw/openclaw.json`, set `tools.profile` to `full` so OpenClaw does not block normal plugin usage.</li>
              <li>Paste the values below and save. The plugin writes to your local `.env` file.</li>
            </ol>
            <p className="setup-copy">
              Target env file: <code>{setupState?.envFile?.targetPath || 'Loading...'}</code>
            </p>
          </div>

          <div className="setup-card">
            <p className="setup-card__title">Configuration</p>
            <label className="setup-field">
              <span>Echo API key</span>
              <input
                type="password"
                value={setupDraft.apiKey}
                placeholder={setupState?.fields?.apiKey?.maskedValue || 'ec_...'}
                autoComplete="new-password"
                onChange={(e) => handleSetupFieldChange('apiKey', e.target.value)}
              />
              <small>Source: {formatSourceLabel(setupState?.fields?.apiKey, setupState)}</small>
            </label>
            <label className="setup-field">
              <span>Memory directory</span>
              <input
                type="text"
                value={setupDraft.memoryDir || setupState?.fields?.memoryDir?.value || ''}
                placeholder={setupState?.fields?.memoryDir?.value || ''}
                onChange={(e) => handleSetupFieldChange('memoryDir', e.target.value)}
              />
              <small>Source: {formatSourceLabel(setupState?.fields?.memoryDir, setupState)}</small>
              {(setupDraft.memoryDir || setupState?.fields?.memoryDir?.value) && (
                <small>Current path: {setupDraft.memoryDir || setupState?.fields?.memoryDir?.value}</small>
              )}
            </label>
            <button className="setup-save-btn" disabled={setupSaving} onClick={handleSetupSave}>
              {setupSaving ? 'Saving...' : 'Save local settings'}
            </button>
            {setupMessage && (
              <p className={setupMessage.ok ? 'setup-msg setup-msg--ok' : 'setup-msg setup-msg--error'}>
                {setupMessage.text}
              </p>
            )}
          </div>
        </div>
      </aside>

      <div className="hdr">
        <span className="hdr-icon">Archive</span>
        {readingPath ? (
          <>
            <span className="hdr-back" onClick={() => { setReadingPath(null); setSelectedPath(null); }}>
              Back to archive
            </span>
            <span className="hdr-title">
              {(readingFile?.fileName || '').replace(/\.md$/i, '')}
            </span>
          </>
        ) : view === 'memories' ? (
          <span className="hdr-title">OpenClaw Smart Clusters</span>
        ) : (
          <>
            <span className="hdr-back" onClick={() => setView('memories')}>Back</span>
            <span className="hdr-title hdr-title-system">System Files</span>
          </>
        )}
        <input
          className="hdr-search"
          type="text"
          value={searchQuery}
          placeholder="Search files and content"
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        <span className="hdr-spacer" />
        <span className="hdr-meta"><b>{dateStr}</b> {timeStr}</span>
        <span className="hdr-meta">|</span>
        <span className="hdr-meta">{timeAgo(syncStatus?.lastSyncAt)}</span>
        <span className="hdr-meta">|</span>
        <span className="hdr-conn">
          {isConnected && <span className="conn-ok">{authLabel}</span>}
          {!isConnected && <span className="conn-off">{authLabel}</span>}
        </span>
      </div>

      {readingPath ? (
        <ReadingPanel
          path={readingPath}
          content={readingContent ?? contentMap?.get(readingPath) ?? 'Loading...'}
          file={readingFile}
          blocked={isViewerBlocked(readingFile)}
          onClose={() => {
            setReadingPath(null);
            setSelectedPath(null);
            setReadingContent(null);
          }}
        />
      ) : files.length === 0 ? (
        <div className="empty-state">Loading files...</div>
      ) : filteredAnnotated.length === 0 ? (
        <div className="empty-state">No files match "{searchQuery.trim()}"</div>
      ) : (
        <Viewport
          key={view}
          cards={activeLayout.cards}
          sections={activeLayout.sections}
          bounds={activeLayout.bounds}
          syncStatus={syncMap}
          syncMetaByPath={syncMetaByPath}
          transientStatusMap={cardSyncState}
          contentMap={contentMap}
          expandedWarnings={expandedWarnings}
          selectedPath={selectedPath}
          selectMode={selectMode}
          syncSelection={syncSelection}
          selectablePaths={selectablePaths}
          onWarningToggle={toggleWarningExpansion}
          onCardClick={(path) => {
            if (selectMode) {
              if (path && selectablePaths.has(path)) toggleFileSelection(path);
              return;
            }
            if (path === null) {
              setSelectedPath(null);
              return;
            }
            setSelectedPath((prev) => (prev === path ? null : path));
          }}
          onCardExpand={(path) => {
            const file = files.find((entry) => entry.relativePath === path) || null;
            setReadingPath(path);
            if (isViewerBlocked(file)) {
              setReadingContent('');
              return;
            }
            const existing = contentMap?.get(path);
            if (existing) {
              setReadingContent(existing);
              return;
            }
            setReadingContent(null);
            fetchFileContent(path).then((result) => {
              if (result?.blocked) {
                setReadingContent('');
                return;
              }
              const content = result?.content ?? '';
              setReadingContent(content);
              setContentMap((prev) => {
                const next = new Map(prev || []);
                next.set(path, content);
                return next;
              });
            });
          }}
        />
      )}

      {syncProgress && (
        <div className="sync-progress-dock">
          <div className="sync-progress-top">
            <span className="sync-progress-title">
              {syncProgress.phase === 'failed'
                ? 'Sync failed'
                : syncProgress.phase === 'finished'
                  ? syncProgress.failedCount > 0
                    ? syncProgress.failedCount === syncProgress.totalFiles
                      ? 'All files failed'
                      : 'Sync finished with failures'
                    : 'Sync complete'
                  : 'Sync in progress'}
            </span>
            <span className="sync-progress-meta">
              {Math.max(syncProgress.currentFileIndex || syncProgress.completedFiles, syncProgress.completedFiles)} / {syncProgress.totalFiles} files
            </span>
            {syncProgress.currentRelativePath && (
              <span className="sync-progress-meta">
                File {basenameFromPath(syncProgress.currentRelativePath)}
              </span>
            )}
            {formatStageLabel(syncProgress.currentStage) && (
              <span className="sync-progress-meta">
                Stage {formatStageLabel(syncProgress.currentStage)}
              </span>
            )}
            <span className="sync-progress-meta">Elapsed {formatDuration(syncProgress.elapsedMs)}</span>
            {syncProgress.etaMs && syncProgress.phase !== 'finished' && syncProgress.phase !== 'failed' && (
              <span className="sync-progress-meta">ETA {formatDuration(syncProgress.etaMs)}</span>
            )}
            <span className="sync-progress-meta">
              OK {syncProgress.successCount} | Failed {syncProgress.failedCount}
            </span>
          </div>
          <div className="sync-progress-track">
            <div className="sync-progress-fill" style={{ width: `${syncProgressPercent}%` }} />
          </div>
          {syncProgress.recentFileResult?.status === 'failed' && (
            <div className="sync-progress-detail">
              Failed {basenameFromPath(syncProgress.recentFileResult.relativePath || syncProgress.currentRelativePath)}: {syncProgress.recentFileResult.lastError || 'Unknown error'}
            </div>
          )}
        </div>
      )}

      <div className="ftr">
        {selectMode ? (
          <>
            <span className="selection-copy">
              <b>{syncSelection.size}</b> file{syncSelection.size !== 1 ? 's' : ''} selected
            </span>
            <button
              className="ftr-select-toggle"
              onClick={() => {
                const pending = (syncStatus?.fileStatuses || [])
                  .filter((status) => status.syncEligible && ['new', 'modified', 'failed'].includes(status.status))
                  .map((status) => status.relativePath);
                setSyncSelection(new Set(pending));
              }}
            >
              Select pending
            </button>
            <button className="ftr-select-toggle" onClick={() => setSyncSelection(new Set())}>Clear</button>
            <button className="ftr-select-toggle" onClick={() => { setSelectMode(false); setSyncSelection(new Set()); }}>
              Cancel
            </button>
          </>
        ) : view === 'memories' ? (
          <>
            <span>
              <b>{visibleSectionCount}</b> smart clusters | <b>{visibleFileCount}</b> visible files | <b>{filteredAnnotated.length}</b> total
            </span>
            {systemFileCount > 0 && (
              <span className="ftr-system" onClick={() => setView('system')} title="View system files">
                {systemFileCount} system files
              </span>
            )}
          </>
        ) : (
          <span>
            <b>{systemFileCount}</b> system files | hidden from smart clusters
          </span>
        )}
        <span className="ftr-spacer" />
        {syncResult && (
          <>
            <span className={syncResult.ok ? 'sync-result' : 'sync-error'}>{syncResult.msg}</span>
            {!syncResult.ok && syncResult.failed?.length > 0 && (
              <span className="sync-error">
                {syncResult.failed
                  .slice(0, 2)
                  .map((item) => `${basenameFromPath(item.filePath)}: ${item.lastError || 'Unknown error'}`)
                  .join(' | ')}
              </span>
            )}
          </>
        )}
        {!selectMode && pendingCount > 0 && (
          <button className="ftr-select-toggle" onClick={() => setSelectMode(true)}>
            Select files
          </button>
        )}
        {selectMode ? (
          <button className="sync-btn" disabled={!isConnected || syncing || syncSelection.size === 0} onClick={handleSync}>
            {syncing ? 'Syncing...' : `Sync ${syncSelection.size} selected`}
          </button>
        ) : (
          <a
            href="https://www.iditor.com/login?next=/memory-graph"
            target="_blank"
            rel="noopener noreferrer"
            className="explore-btn"
            aria-disabled={!isConnected}
            onClick={(event) => {
              if (!isConnected) event.preventDefault();
            }}
          >
            {isConnected ? 'Explore your memories' : 'Add Echo key in Setup'}
          </a>
        )}
      </div>
    </>
  );
}
