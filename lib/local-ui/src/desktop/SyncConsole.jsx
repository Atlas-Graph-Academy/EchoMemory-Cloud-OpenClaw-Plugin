import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './SyncConsole.css';

function formatBytesSum(files) {
  let total = 0;
  for (const f of files) total += Number(f?.sizeBytes || 0);
  if (total <= 0) return '';
  if (total < 1024) return `${total}B`;
  const kb = total / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function basename(rel) {
  if (!rel) return '';
  const i = rel.lastIndexOf('/');
  return i >= 0 ? rel.slice(i + 1) : rel;
}

/**
 * SyncConsole — right-side 25vw glass panel with two states:
 *   - idle    : shows the big Sync button + a short summary
 *   - active  : shows live queue with current/pending/done rows
 *
 * State is derived from `syncing` + `syncStateByPath` from App/SSE.
 *
 * Props:
 *   readyItems        : ready-to-sync entries (sorted for display)
 *   privateCount      : how many are held back
 *   syncedCount       : how many already synced
 *   syncing           : true while a run is active
 *   syncStateByPath   : { [relPath]: 'queued'|'syncing'|'done'|'failed' }
 *   lastSyncLabel     : "Synced 2h ago" or "Never synced"
 *   canSync, onSync   : button state + handler
 *   onStop            : optional; first-cut may be disabled (no backend yet)
 *   isConnected       : account state
 */
export function SyncConsole({
  readyItems,
  privateCount,
  syncedCount,
  syncing,
  syncStateByPath,
  lastSyncLabel,
  canSync,
  onSync,
  onStartSelecting,
  onStop,
  isConnected,
  isOpen = true,
  onClose,
}) {
  const readyCount = readyItems?.length || 0;
  const totalSize = useMemo(() => formatBytesSum((readyItems || []).map((r) => r.file)), [readyItems]);
  const shouldSelectFirst = readyCount > 12;

  // Build an ordered queue view from syncStateByPath during active sync.
  const queue = useMemo(() => {
    if (!syncing || !syncStateByPath) return null;
    const current = [];
    const pending = [];
    const done = [];
    const failed = [];
    for (const [rel, st] of Object.entries(syncStateByPath)) {
      if (st === 'syncing') current.push(rel);
      else if (st === 'queued') pending.push(rel);
      else if (st === 'done') done.push(rel);
      else if (st === 'failed') failed.push(rel);
    }
    return { current, pending, done, failed };
  }, [syncing, syncStateByPath]);

  const progress = queue
    ? Math.round(((queue.done.length + queue.failed.length) /
        Math.max(1, queue.done.length + queue.failed.length + queue.current.length + queue.pending.length)) * 100)
    : 0;

  const closeBtn = onClose ? (
    <button
      type="button"
      className="panel-close panel-close--right"
      onClick={onClose}
      title="Collapse sidebar ( ] )"
      aria-label="Collapse sync sidebar"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  ) : null;

  return (
    <motion.aside
      className="sync-console"
      aria-label="Sync console"
      aria-hidden={!isOpen}
      initial={false}
      animate={{
        x: isOpen ? 0 : 'calc(100% + 24px)',
        opacity: isOpen ? 1 : 0,
      }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
    >
      <AnimatePresence mode="wait">
        {syncing ? (
          <motion.div
            key="active"
            className="sync-console__body"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.24 }}
          >
            <div className="sync-console__head">
              <div className="sync-console__headrow">
                <div className="sync-console__title">
                  Syncing… <strong>{queue.done.length + queue.failed.length}</strong>
                  <span className="sync-console__of"> / {queue.done.length + queue.failed.length + queue.current.length + queue.pending.length}</span>
                </div>
                {closeBtn}
              </div>
              <div className="sync-console__progress">
                <div
                  className="sync-console__progress-bar"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="sync-console__queue">
              {/* Current file(s) — shimmer row */}
              {queue.current.length > 0 && (
                <div className="queue-section">
                  {queue.current.map((rel) => (
                    <div key={rel} className="queue-row queue-row--current">
                      <span className="queue-row__icon">
                        <span className="queue-spinner" aria-hidden="true" />
                      </span>
                      <span className="queue-row__name">{basename(rel)}</span>
                      <span className="queue-row__status">reading…</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Recently failed */}
              {queue.failed.length > 0 && (
                <div className="queue-section">
                  {queue.failed.slice(-3).reverse().map((rel) => (
                    <div key={rel} className="queue-row queue-row--failed">
                      <span className="queue-row__icon">✕</span>
                      <span className="queue-row__name">{basename(rel)}</span>
                      <span className="queue-row__status">failed</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pending */}
              {queue.pending.length > 0 && (
                <div className="queue-section queue-section--pending">
                  {queue.pending.slice(0, 6).map((rel) => (
                    <div key={rel} className="queue-row queue-row--pending">
                      <span className="queue-row__icon">○</span>
                      <span className="queue-row__name">{basename(rel)}</span>
                    </div>
                  ))}
                  {queue.pending.length > 6 && (
                    <div className="queue-row queue-row--more">
                      … +{queue.pending.length - 6} more queued
                    </div>
                  )}
                </div>
              )}

              {/* Done — last few */}
              {queue.done.length > 0 && (
                <div className="queue-section queue-section--done">
                  {queue.done.slice(-4).reverse().map((rel) => (
                    <div key={rel} className="queue-row queue-row--done">
                      <span className="queue-row__icon">✓</span>
                      <span className="queue-row__name">{basename(rel)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {onStop && (
              <button
                type="button"
                className="sync-console__stop"
                onClick={onStop}
                disabled
                title="Stop will be wired in the next PR"
              >
                ⏸ Pause
              </button>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            className="sync-console__body"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.24 }}
          >
            <div className="sync-console__head">
              <div className="sync-console__headrow">
                <div className="sync-console__title">Ready to Sync</div>
                {closeBtn}
              </div>
              <div className="sync-console__subtitle">
                {readyCount} file{readyCount === 1 ? '' : 's'}
                {totalSize && <span className="sync-console__sep"> · {totalSize}</span>}
              </div>
            </div>

            <button
              type="button"
              className="sync-console__cta"
              onClick={shouldSelectFirst ? onStartSelecting : onSync}
              disabled={shouldSelectFirst ? readyCount === 0 : !canSync}
            >
              <span className="sync-console__cta-ic" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              {shouldSelectFirst
                ? 'Select files first'
                : canSync ? `Sync ${readyCount} file${readyCount === 1 ? '' : 's'}` : 'Nothing to sync'}
            </button>

            {shouldSelectFirst && (
              <p className="sync-console__hint">
                {readyCount} files are ready. Pick a small group first so you can review and sync intentionally.
              </p>
            )}

            {!isConnected && (
              <p className="sync-console__hint sync-console__hint--warn">
                Not connected to Echo. Open Settings to connect — your files stay local until you do.
              </p>
            )}

            <dl className="sync-console__stats">
              <div>
                <dt>Kept private</dt>
                <dd>{privateCount}</dd>
              </div>
              <div>
                <dt>Already synced</dt>
                <dd>{syncedCount}</dd>
              </div>
              <div>
                <dt>Last sync</dt>
                <dd>{lastSyncLabel}</dd>
              </div>
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
