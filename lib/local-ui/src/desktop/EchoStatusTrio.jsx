import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alignment, Fit, Layout, useRive } from '@rive-app/react-canvas';
import { useRiveWorldSurface } from './useRiveWorldSurface';

const RIVE_SRC = '/rive/echo_general-file-18.riv';
const STATUS_SEQUENCE = ['ready', 'private', 'synced'];

const STATUS_META = {
  ready: {
    idleAnimation: 'Lumi-Idle-Loop',
    label: 'Ready',
    caption: 'ready to sync',
    className: 'echo-status--ready',
  },
  private: {
    idleAnimation: 'Syk-Idle-Loop',
    label: 'Private',
    caption: 'stays local',
    className: 'echo-status--private',
  },
  synced: {
    idleAnimation: 'Echo-Idle-Loop',
    label: 'Synced',
    caption: 'saved to Echo',
    className: 'echo-status--synced',
  },
};

const RIVE_PIXEL_RATIO = 3;

function StatusEcho({ tone, onAdvance }) {
  const meta = STATUS_META[tone];
  const idleTimerRef = useRef(null);

  const { canvas, container, rive, RiveComponent } = useRive({
    src: RIVE_SRC,
    animations: meta.idleAnimation,
    autoplay: true,
    layout: new Layout({
      fit: Fit.Contain,
      alignment: Alignment.Center,
    }),
  }, {
    useDevicePixelRatio: true,
    customDevicePixelRatio: RIVE_PIXEL_RATIO,
    useOffscreenRenderer: false,
    shouldResizeCanvasToContainer: true,
    shouldUseIntersectionObserver: false,
  });
  useRiveWorldSurface({ rive, canvas, container, pixelRatio: RIVE_PIXEL_RATIO });

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, []);

  const handleClick = useCallback((event) => {
    event.stopPropagation();
    onAdvance();
  }, [onAdvance]);

  return (
    <button
      type="button"
      className={`echo-status ${meta.className}`}
      data-no-pan
      data-canvas-pan-target
      onClick={handleClick}
      aria-label={`${meta.label}: ${meta.caption}. Click to switch status.`}
    >
      <span className="echo-status__stage" aria-hidden="true">
        <RiveComponent />
      </span>
      <span className="echo-status__copy">
        <strong>{meta.label}</strong>
        <span>{meta.caption}</span>
      </span>
    </button>
  );
}

export function EchoStatusTrio() {
  const [statusIndex, setStatusIndex] = useState(0);
  const tone = STATUS_SEQUENCE[statusIndex];
  const advanceStatus = useCallback(() => {
    setStatusIndex((index) => (index + 1) % STATUS_SEQUENCE.length);
  }, []);

  return (
    <div className="echo-status-trio" data-no-pan aria-label="Echo memory status guide">
      <StatusEcho key={tone} tone={tone} onAdvance={advanceStatus} />
    </div>
  );
}
