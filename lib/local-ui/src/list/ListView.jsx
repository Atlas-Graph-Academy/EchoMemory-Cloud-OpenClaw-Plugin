/**
 * ListView — directory-style default view organized by RISK, not by content cluster.
 *
 * Why this exists: the canvas view shows scale ("look how many memories I have")
 * but is hopeless for the actual task: deciding what to upload. Users need a
 * scannable list where the first thing they see is what's risky and what's safe.
 * Cluster labels (Identity / Journal / Technical / etc) become secondary tags
 * on each row instead of the top-level taxonomy.
 *
 * Section order is intentional and never changes:
 *   1. KEEP PRIVATE  — SECRET (red) + PRIVATE (amber). Top of page, impossible to miss.
 *   2. READY TO SHARE — SAFE files in the sync target dir, not yet synced.
 *   3. ALREADY SHARED — synced files (collapsed by default).
 *   4. OTHER — workspace files outside the sync target (collapsed by default).
 */

import React, { useMemo, useState, useCallback } from 'react';
import './ListView.css';

const SECTION_DEFS = [
  {
    id: 'keep-private',
    title: 'Keep private',
    blurb: 'Real credentials and personal files. These never leave your machine.',
    accent: 'risk',
    defaultCollapsed: false,
  },
  {
    id: 'ready-to-share',
    title: 'Ready to share',
    blurb: 'Safe to upload. Echo will turn these into memories.',
    accent: 'safe',
    defaultCollapsed: false,
  },
  {
    id: 'already-shared',
    title: 'Already shared',
    blurb: 'Echo has already digested these.',
    accent: 'shared',
    defaultCollapsed: true,
  },
  {
    id: 'other',
    title: 'Other workspace files',
    blurb: 'Outside the memory directory — not eligible for sync.',
    accent: 'other',
    defaultCollapsed: true,
  },
];

function classifyForList(file, syncStatus) {
  // SECRET wins all other classifications. A file with a leaked key is a
  // secret first, regardless of what directory it lives in.
  if (file?.riskLevel === 'secret') {
    return { sectionId: 'keep-private', riskTier: 'secret' };
  }
  if (file?.riskLevel === 'private' || file?.privacyLevel === 'private') {
    return { sectionId: 'keep-private', riskTier: 'private' };
  }
  if (syncStatus === 'synced') {
    return { sectionId: 'already-shared', riskTier: 'safe' };
  }
  if (syncStatus === 'local') {
    return { sectionId: 'other', riskTier: 'other' };
  }
  // new / modified / failed / null all map to "ready to share" — they're
  // SAFE files in the memory dir that haven't been pushed to Echo yet.
  return { sectionId: 'ready-to-share', riskTier: 'safe' };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
}

function formatRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffDays = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

function reasonForRow(file, riskTier, syncStatus) {
  if (riskTier === 'secret') {
    return file?.sensitiveSummary || 'contains credentials';
  }
  if (riskTier === 'private') {
    if (file?.privacyAutoUpgraded) return 'sensitive auto-private';
    return 'private path';
  }
  if (syncStatus === 'failed') return 'last sync failed';
  if (syncStatus === 'modified') return 'edited since last sync';
  return '';
}

function clusterLabelFor(file) {
  // Strip the leading emoji/symbols the cluster system puts on labels so
  // they read cleanly in a dense list.
  const raw = file?.clusterLabel || file?._clusterLabel || file?.fileType || '';
  return String(raw).replace(/^[^\w]+/u, '').trim();
}

export function ListView({
  files,
  syncMap,
  selectablePaths,
  selectedPath,
  selectMode,
  syncSelection,
  cardSyncState,
  syncing,
  isConnected,
  onCardClick,
  onCardExpand,
  toggleFileSelection,
  onSendAllSafe,
}) {
  const [collapsed, setCollapsed] = useState(() => {
    const initial = {};
    for (const def of SECTION_DEFS) {
      initial[def.id] = def.defaultCollapsed;
    }
    return initial;
  });
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const buckets = new Map();
    for (const def of SECTION_DEFS) buckets.set(def.id, []);
    const normQuery = query.trim().toLowerCase();

    for (const file of files || []) {
      if (!file?.relativePath) continue;
      if (normQuery) {
        const name = (file.fileName || '').toLowerCase();
        const rel = (file.relativePath || '').toLowerCase();
        if (!name.includes(normQuery) && !rel.includes(normQuery)) continue;
      }
      const syncStatus = syncMap?.[file.relativePath] || null;
      const { sectionId, riskTier } = classifyForList(file, syncStatus);
      buckets.get(sectionId)?.push({ file, syncStatus, riskTier });
    }

    // Within each section, sort by riskTier first (secret > private > safe > other),
    // then by modified time desc.
    const tierWeight = { secret: 0, private: 1, safe: 2, other: 3 };
    for (const items of buckets.values()) {
      items.sort((a, b) => {
        const tierDiff = (tierWeight[a.riskTier] ?? 9) - (tierWeight[b.riskTier] ?? 9);
        if (tierDiff !== 0) return tierDiff;
        const aT = new Date(a.file.modifiedTime || a.file.updatedAt || 0).getTime();
        const bT = new Date(b.file.modifiedTime || b.file.updatedAt || 0).getTime();
        return bT - aT;
      });
    }
    return buckets;
  }, [files, syncMap, query]);

  const toggleSection = useCallback((id) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleRowClick = useCallback(
    (file) => {
      const path = file.relativePath;
      if (!path) return;
      if (selectMode) {
        if (selectablePaths?.has(path)) toggleFileSelection?.(path);
        return;
      }
      onCardExpand?.(path);
    },
    [selectMode, selectablePaths, toggleFileSelection, onCardExpand],
  );

  // All eligible SAFE files that haven't been synced yet — the "Send all"
  // button acts on this set. Keep it stable across renders so the button's
  // enabled state doesn't flicker during SSE updates.
  const readyToSharePaths = useMemo(() => {
    const items = grouped.get('ready-to-share') || [];
    return items
      .map(({ file }) => file.relativePath)
      .filter((p) => selectablePaths?.has(p));
  }, [grouped, selectablePaths]);

  return (
    <div className="lv">
      <div className="lv-toolbar">
        <input
          className="lv-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by filename or path..."
        />
      </div>

      <div className="lv-sections">
        {SECTION_DEFS.map((def) => {
          const items = grouped.get(def.id) || [];
          const isCollapsed = collapsed[def.id];
          const showSendAll =
            def.id === 'ready-to-share' &&
            typeof onSendAllSafe === 'function' &&
            readyToSharePaths.length > 0;
          return (
            <section key={def.id} className={`lv-section lv-section--${def.accent}`}>
              <div className="lv-section__head-row">
                <button
                  type="button"
                  className="lv-section__head"
                  onClick={() => toggleSection(def.id)}
                  aria-expanded={!isCollapsed}
                >
                  <span className="lv-section__chevron">{isCollapsed ? '▸' : '▾'}</span>
                  <span className="lv-section__title">{def.title}</span>
                  <span className="lv-section__count">{items.length}</span>
                  <span className="lv-section__blurb">{def.blurb}</span>
                </button>
                {showSendAll && (
                  <button
                    type="button"
                    className="lv-send-all"
                    disabled={!isConnected || syncing}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSendAllSafe(readyToSharePaths);
                    }}
                    title={
                      !isConnected
                        ? 'Connect to Echo first'
                        : syncing
                          ? 'Sync in progress'
                          : `Upload ${readyToSharePaths.length} file${readyToSharePaths.length === 1 ? '' : 's'} to Echo`
                    }
                  >
                    {syncing
                      ? 'Echo is digesting…'
                      : `Send all ${readyToSharePaths.length} to Echo →`}
                  </button>
                )}
              </div>

              {!isCollapsed && (
                items.length === 0 ? (
                  <div className="lv-empty">No files in this group.</div>
                ) : (
                  <ul className="lv-list">
                    {items.map(({ file, syncStatus, riskTier }) => {
                      const path = file.relativePath;
                      const isSelected = selectedPath === path;
                      const isChecked = syncSelection?.has(path);
                      const cluster = clusterLabelFor(file);
                      const sizeLabel = formatBytes(file.sizeBytes);
                      const dateLabel = formatRelative(file.modifiedTime || file.updatedAt);
                      const reason = reasonForRow(file, riskTier, syncStatus);
                      const displayName = (file.fileName || path).replace(/\.md$/i, '');
                      const digestState = cardSyncState?.[path] || null;
                      const rowClass = [
                        'lv-row',
                        `lv-row--${riskTier}`,
                        digestState ? `lv-row--${digestState}` : '',
                        isSelected ? 'lv-row--selected' : '',
                        isChecked ? 'lv-row--checked' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      // When a row is currently being digested, the "reason"
                      // slot is hijacked to show a live status ("Echo is
                      // reading…") so the user has direct feedback on which
                      // file Echo is chewing on right now.
                      const liveLabel =
                        digestState === 'syncing'
                          ? 'Echo is reading…'
                          : digestState === 'queued'
                            ? 'queued'
                            : digestState === 'done'
                              ? 'digested ✓'
                              : digestState === 'failed'
                                ? 'failed'
                                : null;
                      return (
                        <li key={path}>
                          <button
                            type="button"
                            className={rowClass}
                            onClick={() => handleRowClick(file)}
                            title={path}
                          >
                            <span className="lv-row__risk" aria-hidden="true">
                              {digestState === 'syncing' && (
                                <span className="lv-row__pulse" />
                              )}
                              {!digestState && riskTier === 'secret' && '●'}
                              {!digestState && riskTier === 'private' && '●'}
                              {!digestState && riskTier === 'safe' && '○'}
                              {!digestState && riskTier === 'other' && '·'}
                            </span>
                            <span className="lv-row__name">{displayName}</span>
                            {cluster && <span className="lv-row__cluster">{cluster}</span>}
                            {(liveLabel || reason) && (
                              <span className="lv-row__reason">{liveLabel || reason}</span>
                            )}
                            <span className="lv-row__chip">{sizeLabel}</span>
                            <span className="lv-row__chip">{dateLabel}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
