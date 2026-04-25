import React, { useCallback, useEffect, useRef } from 'react';
import { Alignment, Fit, Layout, useRive, useStateMachineInput } from '@rive-app/react-canvas';
import { useRiveWorldSurface } from './useRiveWorldSurface';

const RIVE_SRC = '/rive/echo_general-file-18.riv';
const RIVE_PIXEL_RATIO = 4;

export function EchoMemoryGuide({ onConnect }) {
  const gardenTimerRef = useRef(null);

  const { canvas, container, rive, RiveComponent } = useRive({
    src: RIVE_SRC,
    stateMachines: 'SM-Syk',
    autoplay: true,
    layout: new Layout({
      fit: Fit.Cover,
      alignment: Alignment.Center,
    }),
  }, {
    useDevicePixelRatio: true,
    customDevicePixelRatio: RIVE_PIXEL_RATIO,
    useOffscreenRenderer: false,
    shouldResizeCanvasToContainer: true,
    shouldUseIntersectionObserver: false,
  });

  const tapGardenSyk = useStateMachineInput(rive, 'SM-Syk', 'tapGardenSyk');
  useRiveWorldSurface({ rive, canvas, container, pixelRatio: RIVE_PIXEL_RATIO });

  useEffect(() => () => {
    if (gardenTimerRef.current) window.clearTimeout(gardenTimerRef.current);
  }, []);

  const nudgeEcho = useCallback(() => {
    if (tapGardenSyk) {
      tapGardenSyk.value = 0;
      window.requestAnimationFrame(() => {
        tapGardenSyk.value = 1;
        if (gardenTimerRef.current) window.clearTimeout(gardenTimerRef.current);
        gardenTimerRef.current = window.setTimeout(() => { tapGardenSyk.value = 0; }, 280);
      });
    }
  }, [tapGardenSyk]);

  const handleConnect = useCallback((event) => {
    event.stopPropagation();
    nudgeEcho();
    onConnect?.();
  }, [nudgeEcho, onConnect]);

  return (
    <div
      className="desktop-echo-cta"
      data-no-pan
      onPointerEnter={nudgeEcho}
    >
      <button
        type="button"
        className="desktop-echo-cta__animation"
        data-canvas-pan-target
        onClick={handleConnect}
        aria-label="Connect Echo Memory"
      >
        <RiveComponent />
      </button>

      <div className="desktop-echo-cta__body">
        <h1>Let Echo remember.</h1>
        <p>Your Markdown becomes encrypted Echo Memories.</p>

        <div className="desktop-echo-cta__actions">
          <button type="button" className="desktop-echo-cta__button" onClick={handleConnect}>
            Connect Echo
          </button>
        </div>
      </div>
    </div>
  );
}
