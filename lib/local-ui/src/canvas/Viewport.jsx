/**
 * Viewport — infinite canvas + minimap.
 */

import React, { useRef, useCallback } from 'react';
import { useCanvasTransform } from './useCanvas';
import { Card } from '../cards/Card';
import { Minimap } from './Minimap';
import './Viewport.css';

export function Viewport({ cards, sections, bounds, syncStatus, contentMap, onCardClick }) {
  const vpRef = useRef(null);
  const canvasRef = useRef(null);
  const { viewState, ready, panMoved, focusCard, animateTo, handlers } =
    useCanvasTransform(vpRef, canvasRef, bounds);

  const handlePointerUp = (e) => {
    handlers.onPointerUp(e);
    if (!panMoved.current) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cardEl = el?.closest('[data-card-path]');
      if (cardEl) {
        const path = cardEl.dataset.cardPath;
        const card = cards.find(c => c.key === path);
        if (card) {
          focusCard(card);
          if (onCardClick) onCardClick(path);
        }
      }
    }
  };

  // Minimap navigation: center viewport on clicked canvas coordinate
  const handleMinimapNav = useCallback((cx, cy) => {
    const vp = vpRef.current;
    if (!vp) return;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    const z = viewState.zoom;
    const targetPanX = (vpW / 2) - cx * z;
    const targetPanY = (vpH / 2) - cy * z;
    animateTo(targetPanX, targetPanY, z, 300);
  }, [viewState.zoom, animateTo]);

  const zoomPct = Math.round(viewState.zoom * 100);

  return (
    <div className="viewport-root">
      <div
        ref={vpRef}
        className="viewport"
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          ref={canvasRef}
          className="canvas"
          style={{ width: bounds.w, height: bounds.h }}
        >
          {ready && (
            <>
              {sections.map(sec => (
                <div
                  key={sec.id}
                  className="section-label"
                  style={{ left: sec.x, top: sec.y, color: sec.color }}
                >
                  {sec.label}
                  <span className="section-count">{sec.count}</span>
                </div>
              ))}

              {cards.map(card => (
                <Card
                  key={card.key}
                  card={card}
                  syncStatus={syncStatus?.[card.key]}
                  content={contentMap?.get(card.key) ?? ''}
                  onFocus={() => {
                    focusCard(card);
                    if (onCardClick) onCardClick(card.key);
                  }}
                />
              ))}
            </>
          )}
        </div>
      </div>

      <Minimap
        cards={cards}
        bounds={bounds}
        viewState={viewState}
        viewportRef={vpRef}
        onNavigate={handleMinimapNav}
      />

      <div className="zoom-indicator">{zoomPct}%</div>
    </div>
  );
}
