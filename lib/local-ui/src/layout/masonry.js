/**
 * Layout engine — deterministic absolute positioning.
 *
 * Content-aware: card height scales with actual markdown content length.
 * Long files get exclusive columns; short files share columns.
 *
 * Layout order (top to bottom):
 *
 *   ┌────────────────────────────────────┐
 *   │         MEMORIES (Tier 1)          │  ← dailies + memories, wide horizontal
 *   ├────────────────────────────────────┤
 *   │         PROJECTS (Tier 2)          │  ← project-based knowledge
 *   ├────────────────────────────────────┤
 *   │          SYSTEM (Tier 3)           │  ← config/system files
 *   └────────────────────────────────────┘
 */

const GAP = 8;
const SECTION_GAP = 40;
const LABEL_H = 44;

// ── Card sizing ──────────────────────────────────────────
// Width classes by content size

const W_SM = 200;
const W_MD = 280;
const W_LG = 400;

const MIN_H = 56;
const MAX_H = 800;

// Threshold: files above this content length get exclusive columns
const EXCLUSIVE_THRESHOLD = 5000; // bytes

/**
 * Compute card dimensions from file metadata + content.
 * contentLen: actual string length of markdown content (if available).
 * isSessionLog: if true, use compact sizing (these are de-emphasized).
 */
export function cardSize(file, contentLen, isSessionLog = false) {
  const b = file.sizeBytes;

  if (isSessionLog) {
    // Session logs: compact — fixed small size, don't let them dominate
    return { w: W_SM, h: Math.min(80, MIN_H) };
  }

  // Width by content size
  const w = b < 400 ? W_SM : b < 2500 ? W_MD : W_LG;
  // Height: based on content length if available, else sizeBytes
  const len = contentLen != null ? contentLen : b;
  // Approximate: ~55 chars per line, ~14px per line, capped
  const lines = Math.max(3, Math.ceil(len / 55));
  const h = Math.round(Math.max(MIN_H, Math.min(MAX_H, 32 + lines * 14)));
  return { w, h };
}

// ── Tier classification ──────────────────────────────────

// Session logs: detected by content starting with "# Session:"
// These are raw conversation transcripts — low information density.
// Classified as Tier 3 (system) with a 'session-log' subtype.

export function getTier(f, contentMap) {
  // Check if this is a session log by looking at content
  if (contentMap) {
    const content = contentMap.get(f.relativePath);
    if (content && /^# Session:/.test(content)) return 3;
  }

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

/**
 * Detect if a file is a session log (raw conversation transcript).
 * Used for visual treatment — dimmed, compact rendering.
 */
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
  if (ad === 0) return b.fileName.localeCompare(a.fileName); // newest first
  return new Date(b.modifiedTime) - new Date(a.modifiedTime);
}
const sortT2 = (a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime);
const sortT3 = (a, b) => a.fileName.localeCompare(b.fileName);

// ── Content-aware masonry packer ─────────────────────────
// Long files → exclusive column. Short files → shared columns.

function masonryPack(items, maxWidth, defaultColWidth, contentMap) {
  if (!items.length) return { positions: [], w: 0, h: 0 };

  const nCols = Math.max(1, Math.floor((maxWidth + GAP) / (defaultColWidth + GAP)));
  const colH = new Array(nCols).fill(0);
  const colExclusive = new Array(nCols).fill(false); // track exclusive columns
  const positions = [];

  for (const item of items) {
    const contentLen = contentMap ? contentMap.get(item.relativePath)?.length : undefined;
    const itemIsLog = item._isSessionLog || false;
    const { w, h } = cardSize(item, contentLen, itemIsLog);
    const isLong = (!itemIsLog && item.sizeBytes >= EXCLUSIVE_THRESHOLD);

    if (isLong) {
      // Find the shortest column that isn't already exclusive
      let col = -1;
      for (let c = 0; c < nCols; c++) {
        if (!colExclusive[c]) {
          if (col === -1 || colH[c] < colH[col]) col = c;
        }
      }
      // Fallback: if all exclusive, just pick shortest
      if (col === -1) {
        col = 0;
        for (let c = 1; c < nCols; c++) {
          if (colH[c] < colH[col]) col = c;
        }
      }
      positions.push({
        key: item.relativePath,
        x: col * (defaultColWidth + GAP),
        y: LABEL_H + colH[col],
        w: defaultColWidth,
        h,
        file: item,
      });
      colH[col] += h + GAP;
      colExclusive[col] = true; // mark as exclusive
    } else {
      // Short file → find shortest non-exclusive column; if none, find shortest overall
      let col = -1;
      for (let c = 0; c < nCols; c++) {
        if (!colExclusive[c]) {
          if (col === -1 || colH[c] < colH[col]) col = c;
        }
      }
      if (col === -1) {
        col = 0;
        for (let c = 1; c < nCols; c++) {
          if (colH[c] < colH[col]) col = c;
        }
      }
      positions.push({
        key: item.relativePath,
        x: col * (defaultColWidth + GAP),
        y: LABEL_H + colH[col],
        w: defaultColWidth,
        h,
        file: item,
      });
      colH[col] += h + GAP;
    }
  }

  const usedW = nCols * (defaultColWidth + GAP) - GAP;
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
// contentMap: Map<relativePath, contentString> (optional)

export function computeLayout(files, _vpWidth = 1400, contentMap = null) {
  // Bucket & sort — use contentMap for session log detection
  const buckets = { 1: [], 2: [], 3: [] };
  for (const f of files) {
    const tier = f._tier ?? getTier(f, contentMap);
    const sessionLog = f._isSessionLog ?? isSessionLog(f, contentMap);
    buckets[tier].push({ ...f, _tier: tier, _isSessionLog: sessionLog });
  }
  buckets[1].sort(sortT1);
  buckets[2].sort(sortT2);
  buckets[3].sort(sortT3);

  // Calculate total card area → derive canvas width
  const allFiles = [...buckets[1], ...buckets[2], ...buckets[3]];
  let totalArea = 0;
  for (const f of allFiles) {
    const contentLen = contentMap ? contentMap.get(f.relativePath)?.length : undefined;
    const { w, h } = cardSize(f, contentLen, f._isSessionLog || false);
    totalArea += (w + GAP) * (h + GAP);
  }
  const targetArea = totalArea * 1.4;
  const canvasH = Math.sqrt(targetArea / 1.6);
  const canvasW = Math.max(canvasH * 1.6, 1600);

  // All three tiers stacked vertically, full width
  const t1 = masonryPack(buckets[1], canvasW, W_MD, contentMap);

  const t2OffY = t1.h + SECTION_GAP;
  const t2 = masonryPack(buckets[2], canvasW, W_MD, contentMap);
  for (const p of t2.positions) p.y += t2OffY;

  const t3OffY = t2OffY + t2.h + SECTION_GAP;
  const t3 = masonryPack(buckets[3], canvasW, W_SM, contentMap);
  for (const p of t3.positions) p.y += t3OffY;

  const cards = [...t1.positions, ...t2.positions, ...t3.positions];
  const maxW = Math.max(t1.w, t2.w, t3.w);
  const sections = [
    { ...SECTIONS[0], x: 0, y: 0, w: t1.w, h: t1.h, count: buckets[1].length },
    { ...SECTIONS[1], x: 0, y: t2OffY, w: t2.w, h: t2.h, count: buckets[2].length },
    { ...SECTIONS[2], x: 0, y: t3OffY, w: t3.w, h: t3.h, count: buckets[3].length },
  ];
  const bounds = {
    w: maxW,
    h: t3OffY + t3.h,
  };

  return { cards, sections, bounds };
}
