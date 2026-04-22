import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCamera } from './useCamera';
import { Pile } from './Pile';
import { FileCard } from './FileCard';
import { FolderStack } from './FolderStack';
import { TreePanel } from './TreePanel';
import { SyncConsole } from './SyncConsole';
import './Desktop.css';

/**
 * Pile anchor positions in world coordinates.
 *  - STACK: compact, single-card piles overlap at each anchor (root view).
 *  - FOLDER: wider anchors because each region hosts a grid of stacks/cards.
 */
const STACK_ANCHORS = {
  private: { x: -1100, y: 0 },
  ready:   { x:     0, y: 0 },
  synced:  { x:  1100, y: 0 },
};
const RISK_KEYS = ['private', 'ready', 'synced'];
const RISK_LABELS = {
  private: { title: 'Kept Private', sub: 'Never leaves your machine.' },
  ready:   { title: 'Ready to Sync', sub: 'Reviewed and safe to upload.' },
  synced:  { title: 'Already Synced', sub: 'Living in Echo Cloud.' },
};

/**
 * Timeline layout constants (folder view).
 * World coords — X is the time axis, Y is the risk band axis.
 *
 *                      ┌─ Private band (top) ───────┐
 *                      │                            │
 *                      ├─ Ready band (above axis) ──┤
 *   ══════════════════ timeline Y = 0 ═════════════════
 *                      ├─ Synced band (below axis) ─┤
 *                      └────────────────────────────┘
 */
const TIMELINE_WORLD_W = 7200;   // total horizontal span used by the timeline
const TIMELINE_Y = 0;
const TIMELINE_AXIS_GAP = 220;   // half-gap between axis and ready/synced band edges
const BAND_VSPACE = 260;         // vertical padding between Private and Ready bands

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

function getFileTime(file) {
  const raw = file?.modifiedTime || file?.updatedAt || 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
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
  const { cameraX, cameraY, cameraScale, focusOn, panBy, fitTo } = useCamera({
    stageRef,
    minScale: 0.08,
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

  // ─── View mode: root (risk piles) vs. folder (drilled-in hierarchy) ──
  const viewMode = selectedFolder === null ? 'root' : 'folder';

  // ─── Bucket files into the three risk piles (ROOT mode only) ────────
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

  // ─── Folder view → timeline bands ──────────────────────────────────
  //   Build a per-risk list of items (subfolder stacks + direct files),
  //   each stamped with a timestamp. Subfolder timestamp = latest modified
  //   within that risk subset.
  const CARD_H = 560;
  const CARD_W = CARD_H / 1.5;
  const COL_GAP = CARD_W * 0.12;   // horizontal separation in time-packing
  const ROW_GAP = CARD_H * 0.18;   // vertical separation within a band

  const timelineBands = useMemo(() => {
    if (selectedFolder === null) return null;
    const prefix = selectedFolder + '/';
    const subMap = new Map(); // name -> { name, path, total, byRisk: {...} }
    const direct = { private: [], ready: [], synced: [] };

    for (const file of files || []) {
      const rel = file?.relativePath;
      if (!rel) continue;
      if (!pathStartsWith(rel, selectedFolder)) continue;
      const remain = rel.slice(prefix.length);
      if (!remain) continue;
      const status = syncMap?.[rel] || null;
      const risk = classify(file, status);
      const slash = remain.indexOf('/');
      if (slash === -1) {
        direct[risk].push(file);
      } else {
        const sub = remain.slice(0, slash);
        if (!subMap.has(sub)) {
          subMap.set(sub, {
            name: sub, path: prefix + sub, total: 0,
            byRisk: { private: [], ready: [], synced: [] },
          });
        }
        const entry = subMap.get(sub);
        entry.total += 1;
        entry.byRisk[risk].push(file);
      }
    }

    const byRisk = { private: [], ready: [], synced: [] };
    for (const r of RISK_KEYS) {
      for (const file of direct[r]) {
        byRisk[r].push({
          type: 'file',
          key: 'c:' + file.relativePath,
          data: file,
          riskKey: r,
          time: getFileTime(file),
        });
      }
      for (const sub of subMap.values()) {
        const rf = sub.byRisk[r];
        if (rf.length === 0) continue;
        let latest = 0;
        for (const f of rf) { const t = getFileTime(f); if (t > latest) latest = t; }
        byRisk[r].push({
          type: 'folder',
          key: `f:${r}:${sub.path}`,
          name: sub.name,
          path: sub.path,
          files: rf,
          totalAll: sub.total,
          riskKey: r,
          time: latest,
        });
      }
      byRisk[r].sort((a, b) => a.time - b.time);
    }

    // Global time range for the shared axis.
    let minT = Infinity, maxT = -Infinity;
    for (const r of RISK_KEYS) {
      for (const it of byRisk[r]) {
        if (it.time < minT) minT = it.time;
        if (it.time > maxT) maxT = it.time;
      }
    }
    const hasTime = Number.isFinite(minT) && Number.isFinite(maxT);
    const halfW = TIMELINE_WORLD_W / 2;
    const timeToX = !hasTime
      ? () => 0
      : minT === maxT
        ? () => 0
        : (t) => ((t - minT) / (maxT - minT)) * TIMELINE_WORLD_W - halfW;

    // Pack each band into rows by time-collision (left→right).
    //   rowsRightX[i] = rightmost edge of last card placed in row i.
    //   `row` = 0 is nearest to the timeline axis.
    const pack = (items) => {
      const rowsRightX = [];
      const placed = items.map((it) => ({ ...it, x: timeToX(it.time) }));
      for (const it of placed) {
        const left = it.x - CARD_W / 2;
        let row = -1;
        for (let r = 0; r < rowsRightX.length; r++) {
          if (left >= rowsRightX[r] + COL_GAP) { row = r; break; }
        }
        if (row === -1) {
          row = rowsRightX.length;
          rowsRightX.push(-Infinity);
        }
        it.row = row;
        rowsRightX[row] = it.x + CARD_W / 2;
      }
      return { items: placed, rows: rowsRightX.length };
    };

    const packed = {
      private: pack(byRisk.private),
      ready:   pack(byRisk.ready),
      synced:  pack(byRisk.synced),
    };

    // Position bands vertically around the timeline axis (y=0).
    //   Ready band grows UPWARD from (axis − AXIS_GAP).
    //   Private band sits above Ready.
    //   Synced band grows DOWNWARD from (axis + AXIS_GAP).
    const readyBandHeight = Math.max(0, packed.ready.rows * CARD_H + Math.max(0, packed.ready.rows - 1) * ROW_GAP);
    const privateBandHeight = Math.max(0, packed.private.rows * CARD_H + Math.max(0, packed.private.rows - 1) * ROW_GAP);
    const syncedBandHeight = Math.max(0, packed.synced.rows * CARD_H + Math.max(0, packed.synced.rows - 1) * ROW_GAP);

    const readyBottom = TIMELINE_Y - TIMELINE_AXIS_GAP;
    const readyTop = readyBottom - readyBandHeight;
    const privateBottom = readyTop - BAND_VSPACE;
    const privateTop = privateBottom - privateBandHeight;
    const syncedTop = TIMELINE_Y + TIMELINE_AXIS_GAP;
    const syncedBottom = syncedTop + syncedBandHeight;

    // Apply y positions:
    //   Ready: row=0 nearest axis (bottom of band), higher rows upward.
    //   Private: same as ready — row=0 near its bottom, rows go upward.
    //   Synced: row=0 nearest axis (top of band), higher rows downward.
    const rowOffsetUp = (row) => row * (CARD_H + ROW_GAP);
    for (const it of packed.ready.items)
      it.y = readyBottom - CARD_H / 2 - rowOffsetUp(it.row);
    for (const it of packed.private.items)
      it.y = privateBottom - CARD_H / 2 - rowOffsetUp(it.row);
    for (const it of packed.synced.items)
      it.y = syncedTop + CARD_H / 2 + rowOffsetUp(it.row);

    return {
      packed,
      extents: { privateTop, privateBottom, readyTop, readyBottom, syncedTop, syncedBottom },
      time: { minT, maxT, hasTime, timeToX, halfW },
    };
  }, [files, syncMap, selectedFolder, CARD_W, CARD_H, COL_GAP, ROW_GAP]);

  // ─── World-space bounds of rendered content, used by fitTo() ─────────
  const contentBounds = useMemo(() => {
    const PAD = 96;

    if (viewMode === 'folder' && timelineBands) {
      const { extents } = timelineBands;
      const halfW = TIMELINE_WORLD_W / 2;
      const minY = Math.min(extents.privateTop, extents.readyTop, extents.syncedTop);
      const maxY = Math.max(extents.privateBottom, extents.readyBottom, extents.syncedBottom);
      if (minY === maxY) return null;
      return {
        minX: -halfW - CARD_W / 2 - PAD,
        maxX:  halfW + CARD_W / 2 + PAD,
        minY: minY - PAD - 120,  // room for band labels
        maxY: maxY + PAD + 80,
      };
    }

    // root mode: bound the three horizontal piles
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
      minX: Math.min(...regions.map((r) => r.minX)),
      maxX: Math.max(...regions.map((r) => r.maxX)),
      minY: Math.min(...regions.map((r) => r.minY)),
      maxY: Math.max(...regions.map((r) => r.maxY)),
    };
  }, [viewMode, timelineBands, buckets, CARD_W, CARD_H]);

  // ─── Focus Ready pile on mount and when camera stage first measures ──
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      focusOn(STACK_ANCHORS.ready.x, STACK_ANCHORS.ready.y, 1);
    });
    return () => window.cancelAnimationFrame(id);
  }, [focusOn]);

  // ─── Re-focus when folder selection changes ──────────────────────────
  //   root   → zoom 1 on Ready pile
  //   folder → auto-fit the grid of folder-stacks + direct files
  const isFirstFolderChange = useRef(true);
  useEffect(() => {
    if (isFirstFolderChange.current) { isFirstFolderChange.current = false; return; }
    if (selectedFolder === null) {
      focusOn(STACK_ANCHORS.ready.x, STACK_ANCHORS.ready.y, 1);
    } else if (contentBounds) {
      fitTo(contentBounds, { padding: 96 });
    }
  }, [selectedFolder, focusOn, fitTo, contentBounds]);

  // ─── Drill-down helpers ──────────────────────────────────────────────
  const drillInto = useCallback((path) => setSelectedFolder(path), []);
  const drillUp = useCallback(() => {
    if (selectedFolder === null) return;
    const slash = selectedFolder.lastIndexOf('/');
    setSelectedFolder(slash === -1 ? null : selectedFolder.slice(0, slash));
  }, [selectedFolder]);

  // Breadcrumb segments for the current folder path.
  const breadcrumbs = useMemo(() => {
    if (selectedFolder === null) return [];
    const parts = selectedFolder.split('/');
    const out = [];
    let acc = '';
    for (const p of parts) {
      acc = acc ? acc + '/' + p : p;
      out.push({ name: p, path: acc });
    }
    return out;
  }, [selectedFolder]);

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

  const isEmpty = viewMode === 'root'
    ? (buckets.private.length === 0 && buckets.ready.length === 0 && buckets.synced.length === 0)
    : (timelineBands
        && timelineBands.packed.private.items.length === 0
        && timelineBands.packed.ready.items.length === 0
        && timelineBands.packed.synced.items.length === 0);

  // Zoom-in button handlers (small overlay on the stage). In folder view,
  // the three pile anchors don't exist — fall back to Fit-all for all three.
  const zoomTo = useCallback((pileKey, scale) => {
    if (viewMode === 'folder') {
      if (contentBounds) fitTo(contentBounds, { padding: 96 });
      return;
    }
    focusOn(STACK_ANCHORS[pileKey].x, STACK_ANCHORS[pileKey].y, scale ?? 1);
  }, [focusOn, fitTo, viewMode, contentBounds]);

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
          {viewMode === 'root' ? (
            <>
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
            </>
          ) : (
            timelineBands && (() => {
              const { packed, extents, time } = timelineBands;
              const halfW = TIMELINE_WORLD_W / 2;
              const nodes = [];

              // Band backgrounds
              const bandBg = (key, top, bottom) => {
                if (bottom <= top) return null;
                return (
                  <div
                    key={`band-bg-${key}`}
                    className={`timeline-band timeline-band--${key}`}
                    style={{
                      position: 'absolute',
                      left: -halfW - CARD_W / 2 - 40,
                      top,
                      width: TIMELINE_WORLD_W + CARD_W + 80,
                      height: bottom - top,
                      pointerEvents: 'none',
                      zIndex: 0,
                    }}
                    aria-hidden="true"
                  />
                );
              };
              const bandLabel = (key, y) => {
                const labels = RISK_LABELS[key];
                const total = packed[key].items.reduce(
                  (sum, it) => sum + (it.type === 'folder' ? it.files.length : 1), 0);
                return (
                  <div
                    key={`band-label-${key}`}
                    className={`timeline-band__label timeline-band__label--${key}`}
                    style={{
                      position: 'absolute',
                      left: -halfW - CARD_W / 2 - 20,
                      top: y,
                      transform: 'translateY(-50%)',
                      zIndex: 3,
                    }}
                  >
                    <span className={`pile__dot pile__dot--${key}`} />
                    <span className="timeline-band__title">{labels.title}</span>
                    <span className="timeline-band__count">{total}</span>
                  </div>
                );
              };

              if (packed.private.items.length > 0) {
                nodes.push(bandBg('private', extents.privateTop - 16, extents.privateBottom + 16));
                nodes.push(bandLabel('private', (extents.privateTop + extents.privateBottom) / 2));
              }
              if (packed.ready.items.length > 0) {
                nodes.push(bandBg('ready', extents.readyTop - 16, extents.readyBottom + 16));
                nodes.push(bandLabel('ready', (extents.readyTop + extents.readyBottom) / 2));
              }
              if (packed.synced.items.length > 0) {
                nodes.push(bandBg('synced', extents.syncedTop - 16, extents.syncedBottom + 16));
                nodes.push(bandLabel('synced', (extents.syncedTop + extents.syncedBottom) / 2));
              }

              // Timeline axis (horizontal line at y=0 with date ticks)
              nodes.push(
                <TimelineAxis
                  key="timeline-axis"
                  halfW={halfW}
                  cardW={CARD_W}
                  hasTime={time.hasTime}
                  minT={time.minT}
                  maxT={time.maxT}
                  timeToX={time.timeToX}
                />
              );

              // Items + leader lines (each item pinned to the timeline axis)
              for (const riskKey of RISK_KEYS) {
                for (const item of packed[riskKey].items) {
                  // Leader line: vertical line from the card's near-axis edge
                  // to y=0. Creates the "pin on a corkboard" feel; when items
                  // cluster in time, the lines naturally bundle.
                  const isAbove = item.y < 0;
                  const cardEdgeY = isAbove
                    ? item.y + CARD_H / 2
                    : item.y - CARD_H / 2;
                  const leaderTop = Math.min(cardEdgeY, 0);
                  const leaderHeight = Math.abs(cardEdgeY);
                  if (leaderHeight > 0) {
                    nodes.push(
                      <div
                        key={`leader-${item.key}`}
                        className={`timeline-leader timeline-leader--${riskKey} timeline-leader--${isAbove ? 'above' : 'below'}`}
                        style={{
                          position: 'absolute',
                          left: item.x - 1.5,
                          top: leaderTop,
                          width: 3,
                          height: leaderHeight,
                          zIndex: 1,
                          pointerEvents: 'none',
                        }}
                        aria-hidden="true"
                      />
                    );
                    // Anchor dot at axis base of the leader
                    nodes.push(
                      <div
                        key={`anchor-${item.key}`}
                        className={`timeline-anchor timeline-anchor--${riskKey}`}
                        style={{
                          position: 'absolute',
                          left: item.x - 4,
                          top: -4,
                          width: 8,
                          height: 8,
                          zIndex: 5,
                          pointerEvents: 'none',
                        }}
                        aria-hidden="true"
                      />
                    );
                  }

                  if (item.type === 'folder') {
                    nodes.push(
                      <FolderStack
                        key={item.key}
                        name={item.name}
                        path={item.path}
                        files={item.files}
                        syncMap={syncMap}
                        variant={riskKey}
                        totalAll={item.totalAll}
                        translateX={item.x}
                        translateY={item.y}
                        zIndex={2}
                        onDrill={drillInto}
                      />
                    );
                  } else {
                    const file = item.data;
                    nodes.push(
                      <FileCard
                        key={item.key}
                        file={file}
                        content={contentFor(contentMap, file.relativePath)}
                        variant={riskKey}
                        syncState={cardSyncState?.[file.relativePath]}
                        rotate={0}
                        translateX={item.x}
                        translateY={item.y}
                        zIndex={2}
                        onClick={() => onOpenCard?.(file.relativePath)}
                      />
                    );
                  }
                }
              }
              return nodes;
            })()
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

        {/* ─── Breadcrumb (folder view) ─── */}
        {viewMode === 'folder' && (
          <div className="desktop__crumbs" data-no-pan>
            <button
              type="button"
              className="desktop__crumb desktop__crumb--back"
              onClick={drillUp}
              title="Up one level"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>
            <button
              type="button"
              className="desktop__crumb desktop__crumb--root"
              onClick={() => setSelectedFolder(null)}
              title="Back to all memories"
            >
              Memory
            </button>
            {breadcrumbs.map((c, i) => (
              <React.Fragment key={c.path}>
                <span className="desktop__crumb-sep" aria-hidden="true">/</span>
                <button
                  type="button"
                  className={`desktop__crumb ${i === breadcrumbs.length - 1 ? 'is-current' : ''}`}
                  onClick={() => setSelectedFolder(c.path)}
                >
                  {c.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

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
        <span className="desktop__zoomhint">scroll to zoom · drag to pan</span>
      </div>
    </div>
  );
}

/**
 * TimelineAxis — horizontal line at world y=0 with date tick marks along its
 * length. Adapts tick granularity to the visible date range (months for small
 * ranges, years otherwise). Rendered inside the pannable world.
 */
function TimelineAxis({ halfW, cardW, hasTime, minT, maxT, timeToX }) {
  const axisLeft = -halfW - cardW / 2 - 40;
  const axisWidth = halfW * 2 + cardW + 80;

  // Generate ticks
  const ticks = [];
  if (hasTime && maxT > minT) {
    const rangeDays = (maxT - minT) / (24 * 3600 * 1000);
    // Pick granularity
    let step = 'month';
    if (rangeDays > 365 * 3) step = 'year';
    else if (rangeDays > 180) step = 'quarter';
    else if (rangeDays > 30) step = 'month';
    else step = 'week';

    const start = new Date(minT);
    const end = new Date(maxT);
    const cursor = new Date(start);
    // Snap cursor to the boundary
    if (step === 'year') {
      cursor.setMonth(0, 1); cursor.setHours(0, 0, 0, 0);
    } else if (step === 'quarter') {
      const q = Math.floor(cursor.getMonth() / 3) * 3;
      cursor.setMonth(q, 1); cursor.setHours(0, 0, 0, 0);
    } else if (step === 'month') {
      cursor.setDate(1); cursor.setHours(0, 0, 0, 0);
    } else { // week
      const dow = cursor.getDay();
      cursor.setDate(cursor.getDate() - dow); cursor.setHours(0, 0, 0, 0);
    }

    let guard = 0;
    while (cursor.getTime() <= end.getTime() + 1 && guard++ < 80) {
      const t = cursor.getTime();
      if (t >= minT && t <= maxT) {
        let label;
        if (step === 'year') label = String(cursor.getFullYear());
        else if (step === 'quarter') label = `Q${Math.floor(cursor.getMonth() / 3) + 1} ${cursor.getFullYear()}`;
        else if (step === 'month') label = cursor.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
        else label = cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        ticks.push({ t, label, x: timeToX(t) });
      }
      if (step === 'year') cursor.setFullYear(cursor.getFullYear() + 1);
      else if (step === 'quarter') cursor.setMonth(cursor.getMonth() + 3);
      else if (step === 'month') cursor.setMonth(cursor.getMonth() + 1);
      else cursor.setDate(cursor.getDate() + 7);
    }
  }

  return (
    <>
      <div
        className="timeline-axis"
        style={{
          position: 'absolute',
          left: axisLeft,
          top: -1,
          width: axisWidth,
          height: 2,
          zIndex: 4,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />
      {hasTime && minT === maxT && (
        <div
          className="timeline-axis__single"
          style={{
            position: 'absolute',
            left: -120,
            top: 14,
            width: 240,
            textAlign: 'center',
            zIndex: 4,
            pointerEvents: 'none',
          }}
        >
          {new Date(minT).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      )}
      {ticks.map((tick) => (
        <React.Fragment key={tick.t}>
          <div
            className="timeline-axis__tick"
            style={{
              position: 'absolute',
              left: tick.x - 0.5,
              top: -7,
              width: 1,
              height: 14,
              zIndex: 4,
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          />
          <div
            className="timeline-axis__label"
            style={{
              position: 'absolute',
              left: tick.x - 60,
              top: 14,
              width: 120,
              textAlign: 'center',
              zIndex: 4,
              pointerEvents: 'none',
            }}
          >
            {tick.label}
          </div>
        </React.Fragment>
      ))}
    </>
  );
}
