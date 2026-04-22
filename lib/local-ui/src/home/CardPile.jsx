import React from 'react';
import './CardPile.css';

/**
 * CardPile — wraps a single HomeCard in a stacking-paper visual effect.
 * Two ghost layers sit behind the real card, rotated and offset like a pile
 * of documents. On hover, the ghosts spread slightly wider.
 */
export function CardPile({ children, onClick, ariaLabel }) {
  return (
    <div
      className="card-pile"
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="pile-ghost" aria-hidden="true" />
      <div className="pile-ghost" aria-hidden="true" />
      {children}
    </div>
  );
}
