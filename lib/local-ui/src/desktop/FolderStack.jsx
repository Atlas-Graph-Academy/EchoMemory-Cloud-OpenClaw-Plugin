import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { cardJitter } from './FileCard';
import './FolderStack.css';

// Count grows → stack thickness grows (log scale, capped).
function stackThickness(n) {
  if (n <= 1) return 2;
  if (n <= 3) return 3;
  if (n <= 7) return 4;
  if (n <= 20) return 6;
  if (n <= 60) return 8;
  return 10;
}

function summarize(files, syncMap) {
  let priv = 0, synced = 0, ready = 0;
  for (const f of files || []) {
    const status = syncMap?.[f.relativePath];
    if (
      f.riskLevel === 'secret' ||
      f.riskLevel === 'private' ||
      f.privacyLevel === 'private' ||
      status === 'sealed'
    ) priv++;
    else if (status === 'synced') synced++;
    else ready++;
  }
  return { priv, synced, ready };
}

/**
 * FolderStack — chunky tilted pile of blank sheets representing a folder
 * and all its descendants. Thickness scales with total file count.
 *
 * Props:
 *   name                         folder basename
 *   path                         full relative folder path
 *   files                        ALL descendants (recursive)
 *   syncMap                      used to tint stack by dominant risk
 *   translateX, translateY, zIndex  world-space placement
 *   onDrill                      (path) => void, drills into the folder
 */
export function FolderStack({
  name,
  path,
  files,
  syncMap,
  variant,        // optional explicit risk tint: 'private'|'ready'|'synced'
  totalAll,       // optional total file count across all risks (for context)
  translateX = 0,
  translateY = 0,
  zIndex = 0,
  onDrill,
}) {
  const total = files?.length || 0;
  const thickness = stackThickness(total);
  const { priv, synced, ready } = useMemo(
    () => summarize(files || [], syncMap),
    [files, syncMap]
  );

  let tint = variant;
  if (!tint) {
    tint = 'ready';
    if (priv >= ready && priv >= synced) tint = 'private';
    else if (synced >= ready) tint = 'synced';
  }
  const showSplit = !variant; // only show all 3 chips when no explicit region

  return (
    <motion.div
      className={`folder-stack folder-stack--${tint}`}
      initial={{ x: translateX, y: translateY, rotate: 0, opacity: 0, scale: 0.82 }}
      animate={{ x: translateX, y: translateY, rotate: 0, opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.82, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{ zIndex }}
      onClick={() => onDrill?.(path)}
      role="button"
      tabIndex={0}
    >
      {/* Back sheets — each tilted, progressively offset to give thickness */}
      {Array.from({ length: thickness }).map((_, i) => {
        const idx = thickness - 1 - i; // bottom first
        const rot = cardJitter(path + ':sheet:' + idx, 7.5);
        const offX = idx * 2.6;
        const offY = idx * 3.8;
        return (
          <div
            key={idx}
            className="folder-stack__sheet"
            style={{
              transform: `translate(${offX}px, ${offY}px) rotate(${rot}deg)`,
              zIndex: idx,
            }}
          />
        );
      })}

      {/* Top label card */}
      <div className="folder-stack__label" style={{ zIndex: thickness + 1 }}>
        <div className="folder-stack__icon" aria-hidden="true">
          <svg width="32" height="26" viewBox="0 0 32 26" fill="none">
            <path
              d="M1 4C1 2.34 2.34 1 4 1H11.5L14 4H28C29.66 4 31 5.34 31 7V22C31 23.66 29.66 25 28 25H4C2.34 25 1 23.66 1 22V4Z"
              stroke="currentColor" strokeWidth="1.3"
              fill="currentColor" fillOpacity="0.08"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="folder-stack__name" title={name}>{name}</div>
        <div className="folder-stack__count">
          <strong>{total}</strong>
          <span>
            {total === 1 ? 'file' : 'files'}
            {totalAll && totalAll !== total ? ` of ${totalAll}` : ''}
          </span>
        </div>
        {showSplit && (
          <div className="folder-stack__risk">
            {priv > 0 && (
              <span className="folder-stack__chip folder-stack__chip--priv" title={`${priv} private`}>
                <span className="folder-stack__dot folder-stack__dot--priv" />
                {priv}
              </span>
            )}
            {ready > 0 && (
              <span className="folder-stack__chip folder-stack__chip--ready" title={`${ready} ready`}>
                <span className="folder-stack__dot folder-stack__dot--ready" />
                {ready}
              </span>
            )}
            {synced > 0 && (
              <span className="folder-stack__chip folder-stack__chip--sync" title={`${synced} synced`}>
                <span className="folder-stack__dot folder-stack__dot--sync" />
                {synced}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
