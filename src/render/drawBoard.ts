/**
 * Whole-mosaic draw board renderer (Canvas 2D). Owns the sprite cache, the viewport
 * (scale 1 = fit-to-screen), panel seam lines, a faint per-stud grid overlay past a zoom
 * threshold, a transient tool preview, hit testing, and one coalesced rAF redraw. The
 * editor calls setData, resize, then draw/drawCells as the session changes; destroy on
 * unmount. Cells are whole-grid studs, unlike BoardRenderer's panel-local ones.
 */

import type { GridCell } from '../game/drawTools';
import { EMPTY, PANEL_SIZE, type PaletteColor, type PictureSave } from '../types';
import { clearCanvas, drawPlate, resizeBacking } from './canvas';
import {
  cellDeviceRect,
  cellToScreen,
  fitGrid,
  type GridLayout,
  screenToCell,
  type Viewport,
} from './layout';
import { clientToCanvas } from './motion';
import { PLATE_GREEN, SpriteCache } from './sprites';

/** Cell size past which the faint per-stud grid overlay is drawn (device px). */
const GRID_THRESHOLD_PX = 14;
/** CSS px per stud at the 1:1 zoom step (double-tap). */
export const STUD_CSS_PX = 22;
/** Preview dot alpha. */
const PREVIEW_ALPHA = 0.5;
const MARGIN_CELLS = 0.25;

/** Draws the whole drawn mosaic with seams, grid overlay and tool preview. */
export class DrawBoard {
  /** The canvas this renderer draws into. */
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new SpriteCache();
  private save: PictureSave | null = null;
  private palette: PaletteColor[] = [];
  private vp: Viewport = { scale: 1, offsetX: 0, offsetY: 0 };
  private layout: GridLayout = { cell: 0, originX: 0, originY: 0, cols: 0, rows: 0 };
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private preview = new Set<number>();
  private previewValue = 0;
  private raf = 0;
  private destroyed = false;

  /** Takes the canvas's 2D context. Throws when no 2D context is available. */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  /** Board contents and the palette index preview shapes render in. */
  setData(save: PictureSave, previewValue: number): void {
    this.save = save;
    this.palette = save.palette;
    this.previewValue = previewValue;
  }

  setPreviewValue(index: number): void {
    this.previewValue = index;
  }

  /** Show the transient tool preview on `cells` (null clears). Does not redraw. */
  setPreview(cells: GridCell[] | null): void {
    this.preview.clear();
    if (!cells || !this.save) return;
    for (const c of cells) {
      if (this.inGrid(c.x, c.y)) this.preview.add(c.y * this.save.width + c.x);
    }
  }

  setViewport(scale: number, offsetX: number, offsetY: number): void {
    this.vp = { scale: scale > 0 ? scale : 1, offsetX, offsetY };
  }

  getViewport(): Viewport {
    return { ...this.vp };
  }

  /** Canvas size in CSS px. */
  getSize(): { width: number; height: number } {
    return { width: this.cssW, height: this.cssH };
  }

  /** Scale that renders one stud at STUD_CSS_PX CSS px, never below fit (1). */
  oneToOneScale(): number {
    return Math.max(1, STUD_CSS_PX / (this.layout.cell || 1));
  }

  /** Re-read the canvas CSS size and DPR, refit the layout, and redraw. */
  resize(): void {
    if (!this.save || this.destroyed) return;
    ({ cssW: this.cssW, cssH: this.cssH, dpr: this.dpr } = resizeBacking(this.canvas));
    this.layout = fitGrid(this.cssW, this.cssH, this.save.width, this.save.height, MARGIN_CELLS);
    this.draw();
  }

  /** Full redraw: plate, studs, dots, preview, seam lines, grid overlay. */
  draw(): void {
    if (this.destroyed || !this.save) return;
    clearCanvas(this.ctx);
    if (this.layout.cell <= 0) return;
    this.drawPlate();
    const { width, height } = this.save;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) this.paintCell(x, y);
    }
    this.paintPreview();
    this.drawSeams();
    this.drawGridOverlay();
  }

  /** Redraw the given cells, then the preview, seams and grid overlay above them. */
  drawCells(_cells: Iterable<GridCell>): void {
    if (this.destroyed || !this.save || this.layout.cell <= 0) return;
    // Full repaint. Partial repaints stack translucent seam/grid layers over the touched
    // region - seams brighten with every use and reverted cells leave hairline gaps - so
    // a drawCells call redraws the same sequence as draw(). Grids here are <= 4096 studs,
    // where a full sprite pass is cheap.
    this.draw();
  }

  /** Schedule one coalesced full redraw on the next animation frame. */
  requestDraw(): void {
    if (this.raf || this.destroyed || typeof requestAnimationFrame !== 'function') return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  /** Client (viewport) coordinates to a whole-grid stud, or null off the studs. */
  hitTest(clientX: number, clientY: number): GridCell | null {
    if (!this.save) return null;
    const p = clientToCanvas(this.canvas, this.cssW, this.cssH, clientX, clientY);
    return screenToCell(this.layout, this.vp, p.x, p.y);
  }

  /** Stop animations and release resources. */
  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.preview.clear();
    this.sprites.clear();
  }

  private inGrid(x: number, y: number): boolean {
    if (!this.save) return false;
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.save.width &&
      y < this.save.height
    );
  }

  private drawPlate(): void {
    const L = this.layout;
    const m = L.cell * MARGIN_CELLS;
    const a = {
      x: this.vp.offsetX + this.vp.scale * (L.originX - m),
      y: this.vp.offsetY + this.vp.scale * (L.originY - m),
    };
    const size = this.vp.scale * (L.cell * L.cols + 2 * m);
    const d = this.dpr;
    drawPlate(
      this.ctx,
      { x: a.x * d, y: a.y * d, w: size * d, h: this.vp.scale * (L.cell * L.rows + 2 * m) * d },
      Math.min(size * d * 0.02, 10 * d),
      PLATE_GREEN,
      { blur: 12 * d, offsetY: 4 * d, color: 'rgba(0,0,0,0.35)' },
    );
  }

  private paintCell(x: number, y: number): void {
    if (!this.save) return;
    const r = cellDeviceRect(this.layout, this.vp, this.dpr, x, y);
    if (r.w <= 0 || r.h <= 0) return;
    if (r.x + r.w < 0 || r.y + r.h < 0 || r.x > this.canvas.width || r.y > this.canvas.height) {
      return;
    }
    const s = Math.max(r.w, r.h);
    const ctx = this.ctx;
    const i = y * this.save.width + x;
    const idx = this.save.placed[i];
    const color = idx !== EMPTY ? this.palette[idx] : undefined;
    ctx.drawImage(this.sprites.stud(s), r.x, r.y, r.w, r.h);
    if (color) ctx.drawImage(this.sprites.dot(color.hex, s), r.x, r.y, r.w, r.h);
  }

  private paintPreview(): void {
    if (!this.save || this.preview.size === 0) return;
    const color = this.palette[this.previewValue];
    if (!color) return;
    const ctx = this.ctx;
    ctx.globalAlpha = PREVIEW_ALPHA;
    for (const i of this.preview) {
      const r = cellDeviceRect(
        this.layout,
        this.vp,
        this.dpr,
        i % this.save.width,
        Math.floor(i / this.save.width),
      );
      if (r.w <= 0 || r.h <= 0) continue;
      const s = Math.max(r.w, r.h);
      ctx.drawImage(this.sprites.dot(color.hex, s), r.x, r.y, r.w, r.h);
    }
    ctx.globalAlpha = 1;
  }

  private drawSeams(): void {
    if (!this.save) return;
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = Math.max(1, Math.round(d));
    ctx.beginPath();
    for (let x = PANEL_SIZE; x < this.save.width; x += PANEL_SIZE) {
      const a = cellToScreen(this.layout, this.vp, x, 0);
      const b = cellToScreen(this.layout, this.vp, x, this.save.height);
      ctx.moveTo(Math.round(a.x * d), Math.round(a.y * d));
      ctx.lineTo(Math.round(b.x * d), Math.round(b.y * d));
    }
    for (let y = PANEL_SIZE; y < this.save.height; y += PANEL_SIZE) {
      const a = cellToScreen(this.layout, this.vp, 0, y);
      const b = cellToScreen(this.layout, this.vp, this.save.width, y);
      ctx.moveTo(Math.round(a.x * d), Math.round(a.y * d));
      ctx.lineTo(Math.round(b.x * d), Math.round(b.y * d));
    }
    ctx.stroke();
  }

  private drawGridOverlay(): void {
    if (!this.save) return;
    const cellPx = this.layout.cell * this.vp.scale * this.dpr;
    if (cellPx < GRID_THRESHOLD_PX) return;
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < this.save.width; x++) {
      const a = cellToScreen(this.layout, this.vp, x, 0);
      const b = cellToScreen(this.layout, this.vp, x, this.save.height);
      ctx.moveTo(Math.round(a.x * d), Math.round(a.y * d));
      ctx.lineTo(Math.round(b.x * d), Math.round(b.y * d));
    }
    for (let y = 1; y < this.save.height; y++) {
      const a = cellToScreen(this.layout, this.vp, 0, y);
      const b = cellToScreen(this.layout, this.vp, this.save.width, y);
      ctx.moveTo(Math.round(a.x * d), Math.round(a.y * d));
      ctx.lineTo(Math.round(b.x * d), Math.round(b.y * d));
    }
    ctx.stroke();
  }
}
