import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { FileCard, cardJitter } from './FileCard';
import './Pile.css';

/**
 * Pile — a horizontal fan of FileCards positioned at a world anchor (x, y).
 *
 * Behavior:
 *   - Renders up to MAX_VISIBLE cards from `items` as a fan to the right
 *     of the anchor. Each card's x offset grows linearly; each has a stable
 *     pseudo-random tilt.
 *   - The anchor (x, y) is in world coordinates inside canvasWorld — the
 *     caller composes piles by passing different (x, y).
 *   - Label + count badge float above the pile top-left corner.
 *
 * Props:
 *   anchor   : { x, y } world-space anchor (top of the pile's visual column)
 *   label    : section title shown above
 *   sublabel : short description shown under the label
 *   accent   : 'private' | 'ready' | 'synced' — drives color
 *   items    : [{ file, content, syncStatus }]  sorted oldest-last (top=first)
 *   syncStateByPath : { [relativePath]: 'queued'|'syncing'|'done'|'failed' }
 *   onCardClick     : (file) => void
 *   cardVariant     : 'private' | 'ready' | 'synced' — passed to each FileCard
 *   hiddenPaths     : Set<string> — skip rendering these (for in-flight cards)
 */

const MAX_VISIBLE = 8;
const SPREAD_COLS = 4;        // grid columns in spread mode
const SPREAD_GAP_X = 0.22;    // in card-widths
const SPREAD_GAP_Y = 0.18;    // in card-heights

export function Pile({
  anchor,
  label,
  sublabel,
  accent = 'ready',
  items,
  syncStateByPath,
  onCardClick,
  cardVariant,
  hiddenPaths,
  layout = 'stack',
}) {
  const total = items?.length || 0;
  const isSpread = layout === 'spread';
  const visibleItems = useMemo(() => {
    // Stack mode: top-of-pile first, capped at MAX_VISIBLE.
    // Spread mode: show everything that passed the filter.
    return isSpread ? (items || []) : (items || []).slice(0, MAX_VISIBLE);
  }, [items, isSpread]);

  // Region dimensions (spread mode): width spans the grid, height grows by rows.
  const cols = Math.min(total || 1, SPREAD_COLS);
  const rows = Math.max(1, Math.ceil(total / SPREAD_COLS));
  const regionW = `calc(var(--card-w) * ${cols + (cols - 1) * SPREAD_GAP_X} + 48px)`;
  const regionH = `calc(var(--card-h) * ${rows + (rows - 1) * SPREAD_GAP_Y} + 64px)`;

  return (
    <motion.div
      className={`pile pile--${accent} pile--layout-${layout}`}
      style={{
        position: 'absolute',
        left: anchor.x,
        top: anchor.y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      {/* Spread-mode region outline — the "area on the desk" */}
      {isSpread && total > 0 && (
        <motion.div
          className="pile__region"
          initial={false}
          animate={{ width: regionW, height: regionH }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      )}

      {/* Label: floats above the top-left of the pile */}
      <div className="pile__label">
        <div className="pile__label-row">
          <span className={`pile__dot pile__dot--${accent}`} />
          <span className="pile__title">{label}</span>
          <span className="pile__count">{total}</span>
        </div>
        {sublabel && <div className="pile__sub">{sublabel}</div>}
      </div>

      {/* Cards — positioned absolutely inside an invisible anchor */}
      <div className="pile__fan">
        {visibleItems.map(({ file, content }, i) => {
          const hidden = hiddenPaths?.has(file.relativePath);
          if (hidden) return null;
          const syncState = syncStateByPath?.[file.relativePath];

          let offsetX, offsetY, rot, zIndex;
          if (isSpread) {
            const col = i % SPREAD_COLS;
            const row = Math.floor(i / SPREAD_COLS);
            offsetX = `calc(var(--card-w) * ${col * (1 + SPREAD_GAP_X)})`;
            offsetY = `calc(var(--card-h) * ${row * (1 + SPREAD_GAP_Y)})`;
            rot = 0;
            zIndex = 1;
          } else {
            offsetX = `calc(var(--card-w) * ${i * 0.14})`;
            offsetY = `calc(var(--card-h) * ${i * 0.008})`;
            rot = cardJitter(file.relativePath + ':pile', 3.2) + (i % 2 === 0 ? 0 : -1.2);
            zIndex = MAX_VISIBLE - i;
          }

          return (
            <FileCard
              key={file.relativePath}
              file={file}
              content={content}
              variant={cardVariant || accent}
              syncState={syncState}
              rotate={rot}
              translateX={offsetX}
              translateY={offsetY}
              zIndex={zIndex}
              onClick={() => onCardClick?.(file)}
            />
          );
        })}

        {/* "+N more" hint — only in stack mode */}
        {!isSpread && total > MAX_VISIBLE && (
          <div
            className="pile__overflow"
            style={{
              transform: `translate(calc(var(--card-w) * ${MAX_VISIBLE * 0.14 + 0.1}), 0)`,
            }}
          >
            <span className="pile__overflow-n">+{total - MAX_VISIBLE}</span>
            <span className="pile__overflow-lbl">more</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
