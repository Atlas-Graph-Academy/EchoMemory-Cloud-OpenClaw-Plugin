/**
 * Card — layout-mode: colored rectangle with file name.
 * No content rendering. Size is determined by layout engine.
 */

import React from 'react';
import './Card.css';

const TIER_BG = { 1: '#fefcf3', 2: '#f8f9fc', 3: '#ededf0' };
const TIER_BORDER = { 1: '#d4a574', 2: '#a0b4d4', 3: '#c0c0c4' };
const TIER_TEXT = { 1: '#8b5e3c', 2: '#4a6fa5', 3: '#888' };

export const Card = React.memo(function Card({ card, syncStatus, onFocus }) {
  const { file, x, y, w, h } = card;
  const tier = file._tier || 3;
  const displayName = file.fileName.replace(/\.md$/i, '');

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
      <div className="card-name" style={{ color: TIER_TEXT[tier] }}>
        {displayName}
      </div>
      {syncStatus === 'new' && <span className="stamp stamp-new">NEW</span>}
      {syncStatus === 'modified' && <span className="stamp stamp-mod">MOD</span>}
      {syncStatus === 'synced' && <span className="stamp stamp-synced">✓</span>}
    </div>
  );
});
