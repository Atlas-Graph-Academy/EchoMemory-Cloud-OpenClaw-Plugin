/**
 * Layout engine — deterministic absolute positioning.
 *
 * Card sizes are fixed, derived from file metadata (sizeBytes).
 * No DOM measurement needed. Layout is pure math.
 *
 * Three tiers arranged as museum rooms:
 *
 *   ┌───────────────────┬────────────────┐
 *   │                   │                │
 *   │    MEMORIES (T1)  │  PROJECTS (T2) │
 *   │                   │                │
 *   ├───────────────────┴────────────────┤
 *   │                                    │
 *   │         SYSTEM (T3)                │
 *   │                                    │
 *   └────────────────────────────────────┘
 */

const GAP = 6;
const SECTION_GAP = 32;
const LABEL_H = 40;

// ── Card sizing from file metadata ───────────────────────
// Width: 3 classes. Height: proportional to sizeBytes.

const W_SM = 220;
const W_MD = 300;
const W_LG = 380;

const MIN_H = 48;
const MAX_H = 520;

export function cardSize(file) {
  const b = file.sizeBytes;
  // Width by content size
  const w = b < 400 ? W_SM : b < 2500 ? W_MD : W_LG;
  // Height: logarithmic scaling so big files don't dominate
  const h = Math.round(Math.max(MIN_H, Math.min(MAX_H, 40 + Math.log2(b + 1) * 28)));
  return { w, h };
}

// ── Tier classification ──────────────────────────────────

export function getTier(f) {
  const ft = f.fileType;
  if (ft === 'daily' || ft === 'long-term' || ft === 'memory') return 1;
  if (f.relativePath.startsWith('workspace/memory/')) return 1;
  if (ft.startsWith('agent:') && /^\d{4}-\d{2}-\d{2}/.test(f.fileName)) return 1;
  if (ft === 'research' || ft === 'tasks' || ft === 'projects') return 2;
  if (f.fileName === 'CARRY.md' || f.fileName === 'WORKFLOW.md') return 2;
  if (ft === 'agents') return 2;
  if (ft.startsWith('agent:')) return 2;
  return 3;
}

// ── Sort ─────────────────────────────────────────────────

function sortT1(a, b) {
  const ad = a.fileType === 'daily' ? 0 : 1;
  const bd = b.fileType === 'daily' ? 0 : 1;
  if (ad !== bd) return ad - bd;
  if (ad === 0) return a.fileName.localeCompare(b.fileName);
  return new Date(b.modifiedTime) - new Date(a.modifiedTime);
}
const sortT2 = (a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime);
const sortT3 = (a, b) => a.fileName.localeCompare(b.fileName);

// ── Masonry column packer ────────────────────────────────
// Given items with known { w, h }, pack into columns.
// Uses "shortest column" heuristic with uniform column width.

function masonryPack(items, maxWidth, colWidth) {
  if (!items.length) return { positions: [], w: 0, h: 0 };

  const nCols = Math.max(1, Math.floor((maxWidth + GAP) / (colWidth + GAP)));
  const colH = new Array(nCols).fill(0);
  const positions = [];

  for (const item of items) {
    const { w, h } = cardSize(item);
    // Find shortest column
    let col = 0;
    for (let c = 1; c < nCols; c++) {
      if (colH[c] < colH[col]) col = c;
    }
    positions.push({
      key: item.relativePath,
      x: col * (colWidth + GAP),
      y: LABEL_H + colH[col],
      w: colWidth,  // uniform column width for clean grid
      h,
      file: item,
    });
    colH[col] += h + GAP;
  }

  const usedW = nCols * (colWidth + GAP) - GAP;
  const usedH = LABEL_H + Math.max(...colH, 0);
  return { positions, w: usedW, h: usedH };
}

// ── Section definitions ──────────────────────────────────

export const SECTIONS = [
  { id: 'memories', tier: 1, label: '🟣 MEMORIES', color: '#a78bfa' },
  { id: 'projects', tier: 2, label: '🔵 PROJECTS', color: '#60a5fa' },
  { id: 'system',   tier: 3, label: '⚪ SYSTEM',   color: '#9ca3af' },
];

// ── Main layout ──────────────────────────────────────────

export function computeLayout(files, _vpWidth = 1400) {
  // Bucket & sort
  const buckets = { 1: [], 2: [], 3: [] };
  for (const f of files) buckets[f._tier ?? getTier(f)].push(f);
  buckets[1].sort(sortT1);
  buckets[2].sort(sortT2);
  buckets[3].sort(sortT3);

  // Calculate total card area → derive canvas size targeting ~16:10 aspect ratio
  const allFiles = [...buckets[1], ...buckets[2], ...buckets[3]];
  let totalArea = 0;
  for (const f of allFiles) {
    const { w, h } = cardSize(f);
    totalArea += (w + GAP) * (h + GAP);
  }
  // Target aspect 1.6:1 (landscape). Canvas area ≈ totalArea * 1.3 (packing overhead)
  const targetArea = totalArea * 1.35;
  const canvasH = Math.sqrt(targetArea / 1.6);
  const canvasW = canvasH * 1.6;

  // T1 gets 55% of width, T2 gets 45%
  const t1Width = Math.floor(canvasW * 0.55);
  const t2Width = Math.floor(canvasW * 0.45) - SECTION_GAP;

  const t1 = masonryPack(buckets[1], t1Width, W_MD);
  const t2 = masonryPack(buckets[2], t2Width, W_MD);

  const t2OffX = t1Width + SECTION_GAP;
  for (const p of t2.positions) p.x += t2OffX;

  // T3: full width, below
  const t3OffY = Math.max(t1.h, t2.h) + SECTION_GAP;
  const t3 = masonryPack(buckets[3], canvasW, W_SM);
  for (const p of t3.positions) p.y += t3OffY;

  const cards = [...t1.positions, ...t2.positions, ...t3.positions];
  const sections = [
    { ...SECTIONS[0], x: 0, y: 0, w: t1.w, h: t1.h, count: buckets[1].length },
    { ...SECTIONS[1], x: t2OffX, y: 0, w: t2.w, h: t2.h, count: buckets[2].length },
    { ...SECTIONS[2], x: 0, y: t3OffY, w: t3.w, h: t3.h, count: buckets[3].length },
  ];
  const bounds = {
    w: Math.max(t1.w + SECTION_GAP + t2.w, t3.w),
    h: t3OffY + t3.h,
  };

  return { cards, sections, bounds };
}
