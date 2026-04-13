/**
 * SelectionDrawer — side panel for bulk file selection.
 *
 * Why this exists: picking files on the spatial canvas is hopeless at the
 * zoom levels where you can actually see all 236 cards — click targets
 * shrink to pixels and the checkbox UI only renders at LOD 2. Selection is
 * a flat-list operation; give it a flat list.
 */

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import './SelectionDrawer.css';

const STATUS_PILL_CONFIG = {
  new: { label: 'NEW', cls: 'pill-new' },
  modified: { label: 'EDIT', cls: 'pill-mod' },
  failed: { label: 'FAIL', cls: 'pill-failed' },
  synced: { label: 'SYNC', cls: 'pill-synced' },
  local: { label: 'LOCAL', cls: 'pill-local' },
  sealed: { label: 'SEAL', cls: 'pill-sealed' },
};

const FILTER_DEFS = [
  { id: 'pending', label: 'Pending', match: (s) => s === 'new' || s === 'modified' || s === 'failed' },
  { id: 'all', label: 'All', match: () => true },
  { id: 'synced', label: 'Synced', match: (s) => s === 'synced' },
  { id: 'failed', label: 'Failed', match: (s) => s === 'failed' },
  { id: 'sensitive', label: 'Sensitive', match: (_s, file) => !!file?.hasSensitiveContent },
];

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
}

function formatRelativeDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor(diffMs / day);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

function stripSectionEmoji(label) {
  if (!label) return '';
  return label.replace(/^[^\w]+/u, '').trim();
}

function totalBytesOf(paths, fileByPath) {
  let total = 0;
  for (const path of paths) {
    const file = fileByPath.get(path);
    if (Number.isFinite(file?.sizeBytes)) total += file.sizeBytes;
  }
  return total;
}

export function SelectionDrawer({
  open,
  onClose,
  cards,
  sections,
  syncMap,
  selectablePaths,
  syncSelection,
  setSyncSelection,
  toggleFileSelection,
  syncing,
  isConnected,
  onSync,
}) {
  const [filterId, setFilterId] = useState('pending');
  const [query, setQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState(() => new Set());
  const searchRef = useRef(null);

  // Focus search when drawer opens — keyboard users should be able to type
  // immediately without hunting for the input.
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => searchRef.current?.focus(), 120);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  // ESC closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const fileByPath = useMemo(() => {
    const map = new Map();
    for (const card of cards || []) {
      if (card?.key && card.file) map.set(card.key, card.file);
    }
    return map;
  }, [cards]);

  const sectionMetaById = useMemo(() => {
    const map = new Map();
    for (const section of sections || []) {
      if (section?.id) map.set(section.id, section);
    }
    return map;
  }, [sections]);

  const activeFilter = FILTER_DEFS.find((f) => f.id === filterId) || FILTER_DEFS[0];
  const normQuery = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const bySection = new Map();
    for (const card of cards || []) {
      const path = card.key;
      const file = card.file;
      if (!file) continue;
      const status = syncMap?.[path] || null;
      if (!activeFilter.match(status, file)) continue;
      if (normQuery) {
        const name = (file.fileName || '').toLowerCase();
        const rel = (file.relativePath || '').toLowerCase();
        if (!name.includes(normQuery) && !rel.includes(normQuery)) continue;
      }
      const sectionKey = file._clusterSectionKey || 'knowledge';
      if (!bySection.has(sectionKey)) bySection.set(sectionKey, []);
      bySection.get(sectionKey).push({ path, file, status });
    }

    // Preserve section order from layout.sections. Sections missing from
    // layout fall through to the end.
    const ordered = [];
    const seen = new Set();
    for (const section of sections || []) {
      if (!section?.id) continue;
      if (!bySection.has(section.id)) continue;
      ordered.push({ section, items: bySection.get(section.id) });
      seen.add(section.id);
    }
    for (const [sectionKey, items] of bySection) {
      if (seen.has(sectionKey)) continue;
      ordered.push({ section: { id: sectionKey, label: sectionKey, color: '#888' }, items });
    }
    return ordered;
  }, [cards, sections, syncMap, activeFilter, normQuery]);

  const totals = useMemo(() => {
    const selectedPaths = [...syncSelection];
    let sensitiveCount = 0;
    for (const path of selectedPaths) {
      const file = fileByPath.get(path);
      if (file?.hasSensitiveContent) sensitiveCount++;
    }
    return {
      count: selectedPaths.length,
      bytes: totalBytesOf(selectedPaths, fileByPath),
      sensitiveCount,
    };
  }, [syncSelection, fileByPath]);

  // All paths currently visible under active filter+query (across all groups).
  const visiblePaths = useMemo(() => {
    const list = [];
    for (const group of groups) {
      for (const row of group.items) list.push(row.path);
    }
    return list;
  }, [groups]);

  const visibleSelectablePaths = useMemo(
    () => visiblePaths.filter((p) => selectablePaths?.has(p)),
    [visiblePaths, selectablePaths],
  );

  const toggleGroup = useCallback((sectionId) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);

  const selectGroup = useCallback(
    (group) => {
      const selectablePathsInGroup = group.items
        .map((row) => row.path)
        .filter((p) => selectablePaths?.has(p));
      if (selectablePathsInGroup.length === 0) return;
      const allSelected = selectablePathsInGroup.every((p) => syncSelection.has(p));
      setSyncSelection((prev) => {
        const next = new Set(prev);
        if (allSelected) {
          for (const p of selectablePathsInGroup) next.delete(p);
        } else {
          for (const p of selectablePathsInGroup) next.add(p);
        }
        return next;
      });
    },
    [selectablePaths, syncSelection, setSyncSelection],
  );

  const selectAllVisible = useCallback(() => {
    if (visibleSelectablePaths.length === 0) return;
    setSyncSelection((prev) => {
      const next = new Set(prev);
      for (const p of visibleSelectablePaths) next.add(p);
      return next;
    });
  }, [visibleSelectablePaths, setSyncSelection]);

  const clearSelection = useCallback(() => {
    setSyncSelection(new Set());
  }, [setSyncSelection]);

  if (!open) return null;

  const canAct = isConnected && !syncing && totals.count > 0;
  const filterCountHint = visiblePaths.length;
  const dynamicCopy = (() => {
    if (totals.count === 0) return 'Pick files to sync. Sensitive files stay put unless you override.';
    if (totals.sensitiveCount > 0) {
      return `${totals.sensitiveCount} sensitive file${totals.sensitiveCount === 1 ? '' : 's'} included — review before syncing.`;
    }
    if (totals.count >= 50) return `${totals.count} memories — that's a rich profile.`;
    if (totals.count >= 11) return `${totals.count} core memories ready.`;
    return `${totals.count} selected. Keep going.`;
  })();

  return (
    <>
      <div className="sel-drawer-scrim" onClick={onClose} />
      <aside className="sel-drawer" role="dialog" aria-label="Select files to sync">
        <header className="sel-drawer__head">
          <div className="sel-drawer__title">
            <span className="sel-drawer__title-main">Select files</span>
            <span className="sel-drawer__title-sub">{filterCountHint} shown · {syncSelection.size} selected</span>
          </div>
          <button type="button" className="sel-drawer__close" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </header>

        <div className="sel-drawer__toolbar">
          <div className="sel-drawer__chips">
            {FILTER_DEFS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`sel-chip${filterId === f.id ? ' sel-chip--active' : ''}`}
                onClick={() => setFilterId(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            ref={searchRef}
            className="sel-drawer__search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by filename or path..."
          />
        </div>

        <div className="sel-drawer__actionbar">
          <button
            type="button"
            className="sel-drawer__link-btn"
            onClick={selectAllVisible}
            disabled={visibleSelectablePaths.length === 0}
            title="Select every file shown under the current filter"
          >
            Select all visible ({visibleSelectablePaths.length})
          </button>
          <button
            type="button"
            className="sel-drawer__link-btn"
            onClick={clearSelection}
            disabled={syncSelection.size === 0}
          >
            Clear
          </button>
        </div>

        <div className="sel-drawer__body">
          {groups.length === 0 ? (
            <div className="sel-drawer__empty">No files match the current filter.</div>
          ) : (
            groups.map(({ section, items }) => {
              const sectionId = section.id;
              const collapsed = collapsedSections.has(sectionId);
              const selectableInGroup = items.filter((row) => selectablePaths?.has(row.path));
              const selectedInGroup = selectableInGroup.filter((row) => syncSelection.has(row.path)).length;
              const groupState =
                selectedInGroup === 0
                  ? 'empty'
                  : selectedInGroup === selectableInGroup.length
                    ? 'full'
                    : 'partial';
              const label = stripSectionEmoji(sectionMetaById.get(sectionId)?.label || section.label || sectionId);
              return (
                <section key={sectionId} className="sel-group">
                  <div className="sel-group__head">
                    <button
                      type="button"
                      className={`sel-group__checkbox sel-group__checkbox--${groupState}`}
                      onClick={() => selectGroup({ items })}
                      disabled={selectableInGroup.length === 0}
                      title={
                        groupState === 'full'
                          ? 'Deselect all in group'
                          : `Select all ${selectableInGroup.length} in this group`
                      }
                    >
                      {groupState === 'full' ? '✓' : groupState === 'partial' ? '–' : ''}
                    </button>
                    <button
                      type="button"
                      className="sel-group__title"
                      onClick={() => toggleGroup(sectionId)}
                    >
                      <span className="sel-group__chevron">{collapsed ? '▸' : '▾'}</span>
                      <span className="sel-group__label" style={{ color: section.color }}>
                        {label}
                      </span>
                      <span className="sel-group__count">
                        {selectedInGroup}/{items.length}
                      </span>
                    </button>
                  </div>
                  {!collapsed && (
                    <ul className="sel-list">
                      {items.map((row) => {
                        const { path, file, status } = row;
                        const selectable = selectablePaths?.has(path);
                        const checked = syncSelection.has(path);
                        const statusCfg =
                          file?.hasSensitiveContent ? STATUS_PILL_CONFIG.sealed : STATUS_PILL_CONFIG[status] || null;
                        const sizeLabel = formatBytes(file?.sizeBytes);
                        const dateLabel = formatRelativeDate(file?.modifiedTime || file?.updatedAt);
                        const displayName = (file?.fileName || path).replace(/\.md$/i, '');
                        const rowClass = [
                          'sel-row',
                          checked ? 'sel-row--checked' : '',
                          !selectable ? 'sel-row--disabled' : '',
                          file?.hasSensitiveContent ? 'sel-row--sensitive' : '',
                        ]
                          .filter(Boolean)
                          .join(' ');
                        return (
                          <li key={path}>
                            <button
                              type="button"
                              className={rowClass}
                              onClick={() => {
                                if (!selectable) return;
                                toggleFileSelection(path);
                              }}
                              title={selectable ? path : `${path} (not eligible for sync)`}
                            >
                              <span className="sel-row__checkbox" aria-hidden="true">
                                {checked ? '☑' : selectable ? '☐' : '·'}
                              </span>
                              <span className="sel-row__name">{displayName}</span>
                              <span className="sel-row__meta">
                                {statusCfg && (
                                  <span className={`sel-pill ${statusCfg.cls}`}>{statusCfg.label}</span>
                                )}
                                {sizeLabel && <span className="sel-row__chip">{sizeLabel}</span>}
                                {dateLabel && <span className="sel-row__chip">{dateLabel}</span>}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>

        <footer className="sel-drawer__footer">
          <div className="sel-drawer__summary">
            <div className="sel-drawer__summary-top">
              <strong>{totals.count}</strong> selected
              {totals.bytes > 0 && <span> · {formatBytes(totals.bytes)}</span>}
              {totals.sensitiveCount > 0 && (
                <span className="sel-drawer__summary-sensitive">
                  · ⚠️ {totals.sensitiveCount} sensitive
                </span>
              )}
            </div>
            <div className="sel-drawer__summary-copy">{dynamicCopy}</div>
          </div>
          <div className="sel-drawer__actions">
            <button
              type="button"
              className="sel-btn sel-btn--ghost"
              onClick={onClose}
              disabled={syncing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="sel-btn sel-btn--ghost"
              disabled={!canAct}
              title="Force re-run extraction on the selected files (ignores content-hash skip)."
              onClick={() => onSync?.('reextract')}
            >
              {syncing ? 'Working...' : `Re-extract ${totals.count || ''}`.trim()}
            </button>
            <button
              type="button"
              className="sel-btn sel-btn--primary"
              disabled={!canAct}
              onClick={() => onSync?.('sync')}
            >
              {syncing ? 'Syncing...' : `Sync ${totals.count || ''}`.trim()}
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}
