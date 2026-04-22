import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCamera } from './useCamera';
import { Pile } from './Pile';
import { FileCard } from './FileCard';
import { TreePanel } from './TreePanel';
import { SyncConsole } from './SyncConsole';
import './Desktop.css';

/**
 * Pile anchor positions in world coordinates. Two sets: compact (stack mode)
 * and wide (spread mode) so the three "desk regions" don't overlap when
 * cards are laid flat.
 */
const STACK_ANCHORS = {
  private: { x: -1100, y: 0 },
  ready:   { x:     0, y: 0 },
  synced:  { x:  1100, y: 0 },
};
const SPREAD_ANCHORS = {
  private: { x: -2300, y: 0 },
  ready:   { x:     0, y: 0 },
  synced:  { x:  2300, y: 0 },
};

/**
 * Classify a file into one of the three piles.
 */
function classify(file, syncStatus) {
  if (file?.riskLevel === 'secret') return 'private';
  if (file?.riskLevel === 'private' || file?.privacyLevel === 'private') return 'private';
  if (syncStatus === 'sealed') return 'private';
  if (syncStatus === 'synced') return 'synced';
  return 'ready';
}

function dateDesc(a, b) {
  const at = new Date(a.modifiedTime || a.updatedAt || 0).getTime();
  const bt = new Date(b.modifiedTime || b.updatedAt || 0).getTime();
  return bt - at;
}

function contentFor(contentMap, rel) {
  if (!contentMap || !rel) return '';
  if (contentMap.get) return contentMap.get(rel) || '';
  return contentMap[rel] || '';
}

function pathStartsWith(path, prefix) {
  if (!prefix) return true;
  return path === prefix || path.startsWith(prefix + '/');
}

/**
 * Top-level desktop view. Replaces HomeView when reading panel is closed.
 *
 * Props (all passed from App.jsx):
 *   files, syncMap, contentMap
 *   cardSyncState : { [rel]: 'queued'|'syncing'|'done'|'failed' }
 *   syncing, canSync, isConnected
 *   readyCount, privateCount, syncedCount, lastSyncLabel
 *   onSync, onOpenCard
 */
export function Desktop({
  files,
  syncMap,
  contentMap,
  cardSyncState,
  syncing,
  canSync,
  isConnected,
  lastSyncLabel,
  onSync,
  onOpenCard,
}) {
  const stageRef = useRef(null);
  const { cameraX, cameraY, cameraScale, focusOn, panBy } = useCamera({
    stageRef,
    minScale: 0.25,
    maxScale: 2.0,
    initial: { x: 0, y: 0, scale: 1 },
  });

  const [selectedFolder, setSelectedFolder] = useState(null);

  // ─── Sidebar open/close state (persisted) ────────────────────────────
  const [treeOpen, setTreeOpen] = useState(() => {
    try { return localStorage.getItem('echomem.treeOpen') !== '0'; } catch { return true; }
  });
  const [syncOpen, setSyncOpen] = useState(() => {
    try { return localStorage.getItem('echomem.syncOpen') !== '0'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('echomem.treeOpen', treeOpen ? '1' : '0'); } catch { /* ignore */ }
  }, [treeOpen]);
  useEffect(() => {
    try { localStorage.setItem('echomem.syncOpen', syncOpen ? '1' : '0'); } catch { /* ignore */ }
  }, [syncOpen]);

  // Keyboard shortcuts: [ toggles left, ] toggles right
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '[') { e.preventDefault(); setTreeOpen((v) => !v); }
      else if (e.key === ']') { e.preventDefault(); setSyncOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── Bucket files into the three piles ───────────────────────────────
  const buckets = useMemo(() => {
    const priv = [], ready = [], synced = [];
    for (const file of files || []) {
      if (!file?.relativePath) continue;
      if (selectedFolder !== null && !pathStartsWith(file.relativePath, selectedFolder)) continue;
      const status = syncMap?.[file.relativePath] || null;
      const key = classify(file, status);
      const row = { file, content: contentFor(contentMap, file.relativePath), syncStatus: status };
      if (key === 'private') priv.push(row);
      else if (key === 'synced') synced.push(row);
      else ready.push(row);
    }
    priv.sort((a, b) => dateDesc(a.file, b.file));
    ready.sort((a, b) => dateDesc(a.file, b.file));
    synced.sort((a, b) => dateDesc(a.file, b.file));
    return { private: priv, ready, synced };
  }, [files, syncMap, contentMap, selectedFolder]);

  // ─── Layout mode: compact piles (default) vs. flat "desktop" spread ──
  const pileLayout = selectedFolder === null ? 'stack' : 'spread';
  const PILE_ANCHORS = pileLayout === 'spread' ? SPREAD_ANCHORS : STACK_ANCHORS;

  // ─── Focus Ready pile on mount and when camera stage first measures ──
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      focusOn(STACK_ANCHORS.ready.x, STACK_ANCHORS.ready.y, 1);
    });
    return () => window.cancelAnimationFrame(id);
  }, [focusOn]);

  // ─── Re-focus when folder selection changes ──────────────────────────
  //   null  → stack view, zoom 1 on Ready
  //   else  → spread view, zoom out 0.5 and drop camera slightly so the
  //           upper rows of the grid are visible from the get-go.
  const isFirstFolderChange = useRef(true);
  useEffect(() => {
    if (isFirstFolderChange.current) { isFirstFolderChange.current = false; return; }
    if (selectedFolder === null) {
      focusOn(STACK_ANCHORS.ready.x, STACK_ANCHORS.ready.y, 1);
    } else {
      focusOn(SPREAD_ANCHORS.ready.x, 420, 0.5);
    }
  }, [selectedFolder, focusOn]);

  // Pan is handled natively inside useCamera (pointer events on the stage).

  // ─── In-flight cards: any file with syncState === 'syncing' is rendered
  //     as a flying card from Ready → Synced (shown on top of piles) ────
  const flyingPaths = useMemo(() => {
    const s = new Set();
    for (const [rel, st] of Object.entries(cardSyncState || {})) {
      if (st === 'syncing') s.add(rel);
    }
    return s;
  }, [cardSyncState]);

  const flyingItems = useMemo(() => {
    const items = [];
    for (const rel of flyingPaths) {
      const file = (files || []).find((f) => f.relativePath === rel);
      if (file) items.push({ file, content: contentFor(contentMap, rel) });
    }
    return items;
  }, [flyingPaths, files, contentMap]);

  const isEmpty =
    buckets.private.length === 0 && buckets.ready.length === 0 && buckets.synced.length === 0;

  // Zoom-in button handlers (small overlay on the stage)
  const zoomTo = useCallback((pileKey, scale) => {
    const anchors = pileLayout === 'spread' ? SPREAD_ANCHORS : STACK_ANCHORS;
    const targetScale = scale ?? (pileLayout === 'spread' ? 0.5 : 1);
    const targetY = pileLayout === 'spread' ? 420 : anchors[pileKey].y;
    focusOn(anchors[pileKey].x, targetY, targetScale);
  }, [focusOn, pileLayout]);

  return (
    <div className="desktop">
      {/* ─── Canvas stage (pan + zoom, via useCamera native pointer events) ─── */}
      <div className="desktop__stage" ref={stageRef}>
        {/* The pannable world */}
        <motion.div
          className="desktop__world"
          style={{
            x: cameraX,
            y: cameraY,
            scale: cameraScale,
            transformOrigin: '0 0',
          }}
        >
          {/* Piles */}
          {buckets.private.length > 0 && (
            <Pile
              anchor={PILE_ANCHORS.private}
              label="Kept Private"
              sublabel="Never leaves your machine."
              accent="private"
              items={buckets.private}
              syncStateByPath={cardSyncState}
              onCardClick={(file) => onOpenCard?.(file.relativePath)}
              hiddenPaths={flyingPaths}
              layout={pileLayout}
            />
          )}
          <Pile
            anchor={PILE_ANCHORS.ready}
            label="Ready to Sync"
            sublabel="Reviewed and safe to upload."
            accent="ready"
            items={buckets.ready}
            syncStateByPath={cardSyncState}
            onCardClick={(file) => onOpenCard?.(file.relativePath)}
            hiddenPaths={flyingPaths}
            layout={pileLayout}
          />
          {buckets.synced.length > 0 && (
            <Pile
              anchor={PILE_ANCHORS.synced}
              label="Already Synced"
              sublabel="Living in Echo Cloud."
              accent="synced"
              items={buckets.synced}
              syncStateByPath={cardSyncState}
              onCardClick={(file) => onOpenCard?.(file.relativePath)}
              hiddenPaths={flyingPaths}
              layout={pileLayout}
            />
          )}

          {/* Flight layer — cards in motion between piles */}
          <AnimatePresence>
            {flyingItems.map(({ file, content }) => {
              const from = PILE_ANCHORS.ready;
              const to = PILE_ANCHORS.synced;
              return (
                <motion.div
                  key={`flight-${file.relativePath}`}
                  className="desktop__flight"
                  style={{
                    position: 'absolute',
                    left: from.x,
                    top: from.y,
                    transform: 'translate(-50%, -50%)',
                    zIndex: 1000,
                  }}
                  initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                  animate={{
                    x: [0, (to.x - from.x) * 0.5, to.x - from.x],
                    y: [0, -140, 0],
                    scale: [1, 1.06, 1],
                  }}
                  exit={{ opacity: 0, scale: 0.94 }}
                  transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <FileCard
                    file={file}
                    content={content}
                    variant="ready"
                    syncState="syncing"
                    zIndex={1000}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>

        {/* ─── Empty state fallback ─── */}
        {isEmpty && (
          <div className="desktop__empty">
            <div>
              <h2>No memories yet</h2>
              <p>
                Drop markdown files into your memory directory and they'll appear here, classified
                by privacy risk.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ─── Floating Tree (left 25vw) ─── */}
      <TreePanel
        files={files}
        syncMap={syncMap}
        selectedFolder={selectedFolder}
        onSelectFolder={setSelectedFolder}
        onOpenFile={(rel) => onOpenCard?.(rel)}
        isOpen={treeOpen}
        onClose={() => setTreeOpen(false)}
      />

      {/* ─── Floating Sync Console (right 25vw) ─── */}
      <SyncConsole
        readyItems={buckets.ready}
        privateCount={buckets.private.length}
        syncedCount={buckets.synced.length}
        syncing={syncing}
        syncStateByPath={cardSyncState}
        lastSyncLabel={lastSyncLabel}
        canSync={canSync}
        onSync={onSync}
        isConnected={isConnected}
        isOpen={syncOpen}
        onClose={() => setSyncOpen(false)}
      />

      {/* ─── Edge tabs (shown when a panel is collapsed) ─── */}
      <AnimatePresence>
        {!treeOpen && (
          <motion.button
            key="tab-left"
            type="button"
            className="desktop__edgetab desktop__edgetab--left"
            onClick={() => setTreeOpen(true)}
            title="Open memory sidebar ( [ )"
            aria-label="Open memory sidebar"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 3.5h3.5l1.2 1.4H12a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"
                stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
            </svg>
            <span className="desktop__edgetab-lbl">Memory</span>
            <span className="desktop__edgetab-chev" aria-hidden="true">›</span>
          </motion.button>
        )}
        {!syncOpen && (
          <motion.button
            key="tab-right"
            type="button"
            className="desktop__edgetab desktop__edgetab--right"
            onClick={() => setSyncOpen(true)}
            title="Open sync sidebar ( ] )"
            aria-label="Open sync sidebar"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="desktop__edgetab-chev" aria-hidden="true">‹</span>
            <span className="desktop__edgetab-lbl">
              {syncing ? 'Syncing…' : 'Sync'}
            </span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ─── Mini-map / zoom controls (bottom-center) ─── */}
      <div className="desktop__zoomctrls">
        <button
          type="button"
          className="desktop__zoombtn"
          onClick={() => zoomTo('private', 1)}
          title="Jump to private pile"
        >
          🔒
        </button>
        <button
          type="button"
          className="desktop__zoombtn desktop__zoombtn--primary"
          onClick={() => zoomTo('ready', 1)}
          title="Center on Ready"
        >
          Ready
        </button>
        <button
          type="button"
          className="desktop__zoombtn"
          onClick={() => zoomTo('synced', 1)}
          title="Jump to synced pile"
        >
          ✓
        </button>
        <span className="desktop__zoomhint">scroll to zoom · drag to pan</span>
      </div>
    </div>
  );
}
