/**
 * Full-picture overview: every stud of the width x height mosaic, placed dots, panel borders,
 * per-panel completion badges, and an optional faint target "ghost".
 * Panels are indexed row-major: index = row * (width / 16) + col.
 *
 * OverviewRenderer owns its canvas's backing store and device pixel ratio and a sprite cache.
 * It has no animation loop and nothing to release. Call order: construct (sizes the canvas),
 * setData, then resize on layout changes and draw after setGhost.
 */

import {
  aspectOf,
  panelFractions,
  panelGridOf,
  panelIndexOf,
  panelScaleOf,
} from '../game/geometry';
import { EMPTY, type Mosaic, PANEL_SIZE } from '../types';
import { clearCanvas, drawPlate, resizeBacking } from './canvas';
import { fitGrid, type GridLayout, IDENTITY_VIEWPORT, screenToCell } from './layout';
import { clientToCanvas } from './motion';
import { PLATE_GREEN, SpriteCache } from './sprites';

const COMPLETE_GREEN = '#3fcf5c';

/** Construction options for OverviewRenderer. */
export interface OverviewRendererOptions {
  /** Show a percentage badge on started-but-unfinished panels. Default true. */
  showPercent?: boolean;
}

/** Draws the whole picture; see the file header for ownership and call order. */
export class OverviewRenderer {
  /** The canvas this renderer draws into. */
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: SpriteCache;
  private readonly showPercent: boolean;
  private mosaic: Mosaic | null = null;
  private placed: Uint8Array | null = null;
  private ghost = false;
  private layout: GridLayout = { cell: 0, originX: 0, originY: 0, cols: 0, rows: 0 };
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;

  /** Takes the canvas's 2D context and sizes it. Throws when no 2D context is available. */
  constructor(canvas: HTMLCanvasElement, opts: OverviewRendererOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.sprites = new SpriteCache({ maxEntries: 96 });
    this.showPercent = opts.showPercent ?? true;
    this.resize();
  }

  /**
   * Picture and its placed state (EMPTY or palette index per stud, row-major). Recomputes the
   * layout but does not redraw; call draw() or resize().
   */
  setData(mosaic: Mosaic, placed: Uint8Array): void {
    this.mosaic = mosaic;
    this.placed = placed;
    this.relayout();
  }

  /** Toggle the faint target-color ghost on empty studs. Does not redraw; call draw(). */
  setGhost(on: boolean): void {
    this.ghost = on;
  }

  /** Whether the ghost is on. */
  get ghostEnabled(): boolean {
    return this.ghost;
  }

  /** Canvas-CSS-px rectangle of a panel, e.g. as the origin of a zoom transition. */
  panelRect(index: number): { x: number; y: number; w: number; h: number } | null {
    if (!this.mosaic) return null;
    const aspect = aspectOf(this.mosaic.width, this.mosaic.height);
    const { cols, rows } = panelGridOf(aspect, panelScaleOf(aspect, this.mosaic.width));
    if (!Number.isInteger(index) || index < 0 || index >= cols * rows) return null;
    const L = this.layout;
    const s = L.cell * PANEL_SIZE;
    return {
      x: L.originX + (index % cols) * s,
      y: L.originY + Math.floor(index / cols) * s,
      w: s,
      h: s,
    };
  }

  /** Re-read the canvas CSS size and DPR, resize the backing store, relayout, and redraw. */
  resize(): void {
    ({ cssW: this.cssW, cssH: this.cssH, dpr: this.dpr } = resizeBacking(this.canvas));
    this.relayout();
    this.draw();
  }

  /** Panel index under client coordinates, or null outside the studs. */
  hitTestPanel(clientX: number, clientY: number): number | null {
    if (!this.mosaic) return null;
    const p = clientToCanvas(this.canvas, this.cssW, this.cssH, clientX, clientY);
    const cell = screenToCell(this.layout, IDENTITY_VIEWPORT, p.x, p.y);
    if (!cell) return null;
    const aspect = aspectOf(this.mosaic.width, this.mosaic.height);
    const idx = panelIndexOf(aspect, cell.x, cell.y, panelScaleOf(aspect, this.mosaic.width));
    return idx < 0 ? null : idx;
  }

  /** Full redraw: plate, studs, placed dots or ghost, panel seams and completion badges. */
  draw(): void {
    const ctx = this.ctx;
    clearCanvas(ctx);
    const m = this.mosaic;
    const L = this.layout;
    if (!m || L.cell <= 0) return;
    const d = this.dpr;
    const placed = this.placed;

    // Plate with drop shadow.
    const pad = L.cell * 0.4;
    drawPlate(
      ctx,
      {
        x: (L.originX - pad) * d,
        y: (L.originY - pad) * d,
        w: (L.cell * m.width + 2 * pad) * d,
        h: (L.cell * m.height + 2 * pad) * d,
      },
      6 * d,
      PLATE_GREEN,
      { blur: 10 * d, offsetY: 3 * d, color: 'rgba(0,0,0,0.35)' },
    );

    const edgesX = new Array<number>(m.width + 1);
    for (let x = 0; x <= m.width; x++) edgesX[x] = Math.round((L.originX + x * L.cell) * d);
    const edgesY = new Array<number>(m.height + 1);
    for (let y = 0; y <= m.height; y++) edgesY[y] = Math.round((L.originY + y * L.cell) * d);
    const spritePx = Math.max(4, Math.ceil(L.cell * d));
    const stud = this.sprites.stud(spritePx);

    for (let y = 0; y < m.height; y++) {
      const y0 = edgesY[y] ?? 0;
      const h = (edgesY[y + 1] ?? y0) - y0;
      for (let x = 0; x < m.width; x++) {
        const x0 = edgesX[x] ?? 0;
        const w = (edgesX[x + 1] ?? x0) - x0;
        const i = y * m.width + x;
        const pIdx = placed ? (placed[i] ?? EMPTY) : EMPTY;
        const color = pIdx !== EMPTY ? m.palette[pIdx] : undefined;
        ctx.drawImage(stud, x0, y0, w, h);
        if (color) {
          ctx.drawImage(this.sprites.dot(color.hex, spritePx), x0, y0, w, h);
        } else if (this.ghost) {
          const t = m.palette[m.target[i] ?? 0];
          if (t) {
            ctx.globalAlpha = 0.35;
            ctx.drawImage(this.sprites.dot(t.hex, spritePx), x0, y0, w, h);
            ctx.globalAlpha = 1;
          }
        }
      }
    }

    this.drawPanelChrome(m, edgesX, edgesY);
  }

  private drawPanelChrome(m: Mosaic, edgesX: number[], edgesY: number[]): void {
    const ctx = this.ctx;
    const d = this.dpr;
    const aspect = aspectOf(m.width, m.height);
    const { cols, rows } = panelGridOf(aspect, panelScaleOf(aspect, m.width));
    const completion = this.placed ? panelFractions(aspect, m.width, m.target, this.placed) : [];

    // A finished picture drops its seams and badges for a single green frame.
    if (completion.length > 0 && completion.every((f) => f >= 1)) {
      const lw = Math.max(3, 4 * d);
      const x0 = edgesX[0] ?? 0;
      const y0 = edgesY[0] ?? 0;
      ctx.save();
      ctx.lineWidth = lw;
      ctx.strokeStyle = COMPLETE_GREEN;
      ctx.strokeRect(
        x0 - lw / 2,
        y0 - lw / 2,
        (edgesX[m.width] ?? x0) - x0 + lw,
        (edgesY[m.height] ?? y0) - y0 + lw,
      );
      ctx.restore();
      return;
    }

    // Panel seams: dark groove with a light edge.
    ctx.save();
    ctx.lineWidth = Math.max(1, 1.5 * d);
    for (let c = 1; c < cols; c++) {
      const x = edgesX[c * PANEL_SIZE] ?? 0;
      line(ctx, x, edgesY[0] ?? 0, x, edgesY[m.height] ?? 0, 'rgba(0,0,0,0.45)');
      line(
        ctx,
        x + ctx.lineWidth,
        edgesY[0] ?? 0,
        x + ctx.lineWidth,
        edgesY[m.height] ?? 0,
        'rgba(255,255,255,0.18)',
      );
    }
    for (let r = 1; r < rows; r++) {
      const y = edgesY[r * PANEL_SIZE] ?? 0;
      line(ctx, edgesX[0] ?? 0, y, edgesX[m.width] ?? 0, y, 'rgba(0,0,0,0.45)');
      line(
        ctx,
        edgesX[0] ?? 0,
        y + ctx.lineWidth,
        edgesX[m.width] ?? 0,
        y + ctx.lineWidth,
        'rgba(255,255,255,0.18)',
      );
    }
    ctx.restore();

    // Badges.
    const panelPx = (edgesX[PANEL_SIZE] ?? 0) - (edgesX[0] ?? 0);
    const badgeR = Math.max(8 * d, Math.min(panelPx * 0.13, 16 * d));
    for (let p = 0; p < cols * rows; p++) {
      const frac = completion[p] ?? 0;
      const col = p % cols;
      const row = Math.floor(p / cols);
      const x1 = edgesX[Math.min(m.width, (col + 1) * PANEL_SIZE)] ?? 0;
      const y0 = edgesY[row * PANEL_SIZE] ?? 0;
      const cx = x1 - badgeR - 3 * d;
      const cy = y0 + badgeR + 3 * d;
      if (frac >= 1) drawCheckBadge(ctx, cx, cy, badgeR);
      else if (this.showPercent && frac > 0) drawPercentBadge(ctx, cx, cy, badgeR, frac);
    }
  }

  private relayout(): void {
    const m = this.mosaic;
    if (!m) {
      this.layout = { cell: 0, originX: 0, originY: 0, cols: 0, rows: 0 };
      return;
    }
    this.layout = fitGrid(this.cssW, this.cssH, m.width, m.height, 0.6);
  }
}

function line(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stroke: string,
): void {
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function drawCheckBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = r * 0.4;
  ctx.shadowOffsetY = r * 0.12;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#5fe07a');
  g.addColorStop(1, '#1f9d3a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = r * 0.14;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.lineWidth = r * 0.24;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.1, cy + r * 0.36);
  ctx.lineTo(cx + r * 0.48, cy - r * 0.34);
  ctx.stroke();
  ctx.restore();
}

function drawPercentBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  frac: number,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(20,20,24,0.72)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = r * 0.18;
  ctx.strokeStyle = '#ffd23f';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.84, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${Math.round(r * 0.72)}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.floor(frac * 100)}`, cx, cy + r * 0.04);
  ctx.restore();
}
