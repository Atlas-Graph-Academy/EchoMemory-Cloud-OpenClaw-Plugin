/**
 * Card — renders file name + markdown content preview.
 * Size is determined by layout engine.
 */

import React from 'react';
import './Card.css';

const TIER_BG = { 1: '#fefcf3', 2: '#f8f9fc', 3: '#ededf0' };
const TIER_BORDER = { 1: '#d4a574', 2: '#a0b4d4', 3: '#c0c0c4' };
const TIER_TEXT = { 1: '#8b5e3c', 2: '#4a6fa5', 3: '#888' };
const TIER_CONTENT = { 1: '#6b4e2c', 2: '#3a5a8a', 3: '#666' };

/**
 * Strip markdown syntax to plain text for preview.
 * Keeps it fast — no full parser, just common patterns.
 */
function stripMarkdown(md) {
  if (!md) return '';
  return md
    .replace(/^---[\s\S]*?---\n?/, '')     // frontmatter
    .replace(/^#{1,6}\s+/gm, '')            // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')        // bold
    .replace(/\*(.+?)\*/g, '$1')            // italic
    .replace(/__(.+?)__/g, '$1')            // bold alt
    .replace(/_(.+?)_/g, '$1')              // italic alt
    .replace(/~~(.+?)~~/g, '$1')            // strikethrough
    .replace(/`{1,3}[^`]*`{1,3}/g, '')     // inline code
    .replace(/```[\s\S]*?```/g, '')         // code blocks
    .replace(/^\s*[-*+]\s+/gm, '• ')        // list items
    .replace(/^\s*\d+\.\s+/gm, '')          // numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')// links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // images
    .replace(/^\s*>\s+/gm, '')              // blockquotes
    .replace(/^\s*\|.*\|.*$/gm, '')         // tables
    .replace(/^\s*[-=]{3,}\s*$/gm, '')      // horizontal rules
    .replace(/\n{3,}/g, '\n\n')             // collapse blank lines
    .trim();
}

export const Card = React.memo(function Card({ card, syncStatus, content, onFocus }) {
  const { file, x, y, w, h } = card;
  const tier = file._tier || 3;
  const displayName = file.fileName.replace(/\.md$/i, '');
  const preview = stripMarkdown(content);

  return (
    <div
      className="card"
      data-card-path={file.relativePath}
      onClick={(e) => { e.stopPropagation(); if (onFocus) onFocus(); }}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        background: TIER_BG[tier],
        borderLeft: `3px solid ${TIER_BORDER[tier]}`,
      }}
    >
      <div className="card-header">
        <div className="card-name" style={{ color: TIER_TEXT[tier] }}>
          {displayName}
        </div>
        {syncStatus === 'new' && <span className="stamp stamp-new">NEW</span>}
        {syncStatus === 'modified' && <span className="stamp stamp-mod">MOD</span>}
        {syncStatus === 'synced' && <span className="stamp stamp-synced">✓</span>}
      </div>
      {preview && (
        <div className="card-content" style={{ color: TIER_CONTENT[tier] }}>
          {preview}
        </div>
      )}
    </div>
  );
});
