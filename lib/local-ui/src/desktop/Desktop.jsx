import React, { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import { motion, animate, useTransform } from 'framer-motion';
import { useCamera } from './useCamera';
import { TreePanel } from './TreePanel';
import { SyncConsole } from './SyncConsole';
import { EchoMemoryGuide } from './EchoMemoryGuide';
import { EchoStatusTrio } from './EchoStatusTrio';
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

/* Sticky-note tones — bound to Echo Design System --echo-note-* values.
 * Keep literal hex here (inline styles can't resolve var()). */
const TONE = {
  private: { bg: '#F5D5D5', ink: '#1a1a1a', accent: '#C7372F', stamp: 'PRIVATE' },
  ready:   { bg: '#DCEFD9', ink: '#1a1a1a', accent: '#6b6b6b', stamp: null },
  synced:  { bg: '#DDE6F5', ink: '#1a1a1a', accent: '#1a3a8f', stamp: 'SYNCED' },
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

function previewMarkdown(md) {
  const raw = String(md || '').trim();
  if (!raw) return 'No preview loaded yet.';
  return raw
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[*_~`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 420) || 'No readable preview.';
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

const EMPTY_ID_SET = new Set();

function setEquals(a, b) {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

function hasAnyCardId(cardIds, ids) {
  if (!ids || ids.size === 0) return false;
  for (const id of cardIds || []) {
    if (ids.has(id)) return true;
  }
  return false;
}

function selectionChangedForStack(cardIds, prevSelection, nextSelection) {
  if (prevSelection === nextSelection) return false;
  for (const id of cardIds || []) {
    if (prevSelection?.has(id) !== nextSelection?.has(id)) return true;
  }
  return false;
}

function containsCardId(cardIds, id) {
  return Boolean(id && (cardIds || []).includes(id));
}

function cardShadow(isHighlighted, isTop) {
  if (isHighlighted) {
    return '0 0 0 3px #3b82f6, 0 12px 32px rgba(59,130,246,0.25)';
  }
  return isTop
    ? '0 18px 34px rgba(46,35,20,0.12), 0 5px 12px rgba(46,35,20,0.07), 0 1px 2px rgba(0,0,0,0.04)'
    : '0 5px 12px rgba(46,35,20,0.07), 0 1px 2px rgba(0,0,0,0.035)';
}

const StackView = memo(function StackView({
  stack,
  fileMap,
  syncMap,
  contentMap,
  draggedIds,
  selection,
  highlightCard,
  isHovered,
  isHoverSuppressed,
  isEditing,
  isAbsorb,
  onHoverChange,
  onStackHandleDown,
  onCardDown,
  renameStack,
  setEditingStackId,
}) {
  const visible = stack.cardIds.filter((id) => !draggedIds.has(id)).slice(0, VISIBLE_LAYERS);
  if (visible.length === 0 && !hasAnyCardId(stack.cardIds, draggedIds)) return null;

  const total = stack.cardIds.length;
  const extra = Math.min(Math.max(0, total - VISIBLE_LAYERS), 16);
  const showHead = total > 1 || stack.name;
  const isHov = isHovered && !isHoverSuppressed;
  const mul = isHov ? 1.8 : 1;
  const lift = isHov ? -4 : 0;
  const firstFile = fileMap[stack.cardIds[0]];
  const stackRisk = firstFile ? classify(firstFile, syncMap?.[stack.cardIds[0]]) : 'ready';

  return (
    <div
      data-no-pan
      onMouseEnter={() => onHoverChange(stack.id, true)}
      onMouseLeave={() => onHoverChange(stack.id, false)}
      style={{
        position: 'absolute',
        left: stack.x,
        top: stack.y,
        transition: 'transform 200ms ease',
        transform: `translateY(${lift}px)`,
        zIndex: isHov ? 20 : 10,
      }}
    >
      {showHead && (
        <div data-no-pan className="stack-head">
          <button
            type="button"
            data-no-pan
            className="stack-drag-handle"
            onPointerDown={(e) => onStackHandleDown(e, stack.id)}
            title="Drag pile"
            aria-label="Drag pile"
          >
            <span />
            <span />
            <span />
          </button>
          {isEditing ? (
            <input
              autoFocus
              defaultValue={stack.name || ''}
              data-no-pan
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => { renameStack(stack.id, e.target.value); setEditingStackId(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { renameStack(stack.id, e.target.value); setEditingStackId(null); }
                if (e.key === 'Escape') setEditingStackId(null);
              }}
              placeholder="Name this pile"
              className="stack-title-input"
            />
          ) : (
            <button
              type="button"
              data-no-pan
              className={`stack-title-btn ${stack.name ? '' : 'stack-title-btn--untitled'}`}
              onClick={(e) => {
                e.stopPropagation();
                setEditingStackId(stack.id);
              }}
              title="Click to name this pile"
            >
              {stack.name || 'Untitled pile'}
            </button>
          )}
          <span className="stack-count">{total}</span>
        </div>
      )}

      {isAbsorb && (
        <div
          style={{
            position: 'absolute',
            left: -20,
            top: HEADER_H - 8,
            width: ABSORB_W,
            height: ABSORB_H,
            border: `2px dashed ${TONE[stackRisk].accent}`,
            borderRadius: 14,
            background: `${TONE[stackRisk].accent}14`,
            pointerEvents: 'none',
          }}
        />
      )}

      <div style={{ position: 'relative', width: CARD_W, height: CARD_H }}>
        {extra > 0 && Array.from({ length: extra }).map((_, i) => {
          const d = i + 1;
          const last = fanOffset(VISIBLE_LAYERS - 1);
          const j = ((i * 2654435761) >>> 0) / 0xffffffff;
          return (
            <div
              key={`e${i}`}
              style={{
                position: 'absolute',
                left: last.x * mul + d * 1.2,
                top: last.y * mul + d * 0.5,
                width: CARD_W,
                height: CARD_H,
                background: TONE[stackRisk].bg,
                borderRadius: 4,
                border: '1px solid rgba(40,24,8,0.06)',
                boxShadow: '0 1px 1px rgba(0,0,0,0.04)',
                transform: `rotate(${last.rot + (j - 0.5) * 1.2}deg)`,
                zIndex: 90 - d,
              }}
            />
          );
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
            <div
              key={cardId}
              data-card={cardId}
              data-card-top={isTop ? 'true' : undefined}
              data-no-pan
              onPointerDown={isTop ? (e) => {
                const topX = stack.x + off.x * mul;
                const topY = stack.y + (showHead ? HEADER_H : 0) + off.y * mul;
                onCardDown(e, cardId, topX, topY);
              } : undefined}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: CARD_W,
                height: CARD_H,
                background: tone.bg,
                borderRadius: 4,
                overflow: 'hidden',
                boxShadow: cardShadow(isHL, isTop),
                outline: isSel ? '2.5px solid #3b82f6' : 'none',
                outlineOffset: isSel ? 2 : 0,
                transform: `translate(${off.x * mul}px, ${off.y * mul}px) rotate(${isHL ? 0 : off.rot}deg)${isHL ? ' scale(1.04)' : ''}`,
                transition: 'transform 220ms cubic-bezier(.2,.8,.2,1), box-shadow 300ms ease, outline 150ms ease',
                zIndex: isHL ? 200 : isSel ? 150 : 100 - li,
                cursor: isTop ? 'grab' : 'default',
                padding: '20px 22px',
                fontFamily: 'var(--fm)',
                color: tone.ink,
              }}
            >
              <div style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderTop: '16px solid rgba(0,0,0,0.05)', borderLeft: '16px solid transparent' }} />
              {isTop && (
                <>
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
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}, (prev, next) => {
  if (prev.stack !== next.stack) return false;
  if (prev.fileMap !== next.fileMap || prev.syncMap !== next.syncMap || prev.contentMap !== next.contentMap) return false;
  if (prev.isHovered !== next.isHovered || prev.isEditing !== next.isEditing || prev.isAbsorb !== next.isAbsorb) return false;
  if ((prev.isHovered || next.isHovered) && prev.isHoverSuppressed !== next.isHoverSuppressed) return false;
  if (prev.draggedIds !== next.draggedIds && (
    hasAnyCardId(prev.stack.cardIds, prev.draggedIds) || hasAnyCardId(next.stack.cardIds, next.draggedIds)
  )) return false;
  if (selectionChangedForStack(next.stack.cardIds, prev.selection, next.selection)) return false;
  if (prev.highlightCard !== next.highlightCard && (
    containsCardId(next.stack.cardIds, prev.highlightCard) || containsCardId(next.stack.cardIds, next.highlightCard)
  )) return false;
  return true;
});

/* ── Desktop component ─────────────────────────────────── */
export function Desktop({
  files, syncMap, contentMap, cardSyncState,
  syncing, canSync, isConnected, lastSyncLabel,
  onSync, onSyncSelected, onOpenCard, onCanvasControlsChange, onOpenSettings,
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
  const draggedSet = useMemo(() => (
    drag?.ids?.length ? new Set(drag.ids) : EMPTY_ID_SET
  ), [drag?.ids]);
  const stackList = useMemo(() => Object.values(stacks), [stacks]);
  const heroWorldAnchor = useMemo(() => {
    const b = heroAnchor ? null : stackBounds(stacks);
    return {
      x: heroAnchor?.x ?? (b ? (b.minX + b.maxX) / 2 : 0),
      y: heroAnchor?.y ?? (b ? (b.minY + b.maxY) / 2 : 0),
    };
  }, [heroAnchor, stacks]);
  const heroScreenX = useTransform([cameraX, cameraScale], ([x, scale]) => x + heroWorldAnchor.x * scale);
  const heroScreenY = useTransform([cameraY, cameraScale], ([y, scale]) => y + heroWorldAnchor.y * scale);
  const selectionRef = useRef(selection);
  const dragRef = useRef(drag);
  const sDragRef = useRef(sDrag);
  const dragFrameRef = useRef(null);
  const stacksRef = useRef(stacks);
  useEffect(() => { stacksRef.current = stacks; });
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  useEffect(() => { sDragRef.current = sDrag; }, [sDrag]);
  useEffect(() => () => {
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
  }, []);

  const publishDragFrame = useCallback((nextDrag) => {
    dragRef.current = nextDrag;
    if (dragFrameRef.current) return;
    dragFrameRef.current = requestAnimationFrame(() => {
      dragFrameRef.current = null;
      setDrag(dragRef.current);
    });
  }, []);

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
    const currentSelection = selectionRef.current;
    const selectedIds = currentSelection.has(cardId) ? Array.from(currentSelection) : [];
    const ids = selectedIds.length > 0
      ? [cardId, ...selectedIds.filter((id) => id !== cardId)]
      : [cardId];
    const nextDrag = {
      ids,
      anchorId: cardId,
      offsets: Object.fromEntries(ids.map((id, index) => [id, groupDragOffset(index)])),
      grab: { dx: cursor.wx - wx, dy: cursor.wy - wy },
      worldX: wx, worldY: wy, absorbId: null, moved: false,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  }, [screenToWorld]);

  /* Stack handle drag start. Title click is reserved for naming the pile. */
  const onStackHandleDown = useCallback((e, stackId) => {
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    setEditingStackId(null);
    const nextSDrag = { stackId, lx: e.clientX, ly: e.clientY };
    sDragRef.current = nextSDrag;
    setSDrag(nextSDrag);
  }, []);

  const renameStack = useCallback((id, name) => {
    const normalizedName = String(name || '').trim() || null;
    setStacks(prev => (
      prev[id] ? { ...prev, [id]: { ...prev[id], name: normalizedName } } : prev
    ));
  }, []);

  const openCardInStack = useCallback((cardId) => {
    const stack = Object.values(stacksRef.current).find((candidate) => (
      candidate.cardIds?.includes(cardId)
    ));
    if (!stack) {
      onOpenCard?.(cardId);
      return;
    }
    onOpenCard?.(cardId, {
      paths: stack.cardIds || [cardId],
      name: stack.name || '',
      onRename: (nextName) => renameStack(stack.id, nextName),
    });
  }, [onOpenCard, renameStack]);

  const hasActiveDrag = Boolean(drag || sDrag);

  /* Global move / up */
  useEffect(() => {
    if (!hasActiveDrag) return;
    const onMove = (e) => {
      const activeSDrag = sDragRef.current;
      const activeDrag = dragRef.current;
      if (activeSDrag) {
        const s = cameraScale.get();
        const dx = (e.clientX - activeSDrag.lx) / s;
        const dy = (e.clientY - activeSDrag.ly) / s;
        setStacks(prev => {
          const st = prev[activeSDrag.stackId];
          return st ? { ...prev, [activeSDrag.stackId]: { ...st, x: st.x + dx, y: st.y + dy } } : prev;
        });
        const nextSDrag = { ...activeSDrag, lx: e.clientX, ly: e.clientY };
        sDragRef.current = nextSDrag;
        setSDrag(nextSDrag);
        return;
      }
      if (activeDrag) {
        const { wx, wy } = screenToWorld(e.clientX, e.clientY);
        const newX = wx - activeDrag.grab.dx;
        const newY = wy - activeDrag.grab.dy;
        let absorbId = null;
        for (const st of Object.values(stacksRef.current)) {
          if (activeDrag.ids.every(id => st.cardIds.includes(id))) continue;
          if (wx >= st.x - 20 && wx <= st.x + ABSORB_W && wy >= st.y + HEADER_H - 10 && wy <= st.y + HEADER_H + ABSORB_H) {
            absorbId = st.id; break;
          }
        }
        publishDragFrame({ ...activeDrag, worldX: newX, worldY: newY, absorbId, moved: true });
      }
    };
    const onUp = () => {
      const activeSDrag = sDragRef.current;
      const activeDrag = dragRef.current;
      if (activeSDrag) {
        sDragRef.current = null;
        setSDrag(null);
        return;
      }
      if (!activeDrag) return;
      if (!activeDrag.moved) {
        openCardInStack(activeDrag.ids[0]);
        if (dragFrameRef.current) {
          cancelAnimationFrame(dragFrameRef.current);
          dragFrameRef.current = null;
        }
        dragRef.current = null;
        setDrag(null);
        return;
      }
      const { ids, worldX, worldY, absorbId } = activeDrag;
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
      if (dragFrameRef.current) {
        cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [hasActiveDrag, screenToWorld, cameraScale, openCardInStack, publishDragFrame]);

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
      setSelection((prev) => (setEquals(prev, hits) ? prev : hits));
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

  const fitAll = useCallback(() => {
    const b = stackBounds(stacks);
    if (b) fitTo(b, { padding: 80 });
  }, [stacks, fitTo]);

  const toggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) {
        setSelection(new Set());
        setMarquee(null);
      } else {
        setSyncOpen(true);
      }
      return !prev;
    });
  }, []);

  const handleStackHoverChange = useCallback((stackId, hovered) => {
    setHoverStackId((prev) => {
      if (hovered) return stackId;
      return prev === stackId ? null : prev;
    });
  }, []);

  const closeTreePanel = useCallback(() => setTreeOpen(false), []);
  const closeSyncPanel = useCallback(() => setSyncOpen(false), []);
  const startSelecting = useCallback(() => {
    setSelectMode(true);
    setSyncOpen(true);
  }, []);

  const canvasControls = useMemo(() => ({
    treeOpen,
    syncOpen,
    selectMode,
    selectionCount: selection.size,
    syncing,
    actions: {
      toggleTree: () => setTreeOpen((value) => !value),
      toggleSync: () => setSyncOpen((value) => !value),
      toggleSelect: toggleSelectMode,
      fitAll,
    },
  }), [fitAll, selectMode, selection.size, syncOpen, syncing, toggleSelectMode, treeOpen]);

  useEffect(() => {
    onCanvasControlsChange?.(canvasControls);
  }, [canvasControls, onCanvasControlsChange]);

  useEffect(() => () => onCanvasControlsChange?.(null), [onCanvasControlsChange]);

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
        highlightTimer.current = setTimeout(() => { openCardInStack(relPath); setHighlightCard(null); }, 700);
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

    if (!found) openCardInStack(relPath);
  }, [cameraX, cameraY, cameraScale, openCardInStack]);

  /* ── Render ── */
  return (
    <div className="desktop">
      <div className="desktop__tooldock" data-no-pan aria-label="Canvas tools">
        <button
          type="button"
          className={`desktop__toolbtn ${selectMode ? 'is-active' : ''}`}
          onClick={toggleSelectMode}
          title="Select mode (drag to select cards, Esc to exit)"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M1 1h4v4H1zM8 1h4v4H8zM1 8h4v4H1zM8 8h4v4H8z" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
          </svg>
          <span>{selection.size > 0 ? `${selection.size} selected` : 'Select'}</span>
        </button>
        <button type="button" className="desktop__toolbtn" onClick={fitAll} title="Fit all cards">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M1 4V1h3M9 1h3v3M12 9v3H9M4 12H1V9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Fit</span>
        </button>
      </div>

      <div className="desktop__stage" ref={stageRef}>
        <motion.div
          className={`desktop__hero-overlay ${isConnected ? 'is-connected' : 'is-local'}`}
          style={{ x: heroScreenX, y: heroScreenY, scale: cameraScale }}
          data-no-pan
        >
          <div className="desktop__hero-overlay-inner">
            {isConnected ? (
              <EchoStatusTrio />
            ) : (
              <EchoMemoryGuide onConnect={onOpenSettings} />
            )}
          </div>
        </motion.div>

        <motion.div className="desktop__world" style={{ x: cameraX, y: cameraY, scale: cameraScale, transformOrigin: '0 0' }}>
          {stackList.map((stack) => (
            <StackView
              key={stack.id}
              stack={stack}
              fileMap={fileMap}
              syncMap={syncMap}
              contentMap={contentMap}
              draggedIds={draggedSet}
              selection={selection}
              highlightCard={highlightCard}
              isHovered={hoverStackId === stack.id}
              isHoverSuppressed={hasActiveDrag}
              isEditing={editingStackId === stack.id}
              isAbsorb={drag?.absorbId === stack.id}
              onHoverChange={handleStackHoverChange}
              onStackHandleDown={onStackHandleDown}
              onCardDown={onCardDown}
              renameStack={renameStack}
              setEditingStackId={setEditingStackId}
            />
          ))}

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

      <TreePanel files={files} syncMap={syncMap} onOpenFile={locateAndOpen} isOpen={treeOpen} onClose={closeTreePanel} />

      {/* Right panel: selection workflow while selecting, otherwise SyncConsole */}
      {(selectMode || selection.size > 0) ? (
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
            {selection.size > 0
              ? 'Drag selected cards into a pile, or sync this small group when it looks right.'
              : 'Drag on the canvas to select a small group of markdown cards.'}
          </div>
          <div className="select-panel__list">
            {Array.from(selection).map(cardId => {
              const file = fileMap[cardId];
              if (!file) return null;
              const name = file.fileName || cardId.split('/').pop();
              const parsed = parseCardName(name);
              const risk = classify(file, syncMap?.[cardId]);
              const preview = previewMarkdown(contentFor(contentMap, cardId));
              return (
                <div
                  key={cardId}
                  className={`select-panel__item select-panel__item--${risk}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenCard?.(cardId, { paths: Array.from(selection), name: 'Selected memories' })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenCard?.(cardId, { paths: Array.from(selection), name: 'Selected memories' });
                    }
                  }}
                  title="Open preview"
                >
                  <span className="select-panel__item-name">{parsed.topic || parsed.date || name}</span>
                  <button type="button" className="select-panel__item-remove" onClick={(e) => { e.stopPropagation(); setSelection(prev => { const next = new Set(prev); next.delete(cardId); return next; }); }} title="Deselect">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  </button>
                  <div className={`select-panel__preview select-panel__preview--${risk}`} aria-hidden="true">
                    <div className="select-panel__preview-title">{parsed.topic || parsed.date || name}</div>
                    <div className="select-panel__preview-path">{file.relativePath}</div>
                    <p>{preview}</p>
                    <span>Click to open reading panel</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="select-panel__actions">
            <button
              type="button"
              className="select-panel__btn select-panel__btn--sync"
              onClick={async () => {
                if (!onSyncSelected || selection.size === 0) return;
                await onSyncSelected(Array.from(selection));
                setSelection(new Set());
                setSelectMode(false);
              }}
              disabled={!canSync || syncing || selection.size === 0}
            >
              {syncing ? 'Syncing...' : (selection.size > 0 ? `Sync ${selection.size}` : 'Select files')}
            </button>
            <button type="button" className="select-panel__btn select-panel__btn--clear" onClick={() => { setSelection(new Set()); setSelectMode(false); }}>
              {selection.size > 0 ? 'Clear' : 'Exit'}
            </button>
          </div>
        </motion.aside>
      ) : (
        <SyncConsole readyItems={buckets.ready} privateCount={buckets.private.length} syncedCount={buckets.synced.length} syncing={syncing} syncStateByPath={cardSyncState} lastSyncLabel={lastSyncLabel} canSync={canSync} onSync={onSync} onStartSelecting={startSelecting} isConnected={isConnected} isOpen={syncOpen} onClose={closeSyncPanel} />
      )}

    </div>
  );
}
