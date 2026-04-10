import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './Coachmark.css';

const CARD_WIDTH = 372;
const GAP = 18;
const FRAME_PADDING = 18;
const RAIL_PADDING = 44;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildFallbackRect(frameRect) {
  const width = Math.min(frameRect.width - FRAME_PADDING * 2, 360);
  const top = Math.max(FRAME_PADDING, Math.round(frameRect.height * 0.14));
  const left = Math.round((frameRect.width - width) / 2);
  return {
    top,
    left,
    width,
    height: 12,
    right: left + width,
    bottom: top + 12,
  };
}

function getFrameRelativeRect(targetElement, frameRect) {
  if (!targetElement || !frameRect) return buildFallbackRect(frameRect);
  const rect = targetElement.getBoundingClientRect();
  return {
    top: rect.top - frameRect.top,
    left: rect.left - frameRect.left,
    width: rect.width,
    height: rect.height,
    right: rect.right - frameRect.left,
    bottom: rect.bottom - frameRect.top,
  };
}

function getSidebarBoundaries(frameElement, frameRect) {
  const setup = frameElement?.querySelector('.setup-sidebar');
  const cloud = frameElement?.querySelector('.cloud-sidebar');
  const setupRect = setup?.getBoundingClientRect();
  const cloudRect = cloud?.getBoundingClientRect();

  return {
    minLeft: Math.max(FRAME_PADDING, (setupRect?.right ?? frameRect.left) - frameRect.left + 10),
    maxRight: Math.min(frameRect.width - FRAME_PADDING, (cloudRect?.left ?? frameRect.right) - frameRect.left - 10),
  };
}

function candidateOrder(placement) {
  if (placement === 'left') return ['left', 'right', 'bottom', 'top', 'center'];
  if (placement === 'top') return ['top', 'bottom', 'right', 'left', 'center'];
  if (placement === 'bottom') return ['bottom', 'top', 'right', 'left', 'center'];
  if (placement === 'center') return ['center', 'bottom', 'top', 'right', 'left'];
  return ['right', 'left', 'bottom', 'top', 'center'];
}

function getCandidatePosition(type, targetRect, cardSize) {
  const centerLeft = targetRect.left + targetRect.width / 2 - cardSize.width / 2;
  const centerTop = targetRect.top + targetRect.height / 2 - cardSize.height / 2;

  switch (type) {
    case 'left':
      return { left: targetRect.left - cardSize.width - GAP, top: targetRect.top };
    case 'right':
      return { left: targetRect.right + GAP, top: targetRect.top };
    case 'top':
      return { left: centerLeft, top: targetRect.top - cardSize.height - GAP };
    case 'bottom':
      return { left: centerLeft, top: targetRect.bottom + GAP };
    case 'center':
    default:
      return { left: centerLeft, top: centerTop };
  }
}

function fitsBounds(position, cardSize, bounds) {
  return (
    position.left >= bounds.left &&
    position.top >= bounds.top &&
    (position.left + cardSize.width) <= bounds.right &&
    (position.top + cardSize.height) <= bounds.bottom
  );
}

function resolveCardPosition(frameRect, targetRect, cardSize, placement, frameElement) {
  const boundaries = getSidebarBoundaries(frameElement, frameRect);
  const bounds = {
    left: boundaries.minLeft,
    right: Math.max(boundaries.minLeft + cardSize.width, boundaries.maxRight),
    top: FRAME_PADDING,
    bottom: frameRect.height - FRAME_PADDING,
  };

  const exactRight = bounds.right - cardSize.width;
  const exactBottom = bounds.bottom - cardSize.height;
  const order = candidateOrder(placement);

  for (const type of order) {
    const position = getCandidatePosition(type, targetRect, cardSize);
    if (fitsBounds(position, cardSize, bounds)) {
      return { ...position, placement: type };
    }
  }

  const fallback = getCandidatePosition(order[0], targetRect, cardSize);
  return {
    left: clamp(fallback.left, bounds.left, exactRight),
    top: clamp(fallback.top, bounds.top, exactBottom),
    placement: order[0],
  };
}

export function Coachmark({
  step,
  stepIndex,
  totalSteps,
  targetElement,
  onNext,
  onPrev,
  onSkip,
  onPrimaryAction,
}) {
  const layerRef = useRef(null);
  const cardRef = useRef(null);
  const [frameRect, setFrameRect] = useState(null);
  const [targetRect, setTargetRect] = useState(null);
  const [cardHeight, setCardHeight] = useState(320);

  useLayoutEffect(() => {
    const updateRects = () => {
      const frameElement = layerRef.current?.parentElement;
      if (!frameElement) return;
      const nextFrameRect = frameElement.getBoundingClientRect();
      setFrameRect({
        top: 0,
        left: 0,
        width: nextFrameRect.width,
        height: nextFrameRect.height,
      });
      setTargetRect(getFrameRelativeRect(targetElement, nextFrameRect));
    };

    updateRects();
    window.addEventListener('resize', updateRects);
    window.addEventListener('scroll', updateRects, true);
    return () => {
      window.removeEventListener('resize', updateRects);
      window.removeEventListener('scroll', updateRects, true);
    };
  }, [targetElement, step?.id]);

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    setCardHeight(cardRef.current.offsetHeight || 320);
  }, [step?.id, frameRect?.width]);

  useEffect(() => {
    if (!targetElement) return undefined;
    targetElement.classList.add('tour-highlight-target');
    targetElement.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    return () => {
      targetElement.classList.remove('tour-highlight-target');
    };
  }, [targetElement, step?.id]);

  const frameElement = layerRef.current?.parentElement || null;
  const safeFrameRect = frameRect || { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
  const safeTargetRect = targetRect || buildFallbackRect(safeFrameRect);
  const cardSize = useMemo(
    () => ({
      width: Math.min(CARD_WIDTH, Math.max(300, safeFrameRect.width - FRAME_PADDING * 2 - RAIL_PADDING * 2)),
      height: Math.min(cardHeight, safeFrameRect.height - FRAME_PADDING * 2),
    }),
    [cardHeight, safeFrameRect.height, safeFrameRect.width],
  );
  const cardStyle = useMemo(
    () => resolveCardPosition(safeFrameRect, safeTargetRect, cardSize, step?.placement, frameElement),
    [cardSize, frameElement, safeFrameRect, safeTargetRect, step?.placement],
  );

  if (!step) return null;

  return (
    <div ref={layerRef} className="tour-layer" role="dialog" aria-modal="true" aria-label={step.title}>
      <div className="tour-scrim" />
      <div
        className="tour-highlight"
        style={{
          top: Math.max(FRAME_PADDING, safeTargetRect.top - 8),
          left: Math.max(FRAME_PADDING, safeTargetRect.left - 8),
          width: safeTargetRect.width + 16,
          height: safeTargetRect.height + 16,
        }}
      />
      <section
        ref={cardRef}
        className="tour-card"
        style={{
          top: cardStyle.top,
          left: cardStyle.left,
          width: cardSize.width,
          maxHeight: safeFrameRect.height - FRAME_PADDING * 2,
        }}
      >
        <div className="tour-card__eyebrow">
          Step {stepIndex + 1} of {totalSteps}
        </div>
        <h3 className="tour-card__title">{step.title}</h3>
        <p className="tour-card__body">{step.body}</p>
        {Array.isArray(step.notes) && step.notes.length > 0 && (
          <div className="tour-card__notes">
            {step.notes.map((note) => (
              <div key={`${step.id}-${note.label}`} className="tour-note">
                <span className="tour-note__label">{note.label}</span>
                <span className="tour-note__text">{note.text}</span>
              </div>
            ))}
          </div>
        )}
        <div className="tour-card__actions">
          <button type="button" className="tour-btn tour-btn--ghost" onClick={onSkip}>
            {stepIndex === totalSteps - 1 ? 'Close' : 'Skip'}
          </button>
          <div className="tour-card__nav">
            {stepIndex > 0 && (
              <button type="button" className="tour-btn tour-btn--subtle" onClick={onPrev}>
                Back
              </button>
            )}
            {step.primaryLabel && typeof onPrimaryAction === 'function' && (
              <button type="button" className="tour-btn tour-btn--subtle" onClick={onPrimaryAction}>
                {step.primaryLabel}
              </button>
            )}
            <button type="button" className="tour-btn" onClick={onNext}>
              {stepIndex === totalSteps - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
