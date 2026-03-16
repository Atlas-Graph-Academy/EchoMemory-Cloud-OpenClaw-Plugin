import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Viewport } from './canvas/Viewport';
import { ReadingPanel } from './cards/ReadingPanel';
import { computeLayout, computeSystemLayout, getTier, isSessionLog } from './layout/masonry';
import { fetchFiles, fetchAllContents, fetchFileContent, fetchAuthStatus, fetchSyncStatus, triggerSync, connectSSE } from './sync/api';
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
  const [view, setView] = useState('memories'); // 'memories' | 'system'
  const [selectedPath, setSelectedPath] = useState(null);
  const [readingPath, setReadingPath] = useState(null);
  const [readingContent, setReadingContent] = useState(null);
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

  useEffect(() => {
    loadFiles();
    fetchAuthStatus().then(setAuthStatus);
    loadSyncStatus();
    const cleanup = connectSSE(() => { loadFiles(); loadSyncStatus(); });
    return cleanup;
  }, [loadFiles, loadSyncStatus]);

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

  const syncMap = useMemo(() => {
    const m = {};
    if (syncStatus?.fileStatuses) {
      for (const s of syncStatus.fileStatuses) if (s.status) m[s.relativePath] = s.status;
    }
    return m;
  }, [syncStatus]);

  const stats = useMemo(() => {
    const t1 = annotated.filter(f => f._tier === 1).length;
    const t2 = annotated.filter(f => f._tier === 2).length;
    const t3 = annotated.filter(f => f._tier === 3).length;
    return { t1, t2, t3, total: annotated.length };
  }, [annotated]);

  const systemFileCount = layout.systemFileCount || 0;

  const pendingCount = useMemo(() =>
    (syncStatus?.fileStatuses || []).filter(s => s.status === 'new' || s.status === 'modified').length,
    [syncStatus]
  );

  const handleSync = useCallback(async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const r = await triggerSync();
      setSyncResult({ ok: true, msg: `✓ ${r?.summary?.new_memory_count ?? 0} new` });
      loadSyncStatus();
    } catch { setSyncResult({ ok: false, msg: 'Failed' }); }
    finally { setSyncing(false); }
  }, [loadSyncStatus]);

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
          onCardClick={(path) => {
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
        {view === 'memories' ? (
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
        <button className="sync-btn" disabled={!isConnected || syncing} onClick={handleSync}>
          {syncing ? 'Syncing…' : pendingCount > 0 ? `Sync ${pendingCount} files` : 'All synced ✓'}
        </button>
      </div>
    </>
  );
}
