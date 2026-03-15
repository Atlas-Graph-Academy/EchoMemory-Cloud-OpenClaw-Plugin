/**
 * CardPlaceholder — lightweight stand-in for off-screen cards.
 * Same size/position/color as the real card, but no text content.
 * Gives visual continuity during panning without rendering cost.
 */

import React from 'react';

const TIER_BG = { 1: '#fefcf3', 2: '#f8f9fc', 3: '#ededf0' };
const TIER_BORDER = { 1: '#d4a574', 2: '#a0b4d4', 3: '#c0c0c4' };

export const CardPlaceholder = React.memo(function CardPlaceholder({ card }) {
  const { file, x, y, w, h } = card;
  const tier = file._tier || 3;
  const isLog = file._isSessionLog;
  const bg = isLog ? '#e8e8ec' : TIER_BG[tier];
  const border = isLog ? '#b0b0b8' : TIER_BORDER[tier];

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        background: bg,
        borderLeft: `3px solid ${border}`,
        borderRadius: 4,
        opacity: isLog ? 0.3 : 0.55,
        contain: 'strict',
        pointerEvents: 'none',
      }}
    />
  );
});
