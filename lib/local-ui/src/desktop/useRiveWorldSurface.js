import { useEffect } from 'react';

export function useRiveWorldSurface({ rive, canvas, container, pixelRatio }) {
  useEffect(() => {
    if (!rive || !canvas || !container) return undefined;

    let frameId = 0;
    const resizeDrawingSurface = () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        const cssWidth = container.clientWidth || canvas.clientWidth;
        const cssHeight = container.clientHeight || canvas.clientHeight;
        if (!cssWidth || !cssHeight) return;

        const width = Math.max(1, Math.round(cssWidth * pixelRatio));
        const height = Math.max(1, Math.round(cssHeight * pixelRatio));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        rive.devicePixelRatioUsed = pixelRatio;
        rive.resizeToCanvas();
        rive.startRendering();
        rive.drawFrame?.();
      });
    };

    resizeDrawingSurface();
    window.addEventListener('resize', resizeDrawingSurface);
    const observer = new ResizeObserver(resizeDrawingSurface);
    observer.observe(container);

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resizeDrawingSurface);
      observer.disconnect();
    };
  }, [canvas, container, pixelRatio, rive]);
}
