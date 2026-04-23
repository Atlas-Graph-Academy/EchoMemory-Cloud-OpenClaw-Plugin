import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCamera } from './useCamera';
import { Pile } from './Pile';
import { FileCard } from './FileCard';
import { TreePanel } from './TreePanel';
import { SyncConsole } from './SyncConsole';
import './Desktop.css';

/**
 * Pile anchor positions in world coordinates.
 */
const STACK_ANCHORS = {
  private: { x: -1100, y: 0 },
  ready:   { x:     0, y: 0 },
  synced:  { x:  1100, y: 0 },
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

/**
 * Top-level desktop view — canvas with three risk piles.
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
  const lockYRef = useRef(false);
  const { cameraX, cameraY, cameraScale, focusOn, panBy, fitTo } = useCamera({
    stageRef,
    minScale: 0.08,
    maxScale: 2.0,
    initial: { x: 0, y: 0, scale: 1 },
    lockYRef,
  });

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

  // ─── Bucket files into the three risk piles ────────────────────────
  const buckets = useMemo(() => {
    const priv = [], ready = [], synced = [];
    for (const file of files || []) {
      if (!file?.relativePath) continue;
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
  }, [files, syncMap, contentMap]);

  const CARD_H = 560;
  const CARD_W = CARD_H / 1.5;

  // ─── World-space bounds of rendered content, used by fitTo() ─────────
  const contentBounds = useMemo(() => {
    const PAD = 96;
    const pileBox = (itemCount, anchor) => {
      if (itemCount === 0) return null;
      const fanCards = Math.min(itemCount, 8);
      const w = CARD_W * (1 + (fanCards - 1) * 0.14);
      return {
        minX: anchor.x - CARD_W / 2 - 24,
        maxX: anchor.x - CARD_W / 2 + w + 24,
        minY: anchor.y - CARD_H / 2 - 48,
        maxY: anchor.y + CARD_H / 2 + 24,
      };
    };
    const regions = [
      pileBox(buckets.private.length, STACK_ANCHORS.private),
      pileBox(buckets.ready.length,   STACK_ANCHORS.ready),
      pileBox(buckets.synced.length,  STACK_ANCHORS.synced),
    ].filter(Boolean);
    if (regions.length === 0) return null;
    return {
      minX: Math.min(...regions.map((r) => r.minX)) - PAD,
      maxX: Math.max(...regions.map((r) => r.maxX)) + PAD,
      minY: Math.min(...regions.map((r) => r.minY)) - PAD,
      maxY: Math.max(...regions.map((r) => r.maxY)) + PAD,
    };
  }, [buckets, CARD_W, CARD_H]);

  // ─── Focus Ready pile on mount ──────────────────────────────────────
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      focusOn(STACK_ANCHORS.ready.x, STACK_ANCHORS.ready.y, 1);
    });
    return () => window.cancelAnimationFrame(id);
  }, [focusOn]);

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

  const isEmpty = buckets.private.length === 0
    && buckets.ready.length === 0
    && buckets.synced.length === 0;

  const zoomTo = useCallback((pileKey, scale) => {
    focusOn(STACK_ANCHORS[pileKey].x, STACK_ANCHORS[pileKey].y, scale ?? 1);
  }, [focusOn]);

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
          {buckets.private.length > 0 && (
            <Pile
              anchor={STACK_ANCHORS.private}
              label="Kept Private"
              sublabel="Never leaves your machine."
              accent="private"
              items={buckets.private}
              syncStateByPath={cardSyncState}
              onCardClick={(file) => onOpenCard?.(file.relativePath)}
              hiddenPaths={flyingPaths}
            />
          )}
          <Pile
            anchor={STACK_ANCHORS.ready}
            label="Ready to Sync"
            sublabel="Reviewed and safe to upload."
            accent="ready"
            items={buckets.ready}
            syncStateByPath={cardSyncState}
            onCardClick={(file) => onOpenCard?.(file.relativePath)}
            hiddenPaths={flyingPaths}
          />
          {buckets.synced.length > 0 && (
            <Pile
              anchor={STACK_ANCHORS.synced}
              label="Already Synced"
              sublabel="Living in Echo Cloud."
              accent="synced"
              items={buckets.synced}
              syncStateByPath={cardSyncState}
              onCardClick={(file) => onOpenCard?.(file.relativePath)}
              hiddenPaths={flyingPaths}
            />
          )}

          {/* Flight layer — cards in motion during an active sync */}
          <AnimatePresence>
            {flyingItems.map(({ file, content }) => {
              const from = STACK_ANCHORS.ready;
              const to = STACK_ANCHORS.synced;
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
            <span className="desktop__edgetab-chev" aria-hidden="true">{'\u203A'}</span>
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
            <span className="desktop__edgetab-chev" aria-hidden="true">{'\u2039'}</span>
            <span className="desktop__edgetab-lbl">
              {syncing ? 'Syncing\u2026' : 'Sync'}
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
          {'\uD83D\uDD12'}
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
          {'\u2713'}
        </button>
        <span className="desktop__zoomsep" aria-hidden="true" />
        <button
          type="button"
          className="desktop__zoombtn"
          onClick={() => contentBounds && fitTo(contentBounds, { padding: 96 })}
          title="Fit all piles in view"
          disabled={!contentBounds}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M1 4V1H4M9 1H12V4M12 9V12H9M4 12H1V9"
              stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ marginLeft: 4 }}>Fit</span>
        </button>
        <span className="desktop__zoomhint">scroll to zoom {'\u00B7'} drag to pan</span>
      </div>
    </div>
  );
}
