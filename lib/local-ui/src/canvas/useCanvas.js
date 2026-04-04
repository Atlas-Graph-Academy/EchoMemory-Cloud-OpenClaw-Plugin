/**
 * useCanvasTransform — pan/zoom with dynamic min-zoom clamping.
 *
 * MIN zoom = fit-all (entire canvas visible) — cannot zoom out further.
 * MAX zoom = card fills viewport width.
 * Click-to-focus: animates to card, zooms so card height fills viewport.
 */

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';

const MAX_ZOOM = 2.5;
const MIN_USABLE_INITIAL_ZOOM = 0.08;

function parseCssPx(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getViewportInsets(viewportRef) {
  const vp = viewportRef.current;
  const shell = vp?.closest?.('.app-shell');
  if (!vp || !shell) {
    return { left: 0, right: 0 };
  }

  const styles = window.getComputedStyle(shell);
  const left = parseCssPx(styles.getPropertyValue('--viewport-left-safe-area'), 0);
  const baseRight = parseCssPx(styles.getPropertyValue('--viewport-right-safe-area'), 0);
  const cloudWidth = parseCssPx(styles.getPropertyValue('--cloud-sidebar-width'), 0);
  const railWidth = parseCssPx(styles.getPropertyValue('--cloud-sidebar-rail-width'), 0);
  const right = shell.classList.contains('app-shell--cloud-open')
    ? Math.max(baseRight, cloudWidth + 12)
    : Math.max(baseRight, railWidth + 12);

  return { left, right };
}

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
    const { left: leftInset, right: rightInset } = getViewportInsets(viewportRef);
    const usableW = Math.max(1, vpW - leftInset - rightInset);
    const canvasW = b.w * z;
    const canvasH = b.h * z;

    let cx = px, cy = py;

    if (canvasW <= usableW) {
      // Canvas fits in viewport → center within the usable viewport space
      cx = leftInset + (usableW - canvasW) / 2;
    } else {
      // Reserve the side rails so content doesn't slide under them.
      cx = Math.min(leftInset, Math.max(vpW - rightInset - canvasW, cx));
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

  // Debounced state sync — triggers React re-render for viewport culling.
  // During active panning we use a longer delay to avoid mid-pan re-renders.
  const syncState = useCallback((delayMs = 120) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => setViewState({ ...liveRef.current }), delayMs);
  }, []);

  // ── Compute min zoom = fit-all, and apply on mount/bounds change ──
  // useLayoutEffect runs synchronously BEFORE browser paint → no flash
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !bounds || bounds.w === 0) return;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    const { left: leftInset, right: rightInset } = getViewportInsets(viewportRef);
    const usableW = Math.max(1, vpW - leftInset - rightInset);
    const pad = 24;
    const zw = (usableW - pad * 2) / bounds.w;
    const zh = (vpH - pad * 2) / bounds.h;
    const fitZoom = Math.min(zw, zh);
    minZoomRef.current = fitZoom;

    // Start at fit-all for normal-sized canvases, but avoid opening at an
    // unreadably tiny zoom level on very large workspaces.
    const z = Math.max(fitZoom, MIN_USABLE_INITIAL_ZOOM);
    const useReadableStart = z > fitZoom;
    const px = useReadableStart ? leftInset + pad : leftInset + (usableW - bounds.w * z) / 2;
    const py = useReadableStart ? pad : (vpH - bounds.h * z) / 2;
    liveRef.current = { panX: px, panY: py, zoom: z };
    applyTransform();
    setReady(true);
    setViewState({ ...liveRef.current });
  }, [bounds, viewportRef, canvasRef, applyTransform]);

  // ── Clamp zoom ──
  const clampZoom = useCallback((z) => {
    return Math.max(minZoomRef.current, Math.min(MAX_ZOOM, z));
  }, []);

  const getViewportCenter = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) {
      return null;
    }
    return {
      x: vp.clientWidth / 2,
      y: vp.clientHeight / 2,
    };
  }, [viewportRef]);

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

  const zoomAroundPoint = useCallback((targetZoom, pointX, pointY, dur = 220) => {
    const { panX: px, panY: py, zoom: z } = liveRef.current;
    const nextZoom = clampZoom(targetZoom);
    const worldX = (pointX - px) / z;
    const worldY = (pointY - py) / z;
    const targetPanX = pointX - worldX * nextZoom;
    const targetPanY = pointY - worldY * nextZoom;
    animateTo(targetPanX, targetPanY, nextZoom, dur);
  }, [animateTo, clampZoom]);

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

  const zoomIn = useCallback(() => {
    const center = getViewportCenter();
    if (!center) return;
    zoomAroundPoint(liveRef.current.zoom * 1.18, center.x, center.y);
  }, [getViewportCenter, zoomAroundPoint]);

  const zoomOut = useCallback(() => {
    const center = getViewportCenter();
    if (!center) return;
    zoomAroundPoint(liveRef.current.zoom / 1.18, center.x, center.y);
  }, [getViewportCenter, zoomAroundPoint]);

  const panBy = useCallback((dx, dy, dur = 180) => {
    const { panX, panY, zoom } = liveRef.current;
    animateTo(panX + dx, panY + dy, zoom, dur);
  }, [animateTo]);

  const fitToCanvas = useCallback(() => {
    const vp = viewportRef.current;
    const b = boundsRef.current;
    if (!vp || !b || b.w === 0) return;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    const { left: leftInset, right: rightInset } = getViewportInsets(viewportRef);
    const usableW = Math.max(1, vpW - leftInset - rightInset);
    const pad = 24;
    const fitZoom = Math.min((usableW - pad * 2) / b.w, (vpH - pad * 2) / b.h);
    const targetPanX = leftInset + (usableW - b.w * fitZoom) / 2;
    const targetPanY = (vpH - b.h * fitZoom) / 2;
    animateTo(targetPanX, targetPanY, fitZoom, 260);
  }, [animateTo, viewportRef]);

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
    // Throttled React state sync during drag — keeps visible cards updated
    // without re-rendering every frame
    syncState(80);
  }, [applyTransform, syncState]);

  const onPointerUp = useCallback(() => {
    panStartRef.current = null;
    // NOW trigger React re-render for viewport culling update
    setViewState({ ...liveRef.current });
  }, []);

  // ── Wheel: pan (scroll) or zoom (pinch / Cmd+scroll) ──
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const vp = viewportRef.current;
    if (!vp) return;

    const { panX: px, panY: py, zoom: z } = liveRef.current;

    // Pinch-to-zoom (ctrlKey is set by trackpad pinch) or Cmd+scroll
    if (e.ctrlKey || e.metaKey) {
      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wx = (mx - px) / z;
      const wy = (my - py) / z;
      const delta = -e.deltaY * 0.003;
      const nz = clampZoom(z * (1 + delta));
      liveRef.current = { panX: mx - wx * nz, panY: my - wy * nz, zoom: nz };
    } else {
      // Normal scroll → pan
      // deltaX = horizontal scroll (trackpad two-finger swipe or shift+wheel)
      // deltaY = vertical scroll
      liveRef.current.panX = px - e.deltaX;
      liveRef.current.panY = py - e.deltaY;
    }

    applyTransform();
    syncState(80);
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
    zoomIn,
    zoomOut,
    panBy,
    fitToCanvas,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
