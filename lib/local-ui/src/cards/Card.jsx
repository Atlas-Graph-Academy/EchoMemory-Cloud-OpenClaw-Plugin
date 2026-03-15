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

const TIER_BG = { 1: '#fefcf3', 2: '#f8f9fc', 3: '#ededf0' };
const TIER_BORDER = { 1: '#d4a574', 2: '#a0b4d4', 3: '#c0c0c4' };
const TIER_TEXT = { 1: '#8b5e3c', 2: '#4a6fa5', 3: '#888' };
const TIER_CONTENT = { 1: '#6b4e2c', 2: '#3a5a8a', 3: '#666' };

const MAX_PREVIEW_CHARS = 600; // never put more than this into the DOM

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

export const Card = React.memo(function Card({ card, syncStatus, content, zoom = 1, onFocus }) {
  const { file, x, y, w, h } = card;
  const tier = file._tier || 3;
  const isLog = file._isSessionLog;

  // LOD levels
  const lod = zoom < 0.08 ? 0 : zoom < 0.18 ? 1 : 2;

  const bg = isLog ? '#e8e8ec' : TIER_BG[tier];
  const border = isLog ? '#b0b0b8' : TIER_BORDER[tier];

  // LOD 0: pure colored rectangle — zero children, minimal DOM
  if (lod === 0) {
    return (
      <div
        className="card card-lod0"
        data-card-path={file.relativePath}
        style={{
          left: x, top: y, width: w, height: h,
          background: bg,
          borderLeft: `3px solid ${border}`,
        }}
      />
    );
  }

  const displayName = file.fileName.replace(/\.md$/i, '');

  // LOD 1: title only
  if (lod === 1) {
    return (
      <div
        className={`card${isLog ? ' card-session-log' : ''}`}
        data-card-path={file.relativePath}
        onClick={(e) => { e.stopPropagation(); if (onFocus) onFocus(); }}
        style={{
          left: x, top: y, width: w, height: h,
          background: bg,
          borderLeft: `3px solid ${border}`,
        }}
      >
        <div className="card-header">
          {isLog && <span className="session-badge">💬</span>}
          <div className="card-name" style={{ color: isLog ? '#999' : TIER_TEXT[tier] }}>
            {displayName}
          </div>
          {syncStatus === 'new' && <span className="stamp stamp-new">NEW</span>}
          {syncStatus === 'modified' && <span className="stamp stamp-mod">MOD</span>}
          {syncStatus === 'synced' && <span className="stamp stamp-synced">✓</span>}
        </div>
      </div>
    );
  }

  // LOD 2: full card with truncated content preview
  // Memoize the stripped content so it doesn't re-run on every pan
  const preview = useMemo(() => stripMarkdown(content), [content]);

  return (
    <div
      className={`card${isLog ? ' card-session-log' : ''}`}
      data-card-path={file.relativePath}
      onClick={(e) => { e.stopPropagation(); if (onFocus) onFocus(); }}
      style={{
        left: x, top: y, width: w, height: h,
        background: bg,
        borderLeft: `3px solid ${border}`,
      }}
    >
      <div className="card-header">
        {isLog && <span className="session-badge">💬</span>}
        <div className="card-name" style={{ color: isLog ? '#999' : TIER_TEXT[tier] }}>
          {displayName}
        </div>
        {syncStatus === 'new' && <span className="stamp stamp-new">NEW</span>}
        {syncStatus === 'modified' && <span className="stamp stamp-mod">MOD</span>}
        {syncStatus === 'synced' && <span className="stamp stamp-synced">✓</span>}
      </div>
      {preview && !isLog && (
        <div className="card-content" style={{ color: TIER_CONTENT[tier] }}>
          {preview}
        </div>
      )}
      {isLog && preview && (
        <div className="card-content card-content-log">
          {preview}
        </div>
      )}
    </div>
  );
});
