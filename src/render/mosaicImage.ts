/** Offscreen rendering of a whole mosaic for thumbnails, the panel reference image, and PNG export. */

import type { Mosaic } from '../types';
import { drawDot, drawStud, PLATE_GREEN } from './sprites';

export type MosaicStyle = 'dots';

export interface MosaicImageOptions {
  /** Render only this stud region (e.g. one 16x16 panel for the reference image). */
  region?: { x: number; y: number; w: number; h: number };
  /** Baseplate color behind the dots. Default LEGO green. */
  plateColor?: string;
  /** Per-stud palette index override (e.g. placed state); EMPTY/out-of-range shows a bare stud. */
  cells?: ArrayLike<number>;
}

/** Output pixel size for a region at cellPx per stud. */
export function mosaicImageSize(
  w: number,
  h: number,
  cellPx: number,
): { width: number; height: number } {
  const c = Math.max(1, Math.round(cellPx));
  return { width: Math.max(1, w * c), height: Math.max(1, h * c) };
}

/**
 * Render the mosaic target (or `opts.cells`) at cellPx device pixels per stud.
 * 'dots' draws glossy round tiles on a baseplate.
 */
export function renderMosaicToCanvas(
  mosaic: Mosaic,
  cellPx: number,
  _style: MosaicStyle,
  opts: MosaicImageOptions = {},
): HTMLCanvasElement {
  const region = opts.region ?? { x: 0, y: 0, w: mosaic.width, h: mosaic.height };
  const c = Math.max(1, Math.round(cellPx));
  const size = mosaicImageSize(region.w, region.h, c);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  const cells = opts.cells ?? mosaic.target;
  const plate = opts.plateColor ?? PLATE_GREEN;

  let stud: HTMLCanvasElement | null = null;
  const dotCache = new Map<string, HTMLCanvasElement>();
  const sprite = (paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
    const s = document.createElement('canvas');
    s.width = c;
    s.height = c;
    const g = s.getContext('2d');
    if (g) paint(g);
    return s;
  };

  for (let ry = 0; ry < region.h; ry++) {
    for (let rx = 0; rx < region.w; rx++) {
      const x = region.x + rx;
      const y = region.y + ry;
      const inside = x >= 0 && y >= 0 && x < mosaic.width && y < mosaic.height;
      const idx = inside ? cells[y * mosaic.width + x] : undefined;
      const color = idx === undefined ? undefined : mosaic.palette[idx];
      const px = rx * c;
      const py = ry * c;
      if (!stud) stud = sprite((g) => drawStud(g, 0, 0, c, plate));
      ctx.drawImage(stud, px, py);
      if (color) {
        let dot = dotCache.get(color.hex);
        if (!dot) {
          dot = sprite((g) => drawDot(g, 0, 0, c, color.hex));
          dotCache.set(color.hex, dot);
        }
        ctx.drawImage(dot, px, py);
      }
    }
  }
  return canvas;
}
