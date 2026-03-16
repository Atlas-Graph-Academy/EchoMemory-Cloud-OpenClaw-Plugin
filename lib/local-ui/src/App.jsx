import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

export default function App() {
  const [files, setFiles] = useState([]);
  const [contentMap, setContentMap] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [authStatus, setAuthStatus] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [backendSources, setBackendSources] = useState(null);
  const [setupState, setSetupState] = useState(null);
  const [setupDraft, setSetupDraft] = useState({
    baseUrl: '',
    webBaseUrl: '',
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
  const now = useClock();

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
        baseUrl: data.fields.baseUrl?.value || '',
        webBaseUrl: data.fields.webBaseUrl?.value || '',
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
    const cleanup = connectSSE(() => {
      loadFiles();
      loadSyncStatus();
    });
    return cleanup;
  }, [loadAuthStatus, loadBackendSources, loadFiles, loadSetupStatus, loadSyncStatus]);

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

  const syncMap = useMemo(() => {
    const next = {};

    if (syncStatus?.fileStatuses) {
      for (const status of syncStatus.fileStatuses) {
        if (status.status) next[status.relativePath] = status.status;
      }
    }

    if (backendSources?.sources) {
      const backendPaths = new Set(backendSources.sources.map((source) => source.filePath));
      for (const file of files) {
        const normalized = file.absolutePath || file.filePath;
        if (normalized && backendPaths.has(normalized)) {
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

  const stats = useMemo(() => {
    const t1 = filteredAnnotated.filter((file) => file._tier === 1).length;
    const t2 = filteredAnnotated.filter((file) => file._tier === 2).length;
    return { t1, t2, total: filteredAnnotated.length };
  }, [filteredAnnotated]);

  const systemFileCount = layout.systemFileCount || 0;

  const pendingCount = useMemo(() => {
    let count = 0;
    for (const status of Object.values(syncMap)) {
      if (status === 'new' || status === 'modified') count++;
    }
    return count;
  }, [syncMap]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      let result;
      if (selectMode && syncSelection.size > 0) {
        result = await triggerSyncSelected([...syncSelection]);
        setSyncSelection(new Set());
        setSelectMode(false);
      } else {
        result = await triggerSync();
      }
      const summary = result?.summary || {};
      const parts = [];
      if (summary.new_memory_count > 0) parts.push(`${summary.new_memory_count} new memories`);
      if (summary.new_source_count > 0) parts.push(`${summary.new_source_count} files uploaded`);
      if (summary.skipped_count > 0) parts.push(`${summary.skipped_count} already synced`);
      if (summary.duplicate_count > 0) parts.push(`${summary.duplicate_count} duplicates`);
      if (summary.failed_file_count > 0) parts.push(`${summary.failed_file_count} failed`);
      setSyncResult({ ok: true, msg: parts.join(' | ') || 'Sync complete' });
      loadSyncStatus();
      loadBackendSources();
    } catch {
      setSyncResult({ ok: false, msg: 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  }, [loadBackendSources, loadSyncStatus, selectMode, syncSelection]);

  const toggleFileSelection = useCallback((filePath) => {
    setSyncSelection((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

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
              <li>Generate an API key at `https://www.iditor.com/api`.</li>
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
              {(files.find((file) => file.relativePath === readingPath)?.fileName || '').replace(/\.md$/i, '')}
            </span>
          </>
        ) : view === 'memories' ? (
          <span className="hdr-title">OpenClaw Memory Archive</span>
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
          file={files.find((file) => file.relativePath === readingPath)}
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
          contentMap={contentMap}
          selectedPath={selectedPath}
          selectMode={selectMode}
          syncSelection={syncSelection}
          onCardClick={(path) => {
            if (selectMode) {
              if (path) toggleFileSelection(path);
              return;
            }
            if (path === null) {
              setSelectedPath(null);
              return;
            }
            setSelectedPath((prev) => (prev === path ? null : path));
          }}
          onCardExpand={(path) => {
            setReadingPath(path);
            const existing = contentMap?.get(path);
            if (existing) {
              setReadingContent(existing);
              return;
            }
            setReadingContent(null);
            fetchFileContent(path).then((result) => {
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
                  .filter((status) => status.status === 'new' || status.status === 'modified')
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
              <b>{stats.t1}</b> memories | <b>{stats.t2}</b> knowledge | <b>{stats.total}</b> total
            </span>
            {systemFileCount > 0 && (
              <span className="ftr-system" onClick={() => setView('system')} title="View system files">
                {systemFileCount} system files
              </span>
            )}
          </>
        ) : (
          <span>
            <b>{systemFileCount}</b> system files | not processed into memories
          </span>
        )}
        <span className="ftr-spacer" />
        {syncResult && (
          <span className={syncResult.ok ? 'sync-result' : 'sync-error'}>{syncResult.msg}</span>
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
