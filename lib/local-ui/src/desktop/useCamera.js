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

  const handleZoom = useCallback((e) => {
    e.preventDefault();
    const rect = stageRectRef.current;
    if (!rect) return;

    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    const delta = -e.deltaY;
    const zoomFactor = delta > 0 ? 1.08 : 0.92;
    const currentScale = cameraScale.get();
    const newScale = clamp(currentScale * zoomFactor, minScale, maxScale);
    if (newScale === currentScale) return;

    const scaleRatio = newScale / currentScale;
    cameraX.set(cursorX - (cursorX - cameraX.get()) * scaleRatio);
    if (lockYRef?.current) {
      // Y is locked → keep world y=0 at stage vertical center.
      cameraY.set(rect.height / 2);
    } else {
      cameraY.set(cursorY - (cursorY - cameraY.get()) * scaleRatio);
    }
    cameraScale.set(newScale);
  }, [cameraX, cameraY, cameraScale, minScale, maxScale, lockYRef]);

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
      // Left button or middle button only. Ignore if a button / link / input
      // was the actual target — let those handle the event themselves.
      if (e.button !== 0 && e.button !== 1) return;
      const t = e.target;
      if (t?.closest?.('button, a, input, textarea, select, [data-no-pan]')) return;
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
      el.removeEventListener('wheel', handleZoom);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, [stageRef, handleZoom, cameraX, cameraY]);

  const panBy = useCallback((dx, dy) => {
    cameraX.set(cameraX.get() + dx);
    cameraY.set(cameraY.get() + dy);
  }, [cameraX, cameraY]);

  // Animate camera to a target world point (kept centered in the stage).
  const focusOn = useCallback((worldX, worldY, targetScale) => {
    const rect = stageRectRef.current;
    if (!rect) return;
    const s = targetScale ?? cameraScale.get();
    cameraScale.set(s);
    cameraX.set(rect.width / 2 - worldX * s);
    cameraY.set(rect.height / 2 - worldY * s);
  }, [cameraX, cameraY, cameraScale]);

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
    cameraScale.set(scale);
    cameraX.set(rect.width / 2 - centerX * scale);
    cameraY.set(rect.height / 2 - centerY * scale);
  }, [cameraX, cameraY, cameraScale, minScale, maxScale]);

  return { cameraX, cameraY, cameraScale, stageRectRef, panBy, focusOn, fitTo };
}
