/** Shared browser helpers for renderers: reduced-motion query, DPR, rAF, canvas-local coords. */

export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

export function devicePixelRatioSafe(): number {
  const d = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return Number.isFinite(d) && d > 0 ? Math.min(d, 3) : 1;
}

export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Client (viewport) coords to canvas-local CSS px, tolerant of CSS transforms on the canvas. */
export function clientToCanvas(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const sx = r.width > 0 ? cssW / r.width : 1;
  const sy = r.height > 0 ? cssH / r.height : 1;
  return { x: (clientX - r.left) * sx, y: (clientY - r.top) * sy };
}
