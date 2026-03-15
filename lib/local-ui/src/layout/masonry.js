/**
 * Layout engine — deterministic absolute positioning.
 *
 * Content-aware: card height scales with actual markdown content length.
 * Canvas width matches viewport aspect ratio so cards fill the screen.
 *
 * Layout order (top to bottom):
 *
 *   ┌────────────────────────────────────┐
 *   │         MEMORIES (Tier 1)          │  ← dailies, MEMORY.md, research, identity
 *   ├────────────────────────────────────┤
 *   │         KNOWLEDGE (Tier 2)         │  ← tasks, projects, agent defs
 *   └────────────────────────────────────┘
 *
 *   Tier 3 (System) is hidden — accessible via footer toggle.
 */

const GAP = 10;
const SECTION_GAP = 32;
const LABEL_H = 36;

// ── Card sizing ──────────────────────────────────────────

const COL_W = 280;    // minimum column width; actual width stretches to fill
const W_SM = 200;     // system view compact cards

const MIN_H = 64;
const MAX_H = 400;

/**
 * Compute card height from content length. Width is determined by the packer.
 */
export function cardSize(file, contentLen, isSessionLog = false, colW = COL_W) {
  if (isSessionLog) {
    return { w: colW, h: MIN_H };
  }
  const b = file.sizeBytes;
  const len = contentLen != null ? contentLen : b;
  const lines = Math.max(3, Math.ceil(len / 60));
  const h = Math.round(Math.max(MIN_H, Math.min(MAX_H, 32 + lines * 13)));
  return { w: colW, h };
}

// ── Tier classification ──────────────────────────────────
//
// Tier 1 — "Memories": daily, long-term, memory/*, research, identity
// Tier 2 — "Knowledge": tasks, projects, agent defs, CARRY, WORKFLOW
// Tier 3 — "System": everything else (hidden by default)

export function getTier(f, contentMap) {
  if (contentMap) {
    const content = contentMap.get(f.relativePath);
    if (content && /^# Session:/.test(content)) return 3;
  }
  const ft = f.fileType;
  const rp = f.relativePath;
  // Tier 1
  if (ft === 'daily' || ft === 'long-term' || ft === 'memory') return 1;
  if (rp.startsWith('workspace/memory/')) return 1;
  if (ft === 'research') return 1;
  if (ft === 'identity') return 1;
  // Tier 2
  if (ft === 'tasks' || ft === 'projects') return 2;
  if (ft === 'agents') return 2;
  if (f.fileName === 'CARRY.md' || f.fileName === 'WORKFLOW.md') return 2;
  // Tier 3
  return 3;
}

export function isSessionLog(f, contentMap) {
  if (!contentMap) return false;
  const content = contentMap.get(f.relativePath);
  return content ? /^# Session:/.test(content) : false;
}

// ── Sort ─────────────────────────────────────────────────

function sortT1(a, b) {
  const ad = a.fileType === 'daily' ? 0 : 1;
  const bd = b.fileType === 'daily' ? 0 : 1;
  if (ad !== bd) return ad - bd;
  if (ad === 0) return b.fileName.localeCompare(a.fileName);
  return new Date(b.modifiedTime) - new Date(a.modifiedTime);
}
const sortT2 = (a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime);
const sortT3 = (a, b) => a.fileName.localeCompare(b.fileName);

// ── Masonry packer ───────────────────────────────────────
// Cards stretch to fill the full available width. No dead space.

function masonryPack(items, maxWidth, minColWidth, contentMap) {
  if (!items.length) return { positions: [], w: 0, h: 0 };

  const nCols = Math.max(1, Math.floor((maxWidth + GAP) / (minColWidth + GAP)));
  // Stretch card width to fill exactly
  const actualColW = (maxWidth - (nCols - 1) * GAP) / nCols;
  const colH = new Array(nCols).fill(0);
  const positions = [];

  for (const item of items) {
    const contentLen = contentMap ? contentMap.get(item.relativePath)?.length : undefined;
    const itemIsLog = item._isSessionLog || false;
    const { h } = cardSize(item, contentLen, itemIsLog, actualColW);

    let col = 0;
    for (let c = 1; c < nCols; c++) {
      if (colH[c] < colH[col]) col = c;
    }

    positions.push({
      key: item.relativePath,
      x: Math.round(col * (actualColW + GAP)),
      y: LABEL_H + colH[col],
      w: Math.round(actualColW),
      h,
      file: item,
    });
    colH[col] += h + GAP;
  }

  const usedW = Math.round(nCols * (actualColW + GAP) - GAP);
  const usedH = LABEL_H + Math.max(...colH, 0);
  return { positions, w: usedW, h: usedH };
}

// ── Section definitions ──────────────────────────────────

export const SECTIONS = [
  { id: 'memories',  tier: 1, label: '🟣 MEMORIES',  color: '#a78bfa' },
  { id: 'knowledge', tier: 2, label: '🔵 KNOWLEDGE', color: '#60a5fa' },
];

// ── Main layout ──────────────────────────────────────────

export function computeLayout(files, _vpWidth = 1400, contentMap = null) {
  const buckets = { 1: [], 2: [], 3: [] };
  for (const f of files) {
    const tier = f._tier ?? getTier(f, contentMap);
    const sessionLog = f._isSessionLog ?? isSessionLog(f, contentMap);
    buckets[tier].push({ ...f, _tier: tier, _isSessionLog: sessionLog });
  }
  buckets[1].sort(sortT1);
  buckets[2].sort(sortT2);
  buckets[3].sort(sortT3);

  // Canvas width: match viewport aspect ratio so fit-all zoom fills the screen.
  const visibleFiles = [...buckets[1], ...buckets[2]];
  let totalArea = 0;
  for (const f of visibleFiles) {
    const contentLen = contentMap ? contentMap.get(f.relativePath)?.length : undefined;
    const { w, h } = cardSize(f, contentLen, f._isSessionLog || false, COL_W);
    totalArea += (w + GAP) * (h + GAP);
  }
  const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vpAspect = _vpWidth / vpH;
  const canvasW = Math.max(_vpWidth, Math.round(Math.sqrt(totalArea * 1.1 * vpAspect)));

  // Tier 1
  const t1 = masonryPack(buckets[1], canvasW, COL_W, contentMap);

  // Tier 2
  const t2OffY = t1.h + SECTION_GAP;
  const t2 = masonryPack(buckets[2], canvasW, COL_W, contentMap);
  for (const p of t2.positions) p.y += t2OffY;

  const cards = [...t1.positions, ...t2.positions];
  const maxW = Math.max(t1.w, t2.w || 0);
  const totalH = t2OffY + (t2.h || 0);

  const sections = [
    { ...SECTIONS[0], x: 0, y: 0, w: t1.w, h: t1.h, count: buckets[1].length },
  ];
  if (buckets[2].length > 0) {
    sections.push({ ...SECTIONS[1], x: 0, y: t2OffY, w: t2.w, h: t2.h, count: buckets[2].length });
  }

  return {
    cards,
    sections,
    bounds: { w: maxW, h: totalH },
    systemFileCount: buckets[3].length,
    systemFiles: buckets[3],
  };
}

// ── System files layout (separate canvas) ────────────────

export function computeSystemLayout(systemFiles, _vpWidth = 1400, contentMap = null) {
  if (!systemFiles.length) {
    return { cards: [], sections: [], bounds: { w: 800, h: 200 }, systemFileCount: 0, systemFiles: [] };
  }

  const groups = {};
  for (const f of systemFiles) {
    const key = f.fileType || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }

  const sortedKeys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);

  const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vpAspect = _vpWidth / vpH;
  let totalArea = 0;
  for (const f of systemFiles) {
    const contentLen = contentMap ? contentMap.get(f.relativePath)?.length : undefined;
    const { w, h } = cardSize(f, contentLen, f._isSessionLog || false, W_SM);
    totalArea += (w + GAP) * (h + GAP);
  }
  const canvasW = Math.max(_vpWidth, Math.round(Math.sqrt(totalArea * 1.1 * vpAspect)));

  const allCards = [];
  const allSections = [];
  let yOffset = 0;
  const GROUP_COLORS = ['#9ca3af', '#8b95a5', '#a0a8b0', '#95909a', '#88909c'];

  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    const items = groups[key];
    items.sort((a, b) => a.fileName.localeCompare(b.fileName));

    const packed = masonryPack(items, canvasW, W_SM, contentMap);
    for (const p of packed.positions) p.y += yOffset;
    allCards.push(...packed.positions);

    allSections.push({
      id: `sys-${key}`, tier: 3,
      label: `⚪ ${key.toUpperCase()}`,
      color: GROUP_COLORS[i % GROUP_COLORS.length],
      x: 0, y: yOffset, w: packed.w, h: packed.h, count: items.length,
    });
    yOffset += packed.h + SECTION_GAP;
  }

  const maxW = Math.max(...allSections.map(s => s.w), 800);
  return {
    cards: allCards,
    sections: allSections,
    bounds: { w: maxW, h: yOffset },
    systemFileCount: systemFiles.length,
    systemFiles,
  };
}
