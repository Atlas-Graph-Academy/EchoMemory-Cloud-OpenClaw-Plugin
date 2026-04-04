/**
 * Viewport - infinite canvas + minimap.
 *
 * Performance: viewport culling - only cards visible on screen are mounted
 * in the DOM. Off-screen cards are skipped entirely. A generous margin
 * ensures cards pop in before they're visible during fast panning.
 */

import React, { useRef, useCallback, useMemo } from 'react';
import { useCanvasTransform } from './useCanvas';
import { Card } from '../cards/Card';
import { CardPlaceholder } from '../cards/CardPlaceholder';
import { Minimap } from './Minimap';
import './Viewport.css';

const RENDER_MARGIN = 600;
const PLACEHOLDER_MARGIN = 2000;

export function Viewport({
  cards,
  sections,
  bounds,
  syncStatus,
  syncMetaByPath,
  transientStatusMap,
  contentMap,
  expandedWarnings,
  selectedPath,
  selectMode,
  syncSelection,
  selectablePaths,
  onCardClick,
  onCardExpand,
  onWarningToggle,
}) {
  const vpRef = useRef(null);
  const canvasRef = useRef(null);
  const {
    viewState,
    ready,
    panMoved,
    focusCard,
    animateTo,
    zoomIn,
    zoomOut,
    panBy,
    fitToCanvas,
    handlers,
  } = useCanvasTransform(vpRef, canvasRef, bounds);

  const { renderCards, placeholderCards } = useMemo(() => {
    const vp = vpRef.current;
    if (!vp || !ready) return { renderCards: cards, placeholderCards: [] };
    const { panX, panY, zoom } = viewState;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;

    const renderLeft = (-panX - RENDER_MARGIN) / zoom;
    const renderTop = (-panY - RENDER_MARGIN) / zoom;
    const renderRight = (-panX + vpW + RENDER_MARGIN) / zoom;
    const renderBottom = (-panY + vpH + RENDER_MARGIN) / zoom;

    const placeholderLeft = (-panX - PLACEHOLDER_MARGIN) / zoom;
    const placeholderTop = (-panY - PLACEHOLDER_MARGIN) / zoom;
    const placeholderRight = (-panX + vpW + PLACEHOLDER_MARGIN) / zoom;
    const placeholderBottom = (-panY + vpH + PLACEHOLDER_MARGIN) / zoom;

    const render = [];
    const placeholder = [];

    for (const card of cards) {
      const inOuter =
        card.x + card.w > placeholderLeft &&
        card.x < placeholderRight &&
        card.y + card.h > placeholderTop &&
        card.y < placeholderBottom;
      if (!inOuter) continue;

      const inInner =
        card.x + card.w > renderLeft &&
        card.x < renderRight &&
        card.y + card.h > renderTop &&
        card.y < renderBottom;
      if (inInner) {
        render.push(card);
      } else {
        placeholder.push(card);
      }
    }

    return { renderCards: render, placeholderCards: placeholder };
  }, [cards, viewState, ready]);

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

    return sections.filter((section) =>
      section.x + (section.w || 2000) > worldLeft &&
      section.x < worldRight &&
      section.y + 60 > worldTop &&
      section.y < worldBottom
    );
  }, [sections, viewState, ready]);

  const lastClickRef = useRef({ path: null, time: 0 });

  const handlePointerUp = (e) => {
    handlers.onPointerUp(e);
    if (!panMoved.current) {
      const el = document.elementFromPoint(e.clientX, e.clientY);

      if (el?.closest('.card-expand-btn')) {
        const cardEl = el.closest('[data-card-path]');
        if (cardEl && onCardExpand) onCardExpand(cardEl.dataset.cardPath);
        return;
      }

      if (el?.closest('.card-warning-toggle')) {
        const cardEl = el.closest('[data-card-path]');
        if (!cardEl || !onWarningToggle) return;
        const path = cardEl.dataset.cardPath;
        const card = cards.find((item) => item.key === path);
        if (card) focusCard(card);
        onWarningToggle(path);
        return;
      }

      const cardEl = el?.closest('[data-card-path]');
      if (cardEl) {
        const path = cardEl.dataset.cardPath;
        const card = cards.find((item) => item.key === path);
        if (card) {
          const now = Date.now();
          const last = lastClickRef.current;

          if (last.path === path && now - last.time < 400) {
            lastClickRef.current = { path: null, time: 0 };
            if (onCardExpand) onCardExpand(path);
            return;
          }

          lastClickRef.current = { path, time: now };
          focusCard(card);
          if (onCardClick) onCardClick(path);
        }
      } else if (onCardClick) {
        onCardClick(null);
      }
    }
  };

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
              {visibleSections.map((section) => (
                <div
                  key={section.id}
                  className="section-label"
                  style={{ left: section.x, top: section.y, color: section.color }}
                >
                  {section.label}
                  <span className="section-count">{section.count}</span>
                </div>
              ))}

              {placeholderCards.map((card) => (
                <CardPlaceholder key={card.key} card={card} />
              ))}

              {renderCards.map((card) => (
                <Card
                  key={card.key}
                  card={card}
                  syncStatus={syncStatus?.[card.key]}
                  syncMeta={syncMetaByPath?.[card.key]}
                  transientStatus={transientStatusMap?.[card.key]}
                  content={contentMap?.get(card.key) ?? ''}
                  warningExpanded={!!expandedWarnings?.[card.key]}
                  zoom={viewState.zoom}
                  selected={selectedPath === card.key}
                  dimmed={!!selectedPath && selectedPath !== card.key}
                  selectMode={selectMode}
                  checked={syncSelection?.has(card.key)}
                  selectable={selectablePaths?.has(card.key)}
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

      <div className="viewport-controls">
        <div className="viewport-control-cluster">
          <button type="button" className="viewport-control viewport-control-fit" onClick={fitToCanvas} title="Fit canvas">
            Fit
          </button>
          <button type="button" className="viewport-control" onClick={zoomIn} title="Zoom in">
            +
          </button>
          <button type="button" className="viewport-control" onClick={zoomOut} title="Zoom out">
            -
          </button>
          <div className="zoom-indicator">{zoomPct}% | {renderCards.length}/{cards.length}</div>
        </div>
        <div className="viewport-control-cluster viewport-control-cluster--pad">
          <div className="viewport-control-pad">
            <button type="button" className="viewport-control" onClick={() => panBy(0, 160)} title="Pan up">
              Up
            </button>
            <div className="viewport-control-pad__row">
              <button type="button" className="viewport-control" onClick={() => panBy(160, 0)} title="Pan left">
                Left
              </button>
              <button type="button" className="viewport-control" onClick={() => panBy(-160, 0)} title="Pan right">
                Right
              </button>
            </div>
            <button type="button" className="viewport-control" onClick={() => panBy(0, -160)} title="Pan down">
              Down
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
