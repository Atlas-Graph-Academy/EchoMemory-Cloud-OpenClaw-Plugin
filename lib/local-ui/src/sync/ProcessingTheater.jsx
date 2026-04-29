import { useEffect, useMemo, useRef, useState } from 'react';
import './ProcessingTheater.css';

const STAGES = [
  { key: 'parse', label: 'Parse' },
  { key: 'chunk', label: 'Chunk' },
  { key: 'generate', label: 'Generate' },
  { key: 'save', label: 'Save' },
];

function resolveStageIndex(stage) {
  if (!stage) return -1;
  const normalized = String(stage).trim().toLowerCase();
  const idx = STAGES.findIndex((s) => normalized.includes(s.key));
  return idx;
}

function basename(p) {
  if (!p) return '';
  const parts = String(p).split('/');
  return parts[parts.length - 1] || p;
}

function SlotDigit({ digit }) {
  return (
    <span className="pt-slot" data-digit={digit}>
      <span className="pt-slot__reel" style={{ transform: `translateY(-${digit * 10}%)` }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <span key={n} className="pt-slot__num">{n}</span>
        ))}
      </span>
    </span>
  );
}

function SlotCounter({ value }) {
  const safe = Math.max(0, Math.min(999, value | 0));
  const digits = String(safe).padStart(3, '0').split('').map((d) => parseInt(d, 10));
  const [pulse, setPulse] = useState(0);
  const prevRef = useRef(safe);
  useEffect(() => {
    if (prevRef.current !== safe) {
      prevRef.current = safe;
      setPulse((p) => p + 1);
    }
  }, [safe]);
  return (
    <div className={`pt-counter ${pulse > 0 ? 'pt-counter--bump' : ''}`} key={pulse}>
      {digits.map((d, i) => (
        <SlotDigit key={i} digit={d} />
      ))}
    </div>
  );
}

function StageChain({ currentStage, phase }) {
  const activeIdx = resolveStageIndex(currentStage);
  const done = phase === 'finished';
  return (
    <div className="pt-stages" aria-label="Processing stages">
      {STAGES.map((s, i) => {
        const state = done
          ? 'done'
          : activeIdx < 0
            ? 'pending'
            : i < activeIdx
              ? 'done'
              : i === activeIdx
                ? 'active'
                : 'pending';
        return (
          <div key={s.key} className={`pt-stage pt-stage--${state}`}>
            <span className="pt-stage__dot" />
            <span className="pt-stage__label">{s.label}</span>
            {i < STAGES.length - 1 && <span className="pt-stage__bar" />}
          </div>
        );
      })}
    </div>
  );
}

function MemoryCard({ memory }) {
  const title = memory?.description || 'New memory';
  const file = basename(memory?.relativePath || memory?.filePath);
  const chip = memory?.category || memory?.emotion || memory?.object || null;
  const elapsed = typeof memory?.elapsedMs === 'number' ? memory.elapsedMs : null;
  return (
    <div className="pt-card">
      <div className="pt-card__glow" />
      <div className="pt-card__body">
        <div className="pt-card__title">{title}</div>
        <div className="pt-card__meta">
          {file && <span className="pt-card__file">{file}</span>}
          {chip && <span className="pt-card__chip">{chip}</span>}
          {elapsed != null && <span className="pt-card__elapsed">{(elapsed / 1000).toFixed(1)}s</span>}
        </div>
      </div>
    </div>
  );
}

export function ProcessingTheater({
  syncProgress,
  streamedMemories,
  totalStreamedCount,
  onDismiss,
  onStop,
  onOpenTimeline,
}) {
  const phase = syncProgress?.phase || null;
  const active = Boolean(syncProgress);
  const finished = phase === 'finished';
  const failed = phase === 'failed';
  const stopped = phase === 'stopped';
  const running = active && !finished && !failed && !stopped;

  const [confirmStopOpen, setConfirmStopOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (active) {
      document.body.classList.add('processing-theater-active');
    } else {
      document.body.classList.remove('processing-theater-active');
    }
    return () => {
      document.body.classList.remove('processing-theater-active');
    };
  }, [active]);

  // Reset transient stop state once the run actually wraps up.
  useEffect(() => {
    if (!running) {
      setStopping(false);
      setConfirmStopOpen(false);
    }
  }, [running]);

  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => {
      onDismiss?.();
    }, 3000);
    return () => clearTimeout(t);
  }, [finished, onDismiss]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (confirmStopOpen) setConfirmStopOpen(false);
        else onDismiss?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onDismiss, confirmStopOpen]);

  const recentCards = useMemo(() => {
    const list = Array.isArray(streamedMemories) ? streamedMemories : [];
    return list.slice(-6);
  }, [streamedMemories]);

  if (!active) return null;

  const totalFiles = syncProgress?.totalFiles || 0;
  const completedFiles = syncProgress?.completedFiles || 0;
  const successCount = Array.isArray(syncProgress?.completedFilePaths)
    ? syncProgress.completedFilePaths.length
    : 0;
  const failedCount = Array.isArray(syncProgress?.failedFilePaths)
    ? syncProgress.failedFilePaths.length
    : 0;
  const remainingCount = Math.max(0, totalFiles - completedFiles);
  const currentFile = syncProgress?.currentRelativePath
    || syncProgress?.currentFilePath
    || (Array.isArray(syncProgress?.currentRelativePaths) ? syncProgress.currentRelativePaths[0] : null);

  const statusLine = stopped
    ? 'Sync stopped'
    : failed
      ? 'Sync failed'
      : finished
        ? `${totalStreamedCount} memories captured from ${totalFiles} file${totalFiles === 1 ? '' : 's'}`
        : stopping
          ? 'Stopping…'
          : currentFile
            ? `Reading ${basename(currentFile)}`
            : 'Warming up…';

  const handleStopClick = () => setConfirmStopOpen(true);
  const handleConfirmStop = async () => {
    setStopping(true);
    setConfirmStopOpen(false);
    try {
      await onStop?.();
    } catch {
      // best-effort; server may have already finished
    }
  };

  const rootMod = stopped ? 'stopped' : finished ? 'finished' : failed ? 'failed' : 'running';

  return (
    <div className={`pt-root pt-root--${rootMod}`}>
      <div className="pt-panel" role="status" aria-live="polite">
        <div className="pt-actions">
          {running && (
            <button
              type="button"
              className="pt-stop"
              onClick={handleStopClick}
              disabled={stopping}
              aria-label="Stop sync"
              title="Stop sync"
            >
              <span className="pt-stop__square" aria-hidden="true" />
              <span className="pt-stop__label">Stop</span>
            </button>
          )}
          <button
            type="button"
            className="pt-close"
            onClick={() => onDismiss?.()}
            aria-label="Dismiss"
            title="Dismiss"
          >
            ×
          </button>
        </div>

        <div className="pt-header">
          <div className="pt-counter-wrap">
            <SlotCounter value={totalStreamedCount} />
            <div className="pt-counter-label">
              memories
              <span className="pt-counter-sub">
                {completedFiles} / {totalFiles || '—'} files
              </span>
            </div>
          </div>
          <StageChain currentStage={syncProgress?.currentStage} phase={phase} />
        </div>

        <div className="pt-status">{statusLine}</div>

        {!stopped && (
          <div className={`pt-cards ${recentCards.length === 0 ? 'pt-cards--empty' : ''}`}>
            {recentCards.length === 0 ? (
              <div className="pt-empty">Waiting for the first memory…</div>
            ) : (
              recentCards.map((m, i) => (
                <MemoryCard
                  key={`${m?.filePath || 'm'}-${m?.serial ?? i}`}
                  memory={m}
                />
              ))
            )}
          </div>
        )}

        {stopped && (
          <div className="pt-stopped-summary">
            <div className="pt-stopped-row">
              <span className="pt-stopped-num">{totalStreamedCount}</span>
              <span className="pt-stopped-label">memories saved</span>
            </div>
            <div className="pt-stopped-grid">
              <div className="pt-stopped-cell">
                <span className="pt-stopped-cell__num">{successCount}</span>
                <span className="pt-stopped-cell__label">files synced</span>
              </div>
              <div className="pt-stopped-cell">
                <span className="pt-stopped-cell__num">{failedCount}</span>
                <span className="pt-stopped-cell__label">failed</span>
              </div>
              <div className="pt-stopped-cell">
                <span className="pt-stopped-cell__num">{remainingCount}</span>
                <span className="pt-stopped-cell__label">not synced</span>
              </div>
            </div>
            <div className="pt-stopped-note">
              Saved memories are safe in your cloud. Don't worry about the rest — you can sync them anytime.
            </div>
            <div className="pt-summary">
              <button
                type="button"
                className="pt-cta pt-cta--neutral"
                onClick={() => onDismiss?.()}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {finished && (
          <div className="pt-summary">
            <button
              type="button"
              className="pt-cta"
              onClick={() => {
                onOpenTimeline?.();
                onDismiss?.();
              }}
            >
              Timeline →
            </button>
          </div>
        )}

        {failed && (syncProgress?.error || syncProgress?.recentFileResult?.lastError) && (
          <div className="pt-error">
            {syncProgress.error || syncProgress.recentFileResult.lastError}
          </div>
        )}

        {confirmStopOpen && (
          <div className="pt-confirm" role="dialog" aria-modal="true" aria-labelledby="pt-confirm-title">
            <div className="pt-confirm__panel">
              <div className="pt-confirm__title" id="pt-confirm-title">Stop syncing?</div>
              <div className="pt-confirm__body">
                Memories already saved will stay safe in your cloud. Files still in queue won't be uploaded — you can sync them anytime later.
              </div>
              <div className="pt-confirm__actions">
                <button
                  type="button"
                  className="pt-confirm__btn pt-confirm__btn--ghost"
                  onClick={() => setConfirmStopOpen(false)}
                >
                  Keep syncing
                </button>
                <button
                  type="button"
                  className="pt-confirm__btn pt-confirm__btn--danger"
                  onClick={handleConfirmStop}
                >
                  Yes, stop
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
