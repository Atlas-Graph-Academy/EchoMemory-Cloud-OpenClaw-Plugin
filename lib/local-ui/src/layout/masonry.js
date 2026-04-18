/**
 * Layout engine — deterministic absolute positioning.
 *
 * Smart clustering is still file-level in Phase 1. Each markdown file remains a
 * single card, but sections are driven by deterministic file-type and markdown
 * structure signals produced by the local scanner.
 */

const GAP = 10;
const SECTION_GAP = 48;
const LABEL_H = 52;

const COL_W = 280;
const W_SM = 200;

const MIN_H = 64;
const MAX_H = 400;

const SECTION_META = {
  identity: { id: 'identity', tier: 1, label: '🟥 IDENTITY', color: '#f87171', order: 0 },
  'long-term': { id: 'long-term', tier: 1, label: '🟧 LONG-TERM', color: '#fb923c', order: 1 },
  journal: { id: 'journal', tier: 1, label: '🟨 JOURNAL / TIMELINE', color: '#facc15', order: 2 },
  goals: { id: 'goals', tier: 1, label: '🟫 GOALS', color: '#c08457', order: 3 },
  technical: { id: 'technical', tier: 2, label: '🟦 TECHNICAL', color: '#60a5fa', order: 4 },
  thematic: { id: 'thematic', tier: 2, label: '🟪 THEMES', color: '#c084fc', order: 5 },
  knowledge: { id: 'knowledge', tier: 2, label: '🟩 KNOWLEDGE', color: '#4ade80', order: 6 },
  system: { id: 'system', tier: 3, label: '⚪ SYSTEM', color: '#a0a8b0', order: 99 },
};

export const SECTIONS = Object.values(SECTION_META).sort((left, right) => left.order - right.order);

export function cardSize(file, contentLen, isSessionLog = false, colW = COL_W) {
  if (file?.isJournalGroup) {
    const baseHeight = file._journalGroupExpanded ? 156 : 128;
    const extraHeight = Math.min(72, Math.max(0, ((file._journalGroupCount || 0) - 1) * 6));
    return { w: colW, h: Math.min(MAX_H, baseHeight + extraHeight) };
  }
  if (isSessionLog) {
    return { w: colW, h: MIN_H };
  }
  const len = contentLen != null ? contentLen : file.sizeBytes;
  const lines = Math.max(3, Math.ceil(len / 60));
  const h = Math.round(Math.max(MIN_H, Math.min(MAX_H, 32 + lines * 13)));
  return { w: colW, h };
}

function signalsOf(file) {
  return file.structureSignals || {};
}

function sectionMeta(sectionKey) {
  return SECTION_META[sectionKey] || SECTION_META.knowledge;
}

function fallbackSectionKey(file) {
  const ft = file.fileType;
  if (ft === 'identity') return 'identity';
  if (ft === 'long-term') return 'long-term';
  if (ft === 'daily' || ft === 'memory') return 'journal';
  if (ft === 'tasks' || ft === 'projects' || ft === 'research' || ft === 'skills') return 'knowledge';
  if (String(ft || '').startsWith('agent:')) return 'system';
  if (ft === 'config' || ft === 'private' || ft === 'other') return 'system';
  return 'knowledge';
}

export function isSessionLog(file, contentMap) {
  if (!contentMap) return false;
  const content = contentMap.get(file.relativePath);
  return content ? /^# Session:/.test(content) : false;
}

function resolveSectionKey(file, contentMap) {
  if (isSessionLog(file, contentMap)) return 'system';
  return file.clusterSectionKey || fallbackSectionKey(file);
}

export function getTier(file, contentMap) {
  return sectionMeta(resolveSectionKey(file, contentMap)).tier;
}

function compareModifiedDesc(left, right) {
  return new Date(right.modifiedTime) - new Date(left.modifiedTime);
}

function compareGroupedOrder(left, right) {
  if (Number.isFinite(left?._groupSortOrder) || Number.isFinite(right?._groupSortOrder)) {
    return (left?._groupSortOrder ?? Number.MAX_SAFE_INTEGER) - (right?._groupSortOrder ?? Number.MAX_SAFE_INTEGER);
  }
  return null;
}

function sortJournal(left, right) {
  const groupedDelta = compareGroupedOrder(left, right);
  if (groupedDelta != null) return groupedDelta;
  if (left.fileType === 'daily' && right.fileType === 'daily') {
    return right.fileName.localeCompare(left.fileName);
  }
  if (left.dominantCluster !== right.dominantCluster) {
    return left.dominantCluster === 'timeline' ? -1 : 1;
  }
  return compareModifiedDesc(left, right);
}

function sortGoals(left, right) {
  const groupedDelta = compareGroupedOrder(left, right);
  if (groupedDelta != null) return groupedDelta;
  return compareModifiedDesc(left, right);
}

function sortTechnical(left, right) {
  const groupedDelta = compareGroupedOrder(left, right);
  if (groupedDelta != null) return groupedDelta;
  return compareModifiedDesc(left, right);
}

function sortThematic(left, right) {
  const groupedDelta = compareGroupedOrder(left, right);
  if (groupedDelta != null) return groupedDelta;
  return compareModifiedDesc(left, right);
}

function sortIdentity(left, right) {
  const groupedDelta = compareGroupedOrder(left, right);
  if (groupedDelta != null) return groupedDelta;
  const identityOrder = ['SOUL.md', 'USER.md', 'IDENTITY.md'];
  const leftIndex = identityOrder.indexOf(left.fileName);
  const rightIndex = identityOrder.indexOf(right.fileName);
  if (leftIndex !== rightIndex) {
    return (leftIndex === -1 ? identityOrder.length : leftIndex) - (rightIndex === -1 ? identityOrder.length : rightIndex);
  }
  return left.fileName.localeCompare(right.fileName);
}

function sortLongTerm(left, right) {
  const groupedDelta = compareGroupedOrder(left, right);
  if (groupedDelta != null) return groupedDelta;
  return compareModifiedDesc(left, right);
}

function sortKnowledge(left, right) {
  const groupedDelta = compareGroupedOrder(left, right);
  if (groupedDelta != null) return groupedDelta;
  return compareModifiedDesc(left, right);
}

function sortSystem(left, right) {
  const groupedDelta = compareGroupedOrder(left, right);
  if (groupedDelta != null) return groupedDelta;
  return compareModifiedDesc(left, right);
}

function sortSection(sectionKey, items) {
  const next = [...items];
  if (sectionKey === 'identity') return next.sort(sortIdentity);
  if (sectionKey === 'long-term') return next.sort(sortLongTerm);
  if (sectionKey === 'journal') return next.sort(sortJournal);
  if (sectionKey === 'goals') return next.sort(sortGoals);
  if (sectionKey === 'technical') return next.sort(sortTechnical);
  if (sectionKey === 'thematic') return next.sort(sortThematic);
  if (sectionKey === 'system') return next.sort(sortSystem);
  return next.sort(sortKnowledge);
}

function countVisibleFiles(items) {
  return items.reduce((total, item) => total + (Number.isFinite(item?._visibleCount) ? item._visibleCount : 1), 0);
}

function masonryPack(items, maxWidth, minColWidth, contentMap) {
  if (!items.length) return { positions: [], w: 0, h: 0 };

  const nCols = Math.max(1, Math.floor((maxWidth + GAP) / (minColWidth + GAP)));
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

export function computeLayout(files, _vpWidth = 1400, contentMap = null) {
  const visibleGroups = new Map();
  const systemFiles = [];

  for (const file of files) {
    const sectionKey = resolveSectionKey(file, contentMap);
    const meta = sectionMeta(sectionKey);
    const sessionLog = isSessionLog(file, contentMap);
    const enriched = {
      ...file,
      _tier: meta.tier,
      _isSessionLog: sessionLog,
      _clusterSectionKey: sectionKey,
    };

    if (sectionKey === 'system') {
      systemFiles.push(enriched);
      continue;
    }

    if (!visibleGroups.has(sectionKey)) visibleGroups.set(sectionKey, []);
    visibleGroups.get(sectionKey).push(enriched);
  }

  const orderedSections = SECTIONS
    .filter((section) => section.id !== 'system')
    .filter((section) => (visibleGroups.get(section.id) || []).length > 0);

  const visibleFiles = orderedSections.flatMap((section) => sortSection(section.id, visibleGroups.get(section.id) || []));
  let totalArea = 0;
  for (const file of visibleFiles) {
    const contentLen = contentMap ? contentMap.get(file.relativePath)?.length : undefined;
    const { w, h } = cardSize(file, contentLen, file._isSessionLog || false, COL_W);
    totalArea += (w + GAP) * (h + GAP);
  }

  const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vpAspect = _vpWidth / vpH;
  const canvasW = Math.max(_vpWidth, Math.round(Math.sqrt(Math.max(totalArea, 1) * 1.1 * vpAspect)));

  const cards = [];
  const sections = [];
  let yOffset = 0;
  let maxW = Math.max(_vpWidth, 800);
  let visibleFileCount = 0;

  for (const section of orderedSections) {
    const sectionItems = sortSection(section.id, visibleGroups.get(section.id) || []);
    const packed = masonryPack(sectionItems, canvasW, COL_W, contentMap);
    for (const position of packed.positions) position.y += yOffset;
    cards.push(...packed.positions);
    sections.push({
      ...section,
      x: 0,
      y: yOffset,
      w: packed.w,
      h: packed.h,
      count: countVisibleFiles(sectionItems),
    });
    visibleFileCount += countVisibleFiles(sectionItems);
    maxW = Math.max(maxW, packed.w || 0);
    yOffset += packed.h + SECTION_GAP;
  }

  const totalH = orderedSections.length > 0 ? Math.max(yOffset - SECTION_GAP, 200) : 200;

  return {
    cards,
    sections,
    bounds: { w: maxW, h: totalH },
    systemFileCount: countVisibleFiles(systemFiles),
    systemFiles: sortSection('system', systemFiles),
    visibleFileCount,
    visibleCardCount: cards.length,
    visibleSectionCount: orderedSections.length,
  };
}

// === Risk-banded canvas layout =============================================
// Replaces cluster groupings (IDENTITY / JOURNAL / TECHNICAL / ...) with the
// privacy/risk axis the user actually decides on:
//   1. KEEP PRIVATE   — SECRET (real credentials) + PRIVATE (path convention)
//   2. READY TO SHARE — SAFE files in the memory dir, not yet synced
//   3. ALREADY SHARED — synced files
//   4. OTHER          — workspace files outside the sync target
//
// Sections are collapsible. When a section id is in `collapsedSet`, the band
// renders as a header strip only (no cards), saving vertical space.

const RISK_SECTION_META = {
  'keep-private': {
    id: 'keep-private',
    tier: 1,
    label: '🛡️ KEEP PRIVATE',
    color: '#e63946',
    order: 0,
  },
  'ready-to-share': {
    id: 'ready-to-share',
    tier: 1,
    label: '✨ READY TO SHARE',
    color: '#22c55e',
    order: 1,
  },
  'already-shared': {
    id: 'already-shared',
    tier: 2,
    label: '✓ ALREADY SHARED',
    color: '#3b82f6',
    order: 2,
  },
  'other': {
    id: 'other',
    tier: 3,
    label: '⋯ OTHER WORKSPACE FILES',
    color: '#94a3b8',
    order: 3,
  },
};

export const RISK_SECTIONS = Object.values(RISK_SECTION_META).sort(
  (a, b) => a.order - b.order,
);

function classifyByRisk(file, syncStatus) {
  if (file?.riskLevel === 'secret') return 'keep-private';
  if (file?.riskLevel === 'private' || file?.privacyLevel === 'private') return 'keep-private';
  if (syncStatus === 'synced') return 'already-shared';
  if (syncStatus === 'local') return 'other';
  return 'ready-to-share';
}

function compareRiskWithin(a, b) {
  // Within a band, secret > private > everything else, then newest first.
  const tierWeight = { secret: 0, private: 1, safe: 2, other: 3 };
  const wa = tierWeight[a?.riskLevel] ?? 4;
  const wb = tierWeight[b?.riskLevel] ?? 4;
  if (wa !== wb) return wa - wb;
  return new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0);
}

export function computeRiskLayout(
  files,
  syncMap = {},
  selectablePaths = null,
  vpWidth = 1400,
  contentMap = null,
  collapsedSet = new Set(),
) {
  const buckets = new Map();
  for (const def of RISK_SECTIONS) buckets.set(def.id, []);

  for (const file of files || []) {
    if (!file?.relativePath) continue;
    const syncStatus = syncMap?.[file.relativePath] || null;
    const sectionKey = classifyByRisk(file, syncStatus);
    const sessionLog = isSessionLog(file, contentMap);
    buckets.get(sectionKey).push({
      ...file,
      _tier: RISK_SECTION_META[sectionKey].tier,
      _isSessionLog: sessionLog,
      _clusterSectionKey: sectionKey,
    });
  }

  // Drop empty bands so we don't waste a header strip on them.
  const orderedSections = RISK_SECTIONS.filter(
    (section) => (buckets.get(section.id) || []).length > 0,
  );

  // Estimate canvas width using the same area-based heuristic as the cluster
  // layout, but only counting cards from non-collapsed sections.
  const visibleFilesForSizing = orderedSections
    .filter((section) => !collapsedSet.has(section.id))
    .flatMap((section) => buckets.get(section.id) || []);
  let totalArea = 0;
  for (const file of visibleFilesForSizing) {
    const contentLen = contentMap ? contentMap.get(file.relativePath)?.length : undefined;
    const { w, h } = cardSize(file, contentLen, file._isSessionLog || false, COL_W);
    totalArea += (w + GAP) * (h + GAP);
  }
  const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vpAspect = vpWidth / vpH;
  const canvasW = Math.max(
    vpWidth,
    Math.round(Math.sqrt(Math.max(totalArea, 1) * 1.1 * vpAspect)),
  );

  const cards = [];
  const sections = [];
  let yOffset = 0;
  let maxW = Math.max(vpWidth, 800);
  let visibleFileCount = 0;

  for (const section of orderedSections) {
    const items = (buckets.get(section.id) || []).slice().sort(compareRiskWithin);
    const collapsed = collapsedSet.has(section.id);
    const eligibleItems =
      section.id === 'ready-to-share' && selectablePaths
        ? items.filter((file) => selectablePaths.has(file.relativePath))
        : null;
    const sectionMetaPlus = {
      ...section,
      collapsed,
      // CTA payload is consumed by Viewport. The actual click handler is
      // attached upstream (App.jsx) by reading `eligibleRelativePaths`.
      cta:
        section.id === 'ready-to-share' && eligibleItems && eligibleItems.length > 0
          ? {
              kind: 'send-all',
              count: eligibleItems.length,
              eligibleRelativePaths: eligibleItems.map((f) => f.relativePath),
            }
          : null,
    };

    if (collapsed) {
      // Header-only strip: card area collapses to LABEL_H. No card positions.
      sections.push({
        ...sectionMetaPlus,
        x: 0,
        y: yOffset,
        w: canvasW,
        h: LABEL_H,
        count: items.length,
      });
      visibleFileCount += 0;
      maxW = Math.max(maxW, canvasW);
      yOffset += LABEL_H + SECTION_GAP;
      continue;
    }

    const packed = masonryPack(items, canvasW, COL_W, contentMap);
    for (const position of packed.positions) position.y += yOffset;
    cards.push(...packed.positions);
    sections.push({
      ...sectionMetaPlus,
      x: 0,
      y: yOffset,
      w: packed.w,
      h: packed.h,
      count: items.length,
    });
    visibleFileCount += items.length;
    maxW = Math.max(maxW, packed.w || 0);
    yOffset += packed.h + SECTION_GAP;
  }

  const totalH = orderedSections.length > 0 ? Math.max(yOffset - SECTION_GAP, 200) : 200;

  return {
    cards,
    sections,
    bounds: { w: maxW, h: totalH },
    // No "system files" subset in risk mode — everything lives in one of the
    // four bands. Keep the keys present so callers don't crash.
    systemFileCount: 0,
    systemFiles: [],
    visibleFileCount,
    visibleCardCount: cards.length,
    visibleSectionCount: orderedSections.length,
  };
}

export function computeSystemLayout(systemFiles, _vpWidth = 1400, contentMap = null) {
  if (!systemFiles.length) {
    return { cards: [], sections: [], bounds: { w: 800, h: 200 }, systemFileCount: 0, systemFiles: [] };
  }

  const groups = {};
  for (const file of systemFiles) {
    const key = file.fileType || file.baseClass || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(file);
  }

  const sortedKeys = Object.keys(groups).sort((left, right) => groups[right].length - groups[left].length);

  const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vpAspect = _vpWidth / vpH;
  let totalArea = 0;
  for (const file of systemFiles) {
    const contentLen = contentMap ? contentMap.get(file.relativePath)?.length : undefined;
    const { w, h } = cardSize(file, contentLen, file._isSessionLog || false, W_SM);
    totalArea += (w + GAP) * (h + GAP);
  }
  const canvasW = Math.max(_vpWidth, Math.round(Math.sqrt(Math.max(totalArea, 1) * 1.1 * vpAspect)));

  const allCards = [];
  const allSections = [];
  let yOffset = 0;
  const GROUP_COLORS = ['#9ca3af', '#8b95a5', '#a0a8b0', '#95909a', '#88909c'];

  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    const items = sortSection('system', groups[key]);
    const packed = masonryPack(items, canvasW, W_SM, contentMap);
    for (const position of packed.positions) position.y += yOffset;
    allCards.push(...packed.positions);
    allSections.push({
      id: `sys-${key}`,
      tier: 3,
      label: `⚪ ${String(key).toUpperCase()}`,
      color: GROUP_COLORS[i % GROUP_COLORS.length],
      x: 0,
      y: yOffset,
      w: packed.w,
      h: packed.h,
      count: items.length,
    });
    yOffset += packed.h + SECTION_GAP;
  }

  const maxW = Math.max(...allSections.map((section) => section.w), 800);
  return {
    cards: allCards,
    sections: allSections,
    bounds: { w: maxW, h: Math.max(yOffset - SECTION_GAP, 200) },
    systemFileCount: countVisibleFiles(systemFiles),
    systemFiles,
    visibleCardCount: allCards.length,
    visibleFileCount: countVisibleFiles(systemFiles),
  };
}
