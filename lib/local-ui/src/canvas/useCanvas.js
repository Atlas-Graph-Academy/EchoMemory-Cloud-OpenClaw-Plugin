/**
 * useCanvasTransform — pan/zoom with dynamic min-zoom clamping.
 *
 * MIN zoom = fit-all (entire canvas visible) — cannot zoom out further.
 * MAX zoom = card fills viewport width.
 * Click-to-focus: animates to card, zooms so card height fills viewport.
 */

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';

const MAX_ZOOM = 2.5;

export function useCanvasTransform(viewportRef, canvasRef, bounds) {
  const liveRef = useRef({ panX: 20, panY: 20, zoom: 0.25 });
  const [viewState, setViewState] = useState({ panX: 20, panY: 20, zoom: 0.25 });
  const [ready, setReady] = useState(false);
  const minZoomRef = useRef(0.05);
  const panStartRef = useRef(null);
  const panMovedRef = useRef(false);
  const rafRef = useRef(null);
  const syncTimerRef = useRef(null);

  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  // ── Clamp pan so canvas never leaves viewport with excessive whitespace ──
  const clampPan = useCallback((px, py, z) => {
    const vp = viewportRef.current;
    const b = boundsRef.current;
    if (!vp || !b || b.w === 0) return { px, py };

    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    const canvasW = b.w * z;
    const canvasH = b.h * z;

    let cx = px, cy = py;

    if (canvasW <= vpW) {
      // Canvas fits in viewport → center horizontally
      cx = (vpW - canvasW) / 2;
    } else {
      // Canvas wider than viewport → clamp edges
      // Don't let left edge go past 0, don't let right edge go before vpW
      cx = Math.min(0, Math.max(vpW - canvasW, cx));
    }

    if (canvasH <= vpH) {
      cy = (vpH - canvasH) / 2;
    } else {
      cy = Math.min(0, Math.max(vpH - canvasH, cy));
    }

    return { px: cx, py: cy };
  }, [viewportRef]);

  const applyTransform = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const { panX, panY, zoom } = liveRef.current;
    // Clamp before applying
    const { px, py } = clampPan(panX, panY, zoom);
    liveRef.current.panX = px;
    liveRef.current.panY = py;
    el.style.transform = `translate(${px}px, ${py}px) scale(${zoom})`;
  }, [canvasRef, clampPan]);

  const syncState = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => setViewState({ ...liveRef.current }), 60);
  }, []);

  // ── Compute min zoom = fit-all, and apply on mount/bounds change ──
  // useLayoutEffect runs synchronously BEFORE browser paint → no flash
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !bounds || bounds.w === 0) return;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    const pad = 24;
    const zw = (vpW - pad * 2) / bounds.w;
    const zh = (vpH - pad * 2) / bounds.h;
    const fitZoom = Math.min(zw, zh);
    minZoomRef.current = fitZoom;

    // Set initial view to fit-all
    const z = fitZoom;
    const px = (vpW - bounds.w * z) / 2;
    const py = (vpH - bounds.h * z) / 2;
    liveRef.current = { panX: px, panY: py, zoom: z };
    applyTransform();
    setReady(true);
    setViewState({ ...liveRef.current });
  }, [bounds, viewportRef, canvasRef, applyTransform]);

  // ── Clamp zoom ──
  const clampZoom = useCallback((z) => {
    return Math.max(minZoomRef.current, Math.min(MAX_ZOOM, z));
  }, []);

  // ── Animate to target ──
  const animateTo = useCallback((tx, ty, tz, dur = 400) => {
    const start = performance.now();
    const { panX: sx, panY: sy, zoom: sz } = liveRef.current;
    const ctz = clampZoom(tz);
    function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      liveRef.current = {
        panX: sx + (tx - sx) * e,
        panY: sy + (ty - sy) * e,
        zoom: sz + (ctz - sz) * e,
      };
      applyTransform();
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else setViewState({ ...liveRef.current });
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
  }, [applyTransform, clampZoom]);

  // ── Focus on a card: zoom so card height fills viewport height ──
  const focusCard = useCallback((card) => {
    const vp = viewportRef.current;
    if (!vp || !card) return;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    const pad = 40;
    // Zoom so card height fills viewport height (with padding)
    const zByH = (vpH - pad * 2) / card.h;
    // But don't zoom wider than viewport
    const zByW = (vpW - pad * 2) / card.w;
    const targetZ = clampZoom(Math.min(zByH, zByW));
    // Center the card in viewport
    const targetPanX = (vpW / 2) - (card.x + card.w / 2) * targetZ;
    const targetPanY = (vpH / 2) - (card.y + card.h / 2) * targetZ;
    animateTo(targetPanX, targetPanY, targetZ);
  }, [viewportRef, animateTo, clampZoom]);

  // ── Pointer: pan ──
  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    panStartRef.current = { x: e.clientX, y: e.clientY, px: liveRef.current.panX, py: liveRef.current.panY };
    panMovedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!panStartRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panMovedRef.current = true;
    liveRef.current.panX = panStartRef.current.px + dx;
    liveRef.current.panY = panStartRef.current.py + dy;
    applyTransform();
  }, [applyTransform]);

  const onPointerUp = useCallback(() => {
    panStartRef.current = null;
    setViewState({ ...liveRef.current });
  }, []);

  // ── Wheel: zoom toward cursor, clamped ──
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { panX: px, panY: py, zoom: z } = liveRef.current;
    const wx = (mx - px) / z;
    const wy = (my - py) / z;
    const delta = -e.deltaY * 0.003;
    const nz = clampZoom(z * (1 + delta));
    liveRef.current = { panX: mx - wx * nz, panY: my - wy * nz, zoom: nz };
    applyTransform();
    syncState();
  }, [viewportRef, applyTransform, syncState, clampZoom]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [viewportRef, onWheel]);

  return {
    viewState,
    ready,
    panMoved: panMovedRef,
    animateTo,
    focusCard,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
