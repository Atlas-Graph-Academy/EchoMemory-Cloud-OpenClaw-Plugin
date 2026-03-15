import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Viewport } from './canvas/Viewport';
import { computeLayout, getTier, isSessionLog } from './layout/masonry';
import { fetchFiles, fetchAllContents, fetchAuthStatus, fetchSyncStatus, triggerSync, connectSSE } from './sync/api';
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
  const [contentMap, setContentMap] = useState(null); // Map<path, content>
  const [authStatus, setAuthStatus] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const now = useClock();

  const loadFiles = useCallback(async () => {
    try {
      const newFiles = await fetchFiles();
      setFiles(newFiles);
      // Fetch all content in parallel
      const contents = await fetchAllContents(newFiles);
      setContentMap(contents);
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

  // Annotate with tier — pass contentMap for session log detection
  const annotated = useMemo(() =>
    files.map(f => ({
      ...f,
      _tier: getTier(f, contentMap),
      _isSessionLog: isSessionLog(f, contentMap),
    })),
    [files, contentMap]
  );

  // Responsive to viewport
  const [vpWidth, setVpWidth] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setVpWidth(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // Layout — pass contentMap for content-aware sizing
  const layout = useMemo(
    () => computeLayout(annotated, vpWidth, contentMap),
    [annotated, vpWidth, contentMap]
  );

  // Sync status map
  const syncMap = useMemo(() => {
    const m = {};
    if (syncStatus?.fileStatuses) {
      for (const s of syncStatus.fileStatuses) if (s.status) m[s.relativePath] = s.status;
    }
    return m;
  }, [syncStatus]);

  // Stats
  const stats = useMemo(() => {
    const t1 = annotated.filter(f => f._tier === 1).length;
    const t2 = annotated.filter(f => f._tier === 2).length;
    const t3 = annotated.filter(f => f._tier === 3).length;
    return { t1, t2, t3, total: annotated.length };
  }, [annotated]);

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

  return (
    <>
      <div className="hdr">
        <span style={{ fontSize: 16 }}>📂</span>
        <span className="hdr-title">OpenClaw Memory Archive</span>
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

      <Viewport
        cards={layout.cards}
        sections={layout.sections}
        bounds={layout.bounds}
        syncStatus={syncMap}
        contentMap={contentMap}
        onCardClick={(path) => console.log('card click:', path)}
      />

      <div className="ftr">
        <span>
          <b>{stats.t1}</b> memories · <b>{stats.t2}</b> projects · <b>{stats.t3}</b> system · <b>{stats.total}</b> total
        </span>
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
