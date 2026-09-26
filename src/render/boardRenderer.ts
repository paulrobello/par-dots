/**
 * 16x16 panel board renderer (Canvas 2D, pseudo-3D sprites).
 *
 * Coordinates: cells are panel-local (x, y) in 0..15. The viewport is in canvas CSS px
 * relative to the canvas top-left: screen = offset + scale * fittedPoint, where the fitted
 * layout centers the 16x16 plate in the canvas at scale 1 (see layout.ts).
 */

import { EMPTY, PANEL_SIZE, type PaletteColor } from "../types";
import {
  cellDeviceRect,
  fitGrid,
  type GridLayout,
  IDENTITY_VIEWPORT,
  pressScale,
  pulseAlpha,
  screenToCell,
  type Viewport,
} from "./layout";
import { clientToCanvas, devicePixelRatioSafe, now, prefersReducedMotion } from "./motion";
import { PLATE_GREEN, SpriteCache } from "./sprites";

export interface Cell {
  x: number;
  y: number;
}

export type CellGetter = (x: number, y: number) => { placed: number };

export interface BoardRendererOptions {
  plateColor?: string;
  /** Fill outside the plate; null leaves it transparent (CSS background shows). */
  background?: string | null;
  /** Plate margin around the studs, in cells. Default 0.25. */
  marginCells?: number;
}

const PRESS_MS = 180;

export class BoardRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: SpriteCache;
  private readonly background: string | null;
  private readonly margin: number;
  private getCell: CellGetter | null = null;
  private palette: PaletteColor[] = [];
  private vp: Viewport = { ...IDENTITY_VIEWPORT };
  private layoutCache: GridLayout = {
    cell: 0,
    originX: 0,
    originY: 0,
    cols: PANEL_SIZE,
    rows: PANEL_SIZE,
  };
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private readonly presses = new Map<number, number>();
  private readonly hints = new Map<number, number>();
  private hintStart = 0;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, opts: BoardRendererOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.sprites = new SpriteCache({ plateColor: opts.plateColor ?? PLATE_GREEN });
    this.background = opts.background === undefined ? null : opts.background;
    this.margin = opts.marginCells ?? 0.25;
    this.resize();
  }

  /** Board contents. getCell(x, y) is called for panel-local cells; placed is EMPTY or a palette index. */
  setData(getCell: CellGetter, palette: PaletteColor[]): void {
    this.getCell = getCell;
    this.palette = palette;
  }

  setPlateColor(hex: string): void {
    this.sprites.setPlateColor(hex);
  }

  /** Viewport in canvas CSS px (see file header). Does not redraw; call draw(). */
  setViewport(scale: number, offsetX: number, offsetY: number): void {
    this.vp = { scale: scale > 0 ? scale : 1, offsetX, offsetY };
  }

  getViewport(): Viewport {
    return { ...this.vp };
  }

  /** Fitted (scale 1) layout in CSS px, for gesture math. */
  getLayout(): GridLayout {
    return { ...this.layoutCache };
  }

  /** Canvas size in CSS px. */
  getSize(): { width: number; height: number } {
    return { width: this.cssW, height: this.cssH };
  }

  /** Re-read the canvas CSS size and DPR, resize the backing store, and redraw. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(0, rect.width || this.canvas.clientWidth);
    this.cssH = Math.max(0, rect.height || this.canvas.clientHeight);
    this.dpr = devicePixelRatioSafe();
    const w = Math.round(this.cssW * this.dpr);
    const h = Math.round(this.cssH * this.dpr);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.layoutCache = fitGrid(this.cssW, this.cssH, PANEL_SIZE, PANEL_SIZE, this.margin);
    this.draw();
  }

  /** Full redraw of plate, studs, dots, and active overlays. */
  draw(): void {
    if (this.destroyed) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.background) {
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.layoutCache.cell <= 0) return;
    this.drawPlate();
    for (let y = 0; y < PANEL_SIZE; y++) {
      for (let x = 0; x < PANEL_SIZE; x++) this.paintCell(x, y);
    }
  }

  /** Redraw only the given cells (dirty-rect update during strokes). */
  drawCells(cells: Iterable<Cell>): void {
    if (this.destroyed || this.layoutCache.cell <= 0) return;
    for (const c of cells) {
      if (inBoard(c.x, c.y)) this.paintCell(c.x, c.y);
    }
  }

  /** Client (viewport) coordinates to a panel cell, or null when off the studs. */
  hitTest(clientX: number, clientY: number): Cell | null {
    const p = clientToCanvas(this.canvas, this.cssW, this.cssH, clientX, clientY);
    return screenToCell(this.layoutCache, this.vp, p.x, p.y);
  }

  /**
   * Hint: outline the given cells for `ms` (pulsing; static when reduced motion is on).
   * Replaces any active highlight.
   */
  highlight(cells: Iterable<Cell>, ms = 3000): void {
    const old = [...this.hints.keys()];
    this.hints.clear();
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = null;
    const t = now();
    this.hintStart = t;
    for (const c of cells) if (inBoard(c.x, c.y)) this.hints.set(key(c.x, c.y), t + ms);
    this.repaintKeys(old);
    this.repaintKeys([...this.hints.keys()]);
    if (this.hints.size === 0) return;
    if (prefersReducedMotion()) {
      this.hintTimer = setTimeout(() => this.clearHighlight(), ms);
    } else {
      this.ensureLoop();
    }
  }

  clearHighlight(): void {
    const old = [...this.hints.keys()];
    this.hints.clear();
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = null;
    this.repaintKeys(old);
  }

  /** Small placement "pop" on one cell. No-op animation under reduced motion (cell is redrawn). */
  pressAnim(x: number, y: number): void {
    if (!inBoard(x, y)) return;
    if (prefersReducedMotion()) {
      this.paintCell(x, y);
      return;
    }
    this.presses.set(key(x, y), now());
    this.paintCell(x, y);
    this.ensureLoop();
  }

  /** Stop animations and release resources. */
  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = null;
    this.presses.clear();
    this.hints.clear();
    this.sprites.clear();
  }

  private drawPlate(): void {
    const L = this.layoutCache;
    const m = L.cell * this.margin;
    const a = {
      x: this.vp.offsetX + this.vp.scale * (L.originX - m),
      y: this.vp.offsetY + this.vp.scale * (L.originY - m),
    };
    const size = this.vp.scale * (L.cell * PANEL_SIZE + 2 * m);
    const d = this.dpr;
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 12 * d;
    ctx.shadowOffsetY = 4 * d;
    ctx.fillStyle = this.sprites.plateColor;
    roundRect(ctx, a.x * d, a.y * d, size * d, size * d, Math.min(size * d * 0.02, 10 * d));
    ctx.fill();
    ctx.restore();
  }

  private paintCell(x: number, y: number): void {
    const ctx = this.ctx;
    const r = cellDeviceRect(this.layoutCache, this.vp, this.dpr, x, y);
    if (r.w <= 0 || r.h <= 0) return;
    if (r.x + r.w < 0 || r.y + r.h < 0 || r.x > this.canvas.width || r.y > this.canvas.height)
      return;
    const s = Math.max(r.w, r.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.drawImage(this.sprites.stud(s), r.x, r.y, r.w, r.h);
    const idx = this.getCell ? this.getCell(x, y).placed : EMPTY;
    const color = idx !== EMPTY ? this.palette[idx] : undefined;
    const k = key(x, y);
    if (color) {
      let sc = 1;
      const pressT = this.presses.get(k);
      if (pressT !== undefined) sc = pressScale((now() - pressT) / PRESS_MS);
      const w = r.w * sc;
      const h = r.h * sc;
      ctx.drawImage(this.sprites.dot(color.hex, s), r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
    }
    if (this.hints.has(k)) {
      ctx.globalAlpha = prefersReducedMotion() ? 1 : pulseAlpha(now() - this.hintStart);
      ctx.drawImage(this.sprites.wrongOutline(s), r.x, r.y, r.w, r.h);
    }
    ctx.restore();
  }

  private repaintKeys(keys: number[]): void {
    for (const k of keys) this.paintCell(k % PANEL_SIZE, Math.floor(k / PANEL_SIZE));
  }

  private ensureLoop(): void {
    if (this.raf || this.destroyed || typeof requestAnimationFrame !== "function") return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    this.raf = 0;
    if (this.destroyed) return;
    const t = now();
    const dirty: number[] = [];
    for (const [k, start] of this.presses) {
      if (t - start >= PRESS_MS) this.presses.delete(k);
      dirty.push(k);
    }
    for (const [k, end] of this.hints) {
      if (t >= end) this.hints.delete(k);
      dirty.push(k);
    }
    this.repaintKeys(dirty);
    if (this.presses.size > 0 || this.hints.size > 0) this.ensureLoop();
  };
}

function key(x: number, y: number): number {
  return y * PANEL_SIZE + x;
}

function inBoard(x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < PANEL_SIZE &&
    y < PANEL_SIZE
  );
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
