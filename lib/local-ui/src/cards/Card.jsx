import React, { useMemo } from 'react';
import './Card.css';

const STATUS_PALETTE = {
  sealed: { bg: '#fdf2f2', border: '#c9a0a0', text: '#8b4c4c', content: '#7a4040' },
  new: { bg: '#fefcf6', border: '#d4b882', text: '#7a6230', content: '#6b5228' },
  modified: { bg: '#fefcf6', border: '#d4b882', text: '#7a6230', content: '#6b5228' },
  synced: { bg: '#f3f3f5', border: '#c0c0c8', text: '#888890', content: '#6e6e78' },
  none: { bg: '#eaeaed', border: '#b8b8c0', text: '#808088', content: '#606068' },
};

const TIER_DEFAULTS = { 1: 'new', 2: 'none', 3: 'none' };
const MAX_PREVIEW_CHARS = 600;

function getPalette(syncStatus, tier) {
  if (syncStatus === 'sealed') return STATUS_PALETTE.sealed;
  if (syncStatus === 'new') return STATUS_PALETTE.new;
  if (syncStatus === 'modified') return STATUS_PALETTE.modified;
  if (syncStatus === 'synced') return STATUS_PALETTE.synced;
  return STATUS_PALETTE[TIER_DEFAULTS[tier] || 'none'];
}

function stripMarkdown(md, maxLen = MAX_PREVIEW_CHARS) {
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
    .replace(/`([^`]*)`/g, '')
    .replace(/^\s*[-*+]\s+/gm, '- ')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/^\s*\|.*\|.*$/gm, '')
    .replace(/^\s*[-=]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen) : stripped;
}

const STAMP_CONFIG = {
  sealed: { label: 'SENSITIVE', cls: 'stamp-sealed' },
  new: { label: 'NEW', cls: 'stamp-new' },
  modified: { label: 'MOD', cls: 'stamp-mod' },
  synced: { label: 'OK', cls: 'stamp-synced' },
};

function Stamp({ status }) {
  const cfg = STAMP_CONFIG[status];
  if (!cfg) return null;
  if (status === 'sealed') {
    return <div className={`stamp-overlay ${cfg.cls}`}>{cfg.label}</div>;
  }
  return <span className={`stamp ${cfg.cls}`}>{cfg.label}</span>;
}

export const Card = React.memo(function Card({
  card,
  syncStatus,
  content,
  zoom = 1,
  selected,
  dimmed,
  selectMode,
  checked,
}) {
  const { file, x, y, w, h } = card;
  const tier = file._tier || 3;
  const isLog = file._isSessionLog;
  const effectiveStatus = syncStatus || null;
  const pal = isLog ? STATUS_PALETTE.none : getPalette(effectiveStatus, tier);
  const lod = zoom < 0.08 ? 0 : zoom < 0.18 ? 1 : 2;

  if (lod === 0) {
    return (
      <div
        className="card card-lod0"
        data-card-path={file.relativePath}
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          background: pal.bg,
          borderLeft: `3px solid ${pal.border}`,
        }}
      />
    );
  }

  const displayName = file.fileName.replace(/\.md$/i, '');

  if (lod === 1) {
    return (
      <div
        className={`card${isLog ? ' card-session-log' : ''}`}
        data-card-path={file.relativePath}
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          background: pal.bg,
          borderLeft: `3px solid ${pal.border}`,
        }}
      >
        <div className="card-header">
          {isLog && <span className="session-badge">LOG</span>}
          <div className="card-name" style={{ color: isLog ? '#999' : pal.text }}>
            {displayName}
          </div>
          <Stamp status={effectiveStatus} />
        </div>
      </div>
    );
  }

  const preview = useMemo(() => stripMarkdown(content), [content]);
  const classNames = [
    'card',
    isLog ? 'card-session-log' : '',
    effectiveStatus === 'sealed' ? 'card-sealed' : '',
    selected ? 'card-selected' : '',
    dimmed ? 'card-dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classNames}
      data-card-path={file.relativePath}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        background: pal.bg,
        borderLeft: `3px solid ${pal.border}`,
      }}
    >
      <div className="card-header">
        {selectMode && (
          <span className={`card-checkbox ${checked ? 'card-checkbox-on' : ''}`} data-checkbox="true">
            {checked ? '[x]' : '[ ]'}
          </span>
        )}
        {isLog && <span className="session-badge">LOG</span>}
        <div className="card-name" style={{ color: isLog ? '#999' : pal.text }}>
          {displayName}
        </div>
        {effectiveStatus !== 'sealed' && <Stamp status={effectiveStatus} />}
        {selected && !selectMode && (
          <button className="card-expand-btn" title="Read full document">
            {'->'}
          </button>
        )}
      </div>
      {preview && !isLog && (
        <div className="card-content" style={{ color: pal.content }}>
          {preview}
        </div>
      )}
      {isLog && preview && <div className="card-content card-content-log">{preview}</div>}
      {effectiveStatus === 'sealed' && <Stamp status="sealed" />}
    </div>
  );
});
