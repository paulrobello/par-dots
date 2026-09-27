/** Pure layout / coordinate math shared by renderers and hit tests. DOM-free. */

/** Fitted grid inside a CSS-pixel area, before any viewport transform. */
export interface GridLayout {
  /** CSS px per cell at scale 1. */
  cell: number;
  /** CSS px of the grid's top-left (first cell) at scale 1. */
  originX: number;
  originY: number;
  cols: number;
  rows: number;
}

/**
 * Viewport transform in CSS px, relative to the canvas top-left:
 *   screen = offset + scale * layoutPoint
 * where layoutPoint is a point in the fitted (scale 1) layout.
 */
export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const IDENTITY_VIEWPORT: Viewport = { scale: 1, offsetX: 0, offsetY: 0 };

/**
 * Fit a cols x rows grid centered in a w x h area, leaving `marginCells` of plate
 * border on every side.
 */
export function fitGrid(
  w: number,
  h: number,
  cols: number,
  rows: number,
  marginCells = 0.25,
): GridLayout {
  const cell = Math.max(0, Math.min(w / (cols + 2 * marginCells), h / (rows + 2 * marginCells)));
  return {
    cell,
    originX: (w - cell * cols) / 2,
    originY: (h - cell * rows) / 2,
    cols,
    rows,
  };
}

/** Top-left of cell (x, y) in canvas CSS px after the viewport transform. */
export function cellToScreen(
  layout: GridLayout,
  vp: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: vp.offsetX + vp.scale * (layout.originX + x * layout.cell),
    y: vp.offsetY + vp.scale * (layout.originY + y * layout.cell),
  };
}

/** Inverse of cellToScreen: canvas-local CSS px to a cell, or null outside the grid. */
export function screenToCell(
  layout: GridLayout,
  vp: Viewport,
  px: number,
  py: number,
): { x: number; y: number } | null {
  if (layout.cell <= 0 || vp.scale <= 0) return null;
  const lx = ((px - vp.offsetX) / vp.scale - layout.originX) / layout.cell;
  const ly = ((py - vp.offsetY) / vp.scale - layout.originY) / layout.cell;
  const x = Math.floor(lx);
  const y = Math.floor(ly);
  if (x < 0 || y < 0 || x >= layout.cols || y >= layout.rows) return null;
  return { x, y };
}

/**
 * Zoom by `factor` keeping canvas-local point (px, py) fixed on screen.
 * Resulting scale is clamped to [minScale, maxScale].
 */
export function zoomViewportAt(
  vp: Viewport,
  factor: number,
  px: number,
  py: number,
  minScale = 1,
  maxScale = 4,
): Viewport {
  const scale = Math.max(minScale, Math.min(maxScale, vp.scale * factor));
  const k = scale / vp.scale;
  return {
    scale,
    offsetX: px - (px - vp.offsetX) * k,
    offsetY: py - (py - vp.offsetY) * k,
  };
}

/** Device-pixel cell edges; neighbours share edges so there are no seams. */
export function cellDeviceRect(
  layout: GridLayout,
  vp: Viewport,
  dpr: number,
  x: number,
  y: number,
): { x: number; y: number; w: number; h: number } {
  const a = cellToScreen(layout, vp, x, y);
  const b = cellToScreen(layout, vp, x + 1, y + 1);
  const x0 = Math.round(a.x * dpr);
  const y0 = Math.round(a.y * dpr);
  return { x: x0, y: y0, w: Math.round(b.x * dpr) - x0, h: Math.round(b.y * dpr) - y0 };
}

/**
 * Quantize a desired sprite size in device px so pinch-zoom reuses a small set of
 * sprite sizes (steps of ~12%) instead of regenerating on every frame.
 */
export function quantizeSpritePx(px: number): number {
  if (!Number.isFinite(px) || px <= 4) return 4;
  if (px <= 24) return Math.round(px);
  const k = Math.round(Math.log(px / 24) / Math.log(1.1));
  return Math.round(24 * 1.1 ** k);
}

/** Linear 0..1 easing helpers for animations. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = Math.max(0, Math.min(1, t)) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/** Placement pop scale for normalized time t in [0,1]: starts small, overshoots, settles at 1. */
export function pressScale(t: number): number {
  if (t >= 1) return 1;
  return 0.72 + 0.28 * easeOutBack(t);
}

/** Hint pulse alpha in [0.35, 1] for elapsed ms, 2 pulses per second. */
export function pulseAlpha(elapsedMs: number): number {
  return 0.675 + 0.325 * Math.cos((elapsedMs / 500) * Math.PI * 2);
}
