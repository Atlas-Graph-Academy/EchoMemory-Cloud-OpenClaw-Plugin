import { useEffect, useMemo, useState } from 'react';
import { fetchFileDiff } from '../sync/api';
import { lineDiff, parseSections, indexSectionsByTitle } from './lineDiff';
import './FileDiffModal.css';

function formatTitle(title) {
  if (!title) return '';
  if (title === '__intro__') return '(intro)';
  if (title === '__untitled__') return '(untitled section)';
  return title;
}

/**
 * FileDiffModal — shows what changed in a markdown file since the last
 * successful sync. Section list with status, line-level diff per changed
 * section, and a "Sync this file" CTA at the bottom that pushes the
 * upload through.
 *
 * Loads on mount via /api/file-diff. Cloud content (the user's last
 * synced version) is preferred as the diff baseline; falls back to the
 * local section snapshot if cloud isn't reachable.
 */
export function FileDiffModal({ open, relativePath, onClose, onSync, syncing }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !relativePath) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetchFileDiff(relativePath)
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Could not load diff');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [open, relativePath]);

  const baselineContent = useMemo(() => {
    if (!data) return '';
    return typeof data.cloudContent === 'string' ? data.cloudContent : '';
  }, [data]);

  const localContent = useMemo(() => data?.localContent || '', [data]);
  const changedSections = useMemo(
    () => Array.isArray(data?.changedSections) ? data.changedSections : [],
    [data],
  );

  const baselineSections = useMemo(() => indexSectionsByTitle(parseSections(baselineContent)), [baselineContent]);
  const localSections = useMemo(() => indexSectionsByTitle(parseSections(localContent)), [localContent]);

  if (!open) return null;

  const hasBaseline = !!baselineContent;
  const summary = changedSections.length === 0
    ? (hasBaseline ? 'No changes detected.' : 'New file (no prior version on cloud).')
    : (() => {
      const counts = { added: 0, changed: 0, removed: 0 };
      for (const c of changedSections) counts[c.kind] = (counts[c.kind] || 0) + 1;
      const parts = [];
      if (counts.changed) parts.push(`${counts.changed} changed`);
      if (counts.added) parts.push(`${counts.added} added`);
      if (counts.removed) parts.push(`${counts.removed} removed`);
      return parts.join(' · ');
    })();

  return (
    <div
      className="diff-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Changes to ${relativePath}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !syncing) onClose?.();
      }}
    >
      <div className="diff-modal">
        <button
          type="button"
          className="diff-modal__close"
          onClick={onClose}
          disabled={syncing}
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <p className="diff-modal__kicker">File update</p>
        <h1 className="diff-modal__headline">What changed.</h1>
        <p className="diff-modal__path">{relativePath}</p>
        <p className="diff-modal__summary">{summary}</p>

        <div className="diff-modal__body">
          {loading && <div className="diff-modal__placeholder">Loading diff…</div>}
          {error && <div className="diff-modal__error" role="alert">{error}</div>}

          {!loading && !error && changedSections.length === 0 && hasBaseline && (
            <div className="diff-modal__placeholder">
              The local file matches what's on the cloud. Nothing to sync.
            </div>
          )}

          {!loading && !error && changedSections.length === 0 && !hasBaseline && (
            <div className="diff-modal__placeholder">
              This file has not been synced before. Sync to upload it as the
              first source-of-truth.
            </div>
          )}

          {!loading && !error && changedSections.map((section) => {
            const before = section.kind === 'added'
              ? ''
              : (baselineSections.get(section.title) || '');
            const after = section.kind === 'removed'
              ? ''
              : (localSections.get(section.title) || '');
            const diff = lineDiff(before, after);
            return (
              <section key={`${section.kind}-${section.title}`} className={`diff-section diff-section--${section.kind}`}>
                <header className="diff-section__head">
                  <span className={`diff-section__tag diff-section__tag--${section.kind}`}>
                    {section.kind}
                  </span>
                  <span className="diff-section__title">{formatTitle(section.title)}</span>
                </header>
                <pre className="diff-section__lines">
                  {diff.map((line, idx) => (
                    <span key={idx} className={`diff-line diff-line--${line.type}`}>
                      <span className="diff-line__sigil" aria-hidden="true">
                        {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
                      </span>
                      <span className="diff-line__text">{line.text}</span>
                    </span>
                  ))}
                </pre>
              </section>
            );
          })}
        </div>

        <div className="diff-modal__actions">
          <button
            type="button"
            className="diff-modal__btn diff-modal__btn--primary"
            onClick={() => onSync?.(relativePath)}
            disabled={loading || syncing || (!!error && !data)}
          >
            {syncing ? 'Syncing…' : changedSections.length === 0 && hasBaseline ? 'Re-sync anyway' : 'Sync this file'}
          </button>
          <button
            type="button"
            className="diff-modal__btn diff-modal__btn--ghost"
            onClick={onClose}
            disabled={syncing}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
