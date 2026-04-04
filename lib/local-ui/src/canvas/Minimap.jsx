/**
 * Minimap — shows the full canvas in miniature with a viewport indicator.
 * Rendered with <canvas> for performance.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import './Minimap.css';

const MM_W = 180;
const MM_H = 120;
const TIER_COLORS = { 1: '#d8b184', 2: '#91aed8', 3: '#96a3b8' };

export function Minimap({ cards, bounds, viewState, viewportRef, onNavigate }) {
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs || !bounds || bounds.w === 0) return;
    const ctx = cvs.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cvs.width = MM_W * dpr;
    cvs.height = MM_H * dpr;
    ctx.scale(dpr, dpr);

    // Scale factor: fit bounds into minimap
    const sx = MM_W / bounds.w;
    const sy = MM_H / bounds.h;
    const s = Math.min(sx, sy);
    const ox = (MM_W - bounds.w * s) / 2;
    const oy = (MM_H - bounds.h * s) / 2;

    // Background
    ctx.fillStyle = 'rgba(8, 13, 22, 0.92)';
    ctx.fillRect(0, 0, MM_W, MM_H);

    // Draw cards as tiny rectangles
    for (const card of cards) {
      const tier = card.file?._tier || 3;
      ctx.fillStyle = TIER_COLORS[tier] || '#888';
      ctx.fillRect(
        ox + card.x * s,
        oy + card.y * s,
        Math.max(1, card.w * s),
        Math.max(1, card.h * s),
      );
    }

    // Draw viewport indicator
    const vp = viewportRef.current;
    if (vp) {
      const { panX, panY, zoom } = viewState;
      const vpW = vp.clientWidth;
      const vpH = vp.clientHeight;
      // Viewport rect in canvas coords
      const vx = -panX / zoom;
      const vy = -panY / zoom;
      const vw = vpW / zoom;
      const vh = vpH / zoom;

      ctx.strokeStyle = '#c3d7ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        ox + vx * s,
        oy + vy * s,
        vw * s,
        vh * s,
      );
    }
  }, [cards, bounds, viewState, viewportRef]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Click on minimap to navigate
  const handleClick = useCallback((e) => {
    if (!bounds || bounds.w === 0 || !onNavigate) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const sx = MM_W / bounds.w;
    const sy = MM_H / bounds.h;
    const s = Math.min(sx, sy);
    const ox = (MM_W - bounds.w * s) / 2;
    const oy = (MM_H - bounds.h * s) / 2;

    // Convert minimap click to canvas coordinates
    const cx = (mx - ox) / s;
    const cy = (my - oy) / s;
    onNavigate(cx, cy);
  }, [bounds, onNavigate]);

  return (
    <div className="minimap">
      <canvas
        ref={canvasRef}
        className="minimap-canvas"
        width={MM_W}
        height={MM_H}
        onClick={handleClick}
      />
    </div>
  );
}
