/**
 * Card — renders file name + markdown content preview.
 * Size is determined by layout engine.
 *
 * Performance: LOD (Level of Detail) based on zoom level.
 *   zoom < 0.08  → colored rectangle only (no DOM children)
 *   zoom < 0.18  → title only
 *   zoom >= 0.18 → title + truncated content preview
 *
 * Content is pre-truncated to MAX_PREVIEW_CHARS to avoid
 * putting 50KB strings into the DOM.
 */

import React, { useMemo } from 'react';
import './Card.css';

// ── Color system based on sync status ──
// Designed to be subtle, readable, and consistent with the warm archive feel.
//
// sealed   → muted rose/red — sensitive, do not upload
// new      → warm cream/white — needs attention, should be processed
// modified → warm cream/white — same as new, needs re-processing
// synced   → cool light grey — already handled, fade into background
// (none)   → neutral grey — no sync relevance, quiet

const STATUS_PALETTE = {
  sealed:   { bg: '#fdf2f2', border: '#c9a0a0', text: '#8b4c4c', content: '#7a4040' },
  new:      { bg: '#fefcf6', border: '#d4b882', text: '#7a6230', content: '#6b5228' },
  modified: { bg: '#fefcf6', border: '#d4b882', text: '#7a6230', content: '#6b5228' },
  synced:   { bg: '#f3f3f5', border: '#c0c0c8', text: '#888890', content: '#6e6e78' },
  none:     { bg: '#eaeaed', border: '#b8b8c0', text: '#808088', content: '#606068' },
};

// Tier-based fallback (used when no sync status)
const TIER_DEFAULTS = { 1: 'new', 2: 'none', 3: 'none' };

function getPalette(syncStatus, tier) {
  if (syncStatus === 'sealed') return STATUS_PALETTE.sealed;
  if (syncStatus === 'new') return STATUS_PALETTE.new;
  if (syncStatus === 'modified') return STATUS_PALETTE.modified;
  if (syncStatus === 'synced') return STATUS_PALETTE.synced;
  // No status — use tier default
  return STATUS_PALETTE[TIER_DEFAULTS[tier] || 'none'];
}

const MAX_PREVIEW_CHARS = 600;

/**
 * Strip markdown syntax to plain text for preview.
 * Truncates FIRST, then strips — avoids regex running on 50KB strings.
 */
function stripMarkdown(md, maxLen = MAX_PREVIEW_CHARS) {
  if (!md) return '';
  // Truncate raw input first for speed
  const raw = md.length > maxLen * 2 ? md.slice(0, maxLen * 2) : md;
  const stripped = raw
    .replace(/^---[\s\S]*?---\n?/, '')     // frontmatter
    .replace(/```[\s\S]*?```/g, '')         // code blocks (before inline)
    .replace(/^#{1,6}\s+/gm, '')            // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')        // bold
    .replace(/\*(.+?)\*/g, '$1')            // italic
    .replace(/__(.+?)__/g, '$1')            // bold alt
    .replace(/_(.+?)_/g, '$1')              // italic alt
    .replace(/~~(.+?)~~/g, '$1')            // strikethrough
    .replace(/`([^`]*)`/g, '')              // inline code
    .replace(/^\s*[-*+]\s+/gm, '• ')        // list items
    .replace(/^\s*\d+\.\s+/gm, '')          // numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')// links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // images
    .replace(/^\s*>\s+/gm, '')              // blockquotes
    .replace(/^\s*\|.*\|.*$/gm, '')         // tables
    .replace(/^\s*[-=]{3,}\s*$/gm, '')      // horizontal rules
    .replace(/\n{3,}/g, '\n\n')             // collapse blank lines
    .trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen) : stripped;
}

// ── Stamp label/config per status ──
const STAMP_CONFIG = {
  sealed:   { label: '密 SEALED', cls: 'stamp-sealed' },
  new:      { label: 'NEW',       cls: 'stamp-new' },
  modified: { label: 'MOD',       cls: 'stamp-mod' },
  synced:   { label: '✓',         cls: 'stamp-synced' },
};

function Stamp({ status }) {
  const cfg = STAMP_CONFIG[status];
  if (!cfg) return null;
  // Sealed stamp is centered overlay; others are in the header
  if (status === 'sealed') {
    return <div className={`stamp-overlay ${cfg.cls}`}>{cfg.label}</div>;
  }
  return <span className={`stamp ${cfg.cls}`}>{cfg.label}</span>;
}

export const Card = React.memo(function Card({ card, syncStatus, content, zoom = 1, onFocus }) {
  const { file, x, y, w, h } = card;
  const tier = file._tier || 3;
  const isLog = file._isSessionLog;
  const effectiveStatus = syncStatus || null;
  const pal = isLog
    ? STATUS_PALETTE.none
    : getPalette(effectiveStatus, tier);

  // LOD levels
  const lod = zoom < 0.08 ? 0 : zoom < 0.18 ? 1 : 2;

  // LOD 0: pure colored rectangle
  if (lod === 0) {
    return (
      <div
        className="card card-lod0"
        data-card-path={file.relativePath}
        style={{
          left: x, top: y, width: w, height: h,
          background: pal.bg,
          borderLeft: `3px solid ${pal.border}`,
        }}
      />
    );
  }

  const displayName = file.fileName.replace(/\.md$/i, '');

  // LOD 1: title + stamp only
  if (lod === 1) {
    return (
      <div
        className={`card${isLog ? ' card-session-log' : ''}`}
        data-card-path={file.relativePath}
        onClick={(e) => { e.stopPropagation(); if (onFocus) onFocus(); }}
        style={{
          left: x, top: y, width: w, height: h,
          background: pal.bg,
          borderLeft: `3px solid ${pal.border}`,
        }}
      >
        <div className="card-header">
          {isLog && <span className="session-badge">💬</span>}
          <div className="card-name" style={{ color: isLog ? '#999' : pal.text }}>
            {displayName}
          </div>
          <Stamp status={effectiveStatus} />
        </div>
      </div>
    );
  }

  // LOD 2: full card
  const preview = useMemo(() => stripMarkdown(content), [content]);

  return (
    <div
      className={`card${isLog ? ' card-session-log' : ''}${effectiveStatus === 'sealed' ? ' card-sealed' : ''}`}
      data-card-path={file.relativePath}
      onClick={(e) => { e.stopPropagation(); if (onFocus) onFocus(); }}
      style={{
        left: x, top: y, width: w, height: h,
        background: pal.bg,
        borderLeft: `3px solid ${pal.border}`,
      }}
    >
      <div className="card-header">
        {isLog && <span className="session-badge">💬</span>}
        <div className="card-name" style={{ color: isLog ? '#999' : pal.text }}>
          {displayName}
        </div>
        {effectiveStatus !== 'sealed' && <Stamp status={effectiveStatus} />}
      </div>
      {preview && !isLog && (
        <div className="card-content" style={{ color: pal.content }}>
          {preview}
        </div>
      )}
      {isLog && preview && (
        <div className="card-content card-content-log">
          {preview}
        </div>
      )}
      {effectiveStatus === 'sealed' && <Stamp status="sealed" />}
    </div>
  );
});
