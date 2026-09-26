/**
 * Pre-rendered pseudo-3D sprites (baseplate studs, glossy round dot tiles, hint outline).
 * Every sprite is a square covering exactly one cell; all shading and shadows stay inside
 * that square so dirty-cell redraws never leave fragments on neighbours.
 */

import { plasticTones, rgba, shade } from "./color";
import { quantizeSpritePx } from "./layout";

export const PLATE_GREEN = "#237841";
export const PLATE_GRAY = "#A0A5A9";

export type SpriteCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Create a canvas usable as a drawImage source: DOM canvas when available, else OffscreenCanvas. */
export function createSpriteCanvas(w: number, h: number): SpriteCanvas {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  throw new Error("No canvas implementation available");
}

export function context2d(canvas: SpriteCanvas): Ctx2D {
  const ctx = canvas.getContext("2d") as Ctx2D | null;
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

/** Stud top radius as a fraction of the cell. */
export const STUD_R = 0.3;
/** Dot tile radius as a fraction of the cell (slightly larger than the stud). */
export const DOT_R = 0.43;

/** Draw one baseplate cell (opaque plate square + raised stud) into a size x size box at (x, y). */
export function drawStud(ctx: Ctx2D, x: number, y: number, size: number, plate: string): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * STUD_R;
  const t = plasticTones(plate);

  ctx.save();
  // Plate surface with a very soft vertical sheen.
  const plateGrad = ctx.createLinearGradient(x, y, x, y + size);
  plateGrad.addColorStop(0, shade(plate, 0.03));
  plateGrad.addColorStop(1, shade(plate, -0.03));
  ctx.fillStyle = plateGrad;
  ctx.fillRect(x, y, size, size);

  // Contact shadow cast down-right.
  const sOff = size * 0.06;
  const shadow = ctx.createRadialGradient(
    cx + sOff,
    cy + sOff,
    r * 0.6,
    cx + sOff,
    cy + sOff,
    r * 1.45,
  );
  shadow.addColorStop(0, "rgba(0,0,0,0.38)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(cx + sOff, cy + sOff, r * 1.45, 0, Math.PI * 2);
  ctx.fill();

  // Cylinder side wall (visible lower-right sliver).
  const h = size * 0.045;
  ctx.fillStyle = t.dark;
  ctx.beginPath();
  ctx.arc(cx + h * 0.4, cy + h, r, 0, Math.PI * 2);
  ctx.fill();

  // Top face.
  const top = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  top.addColorStop(0, t.light);
  top.addColorStop(0.65, t.base);
  top.addColorStop(1, shade(plate, -0.08));
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Rim.
  ctx.lineWidth = Math.max(0.5, size * 0.02);
  ctx.strokeStyle = rgba(t.rim, 0.55);
  ctx.stroke();

  // Highlight arc on the upper-left edge.
  ctx.lineWidth = Math.max(0.5, size * 0.03);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a glossy 1x1 round dot tile (transparent outside the tile) centered in a size box at (x, y).
 * `scale` shrinks/grows the tile around its center (used by the placement pop).
 */
export function drawDot(
  ctx: Ctx2D,
  x: number,
  y: number,
  size: number,
  hex: string,
  scale = 1,
): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * DOT_R * scale;
  const t = plasticTones(hex);

  ctx.save();
  // Soft drop shadow; its outer radius stays within the cell.
  const sOff = size * 0.035 * scale;
  const sR = Math.min(r * 1.1, size * 0.5 - sOff);
  const shadow = ctx.createRadialGradient(cx + sOff, cy + sOff, r * 0.7, cx + sOff, cy + sOff, sR);
  shadow.addColorStop(0, "rgba(0,0,0,0.45)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(cx + sOff, cy + sOff, sR, 0, Math.PI * 2);
  ctx.fill();

  // Tile edge/thickness: slightly offset darker disc.
  const th = size * 0.03 * scale;
  ctx.fillStyle = t.rim;
  ctx.beginPath();
  ctx.arc(cx + th * 0.3, cy + th, r, 0, Math.PI * 2);
  ctx.fill();

  // Body: radial gradient, lit from the upper left, darkening toward the edge.
  const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, r);
  body.addColorStop(0, t.light);
  body.addColorStop(0.35, t.base);
  body.addColorStop(0.78, t.base);
  body.addColorStop(0.93, t.dark);
  body.addColorStop(1, t.rim);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Faint bevel ring just inside the edge (flat top of the tile meeting its rounded edge).
  ctx.lineWidth = Math.max(0.5, size * 0.018);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
  ctx.stroke();

  // Broad specular sheen (upper-left ellipse).
  ctx.save();
  ctx.translate(cx - r * 0.3, cy - r * 0.38);
  ctx.rotate(-Math.PI / 4);
  ctx.scale(1, 0.55);
  const spec = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.5);
  spec.addColorStop(0, `rgba(255,255,255,${t.specularAlpha})`);
  spec.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Crisp glint.
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(cx - r * 0.42, cy - r * 0.42, Math.max(0.6, r * 0.09), 0, Math.PI * 2);
  ctx.fill();

  // Reflected light along the lower-right edge.
  ctx.lineWidth = Math.max(0.5, size * 0.02);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.9, Math.PI * 0.1, Math.PI * 0.45);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw the "wrong dot" hint marker: a dashed double ring (dark + white) that differs by
 * shape, not color alone, so it reads for colorblind players on any dot color.
 */
export function drawWrongOutline(ctx: Ctx2D, x: number, y: number, size: number, alpha = 1): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.44;
  const lw = Math.max(1.5, size * 0.07);
  const dash = Math.max(2, size * 0.12);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.setLineDash([dash, dash * 0.6]);
  ctx.lineWidth = lw * 1.6;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.beginPath();
  ctx.arc(cx, cy, r - lw * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = lw * 0.8;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.setLineDash([]);
  // Small diagonal cross in the middle as a second, shape-based cue.
  const k = size * 0.1;
  ctx.lineCap = "round";
  ctx.lineWidth = lw * 1.2;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.beginPath();
  ctx.moveTo(cx - k, cy - k);
  ctx.lineTo(cx + k, cy + k);
  ctx.moveTo(cx + k, cy - k);
  ctx.lineTo(cx - k, cy + k);
  ctx.stroke();
  ctx.lineWidth = lw * 0.55;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();
}

export interface SpriteCacheOptions {
  /** Baseplate color, default LEGO green. */
  plateColor?: string;
  /** Max cached sprites before least-recently-used eviction. Default 160. */
  maxEntries?: number;
}

/**
 * LRU cache of pre-rendered sprites keyed by kind, color, and device-pixel size.
 * Sizes are quantized (quantizeSpritePx) so continuous zooming reuses a bounded set.
 */
export class SpriteCache {
  private plate: string;
  private readonly max: number;
  private readonly map = new Map<string, SpriteCanvas>();

  constructor(opts: SpriteCacheOptions = {}) {
    this.plate = opts.plateColor ?? PLATE_GREEN;
    this.max = Math.max(8, opts.maxEntries ?? 160);
  }

  get plateColor(): string {
    return this.plate;
  }

  /** Change the baseplate color; cached studs for the old color age out via LRU. */
  setPlateColor(hex: string): void {
    this.plate = hex;
  }

  /** Opaque baseplate cell with a stud, sizePx x sizePx device px (quantized). */
  stud(sizePx: number): SpriteCanvas {
    const s = quantizeSpritePx(sizePx);
    const plate = this.plate;
    return this.get(`s|${plate}|${s}`, s, (ctx) => drawStud(ctx, 0, 0, s, plate));
  }

  /** Transparent-background glossy dot tile for a "#rrggbb" color. */
  dot(hex: string, sizePx: number): SpriteCanvas {
    const s = quantizeSpritePx(sizePx);
    return this.get(`d|${hex.toLowerCase()}|${s}`, s, (ctx) => drawDot(ctx, 0, 0, s, hex));
  }

  /** Transparent-background wrong-dot hint marker. */
  wrongOutline(sizePx: number): SpriteCanvas {
    const s = quantizeSpritePx(sizePx);
    return this.get(`w|${s}`, s, (ctx) => drawWrongOutline(ctx, 0, 0, s));
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  private get(key: string, s: number, paint: (ctx: Ctx2D) => void): SpriteCanvas {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const canvas = createSpriteCanvas(s, s);
    paint(context2d(canvas));
    this.map.set(key, canvas);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
    return canvas;
  }
}
