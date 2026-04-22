import React, { useMemo } from 'react';
import './HomeCard.css';

const PREVIEW_CHAR_LIMIT = 260;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}kb`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}mb`;
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
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
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
    .replace(/\n{2,}/g, ' · ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen) + '…' : stripped;
}

function typeTagForFile(file) {
  // Map fileType/clusterLabel into one of the reference tag classes
  const raw = String(file?.fileType || file?.clusterLabel || '').toLowerCase();
  if (/timeline|journal|daily|diary|log/.test(raw)) return { cls: 't-tl', label: 'Timeline' };
  if (/tech|code|setup|readme|docs/.test(raw)) return { cls: 't-tech', label: 'Technical' };
  if (/people|profile|person|contact/.test(raw)) return { cls: 't-ppl', label: 'People' };
  if (/system|soul|identity|tools|agents/.test(raw)) return { cls: 't-sys', label: 'System' };
  if (/memory|long.?term/.test(raw)) return { cls: 't-sys', label: 'Long-term' };
  return { cls: 't-loc', label: 'Note' };
}

/**
 * HomeCard — a single file card.
 *
 *  variant: 'private' | 'ready' | 'synced'
 *  cardSyncState: transient state for sync animation — 'queued' | 'syncing' | 'done' | 'failed'
 */
export function HomeCard({ file, syncStatus, variant = 'ready', content, cardSyncState, onClick }) {
  const preview = useMemo(() => stripMarkdown(content || ''), [content]);
  const size = formatBytes(file?.sizeBytes);
  const date = formatRelativeDate(file?.modifiedTime || file?.updatedAt);
  const typeTag = typeTagForFile(file);

  const isSecret = file?.riskLevel === 'secret';
  const isPrivate = variant === 'private';
  const isSynced = variant === 'synced';

  const classes = [
    'home-card',
    isPrivate ? 'home-card--priv' : '',
    isSynced ? 'home-card--sync' : '',
    cardSyncState ? `home-card--${cardSyncState}` : '',
  ].filter(Boolean).join(' ');

  const displayPreview = preview || 'Markdown file. Click to read.';

  const fileName = file?.fileName || 'untitled.md';
  const truncatedName = fileName.length > 26 ? fileName.slice(0, 25) + '…' : fileName;

  return (
    <div className={classes} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      }}
      title={fileName}
    >
      <div className="home-card__head">
        <div className="home-card__fname" title={fileName}>{truncatedName}</div>
        <div className="home-card__tags">
          <span className={`tag ${typeTag.cls}`}>{typeTag.label}</span>
          {isSecret && file?.sensitiveSummary && (
            <span className="tag t-sens">!! {file.sensitiveSummary}</span>
          )}
          {isPrivate && !isSecret && (
            <span className="tag t-priv">Private</span>
          )}
          {isSynced && (
            <span className="tag t-sync">✓ Synced</span>
          )}
          {variant === 'ready' && (
            <span className="tag t-loc">Local</span>
          )}
        </div>
      </div>

      <div className="home-card__body">
        <div className={`home-card__preview ${isPrivate ? 'home-card__preview--blurred' : ''}`}>
          {displayPreview}
        </div>
        {isPrivate && (
          <div className="home-card__priv-overlay">
            <div className="home-card__lock-icon" aria-hidden="true">🔒</div>
            <div className="home-card__lock-label">Protected</div>
          </div>
        )}
      </div>

      <div className="home-card__foot">
        <span className="home-card__meta">
          {size && `${size}`}
          {size && date && ' · '}
          {date}
        </span>
      </div>
    </div>
  );
}
