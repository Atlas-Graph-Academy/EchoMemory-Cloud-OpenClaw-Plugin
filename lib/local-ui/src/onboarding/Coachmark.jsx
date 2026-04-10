import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import './Coachmark.css';

function getFallbackRect() {
  const width = Math.min(window.innerWidth - 48, 360);
  const height = 10;
  return {
    top: Math.max(80, Math.round(window.innerHeight * 0.16)),
    left: Math.round((window.innerWidth - width) / 2),
    width,
    height,
    right: Math.round((window.innerWidth - width) / 2) + width,
    bottom: Math.max(80, Math.round(window.innerHeight * 0.16)) + height,
  };
}

function resolveCardPosition(rect, placement) {
  const cardWidth = 340;
  const gap = 18;
  const viewportPadding = 16;
  const fallbackTop = Math.max(viewportPadding, rect.bottom + gap);
  const positions = {
    right: {
      top: rect.top,
      left: rect.right + gap,
    },
    left: {
      top: rect.top,
      left: rect.left - cardWidth - gap,
    },
    top: {
      top: rect.top - gap,
      left: rect.left + rect.width / 2 - cardWidth / 2,
      translateY: '-100%',
    },
    bottom: {
      top: rect.bottom + gap,
      left: rect.left + rect.width / 2 - cardWidth / 2,
    },
    center: {
      top: rect.top + rect.height / 2,
      left: rect.left + rect.width / 2 - cardWidth / 2,
      translateY: '-50%',
    },
  };
  const choice = positions[placement] || positions.bottom;
  const maxLeft = window.innerWidth - cardWidth - viewportPadding;
  const top = Math.min(window.innerHeight - 220, Math.max(viewportPadding, choice.top ?? fallbackTop));
  const left = Math.min(maxLeft, Math.max(viewportPadding, choice.left ?? viewportPadding));
  return {
    top,
    left,
    transform: choice.translateY ? `translateY(${choice.translateY})` : undefined,
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
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    const updateRect = () => {
      if (targetElement) {
        setRect(targetElement.getBoundingClientRect());
      } else {
        setRect(getFallbackRect());
      }
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [targetElement, step?.id]);

  useEffect(() => {
    if (!targetElement) return undefined;
    targetElement.classList.add('tour-highlight-target');
    targetElement.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    return () => {
      targetElement.classList.remove('tour-highlight-target');
    };
  }, [targetElement, step?.id]);

  const safeRect = rect || getFallbackRect();
  const cardStyle = useMemo(
    () => resolveCardPosition(safeRect, step?.placement),
    [safeRect, step?.placement],
  );

  if (!step) return null;

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-label={step.title}>
      <div className="tour-scrim" />
      <div
        className="tour-highlight"
        style={{
          top: safeRect.top - 8,
          left: safeRect.left - 8,
          width: safeRect.width + 16,
          height: safeRect.height + 16,
        }}
      />
      <section className="tour-card" style={cardStyle}>
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
