import React, { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import { motion, AnimatePresence, animate } from 'framer-motion';
import { useCamera } from './useCamera';
import { TreePanel } from './TreePanel';
import { SyncConsole } from './SyncConsole';
import { fetchCanvasLayout, saveCanvasLayout } from '../sync/api';
import './Desktop.css';

/* ── Constants ─────────────────────────────────────────── */
const MEMORY_PREFIX = 'workspace/memory/';
const CARD_W = 260;
const CARD_H = 330;
const VISIBLE_LAYERS = 8;
const HEADER_H = 34;
const ABSORB_W = 320;
const ABSORB_H = 400;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const TONE = {
  private: { bg: '#fbeeee', ink: '#7a3b3b', accent: '#c45a5a', stamp: 'PRIVATE' },
  ready:   { bg: '#f8f4ea', ink: '#3d3a33', accent: '#7a7060', stamp: null },
  synced:  { bg: '#e8f3eb', ink: '#2f5a40', accent: '#3e8f5e', stamp: 'SYNCED' },
};

/* ── Helpers ────────────────────────────────────────────── */
function classify(file, syncStatus) {
  if (file?.riskLevel === 'secret') return 'private';
  if (file?.riskLevel === 'private' || file?.privacyLevel === 'private') return 'private';
  if (syncStatus === 'sealed') return 'private';
  if (syncStatus === 'synced') return 'synced';
  return 'ready';
}

function contentFor(contentMap, rel) {
  if (!contentMap || !rel) return '';
  if (contentMap.get) return contentMap.get(rel) || '';
  return contentMap[rel] || '';
}

function parseCardName(name) {
  const noExt = name.replace(/\.(md|json)$/, '');
  const m = noExt.match(/^(\d{4}-\d{2}-\d{2})(?:-(\d{4}))?(?:-(.+))?$/);
  if (m) {
    const [, date, , topic] = m;
    return { date, topic: topic ? topic.replace(/-/g, ' ') : null };
  }
  return { date: null, topic: noExt.replace(/-/g, ' ') };
}

/** Deterministic fan offset for stacked cards. */
function fanOffset(i) {
  const r  = ((i * 2654435761) >>> 0) / 0xffffffff;
  const r2 = (((i + 7) * 40503) >>> 0) / 0xffff;
  return {
    x: i * 10 + (r - 0.5) * 3,
    y: i * -1.5 + (r2 - 0.5) * 4,
    rot: (r - 0.5) * 4 - i * 0.3,
  };
}

function groupDragOffset(index) {
  return {
    x: index * 12,
    y: index * 5,
    rot: (index - 1) * 1.4,
  };
}

/** Group memory files into initial named stacks by risk + month. */
function buildInitialStacks(memoryFiles, syncMap) {
  const groups = { private: [], ready: [], synced: [] };
  for (const f of memoryFiles) {
    const risk = classify(f, syncMap?.[f.relativePath] || null);
    groups[risk].push(f.relativePath);
  }
  const stacks = {};
  let num = 1;

  const makeStacks = (paths, zoneX, zoneY) => {
    if (paths.length === 0) return;
    const byMonth = {};
    const misc = [];
    for (const rel of paths) {
      const name = rel.split('/').pop();
      const m = name.match(/^(\d{4})-(\d{2})/);
      if (m) {
        const key = `${m[1]}-${m[2]}`;
        (byMonth[key] || (byMonth[key] = [])).push(rel);
      } else {
        misc.push(rel);
      }
    }
    const buckets = [];
    for (const [key, items] of Object.entries(byMonth)) {
      const [y, mo] = key.split('-');
      const label = `${MONTHS[parseInt(mo) - 1]} ${y}`;
      if (items.length > 30) {
        const mid = Math.ceil(items.length / 2);
        buckets.push({ label: `${label} (1)`, items: items.slice(0, mid) });
        buckets.push({ label: `${label} (2)`, items: items.slice(mid) });
      } else {
        buckets.push({ label, items });
      }
    }
    if (misc.length > 0) buckets.push({ label: 'misc', items: misc });
    buckets.sort((a, b) => b.items[0].localeCompare(a.items[0]));

    buckets.forEach((b, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const id = `s${num++}`;
      stacks[id] = { id, name: b.label, x: zoneX + col * 340, y: zoneY + row * 480, cardIds: b.items };
    });
  };

  makeStacks(groups.private, 60,  60);
  makeStacks(groups.ready,   500, 60);
  makeStacks(groups.synced,  1100, 60);
  return { stacks, nextStackNum: num };
}

function parseStackNum(id) {
  const match = String(id || '').match(/^s(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function reconcileSavedLayout(layout, memoryFiles, syncMap) {
  const validPaths = new Set(memoryFiles.map((file) => file.relativePath));
  const assigned = new Set();
  const stacks = {};
  let maxStackNum = 0;

  for (const [rawId, rawStack] of Object.entries(layout?.stacks || {})) {
    const id = String(rawStack?.id || rawId || '').trim();
    if (!id) continue;
    const cardIds = (rawStack?.cardIds || [])
      .map((cardId) => String(cardId || '').replace(/\\/g, '/'))
      .filter((cardId) => validPaths.has(cardId) && !assigned.has(cardId));
    if (cardIds.length === 0) continue;

    const x = Number(rawStack.x);
    const y = Number(rawStack.y);
    stacks[id] = {
      id,
      name: typeof rawStack.name === 'string' && rawStack.name.trim() ? rawStack.name.trim() : null,
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      cardIds,
    };
    cardIds.forEach((cardId) => assigned.add(cardId));
    maxStackNum = Math.max(maxStackNum, parseStackNum(id));
  }

  const unassignedFiles = memoryFiles.filter((file) => !assigned.has(file.relativePath));
  const generated = buildInitialStacks(unassignedFiles, syncMap);
  for (const stack of Object.values(generated.stacks)) {
    let id = stack.id;
    while (stacks[id]) {
      maxStackNum += 1;
      id = `s${maxStackNum}`;
    }
    stacks[id] = { ...stack, id };
    maxStackNum = Math.max(maxStackNum, parseStackNum(id));
  }

  const savedNextStackNum = Number.parseInt(String(layout?.nextStackNum ?? ''), 10);
  const nextStackNum = Math.max(
    Number.isFinite(savedNextStackNum) ? savedNextStackNum : 1,
    generated.nextStackNum,
    maxStackNum + 1,
  );
  return { stacks, nextStackNum };
}

function stackBounds(stacks) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of Object.values(stacks)) {
    minX = Math.min(minX, s.x - 30);
    maxX = Math.max(maxX, s.x + CARD_W + 120);
    minY = Math.min(minY, s.y - 30);
    maxY = Math.max(maxY, s.y + HEADER_H + CARD_H + 100);
  }
  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
}

/* ── Desktop component ─────────────────────────────────── */
export function Desktop({
  files, syncMap, contentMap, cardSyncState,
  syncing, canSync, isConnected, lastSyncLabel,
  onSync, onOpenCard,
}) {
  const stageRef = useRef(null);
  const lockYRef = useRef(false);
  const { cameraX, cameraY, cameraScale, focusOn, fitTo } = useCamera({
    stageRef, minScale: 0.05, maxScale: 3.0,
    initial: { x: 0, y: 0, scale: 1 }, lockYRef,
  });

  /* ── Sidebar state ── */
  const [treeOpen, setTreeOpen] = useState(() => {
    try { return localStorage.getItem('echomem.treeOpen') !== '0'; } catch { return true; }
  });
  const [syncOpen, setSyncOpen] = useState(() => {
    try { return localStorage.getItem('echomem.syncOpen') !== '0'; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem('echomem.treeOpen', treeOpen ? '1' : '0'); } catch {} }, [treeOpen]);
  useEffect(() => { try { localStorage.setItem('echomem.syncOpen', syncOpen ? '1' : '0'); } catch {} }, [syncOpen]);
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '[') { e.preventDefault(); setTreeOpen(v => !v); }
      else if (e.key === ']') { e.preventDefault(); setSyncOpen(v => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ── Memory files ── */
  const memoryFiles = useMemo(() =>
    (files || []).filter(f => f?.relativePath?.startsWith(MEMORY_PREFIX))
      .sort((a, b) => b.relativePath.split('/').pop().localeCompare(a.relativePath.split('/').pop())),
    [files]);
  const fileMap = useMemo(() => {
    const m = {};
    for (const f of memoryFiles) m[f.relativePath] = f;
    return m;
  }, [memoryFiles]);

  /* ── SyncConsole buckets ── */
  const buckets = useMemo(() => {
    const priv = [], ready = [], synced = [];
    for (const file of files || []) {
      if (!file?.relativePath) continue;
      const status = syncMap?.[file.relativePath] || null;
      const key = classify(file, status);
      const row = { file, content: contentFor(contentMap, file.relativePath), syncStatus: status };
      if (key === 'private') priv.push(row); else if (key === 'synced') synced.push(row); else ready.push(row);
    }
    return { private: priv, ready, synced };
  }, [files, syncMap, contentMap]);

  /* ── Stack state ── */
  const [stacks, setStacks] = useState({});
  const nextNumRef = useRef(1);
  const [hoverStackId, setHoverStackId] = useState(null);
  const [editingStackId, setEditingStackId] = useState(null);
  const [savedCanvasLayout, setSavedCanvasLayout] = useState(null);
  const [canvasLayoutLoaded, setCanvasLayoutLoaded] = useState(false);
  const [heroAnchor, setHeroAnchor] = useState(null);
  const layoutDoneRef = useRef(false);
  const saveLayoutTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetchCanvasLayout()
      .then((result) => {
        if (cancelled) return;
        setSavedCanvasLayout(result?.layout || null);
      })
      .catch(() => {
        if (!cancelled) setSavedCanvasLayout(null);
      })
      .finally(() => {
        if (!cancelled) setCanvasLayoutLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!canvasLayoutLoaded || memoryFiles.length === 0 || layoutDoneRef.current) return;
    layoutDoneRef.current = true;
    const init = savedCanvasLayout?.stacks
      ? reconcileSavedLayout(savedCanvasLayout, memoryFiles, syncMap)
      : buildInitialStacks(memoryFiles, syncMap);
    setStacks(init.stacks);
    nextNumRef.current = init.nextStackNum;
    const initialBounds = stackBounds(init.stacks);
    setHeroAnchor(initialBounds
      ? {
          x: (initialBounds.minX + initialBounds.maxX) / 2,
          y: (initialBounds.minY + initialBounds.maxY) / 2,
        }
      : null);
    requestAnimationFrame(() => {
      if (initialBounds) fitTo(initialBounds, { padding: 80 });
    });
  }, [canvasLayoutLoaded, memoryFiles, savedCanvasLayout, syncMap, fitTo]);

  useEffect(() => {
    if (!canvasLayoutLoaded || !layoutDoneRef.current || memoryFiles.length === 0) return;
    setStacks((prev) => {
      const assigned = new Set();
      for (const stack of Object.values(prev)) {
        for (const cardId of stack.cardIds || []) assigned.add(cardId);
      }
      const missingFiles = memoryFiles.filter((file) => !assigned.has(file.relativePath));
      if (missingFiles.length === 0) return prev;
      const generated = buildInitialStacks(missingFiles, syncMap);
      const next = { ...prev };
      let nextNum = nextNumRef.current;
      for (const stack of Object.values(generated.stacks)) {
        const id = `s${nextNum++}`;
        next[id] = { ...stack, id };
      }
      nextNumRef.current = Math.max(nextNumRef.current, nextNum);
      return next;
    });
  }, [canvasLayoutLoaded, memoryFiles, syncMap]);

  useEffect(() => {
    if (!canvasLayoutLoaded || !layoutDoneRef.current) return undefined;
    if (saveLayoutTimerRef.current) {
      window.clearTimeout(saveLayoutTimerRef.current);
    }
    saveLayoutTimerRef.current = window.setTimeout(() => {
      saveCanvasLayout({
        version: 1,
        stacks,
        nextStackNum: nextNumRef.current,
      }).catch((error) => {
        console.warn('Failed to save canvas layout', error);
      });
    }, 450);
    return () => {
      if (saveLayoutTimerRef.current) {
        window.clearTimeout(saveLayoutTimerRef.current);
        saveLayoutTimerRef.current = null;
      }
    };
  }, [canvasLayoutLoaded, stacks]);

  /* ── Select mode + marquee ── */
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState(() => new Set());
  const [marquee, setMarquee] = useState(null); // { sx0, sy0, sx1, sy1 }

  /* ── Drag state ── */
  const [drag, setDrag] = useState(null);
  const [sDrag, setSDrag] = useState(null);
  const draggedSet = useMemo(() => new Set(drag?.ids || []), [drag]);
  const stacksRef = useRef(stacks);
  useEffect(() => { stacksRef.current = stacks; });

  const screenToWorld = useCallback((cx, cy) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { wx: 0, wy: 0 };
    return {
      wx: (cx - rect.left - cameraX.get()) / cameraScale.get(),
      wy: (cy - rect.top  - cameraY.get()) / cameraScale.get(),
    };
  }, [cameraX, cameraY, cameraScale]);

  /* Card drag start */
  const onCardDown = useCallback((e, cardId, wx, wy) => {
    e.stopPropagation(); e.preventDefault();
    const cursor = screenToWorld(e.clientX, e.clientY);
    const selectedIds = selection.has(cardId) ? Array.from(selection) : [];
    const ids = selectedIds.length > 0
      ? [cardId, ...selectedIds.filter((id) => id !== cardId)]
      : [cardId];
    setDrag({
      ids,
      anchorId: cardId,
      offsets: Object.fromEntries(ids.map((id, index) => [id, groupDragOffset(index)])),
      grab: { dx: cursor.wx - wx, dy: cursor.wy - wy },
      worldX: wx, worldY: wy, absorbId: null, moved: false,
    });
  }, [screenToWorld, selection]);

  /* Stack header drag start */
  const onHeaderDown = useCallback((e, stackId) => {
    e.stopPropagation(); e.preventDefault();
    setSDrag({ stackId, lx: e.clientX, ly: e.clientY });
  }, []);

  /* Global move / up */
  useEffect(() => {
    if (!drag && !sDrag) return;
    const onMove = (e) => {
      if (sDrag) {
        const s = cameraScale.get();
        const dx = (e.clientX - sDrag.lx) / s;
        const dy = (e.clientY - sDrag.ly) / s;
        setStacks(prev => {
          const st = prev[sDrag.stackId];
          return st ? { ...prev, [sDrag.stackId]: { ...st, x: st.x + dx, y: st.y + dy } } : prev;
        });
        setSDrag(d => ({ ...d, lx: e.clientX, ly: e.clientY }));
        return;
      }
      if (drag) {
        const { wx, wy } = screenToWorld(e.clientX, e.clientY);
        const newX = wx - drag.grab.dx;
        const newY = wy - drag.grab.dy;
        let absorbId = null;
        for (const st of Object.values(stacksRef.current)) {
          if (drag.ids.every(id => st.cardIds.includes(id))) continue;
          if (wx >= st.x - 20 && wx <= st.x + ABSORB_W && wy >= st.y + HEADER_H - 10 && wy <= st.y + HEADER_H + ABSORB_H) {
            absorbId = st.id; break;
          }
        }
        setDrag(d => d ? { ...d, worldX: newX, worldY: newY, absorbId, moved: true } : d);
      }
    };
    const onUp = () => {
      if (sDrag) { setSDrag(null); return; }
      if (!drag) return;
      if (!drag.moved) { onOpenCard?.(drag.ids[0]); setDrag(null); return; }
      const { ids, worldX, worldY, absorbId } = drag;
      setStacks(prev => {
        const next = { ...prev };
        for (const sid of Object.keys(next)) {
          const filtered = next[sid].cardIds.filter(id => !ids.includes(id));
          if (filtered.length === next[sid].cardIds.length) continue;
          if (filtered.length === 0) delete next[sid]; else next[sid] = { ...next[sid], cardIds: filtered };
        }
        if (absorbId && next[absorbId]) {
          next[absorbId] = { ...next[absorbId], cardIds: [...ids, ...next[absorbId].cardIds] };
        } else {
          const newId = `s${nextNumRef.current++}`;
          next[newId] = { id: newId, name: null, x: worldX, y: worldY, cardIds: ids };
        }
        return next;
      });
      setSelection(new Set());
      setSelectMode(false);
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [drag, sDrag, screenToWorld, cameraScale, onOpenCard]);

  /* ── Marquee selection (active in select mode) ── */
  const onMarqueeDown = useCallback((e) => {
    if (!selectMode) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setMarquee({ sx0: sx, sy0: sy, sx1: sx, sy1: sy });
    e.preventDefault();
  }, [selectMode]);

  useEffect(() => {
    if (!marquee) return;
    const onMove = (e) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setMarquee(m => m ? { ...m, sx1: sx, sy1: sy } : m);

      // Hit-test: if a stack's area intersects the marquee, select ALL its cards
      const cx = cameraX.get(), cy = cameraY.get(), s = cameraScale.get();
      const wx0 = (Math.min(marquee.sx0, sx) - cx) / s;
      const wy0 = (Math.min(marquee.sy0, sy) - cy) / s;
      const wx1 = (Math.max(marquee.sx0, sx) - cx) / s;
      const wy1 = (Math.max(marquee.sy0, sy) - cy) / s;
      const hits = new Set();
      for (const st of Object.values(stacksRef.current)) {
        if (st.cardIds.length === 0) continue;
        const off = fanOffset(0);
        const px = st.x + off.x;
        const py = st.y + HEADER_H + off.y;
        if (px + CARD_W > wx0 && px < wx1 && py + CARD_H > wy0 && py < wy1) {
          for (const id of st.cardIds) hits.add(id);
        }
      }
      setSelection(hits);
    };
    const onUp = () => { setMarquee(null); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [marquee, cameraX, cameraY, cameraScale]);

  // Escape exits select mode and clears selection
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setSelectMode(false); setSelection(new Set()); setMarquee(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const renameStack = useCallback((id, name) => {
    setStacks(prev => ({ ...prev, [id]: { ...prev[id], name } }));
  }, []);

  const fitAll = useCallback(() => {
    const b = stackBounds(stacks);
    if (b) fitTo(b, { padding: 80 });
  }, [stacks, fitTo]);

  /* ── Locate-and-open: TreePanel click → fly to card → highlight → open ── */
  const [highlightCard, setHighlightCard] = useState(null);
  const highlightTimer = useRef(null);

  // Track how many cards have been staged so they don't overlap
  const stagedCountRef = useRef(0);

  const locateAndOpen = useCallback((relPath) => {
    // Check if this card is already a solo stack (already staged) — just open it
    for (const s of Object.values(stacksRef.current)) {
      if (s.cardIds.length === 1 && s.cardIds[0] === relPath) {
        // Already isolated — just fly to it and open
        const off = fanOffset(0);
        const cx = s.x + off.x + CARD_W / 2;
        const cy = s.y + HEADER_H + off.y + CARD_H / 2;
        const rect = stageRef.current?.getBoundingClientRect();
        if (rect) {
          const ts = Math.max(0.8, Math.min(1.2, cameraScale.get()));
          const ease = [0.22, 1, 0.36, 1];
          animate(cameraX, rect.width / 2 - cx * ts, { duration: 0.5, ease });
          animate(cameraY, rect.height / 2 - cy * ts, { duration: 0.5, ease });
          animate(cameraScale, ts, { duration: 0.5, ease });
        }
        clearTimeout(highlightTimer.current);
        setHighlightCard(relPath);
        highlightTimer.current = setTimeout(() => { onOpenCard?.(relPath); setHighlightCard(null); }, 700);
        return;
      }
    }

    // Find the stack containing this card and pull it out
    let found = false;
    for (const s of Object.values(stacksRef.current)) {
      const idx = s.cardIds.indexOf(relPath);
      if (idx === -1) continue;
      found = true;

      // Compute a staging position: center-right of the current viewport,
      // staggered vertically so multiple staged cards don't overlap.
      const rect = stageRef.current?.getBoundingClientRect();
      const scale = cameraScale.get();
      const stageN = stagedCountRef.current++;
      // Convert viewport center-right to world coords
      const viewCX = rect ? (rect.width * 0.6 - cameraX.get()) / scale : s.x + 400;
      const viewCY = rect ? (rect.height * 0.4 - cameraY.get()) / scale + stageN * (CARD_H * 0.35) : s.y;

      // Pull card out of source stack, create new solo stack at staging pos
      setStacks(prev => {
        const next = { ...prev };
        const src = next[s.id];
        const filtered = src.cardIds.filter(id => id !== relPath);
        if (filtered.length === 0) delete next[s.id]; else next[s.id] = { ...src, cardIds: filtered };
        const newId = `s${nextNumRef.current++}`;
        next[newId] = { id: newId, name: null, x: viewCX, y: viewCY, cardIds: [relPath] };
        return next;
      });

      // Fly camera to the new position and highlight
      requestAnimationFrame(() => {
        const ts = Math.max(0.8, Math.min(1.2, scale));
        const cx = viewCX + CARD_W / 2;
        const cy = viewCY + CARD_H / 2;
        if (rect) {
          const ease = [0.22, 1, 0.36, 1];
          animate(cameraX, rect.width / 2 - cx * ts, { duration: 0.5, ease });
          animate(cameraY, rect.height / 2 - cy * ts, { duration: 0.5, ease });
          animate(cameraScale, ts, { duration: 0.5, ease });
        }
      });

      clearTimeout(highlightTimer.current);
      setHighlightCard(relPath);
      highlightTimer.current = setTimeout(() => { setHighlightCard(null); }, 800);
      break;
    }

    if (!found) onOpenCard?.(relPath);
  }, [cameraX, cameraY, cameraScale, onOpenCard]);

  /* ── Render ── */
  return (
    <div className="desktop">
      <div className="desktop__stage" ref={stageRef}>
        <motion.div className="desktop__world" style={{ x: cameraX, y: cameraY, scale: cameraScale, transformOrigin: '0 0' }}>

          {/* Hero text — world-space anchor at the center of the layout */}
          {(() => {
            const b = heroAnchor ? null : stackBounds(stacks);
            const cx = heroAnchor?.x ?? (b ? (b.minX + b.maxX) / 2 : 0);
            const cy = heroAnchor?.y ?? (b ? (b.minY + b.maxY) / 2 : 0);
            return (
              <div className="desktop__hero" style={{ position: 'absolute', left: cx, top: cy, transform: 'translate(-50%, -50%)', zIndex: 0, pointerEvents: 'none' }}>
                <h1 className="desktop__hero-title">Select markdown.<br/>Save to Echo.</h1>
              </div>
            );
          })()}

          {Object.values(stacks).map(s => {
            const visible = s.cardIds.filter(id => !draggedSet.has(id)).slice(0, VISIBLE_LAYERS);
            if (visible.length === 0 && !s.cardIds.some(id => draggedSet.has(id))) return null;
            const isHov = hoverStackId === s.id && !drag && !sDrag;
            const isAbsorb = drag?.absorbId === s.id;
            const total = s.cardIds.length;
            const extra = Math.min(Math.max(0, total - VISIBLE_LAYERS), 16);
            const showHead = total > 1 || s.name;
            const mul = isHov ? 1.8 : 1;
            const lift = isHov ? -4 : 0;
            const firstFile = fileMap[s.cardIds[0]];
            const stackRisk = firstFile ? classify(firstFile, syncMap?.[s.cardIds[0]]) : 'ready';

            return (
              <div key={s.id} data-no-pan
                onMouseEnter={() => setHoverStackId(s.id)} onMouseLeave={() => setHoverStackId(null)}
                style={{ position: 'absolute', left: s.x, top: s.y, transition: drag || sDrag ? 'none' : 'transform 200ms ease', transform: `translateY(${lift}px)`, zIndex: isHov ? 20 : 10 }}>

                {showHead && (
                  <div data-no-pan onPointerDown={e => onHeaderDown(e, s.id)}
                    onDoubleClick={e => { e.stopPropagation(); setEditingStackId(s.id); }}
                    style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'grab', padding: '2px 0', fontFamily: 'var(--fu)' }}>
                    {editingStackId === s.id ? (
                      <input autoFocus defaultValue={s.name || ''} data-no-pan
                        onPointerDown={e => e.stopPropagation()}
                        onBlur={e => { renameStack(s.id, e.target.value || null); setEditingStackId(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') { renameStack(s.id, e.target.value || null); setEditingStackId(null); } if (e.key === 'Escape') setEditingStackId(null); }}
                        style={{ fontFamily: 'var(--fu)', fontWeight: 600, fontSize: 13, border: '1px solid #ccc', borderRadius: 4, padding: '2px 6px', outline: 'none', minWidth: 100, background: '#fff' }} />
                    ) : (
                      <span style={{ fontWeight: 600, fontSize: 13, color: s.name ? 'var(--ink)' : 'var(--ink-faint)', fontStyle: s.name ? 'normal' : 'italic' }}>
                        {s.name || 'Untitled pile'}
                      </span>
                    )}
                    <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 9, background: 'rgba(40,24,8,0.06)', color: 'var(--ink-muted)' }}>{total}</span>
                  </div>
                )}

                {isAbsorb && (
                  <div style={{ position: 'absolute', left: -20, top: HEADER_H - 8, width: ABSORB_W, height: ABSORB_H, border: `2px dashed ${TONE[stackRisk].accent}`, borderRadius: 14, background: `${TONE[stackRisk].accent}14`, pointerEvents: 'none' }} />
                )}

                <div style={{ position: 'relative', width: CARD_W, height: CARD_H }}>
                  {extra > 0 && Array.from({ length: extra }).map((_, i) => {
                    const d = i + 1;
                    const last = fanOffset(VISIBLE_LAYERS - 1);
                    const j = ((i * 2654435761) >>> 0) / 0xffffffff;
                    return (<div key={`e${i}`} style={{ position: 'absolute', left: last.x * mul + d * 1.2, top: last.y * mul + d * 0.5, width: CARD_W, height: CARD_H, background: TONE[stackRisk].bg, borderRadius: 4, border: '1px solid rgba(40,24,8,0.06)', boxShadow: '0 1px 1px rgba(0,0,0,0.04)', transform: `rotate(${last.rot + (j - 0.5) * 1.2}deg)`, zIndex: 90 - d }} />);
                  })}

                  {visible.slice().reverse().map((cardId, ri) => {
                    const li = visible.length - 1 - ri;
                    const off = fanOffset(li);
                    const isTop = li === 0;
                    const file = fileMap[cardId];
                    if (!file) return null;
                    const risk = classify(file, syncMap?.[cardId]);
                    const tone = TONE[risk];
                    const name = file.fileName || cardId.split('/').pop();
                    const parsed = parseCardName(name);
                    const content = isTop ? contentFor(contentMap, cardId) : '';
                    const isHL = highlightCard === cardId;
                    const isSel = selection.has(cardId);

                    return (
                      <div key={cardId} data-card={cardId} data-no-pan
                        onPointerDown={isTop ? (e) => {
                          const topX = s.x + off.x * mul;
                          const topY = s.y + (showHead ? HEADER_H : 0) + off.y * mul;
                          onCardDown(e, cardId, topX, topY);
                        } : undefined}
                        style={{
                          position: 'absolute', left: 0, top: 0, width: CARD_W, height: CARD_H,
                          background: tone.bg, borderRadius: 4, overflow: 'hidden',
                          boxShadow: isHL
                            ? '0 0 0 3px #3b82f6, 0 12px 32px rgba(59,130,246,0.25)'
                            : isTop ? '0 8px 20px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)' : '0 2px 6px rgba(0,0,0,0.05)',
                          outline: isSel ? '2.5px solid #3b82f6' : 'none',
                          outlineOffset: isSel ? 2 : 0,
                          transform: `translate(${off.x * mul}px, ${off.y * mul}px) rotate(${isHL ? 0 : off.rot}deg)${isHL ? ' scale(1.04)' : ''}`,
                          transition: drag ? 'none' : 'transform 220ms cubic-bezier(.2,.8,.2,1), box-shadow 300ms ease, outline 150ms ease',
                          zIndex: isHL ? 200 : isSel ? 150 : 100 - li, cursor: isTop ? 'grab' : 'default',
                          padding: '20px 22px', fontFamily: 'var(--fm)', color: tone.ink,
                        }}>
                        <div style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderTop: '16px solid rgba(0,0,0,0.05)', borderLeft: '16px solid transparent' }} />
                        {isTop && (<>
                          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${tone.ink}18`, wordBreak: 'break-word' }}>
                            {parsed.topic || parsed.date || name}
                          </div>
                          {parsed.date && parsed.topic && (
                            <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 6 }}>{parsed.date}</div>
                          )}
                          {content && (
                            <div style={{ fontSize: 11, lineHeight: 1.55, opacity: 0.75, maxHeight: 170, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                              {content.slice(0, 300)}
                            </div>
                          )}
                          {tone.stamp && (
                            <div style={{ position: 'absolute', right: 16, bottom: 14, padding: '3px 8px', border: `1.5px solid ${tone.accent}`, color: tone.accent, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, borderRadius: 3 }}>
                              {tone.stamp === 'SYNCED' ? '\u2713 SYNCED' : tone.stamp}
                            </div>
                          )}
                        </>)}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Drag ghost — full card content, not just title */}
          {drag?.moved && drag.ids.map(id => {
            const file = fileMap[id];
            if (!file) return null;
            const dragOffset = drag.offsets?.[id] || groupDragOffset(0);
            const risk = classify(file, syncMap?.[id]);
            const tone = TONE[risk];
            const name = file.fileName || id.split('/').pop();
            const parsed = parseCardName(name);
            const content = contentFor(contentMap, id);
            return (
              <div key={`ghost-${id}`} style={{
                position: 'absolute', left: drag.worldX + dragOffset.x, top: drag.worldY + dragOffset.y,
                width: CARD_W, height: CARD_H, background: tone.bg, borderRadius: 4,
                boxShadow: '0 24px 48px rgba(0,0,0,0.18)', transform: `rotate(${dragOffset.rot - 2}deg) scale(1.03)`,
                zIndex: 9000 + drag.ids.indexOf(id), pointerEvents: 'none', overflow: 'hidden',
                padding: '20px 22px', fontFamily: 'var(--fm)', color: tone.ink, opacity: 0.92,
              }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderTop: '16px solid rgba(0,0,0,0.05)', borderLeft: '16px solid transparent' }} />
                <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${tone.ink}18`, wordBreak: 'break-word' }}>
                  {parsed.topic || parsed.date || name}
                </div>
                {parsed.date && parsed.topic && (
                  <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 6 }}>{parsed.date}</div>
                )}
                {content && (
                  <div style={{ fontSize: 11, lineHeight: 1.55, opacity: 0.75, maxHeight: 170, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                    {content.slice(0, 300)}
                  </div>
                )}
                {tone.stamp && (
                  <div style={{ position: 'absolute', right: 16, bottom: 14, padding: '3px 8px', border: `1.5px solid ${tone.accent}`, color: tone.accent, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, borderRadius: 3 }}>
                    {tone.stamp === 'SYNCED' ? '\u2713 SYNCED' : tone.stamp}
                  </div>
                )}
              </div>
            );
          })}
        </motion.div>

        {memoryFiles.length === 0 && (
          <div className="desktop__empty"><div><p>Drop markdown files into your memory directory.</p></div></div>
        )}

        {/* Select-mode overlay: captures pointer for marquee drawing */}
        {selectMode && selection.size === 0 && (
          <div
            data-no-pan
            onPointerDown={onMarqueeDown}
            style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 30 }}
          />
        )}

        {/* Marquee rectangle */}
        {marquee && (
          <div style={{
            position: 'absolute',
            left: Math.min(marquee.sx0, marquee.sx1),
            top: Math.min(marquee.sy0, marquee.sy1),
            width: Math.abs(marquee.sx1 - marquee.sx0),
            height: Math.abs(marquee.sy1 - marquee.sy0),
            border: '1.5px solid #3b82f6',
            background: 'rgba(59,130,246,0.08)',
            borderRadius: 3,
            pointerEvents: 'none', zIndex: 31,
          }} />
        )}
      </div>

      <TreePanel files={files} syncMap={syncMap} onOpenFile={locateAndOpen} isOpen={treeOpen} onClose={() => setTreeOpen(false)} />

      {/* Right panel: selection list when files are selected, otherwise SyncConsole */}
      {selection.size > 0 ? (
        <motion.aside
          className="select-panel"
          initial={false}
          animate={{ x: syncOpen ? 0 : 'calc(100% + 24px)', opacity: syncOpen ? 1 : 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          style={{ pointerEvents: syncOpen ? 'auto' : 'none' }}
        >
          <div className="select-panel__head">
            <span className="select-panel__title">{selection.size} Selected</span>
            <button type="button" className="panel-close" onClick={() => { setSelection(new Set()); setSelectMode(false); }} title="Clear selection">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div className="select-panel__hint">
            Drag a highlighted card to move this group into a pile or onto open space.
          </div>
          <div className="select-panel__list">
            {Array.from(selection).map(cardId => {
              const file = fileMap[cardId];
              if (!file) return null;
              const name = file.fileName || cardId.split('/').pop();
              const parsed = parseCardName(name);
              const risk = classify(file, syncMap?.[cardId]);
              return (
                <div key={cardId} className={`select-panel__item select-panel__item--${risk}`}>
                  <span className="select-panel__item-name">{parsed.topic || parsed.date || name}</span>
                  <button type="button" className="select-panel__item-remove" onClick={() => setSelection(prev => { const next = new Set(prev); next.delete(cardId); return next; })} title="Deselect">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="select-panel__actions">
            <button type="button" className="select-panel__btn select-panel__btn--clear" onClick={() => { setSelection(new Set()); setSelectMode(false); }}>
              Clear
            </button>
          </div>
        </motion.aside>
      ) : (
        <SyncConsole readyItems={buckets.ready} privateCount={buckets.private.length} syncedCount={buckets.synced.length} syncing={syncing} syncStateByPath={cardSyncState} lastSyncLabel={lastSyncLabel} canSync={canSync} onSync={onSync} isConnected={isConnected} isOpen={syncOpen} onClose={() => setSyncOpen(false)} />
      )}

      <AnimatePresence>
        {!treeOpen && (<motion.button key="tab-left" type="button" className="desktop__edgetab desktop__edgetab--left" onClick={() => setTreeOpen(true)} title="[ to toggle" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3.5h3.5l1.2 1.4H12a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/></svg><span className="desktop__edgetab-lbl">Memory</span><span className="desktop__edgetab-chev">{'\u203A'}</span></motion.button>)}
        {!syncOpen && (<motion.button key="tab-right" type="button" className="desktop__edgetab desktop__edgetab--right" onClick={() => setSyncOpen(true)} title="] to toggle" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}><span className="desktop__edgetab-chev">{'\u2039'}</span><span className="desktop__edgetab-lbl">{syncing ? 'Syncing\u2026' : 'Sync'}</span><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></motion.button>)}
      </AnimatePresence>

      <div className="desktop__zoomctrls">
        <button type="button" className={`desktop__zoombtn ${selectMode ? 'desktop__zoombtn--active' : ''}`}
          onClick={() => { setSelectMode(v => !v); if (selectMode) { setSelection(new Set()); setMarquee(null); } }}
          title="Select mode (drag to select cards, Esc to exit)">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M1 1h4v4H1zM8 1h4v4H8zM1 8h4v4H1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/><path d="M8 8h4v4H8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="rgba(59,130,246,0.15)"/></svg>
          <span style={{ marginLeft: 4 }}>Select</span>
        </button>
        {selection.size > 0 && (
          <span className="desktop__zoombtn" style={{ color: '#3b82f6', fontWeight: 600, cursor: 'default' }}>
            {selection.size} selected
          </span>
        )}
        <span className="desktop__zoomsep" aria-hidden="true" />
        <button type="button" className="desktop__zoombtn" onClick={fitAll} title="Fit all"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 4V1H4M9 1H12V4M12 9V12H9M4 12H1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg><span style={{ marginLeft: 4 }}>Fit</span></button>
        <span className="desktop__zoomhint">{selectMode ? 'drag to select \u00B7 Esc to exit' : 'scroll to zoom \u00B7 drag to pan'}</span>
      </div>
    </div>
  );
}
