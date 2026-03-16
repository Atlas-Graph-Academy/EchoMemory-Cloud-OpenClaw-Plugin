/**
 * Viewport — infinite canvas + minimap.
 *
 * Performance: viewport culling — only cards visible on screen are mounted
 * in the DOM. Off-screen cards are skipped entirely. A generous margin
 * ensures cards pop in before they're visible during fast panning.
 */

import React, { useRef, useCallback, useMemo } from 'react';
import { useCanvasTransform } from './useCanvas';
import { Card } from '../cards/Card';
import { CardPlaceholder } from '../cards/CardPlaceholder';
import { Minimap } from './Minimap';
import './Viewport.css';

// Cards within this margin get fully rendered (content visible)
const RENDER_MARGIN = 600; // px in screen space
// Cards within this outer margin get placeholder (colored blur block)
// Cards beyond this are not in DOM at all
const PLACEHOLDER_MARGIN = 2000; // px in screen space

export function Viewport({ cards, sections, bounds, syncStatus, contentMap, selectedPath, onCardClick, onCardExpand }) {
  const vpRef = useRef(null);
  const canvasRef = useRef(null);
  const { viewState, ready, panMoved, focusCard, animateTo, handlers } =
    useCanvasTransform(vpRef, canvasRef, bounds);

  // ── Two-tier viewport culling ──
  // Inner zone (RENDER_MARGIN): full card with content
  // Outer zone (PLACEHOLDER_MARGIN): lightweight colored placeholder
  // Beyond: not in DOM at all
  const { renderCards, placeholderCards } = useMemo(() => {
    const vp = vpRef.current;
    if (!vp || !ready) return { renderCards: cards, placeholderCards: [] };
    const { panX, panY, zoom } = viewState;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;

    // Inner rect (full render)
    const rL = (-panX - RENDER_MARGIN) / zoom;
    const rT = (-panY - RENDER_MARGIN) / zoom;
    const rR = (-panX + vpW + RENDER_MARGIN) / zoom;
    const rB = (-panY + vpH + RENDER_MARGIN) / zoom;

    // Outer rect (placeholder)
    const pL = (-panX - PLACEHOLDER_MARGIN) / zoom;
    const pT = (-panY - PLACEHOLDER_MARGIN) / zoom;
    const pR = (-panX + vpW + PLACEHOLDER_MARGIN) / zoom;
    const pB = (-panY + vpH + PLACEHOLDER_MARGIN) / zoom;

    const render = [];
    const placeholder = [];

    for (const c of cards) {
      const inOuter = c.x + c.w > pL && c.x < pR && c.y + c.h > pT && c.y < pB;
      if (!inOuter) continue; // completely off-screen, skip

      const inInner = c.x + c.w > rL && c.x < rR && c.y + c.h > rT && c.y < rB;
      if (inInner) {
        render.push(c);
      } else {
        placeholder.push(c);
      }
    }
    return { renderCards: render, placeholderCards: placeholder };
  }, [cards, viewState, ready]);

  // ── Visible sections ──
  const visibleSections = useMemo(() => {
    const vp = vpRef.current;
    if (!vp || !ready) return sections;
    const { panX, panY, zoom } = viewState;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    const worldLeft = (-panX - PLACEHOLDER_MARGIN) / zoom;
    const worldTop = (-panY - PLACEHOLDER_MARGIN) / zoom;
    const worldRight = (-panX + vpW + PLACEHOLDER_MARGIN) / zoom;
    const worldBottom = (-panY + vpH + PLACEHOLDER_MARGIN) / zoom;

    return sections.filter(s =>
      s.x + (s.w || 2000) > worldLeft &&
      s.x < worldRight &&
      s.y + 60 > worldTop &&
      s.y < worldBottom
    );
  }, [sections, viewState, ready]);

  // ── Unified click handling ──
  // ALL click logic lives here in the pointer event system.
  // Card components are pure display — no onClick handlers.
  // This eliminates pointer vs React event conflicts.
  const lastClickRef = useRef({ path: null, time: 0 });

  const handlePointerUp = (e) => {
    handlers.onPointerUp(e);
    if (!panMoved.current) {
      const el = document.elementFromPoint(e.clientX, e.clientY);

      // Expand button click → go to reading mode
      if (el?.closest('.card-expand-btn')) {
        const cardEl = el.closest('[data-card-path]');
        if (cardEl && onCardExpand) onCardExpand(cardEl.dataset.cardPath);
        return;
      }

      const cardEl = el?.closest('[data-card-path]');
      if (cardEl) {
        const path = cardEl.dataset.cardPath;
        const card = cards.find(c => c.key === path);
        if (card) {
          const now = Date.now();
          const last = lastClickRef.current;
          
          // Double-click on same card → expand to reading mode
          if (last.path === path && now - last.time < 400) {
            lastClickRef.current = { path: null, time: 0 };
            if (onCardExpand) onCardExpand(path);
            return;
          }
          
          lastClickRef.current = { path, time: now };
          focusCard(card);
          if (onCardClick) onCardClick(path);
        }
      } else {
        // Clicked on empty canvas → deselect
        if (onCardClick) onCardClick(null);
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
              {visibleSections.map(sec => (
                <div
                  key={sec.id}
                  className="section-label"
                  style={{ left: sec.x, top: sec.y, color: sec.color }}
                >
                  {sec.label}
                  <span className="section-count">{sec.count}</span>
                </div>
              ))}

              {placeholderCards.map(card => (
                <CardPlaceholder key={card.key} card={card} />
              ))}

              {renderCards.map(card => (
                <Card
                  key={card.key}
                  card={card}
                  syncStatus={syncStatus?.[card.key]}
                  content={contentMap?.get(card.key) ?? ''}
                  zoom={viewState.zoom}
                  selected={selectedPath === card.key}
                  dimmed={!!selectedPath && selectedPath !== card.key}
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

      <div className="zoom-indicator">{zoomPct}% · {renderCards.length}/{cards.length}</div>
    </div>
  );
}
