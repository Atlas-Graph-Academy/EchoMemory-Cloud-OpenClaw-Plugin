/**
 * Layout engine — deterministic absolute positioning.
 *
 * Smart clustering is still file-level in Phase 1. Each markdown file remains a
 * single card, but sections are driven by deterministic file-type and markdown
 * structure signals produced by the local scanner.
 */

const GAP = 10;
const SECTION_GAP = 32;
const LABEL_H = 36;

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

function sortJournal(left, right) {
  if (Number.isFinite(left?._journalSortOrder) || Number.isFinite(right?._journalSortOrder)) {
    return (left?._journalSortOrder ?? Number.MAX_SAFE_INTEGER) - (right?._journalSortOrder ?? Number.MAX_SAFE_INTEGER);
  }
  if (left.fileType === 'daily' && right.fileType === 'daily') {
    return right.fileName.localeCompare(left.fileName);
  }
  if (left.dominantCluster !== right.dominantCluster) {
    return left.dominantCluster === 'timeline' ? -1 : 1;
  }
  return compareModifiedDesc(left, right);
}

function sortGoals(left, right) {
  const leftSignals = signalsOf(left);
  const rightSignals = signalsOf(right);
  if ((rightSignals.uncheckedCheckboxCount || 0) !== (leftSignals.uncheckedCheckboxCount || 0)) {
    return (rightSignals.uncheckedCheckboxCount || 0) - (leftSignals.uncheckedCheckboxCount || 0);
  }
  if ((rightSignals.checkboxCount || 0) !== (leftSignals.checkboxCount || 0)) {
    return (rightSignals.checkboxCount || 0) - (leftSignals.checkboxCount || 0);
  }
  return compareModifiedDesc(left, right);
}

function sortTechnical(left, right) {
  const leftSignals = signalsOf(left);
  const rightSignals = signalsOf(right);
  if ((rightSignals.codeBlockCount || 0) !== (leftSignals.codeBlockCount || 0)) {
    return (rightSignals.codeBlockCount || 0) - (leftSignals.codeBlockCount || 0);
  }
  return compareModifiedDesc(left, right);
}

function sortThematic(left, right) {
  const leftSignals = signalsOf(left);
  const rightSignals = signalsOf(right);
  if ((rightSignals.h2Count || 0) !== (leftSignals.h2Count || 0)) {
    return (rightSignals.h2Count || 0) - (leftSignals.h2Count || 0);
  }
  return compareModifiedDesc(left, right);
}

function sortIdentity(left, right) {
  const identityOrder = ['SOUL.md', 'USER.md', 'IDENTITY.md'];
  const leftIndex = identityOrder.indexOf(left.fileName);
  const rightIndex = identityOrder.indexOf(right.fileName);
  if (leftIndex !== rightIndex) {
    return (leftIndex === -1 ? identityOrder.length : leftIndex) - (rightIndex === -1 ? identityOrder.length : rightIndex);
  }
  return left.fileName.localeCompare(right.fileName);
}

function sortLongTerm(left, right) {
  if (left.fileName !== right.fileName) return left.fileName.localeCompare(right.fileName);
  return compareModifiedDesc(left, right);
}

function sortKnowledge(left, right) {
  if (left.clusterConfidence !== right.clusterConfidence) {
    const rank = { high: 0, medium: 1, low: 2 };
    return (rank[left.clusterConfidence] ?? 9) - (rank[right.clusterConfidence] ?? 9);
  }
  return compareModifiedDesc(left, right);
}

function sortSystem(left, right) {
  if (left.fileType !== right.fileType) return String(left.fileType).localeCompare(String(right.fileType));
  return left.fileName.localeCompare(right.fileName);
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
    systemFileCount: sortSection('system', systemFiles).length,
    systemFiles: sortSection('system', systemFiles),
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
    systemFileCount: systemFiles.length,
    systemFiles,
    visibleCardCount: allCards.length,
    visibleFileCount: systemFiles.length,
  };
}
