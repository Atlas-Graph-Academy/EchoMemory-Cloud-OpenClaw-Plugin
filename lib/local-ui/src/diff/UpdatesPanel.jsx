import { useEffect, useMemo } from 'react';
import './UpdatesPanel.css';

function summarizeSections(changedSections) {
  if (!Array.isArray(changedSections) || changedSections.length === 0) {
    return null;
  }
  const counts = { added: 0, changed: 0, removed: 0 };
  for (const c of changedSections) counts[c.kind] = (counts[c.kind] || 0) + 1;
  const parts = [];
  if (counts.changed) parts.push(`${counts.changed} changed`);
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  return parts.join(' · ');
}

function tagFromRiskLevel(riskLevel, trustedForUpdate) {
  if (riskLevel === 'secret') return { label: 'Sensitive', tone: 'secret' };
  if (riskLevel === 'private') return { label: trustedForUpdate ? 'Private (trusted)' : 'Private', tone: 'private' };
  return { label: 'Review', tone: 'review' };
}

/**
 * UpdatesPanel — dropdown list of every file the backend flagged as
 * needing user attention before sync (privacyLevel review/private with
 * a known prior version). Click a row to open the FileDiffModal for
 * that file. Closes on outside-click and Escape.
 *
 * Data comes straight from sync-status fileStatuses; no extra fetch.
 */
export function UpdatesPanel({ open, fileStatuses, onClose, onPickFile }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const items = useMemo(() => {
    if (!Array.isArray(fileStatuses)) return [];
    const list = fileStatuses.filter((entry) => entry?.needsUserNotice);
    list.sort((a, b) => {
      const aPath = String(a.relativePath || '');
      const bPath = String(b.relativePath || '');
      return aPath.localeCompare(bPath);
    });
    return list;
  }, [fileStatuses]);

  if (!open) return null;

  return (
    <div
      className="updates-panel-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Files with pending updates"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="updates-panel">
        <header className="updates-panel__head">
          <p className="updates-panel__kicker">Files with updates</p>
          <h1 className="updates-panel__headline">Pending review.</h1>
          <p className="updates-panel__sub">
            {items.length === 0
              ? 'No files waiting on you right now.'
              : `${items.length} ${items.length === 1 ? 'file is' : 'files are'} waiting for you to look at the changes and sync.`}
          </p>
          <button
            type="button"
            className="updates-panel__close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <ul className="updates-panel__list">
          {items.map((entry) => {
            const tag = tagFromRiskLevel(entry.riskLevel, entry.trustedForUpdate);
            const summary = summarizeSections(entry.changedSections);
            const subline = summary
              ? summary
              : (entry.changedSections && entry.changedSections.length === 0
                ? 'first sync — no prior baseline'
                : 'modified');
            return (
              <li key={entry.relativePath}>
                <button
                  type="button"
                  className="updates-panel__row"
                  onClick={() => onPickFile?.(entry.relativePath)}
                >
                  <div className="updates-panel__row-main">
                    <span className="updates-panel__path" title={entry.relativePath}>
                      {entry.relativePath}
                    </span>
                    <span className={`updates-panel__tag updates-panel__tag--${tag.tone}`}>
                      {tag.label}
                    </span>
                  </div>
                  <div className="updates-panel__row-sub">{subline}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
