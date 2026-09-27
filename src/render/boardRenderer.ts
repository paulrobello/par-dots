/**
 * 16x16 panel board renderer (Canvas 2D, pseudo-3D sprites).
 *
 * BoardRenderer owns its canvas's backing store and device pixel ratio, a sprite cache, the
 * viewport (zoom and pan), and a requestAnimationFrame loop that runs only while placement,
 * hint, reference-fade, or completion effects are active. Call order: construct, setData, resize or
 * draw, drawCells/pressAnim/highlight during play, destroy on unmount.
 *
 * Coordinates: cells are panel-local (x, y) in 0..15. The viewport is in canvas CSS px
 * relative to the canvas top-left: screen = offset + scale * fittedPoint, where the fitted
 * layout centers the 16x16 plate in the canvas at scale 1 (see layout.ts).
 */

import { EMPTY, PANEL_SIZE, type PaletteColor } from '../types';
import { clearCanvas, drawPlate, resizeBacking } from './canvas';
import { luminance } from './color';
import {
  cellDeviceRect,
  fitGrid,
  type GridLayout,
  IDENTITY_VIEWPORT,
  pressHighlightAlpha,
  pressScale,
  pulseAlpha,
  screenToCell,
  type Viewport,
} from './layout';
import { clientToCanvas, now, prefersReducedMotion } from './motion';
import { PLATE_GREEN, SpriteCache } from './sprites';

/** A panel-local stud coordinate. */
export interface Cell {
  x: number;
  y: number;
}

/** Reads one panel-local stud: its placed value (EMPTY or palette index) and optional target. */
export type CellGetter = (x: number, y: number) => { placed: number; target?: number };

/** Construction options for BoardRenderer. */
export interface BoardRendererOptions {
  /** Plate margin around the studs, in cells. Default 0.25. */
  marginCells?: number;
}

const PRESS_MS = 180;
const OVERLAY_MS = 160;
const COMPLETE_MS = 600;
const SYMBOL_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Draws one panel board; see the file header for ownership and call order. */
export class BoardRenderer {
  /** The canvas this renderer draws into. */
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: SpriteCache;
  private readonly margin: number;
  private getCell: CellGetter | null = null;
  private palette: PaletteColor[] = [];
  private symbols: string[] = [];
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
  private overlay = false;
  private overlayMix = 0;
  private overlayFrom = 0;
  private overlayTo = 0;
  private overlayStart = 0;
  private completionStart: number | null = null;
  private completionDone = false;
  private completionPromise: Promise<void> | null = null;
  private completionResolve: (() => void) | null = null;

  /** Takes the canvas's 2D context and sizes it. Throws when no 2D context is available. */
  constructor(canvas: HTMLCanvasElement, opts: BoardRendererOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.sprites = new SpriteCache();
    this.margin = opts.marginCells ?? 0.25;
    this.resize();
  }

  /**
   * Board contents. getCell(x, y) is called for panel-local cells; placed is EMPTY or a palette
   * index. `symbols` (by palette index) are drawn on overlay studs. Does not redraw; call draw().
   */
  setData(getCell: CellGetter, palette: PaletteColor[], symbols: string[] = []): void {
    this.getCell = getCell;
    this.palette = palette;
    this.symbols = symbols;
  }

  /** Viewport in canvas CSS px (see file header). Does not redraw; call draw(). */
  setViewport(scale: number, offsetX: number, offsetY: number): void {
    this.vp = { scale: scale > 0 ? scale : 1, offsetX, offsetY };
  }

  /** Show or hide the target reference overlay with a short reversible fade. */
  setOverlay(on: boolean): void {
    if (this.overlay === on) return;
    const t = now();
    this.updateOverlay(t);
    this.overlay = on;
    this.overlayFrom = this.overlayMix;
    this.overlayTo = on ? 1 : 0;
    this.overlayStart = t;
    if (prefersReducedMotion()) this.overlayMix = this.overlayTo;
    this.draw();
    if (!prefersReducedMotion()) this.ensureLoop();
  }

  /** A copy of the current viewport. */
  getViewport(): Viewport {
    return { ...this.vp };
  }

  /** Canvas size in CSS px. */
  getSize(): { width: number; height: number } {
    return { width: this.cssW, height: this.cssH };
  }

  /** Re-read the canvas CSS size and DPR, resize the backing store, and redraw. */
  resize(): void {
    ({ cssW: this.cssW, cssH: this.cssH, dpr: this.dpr } = resizeBacking(this.canvas));
    this.layoutCache = fitGrid(this.cssW, this.cssH, PANEL_SIZE, PANEL_SIZE, this.margin);
    this.draw();
  }

  /** Full redraw of plate, studs, dots, and active overlays. */
  draw(): void {
    if (this.destroyed) return;
    clearCanvas(this.ctx);
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

  /** Remove any hint outlines and repaint their cells. */
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

  /** Sweep a soft highlight across placed dots once, resolving after the sweep. */
  completeAnim(): Promise<void> {
    if (this.destroyed || this.completionDone) return Promise.resolve();
    if (this.completionPromise) return this.completionPromise;
    if (prefersReducedMotion()) {
      this.completionDone = true;
      this.draw();
      return Promise.resolve();
    }
    this.completionStart = now();
    this.completionPromise = new Promise<void>((resolve) => {
      this.completionResolve = resolve;
    });
    this.draw();
    this.ensureLoop();
    return this.completionPromise;
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
    this.completionStart = null;
    this.completionDone = true;
    this.completionResolve?.();
    this.completionResolve = null;
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
    drawPlate(
      this.ctx,
      { x: a.x * d, y: a.y * d, w: size * d, h: size * d },
      Math.min(size * d * 0.02, 10 * d),
      PLATE_GREEN,
      { blur: 12 * d, offsetY: 4 * d, color: 'rgba(0,0,0,0.35)' },
    );
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
    const cell = this.getCell ? this.getCell(x, y) : undefined;
    const idx = cell ? cell.placed : EMPTY;
    const color = idx !== EMPTY ? this.palette[idx] : undefined;
    const k = key(x, y);
    if (color) {
      let sc = 1;
      const pressT = this.presses.get(k);
      let pressProgress = 1;
      if (pressT !== undefined) {
        pressProgress = (now() - pressT) / PRESS_MS;
        sc = pressScale(pressProgress);
      }
      const w = r.w * sc;
      const h = r.h * sc;
      ctx.drawImage(this.sprites.dot(color.hex, s), r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
      const glint = pressHighlightAlpha(pressProgress);
      if (glint > 0) {
        ctx.globalAlpha = glint;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(0.8, s * 0.035);
        ctx.beginPath();
        ctx.arc(
          r.x + r.w * 0.43,
          r.y + r.h * 0.43,
          Math.min(w, h) * 0.28,
          Math.PI * 1.05,
          Math.PI * 1.6,
        );
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else if (this.overlayMix > 0 && cell?.target !== undefined) {
      const t = this.palette[cell.target];
      if (t) {
        ctx.globalAlpha = 0.35 * this.overlayMix;
        ctx.drawImage(this.sprites.dot(t.hex, s), r.x, r.y, r.w, r.h);
        ctx.globalAlpha = this.overlayMix;
        const sym = this.symbols[cell.target];
        if (sym) {
          ctx.font = `bold ${Math.round(s * (sym.length > 1 ? 0.34 : 0.44))}px ${SYMBOL_FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = luminance(t.hex) > 0.45 ? '#1b1b1b' : '#fff';
          ctx.fillText(sym, r.x + r.w / 2, r.y + r.h / 2);
        }
      }
    }
    if (color && this.completionStart !== null) {
      const progress = Math.max(0, Math.min(1, (now() - this.completionStart) / COMPLETE_MS));
      const distance = progress * 1.2 - (x + 0.5) / PANEL_SIZE;
      const alpha = Math.max(0, Math.min(1, 1 - Math.abs(distance) / 0.18)) * 0.24;
      if (alpha > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.43, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#fff';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.restore();
      }
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
    if (this.raf || this.destroyed || typeof requestAnimationFrame !== 'function') return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    this.raf = 0;
    if (this.destroyed) return;
    const t = now();
    const wasOverlayActive = this.overlayMix !== this.overlayTo;
    this.updateOverlay(t);
    let completionActive = false;
    let completionFinished = false;
    if (this.completionStart !== null) {
      completionActive = t - this.completionStart < COMPLETE_MS;
      if (!completionActive) {
        completionFinished = true;
        this.completionStart = null;
        this.completionDone = true;
        this.completionResolve?.();
        this.completionResolve = null;
      }
    }
    const dirty: number[] = [];
    for (const [k, start] of this.presses) {
      if (t - start >= PRESS_MS) this.presses.delete(k);
      dirty.push(k);
    }
    for (const [k, end] of this.hints) {
      if (t >= end) this.hints.delete(k);
      dirty.push(k);
    }
    if (
      wasOverlayActive ||
      this.overlayMix !== this.overlayTo ||
      completionActive ||
      completionFinished
    )
      this.draw();
    else this.repaintKeys(dirty);
    if (
      this.presses.size > 0 ||
      this.hints.size > 0 ||
      this.overlayMix !== this.overlayTo ||
      completionActive
    )
      this.ensureLoop();
  };

  private updateOverlay(t: number): void {
    if (this.overlayMix === this.overlayTo) return;
    const progress = Math.max(0, Math.min(1, (t - this.overlayStart) / OVERLAY_MS));
    this.overlayMix = this.overlayFrom + (this.overlayTo - this.overlayFrom) * progress;
  }
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
