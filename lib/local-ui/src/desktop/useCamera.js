import { useEffect, useRef, useCallback } from 'react';
import { useMotionValue } from 'framer-motion';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Shared camera state for the desktop canvas.
 *  - cameraX / cameraY  — world translation (px)
 *  - cameraScale        — zoom factor
 *
 * Returned handlers bind to a stage element to implement pan via a transparent
 * motion.div drag layer (see Desktop.jsx) and zoom via wheel with zoom-to-cursor.
 */
export function useCamera({ stageRef, minScale = 0.25, maxScale = 2.0, initial, lockYRef }) {
  const cameraX = useMotionValue(initial?.x ?? 0);
  const cameraY = useMotionValue(initial?.y ?? 0);
  const cameraScale = useMotionValue(initial?.scale ?? 1);

  const stageRectRef = useRef(null);
  const cameraTargetRef = useRef({
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    scale: initial?.scale ?? 1,
  });
  const cameraFrameRef = useRef(null);

  const cancelSmoothCamera = useCallback(() => {
    if (cameraFrameRef.current) {
      cancelAnimationFrame(cameraFrameRef.current);
      cameraFrameRef.current = null;
    }
  }, []);

  const setCameraImmediate = useCallback((x, y, scale = cameraScale.get()) => {
    cancelSmoothCamera();
    cameraTargetRef.current = { x, y, scale };
    cameraX.set(x);
    cameraY.set(y);
    cameraScale.set(scale);
  }, [cameraX, cameraY, cameraScale, cancelSmoothCamera]);

  const smoothCameraToTarget = useCallback(() => {
    if (cameraFrameRef.current) return;

    const step = () => {
      const target = cameraTargetRef.current;
      const currentX = cameraX.get();
      const currentY = cameraY.get();
      const currentScale = cameraScale.get();

      const nextX = currentX + (target.x - currentX) * 0.38;
      const nextY = currentY + (target.y - currentY) * 0.38;
      const nextScale = currentScale + (target.scale - currentScale) * 0.38;

      const done =
        Math.abs(target.x - nextX) < 0.18 &&
        Math.abs(target.y - nextY) < 0.18 &&
        Math.abs(target.scale - nextScale) < 0.0009;

      if (done) {
        cameraX.set(target.x);
        cameraY.set(target.y);
        cameraScale.set(target.scale);
        cameraFrameRef.current = null;
        return;
      }

      cameraX.set(nextX);
      cameraY.set(nextY);
      cameraScale.set(nextScale);
      cameraFrameRef.current = requestAnimationFrame(step);
    };

    cameraFrameRef.current = requestAnimationFrame(step);
  }, [cameraX, cameraY, cameraScale]);

  const handleZoom = useCallback((e) => {
    e.preventDefault();
    const rect = stageRectRef.current;
    if (!rect) return;

    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const currentTarget = cameraFrameRef.current
      ? cameraTargetRef.current
      : {
          x: cameraX.get(),
          y: cameraY.get(),
          scale: cameraScale.get(),
        };

    const normalizedDelta = clamp(e.deltaY, -90, 90);
    const speed = e.ctrlKey ? 0.0042 : 0.0024;
    const zoomFactor = Math.exp(-normalizedDelta * speed);
    const newScale = clamp(currentTarget.scale * zoomFactor, minScale, maxScale);
    if (newScale === currentTarget.scale) return;

    const scaleRatio = newScale / currentTarget.scale;
    const nextX = cursorX - (cursorX - currentTarget.x) * scaleRatio;
    let nextY = cursorY - (cursorY - currentTarget.y) * scaleRatio;
    if (lockYRef?.current) {
      // Y is locked → keep world y=0 at stage vertical center.
      nextY = rect.height / 2;
    }

    cameraTargetRef.current = { x: nextX, y: nextY, scale: newScale };
    smoothCameraToTarget();
  }, [cameraX, cameraY, cameraScale, minScale, maxScale, lockYRef, smoothCameraToTarget]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const recache = () => {
      stageRectRef.current = el.getBoundingClientRect();
    };
    recache();
    window.addEventListener('resize', recache);

    // non-passive so preventDefault blocks page scroll / pinch-zoom
    el.addEventListener('wheel', handleZoom, { passive: false });

    // ─── Pan via native pointer events on the stage itself ───
    // Using the stage (not a drag layer) means the whole canvas — including
    // gaps between cards — always pans. A small movement threshold lets plain
    // clicks on cards fall through to their onClick handlers.
    const DRAG_THRESHOLD = 4;
    let pointerId = null;
    let startX = 0, startY = 0;
    let lastX = 0, lastY = 0;
    let dragging = false;

    const onPointerMove = (e) => {
      if (e.pointerId !== pointerId) return;
      const totalDx = e.clientX - startX;
      const totalDy = e.clientY - startY;
      if (!dragging) {
        if (Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD) return;
        dragging = true;
        try { el.setPointerCapture(pointerId); } catch { /* ignore */ }
        el.classList.add('is-panning');
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      cameraX.set(cameraX.get() + dx);
      if (!lockYRef?.current) {
        cameraY.set(cameraY.get() + dy);
      }
      cameraTargetRef.current = {
        x: cameraX.get(),
        y: cameraY.get(),
        scale: cameraScale.get(),
      };
    };

    const onPointerUp = (e) => {
      if (e.pointerId !== pointerId) return;
      if (dragging) {
        // Suppress the synthesized click so a pan doesn't open the card it
        // started over.
        const suppressClick = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', suppressClick, { capture: true, once: true });
        // safety net in case 'click' never fires
        setTimeout(() => window.removeEventListener('click', suppressClick, { capture: true }), 50);
        try { el.releasePointerCapture(pointerId); } catch { /* ignore */ }
        el.classList.remove('is-panning');
      }
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      pointerId = null;
      dragging = false;
    };

    const onPointerDown = (e) => {
      // Left button or middle button only. Most controls keep their normal
      // pointer behavior; canvas pan targets opt into drag-to-pan even when
      // they are implemented as buttons.
      if (e.button !== 0 && e.button !== 1) return;
      const t = e.target;
      const panTarget = t?.closest?.('[data-canvas-pan-target]');
      if (!panTarget && t?.closest?.('button, a, input, textarea, select, [data-no-pan]')) return;
      cancelSmoothCamera();
      pointerId = e.pointerId;
      startX = lastX = e.clientX;
      startY = lastY = e.clientY;
      dragging = false;
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', onPointerUp);
    };

    el.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.removeEventListener('resize', recache);
      cancelSmoothCamera();
      el.removeEventListener('wheel', handleZoom);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, [stageRef, handleZoom, cameraX, cameraY, cameraScale, cancelSmoothCamera]);

  const panBy = useCallback((dx, dy) => {
    setCameraImmediate(cameraX.get() + dx, cameraY.get() + dy);
  }, [cameraX, cameraY, setCameraImmediate]);

  // Animate camera to a target world point (kept centered in the stage).
  const focusOn = useCallback((worldX, worldY, targetScale) => {
    const rect = stageRectRef.current;
    if (!rect) return;
    const s = targetScale ?? cameraScale.get();
    setCameraImmediate(rect.width / 2 - worldX * s, rect.height / 2 - worldY * s, s);
  }, [cameraScale, setCameraImmediate]);

  /**
   * Fit a world-space bounding box into the stage with optional padding.
   * bounds: { minX, maxX, minY, maxY } in world units.
   */
  const fitTo = useCallback((bounds, opts = {}) => {
    const rect = stageRectRef.current;
    if (!rect || !bounds) return;
    const padding = opts.padding ?? 80;
    const contentW = Math.max(1, bounds.maxX - bounds.minX);
    const contentH = Math.max(1, bounds.maxY - bounds.minY);
    const availW = Math.max(1, rect.width - padding * 2);
    const availH = Math.max(1, rect.height - padding * 2);
    const scale = clamp(Math.min(availW / contentW, availH / contentH), minScale, maxScale);
    const centerX = opts.centerX ?? (bounds.minX + bounds.maxX) / 2;
    const centerY = opts.centerY ?? (bounds.minY + bounds.maxY) / 2;
    setCameraImmediate(rect.width / 2 - centerX * scale, rect.height / 2 - centerY * scale, scale);
  }, [minScale, maxScale, setCameraImmediate]);

  return { cameraX, cameraY, cameraScale, stageRectRef, panBy, focusOn, fitTo };
}
