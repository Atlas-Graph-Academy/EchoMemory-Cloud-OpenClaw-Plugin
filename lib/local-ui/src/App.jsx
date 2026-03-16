import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Viewport } from './canvas/Viewport';
import { ReadingPanel } from './cards/ReadingPanel';
import { computeLayout, computeSystemLayout, getTier, isSessionLog } from './layout/masonry';
import { fetchFiles, fetchAllContents, fetchFileContent, fetchAuthStatus, fetchSyncStatus, fetchBackendSources, triggerSync, triggerSyncSelected, connectSSE } from './sync/api';
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

export default function App() {
  const [files, setFiles] = useState([]);
  const [contentMap, setContentMap] = useState(null);
  const [authStatus, setAuthStatus] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [backendSources, setBackendSources] = useState(null);
  const [view, setView] = useState('memories'); // 'memories' | 'system'
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
      // Render canvas immediately with file metadata, then load contents in background
      fetchAllContents(newFiles).then(contents => {
        setContentMap(contents);
      }).catch(console.error);
    } catch (e) { console.error(e); }
  }, []);

  const loadSyncStatus = useCallback(async () => {
    setSyncStatus(await fetchSyncStatus());
  }, []);

  const loadBackendSources = useCallback(async () => {
    const data = await fetchBackendSources();
    if (data?.ok) setBackendSources(data);
  }, []);

  useEffect(() => {
    loadFiles();
    fetchAuthStatus().then(setAuthStatus);
    loadSyncStatus();
    loadBackendSources();
    const cleanup = connectSSE(() => { loadFiles(); loadSyncStatus(); });
    return cleanup;
  }, [loadFiles, loadSyncStatus, loadBackendSources]);

  const annotated = useMemo(() =>
    files.map(f => ({
      ...f,
      _tier: getTier(f, contentMap),
      _isSessionLog: isSessionLog(f, contentMap),
    })),
    [files, contentMap]
  );

  const [vpWidth, setVpWidth] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setVpWidth(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const layout = useMemo(
    () => computeLayout(annotated, vpWidth, contentMap),
    [annotated, vpWidth, contentMap]
  );

  const systemLayout = useMemo(() => {
    if (view !== 'system') return null;
    return computeSystemLayout(layout.systemFiles || [], vpWidth, contentMap);
  }, [view, layout.systemFiles, vpWidth, contentMap]);

  // Build sync status map: merge LOCAL state + BACKEND sources
  // Backend recent_sources is limited (20 items) so local state is primary record.
  // Backend data overrides local for the files it knows about.
  const syncMap = useMemo(() => {
    const m = {};

    // Step 1: Local state as baseline
    if (syncStatus?.fileStatuses) {
      for (const s of syncStatus.fileStatuses) if (s.status) m[s.relativePath] = s.status;
    }

    // Step 2: Backend sources override — these are definitively synced
    if (backendSources?.sources) {
      const backendPaths = new Set(backendSources.sources.map(s => s.filePath));
      for (const f of files) {
        const absPath = `/Users/echoget/.openclaw/${f.relativePath}`;
        if (backendPaths.has(absPath)) {
          m[f.relativePath] = 'synced';
        }
      }
    }

    // Step 3: Ensure private files are sealed, and untracked non-private files are 'new'
    for (const f of files) {
      if (f.privacyLevel === 'private') {
        m[f.relativePath] = 'sealed';
      } else if (!m[f.relativePath]) {
        m[f.relativePath] = 'new';
      }
    }

    return m;
  }, [syncStatus, backendSources, files]);

  const stats = useMemo(() => {
    const t1 = annotated.filter(f => f._tier === 1).length;
    const t2 = annotated.filter(f => f._tier === 2).length;
    const t3 = annotated.filter(f => f._tier === 3).length;
    return { t1, t2, t3, total: annotated.length };
  }, [annotated]);

  const systemFileCount = layout.systemFileCount || 0;

  const pendingCount = useMemo(() => {
    let count = 0;
    for (const status of Object.values(syncMap)) {
      if (status === 'new' || status === 'modified') count++;
    }
    return count;
  }, [syncMap]);

  const handleSync = useCallback(async () => {
    setSyncing(true); setSyncResult(null);
    try {
      let r;
      if (selectMode && syncSelection.size > 0) {
        r = await triggerSyncSelected([...syncSelection]);
        setSyncSelection(new Set());
        setSelectMode(false);
      } else {
        r = await triggerSync();
      }
      const s = r?.summary || {};
      const parts = [];
      if (s.new_memory_count > 0) parts.push(`${s.new_memory_count} new memories`);
      if (s.new_source_count > 0) parts.push(`${s.new_source_count} files uploaded`);
      if (s.skipped_count > 0) parts.push(`${s.skipped_count} already synced`);
      if (s.duplicate_count > 0) parts.push(`${s.duplicate_count} duplicates`);
      if (s.failed_file_count > 0) parts.push(`${s.failed_file_count} failed`);
      setSyncResult({ ok: true, msg: `✓ ${parts.join(' · ') || 'done'}` });
      loadSyncStatus();
      loadBackendSources();
    } catch { setSyncResult({ ok: false, msg: 'Sync failed' }); }
    finally { setSyncing(false); }
  }, [loadSyncStatus, selectMode, syncSelection]);

  const toggleFileSelection = useCallback((path) => {
    setSyncSelection(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const isConnected = authStatus?.connected;

  const activeLayout = view === 'system' && systemLayout ? systemLayout : layout;

  return (
    <>
      <div className="hdr">
        <span style={{ fontSize: 16 }}>📂</span>
        {readingPath ? (
          <>
            <span className="hdr-back" onClick={() => { setReadingPath(null); setSelectedPath(null); }}>← Archive</span>
            <span className="hdr-title">
              {(files.find(f => f.relativePath === readingPath)?.fileName || '').replace(/\.md$/i, '')}
            </span>
          </>
        ) : view === 'memories' ? (
          <span className="hdr-title">OpenClaw Memory Archive</span>
        ) : (
          <>
            <span className="hdr-back" onClick={() => setView('memories')}>← Back</span>
            <span className="hdr-title hdr-title-system">System Files</span>
          </>
        )}
        <input className="hdr-search" type="text" placeholder="Search files…" />
        <span className="hdr-spacer" />
        <span className="hdr-meta"><b>{dateStr}</b> {timeStr}</span>
        <span className="hdr-meta">·</span>
        <span className="hdr-meta">{timeAgo(syncStatus?.lastSyncAt)}</span>
        <span className="hdr-meta">·</span>
        <span className="hdr-conn">
          {isConnected === true && <span className="conn-ok">● Connected</span>}
          {isConnected === false && <span className="conn-off">✕ Offline</span>}
          {isConnected == null && <span className="conn-unknown">…</span>}
        </span>
      </div>

      {readingPath ? (
        <ReadingPanel
          path={readingPath}
          content={readingContent ?? contentMap?.get(readingPath) ?? 'Loading…'}
          file={files.find(f => f.relativePath === readingPath)}
          onClose={() => { setReadingPath(null); setSelectedPath(null); setReadingContent(null); }}
        />
      ) : files.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 14 }}>
          Loading files…
        </div>
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
            if (path === null) { setSelectedPath(null); return; }
            setSelectedPath(prev => prev === path ? null : path);
          }}
          onCardExpand={(path) => {
            // Show reading panel immediately — content resolves sync or async
            setReadingPath(path);
            const existing = contentMap?.get(path);
            if (existing) {
              setReadingContent(existing);
            } else {
              // Fetch just this one file in background, panel shows "Loading…" meanwhile
              setReadingContent(null);
              fetchFileContent(path).then(result => {
                const content = result?.content ?? '';
                setReadingContent(content);
                // Cache for future use
                setContentMap(prev => {
                  const next = new Map(prev || []);
                  next.set(path, content);
                  return next;
                });
              });
            }
          }}
        />
      )}

      <div className="ftr">
        {selectMode ? (
          <>
            <span style={{ color: '#a78bfa' }}>
              <b>{syncSelection.size}</b> file{syncSelection.size !== 1 ? 's' : ''} selected
            </span>
            <button className="ftr-select-toggle" onClick={() => {
              // Select all pending (new/modified)
              const pending = (syncStatus?.fileStatuses || [])
                .filter(s => s.status === 'new' || s.status === 'modified')
                .map(s => s.relativePath);
              setSyncSelection(new Set(pending));
            }}>Select all pending</button>
            <button className="ftr-select-toggle" onClick={() => setSyncSelection(new Set())}>Clear</button>
            <button className="ftr-select-toggle" onClick={() => { setSelectMode(false); setSyncSelection(new Set()); }}>Cancel</button>
          </>
        ) : view === 'memories' ? (
          <>
            <span>
              <b>{stats.t1}</b> memories · <b>{stats.t2}</b> knowledge · <b>{stats.total}</b> total
            </span>
            {systemFileCount > 0 && (
              <span className="ftr-system" onClick={() => setView('system')} title="View system files">
                ⚪ {systemFileCount} system files
              </span>
            )}
          </>
        ) : (
          <span>
            <b>{systemFileCount}</b> system files · not processed into memories
          </span>
        )}
        <span className="ftr-spacer" />
        {syncResult && (
          <span className={syncResult.ok ? 'sync-result' : 'sync-error'}>{syncResult.msg}</span>
        )}
        {!selectMode && pendingCount > 0 && (
          <button className="ftr-select-toggle" onClick={() => setSelectMode(true)}>
            Select files…
          </button>
        )}
        <button className="sync-btn" disabled={!isConnected || syncing || (selectMode && syncSelection.size === 0)} onClick={handleSync}>
          {syncing ? 'Syncing…' : selectMode
            ? `Sync ${syncSelection.size} selected`
            : pendingCount > 0 ? `Sync all ${pendingCount}` : 'All synced ✓'}
        </button>
      </div>
    </>
  );
}
