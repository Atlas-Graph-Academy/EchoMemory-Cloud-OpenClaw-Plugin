import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import './FileCard.css';

const PREVIEW_CHAR_LIMIT = 420;

function formatRelativeDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor(diffMs / day);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}kb`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}mb`;
}

function stripMarkdown(md, maxLen = PREVIEW_CHAR_LIMIT) {
  if (!md) return '';
  const raw = md.length > maxLen * 2 ? md.slice(0, maxLen * 2) : md;
  const stripped = raw
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\n{2,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen) + '…' : stripped;
}

/**
 * Stable ±pseudo-random based on a string id, for consistent per-card tilt.
 */
export function cardJitter(id, max = 2.5) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  const norm = ((h % 1000) / 1000) * 2 - 1;
  return norm * max;
}

/**
 * FileCard — portrait index card in the style of a physical note/file.
 *
 * Sizing: fully viewport-height driven. Callers don't pass width/height;
 * CSS variables `--card-h` and `--card-w` on .desktop compute both from
 * `--card-h-vh` (see Desktop.css).
 *
 * Props:
 *   - file, content                 : markdown metadata + preview text
 *   - variant : 'private' | 'ready' | 'synced'
 *   - syncState : undefined | 'queued' | 'syncing' | 'done' | 'failed'
 *   - rotate, translateX, translateY, zIndex : layout overrides
 *   - onClick                       : open reading panel
 */
export function FileCard({
  file,
  content,
  variant = 'ready',
  syncState,
  rotate = 0,
  translateX = 0,
  translateY = 0,
  zIndex = 0,
  onClick,
  className = '',
  style,
}) {
  const preview = useMemo(() => stripMarkdown(content || ''), [content]);
  const date = formatRelativeDate(file?.modifiedTime || file?.updatedAt);
  const size = formatBytes(file?.sizeBytes);

  const fileName = file?.fileName || 'untitled.md';
  const displayPreview = preview || '—— empty note ——';

  const isPrivate = variant === 'private';
  const isSynced = variant === 'synced';
  const isSecret = file?.riskLevel === 'secret';

  const classes = [
    'file-card',
    `file-card--${variant}`,
    syncState ? `file-card--${syncState}` : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <motion.div
      className={classes}
      style={{ zIndex, ...style }}
      initial={{ x: translateX, y: translateY, rotate, opacity: 0, scale: 0.9 }}
      animate={{ x: translateX, y: translateY, rotate, opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : -1}
    >
      {/* Left binding spine */}
      <div className="file-card__spine" aria-hidden="true">
        <span className="file-card__punch" />
        <span className="file-card__punch" />
        <span className="file-card__punch" />
      </div>

      {/* Head: filename + status badge */}
      <div className="file-card__head">
        <div className="file-card__name" title={fileName}>{fileName}</div>
      </div>

      {/* Body: preview or blurred */}
      <div className="file-card__body">
        <div className={`file-card__preview ${isPrivate ? 'is-blurred' : ''}`}>
          {displayPreview}
        </div>
      </div>

      {/* Foot: meta */}
      <div className="file-card__foot">
        <span className="file-card__meta">
          {size}{size && date && ' · '}{date}
        </span>
      </div>

      {/* Status stamp overlay */}
      {isPrivate && (
        <div className="file-card__stamp file-card__stamp--private" aria-hidden="true">
          {isSecret ? 'SEALED · SECRET' : 'PRIVATE'}
        </div>
      )}
      {isSynced && (
        <div className="file-card__stamp file-card__stamp--synced" aria-hidden="true">
          ✓ SYNCED
        </div>
      )}

      {/* Shimmer "being read" overlay, only when syncState === 'syncing' */}
      {syncState === 'syncing' && (
        <div className="file-card__shimmer" aria-hidden="true" />
      )}

      {/* Corner dog-ear */}
      <div className="file-card__dogear" aria-hidden="true" />
    </motion.div>
  );
}
