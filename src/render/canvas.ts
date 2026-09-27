/**
 * Canvas 2D helpers shared by the board and overview renderers: backing-store sizing,
 * clearing, and the rounded, shadowed plate. Each renderer passes its own constants.
 */

import { devicePixelRatioSafe } from './motion';

export interface PlateRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlateShadow {
  blur: number;
  offsetY: number;
  color: string;
}

/**
 * Re-read the canvas CSS size and device pixel ratio and resize the backing store to match.
 * Width/height are only assigned when they change, since assignment resets the context.
 */
export function resizeBacking(canvas: HTMLCanvasElement): {
  cssW: number;
  cssH: number;
  dpr: number;
} {
  // Layout size, not the bounding rect: a CSS transform (zoom transition) must not leak in.
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(0, canvas.clientWidth || rect.width);
  const cssH = Math.max(0, canvas.clientHeight || rect.height);
  const dpr = devicePixelRatioSafe();
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return { cssW, cssH, dpr };
}

/** Reset the transform and clear the whole backing store. */
export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Fill a rounded plate with a drop shadow. All values are in device px. */
export function drawPlate(
  ctx: CanvasRenderingContext2D,
  rect: PlateRect,
  radius: number,
  fill: string,
  shadow: PlateShadow,
): void {
  ctx.save();
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur;
  ctx.shadowOffsetY = shadow.offsetY;
  ctx.fillStyle = fill;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);
  ctx.fill();
  ctx.restore();
}

export function roundRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
