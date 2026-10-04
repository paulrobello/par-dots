/**
 * Printable building sheet for one panel: a numbered 16x16 grid of flat cell colors (the
 * target for photo saves, the placed dots for drawn ones), each cell carrying its palette
 * symbol, empty cells left blank, and a legend mapping symbol to color name and count.
 */

import { effectiveCells, panelCount, panelOrigin } from '../game';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../types';
import { luminance } from './color';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const INK = '#1b1b1b';

/** Symbol ink that reads on a cell of this color. */
function symbolInk(hex: string): string {
  return luminance(hex) > 0.45 ? INK : '#fff';
}

/**
 * Render the building sheet for one panel. `labels`, `symbols` and `counts` are indexed by
 * palette index; `counts` is the panel's per-color dot count (panelColorCounts).
 */
export function renderPanelSheet(
  save: PictureSave,
  panelIndex: number,
  labels: string[],
  symbols: string[],
  counts: number[],
  cellPx = 40,
): HTMLCanvasElement {
  const c = Math.max(8, Math.round(cellPx));
  const margin = Math.round(c * 0.5);
  const gutter = c;
  const grid = c * PANEL_SIZE;
  const titleSize = Math.round(c * 0.6);
  const subSize = Math.round(c * 0.4);
  const header = titleSize + subSize + Math.round(c * 0.5);
  const legendRow = Math.round(c * 0.8);
  const swatch = Math.round(c * 0.6);
  const gap = Math.round(c * 0.25);
  const labelFont = `${Math.round(c * 0.36)}px ${FONT}`;
  const countFont = `bold ${Math.round(c * 0.36)}px ${FONT}`;

  const used = counts
    .map((count, i) => ({ i, count }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || a.i - b.i);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  // Size the legend columns from the widest label and count before sizing the canvas.
  ctx.font = labelFont;
  const labelW = Math.max(0, ...used.map((e) => ctx.measureText(labels[e.i]).width));
  ctx.font = countFont;
  const countW = Math.max(0, ...used.map((e) => ctx.measureText(String(e.count)).width));
  const contentW = gutter + grid;
  const colW = Math.ceil(swatch + gap + labelW + gap * 2 + countW + gap * 2);
  const cols = Math.max(1, Math.min(used.length, Math.floor(contentW / colW)));
  const legendRows = Math.ceil(used.length / cols);
  const legendTop = margin + header + gutter + grid + margin;

  canvas.width = margin * 2 + contentW;
  canvas.height = legendTop + legendRows * legendRow + margin;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';

  // Header.
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.font = `bold ${titleSize}px ${FONT}`;
  ctx.fillText(save.name, margin, margin + titleSize / 2);
  ctx.font = `${subSize}px ${FONT}`;
  ctx.fillStyle = '#555';
  ctx.fillText(
    `Panel ${panelIndex + 1} of ${panelCount(save)}`,
    margin,
    margin + titleSize + gap + subSize / 2,
  );

  const gx = margin + gutter;
  const gy = margin + header + gutter;

  // Column and row numbers.
  ctx.fillStyle = '#555';
  ctx.textAlign = 'center';
  ctx.font = `${Math.round(c * 0.36)}px ${FONT}`;
  for (let k = 0; k < PANEL_SIZE; k++) {
    ctx.fillText(String(k + 1), gx + k * c + c / 2, gy - gutter / 2);
    ctx.fillText(String(k + 1), margin + gutter / 2, gy + k * c + c / 2);
  }

  // Cells with symbols.
  const o = panelOrigin(save, panelIndex);
  const cells = effectiveCells(save);
  ctx.font = `bold ${Math.round(c * 0.45)}px ${FONT}`;
  for (let y = 0; y < PANEL_SIZE; y++) {
    for (let x = 0; x < PANEL_SIZE; x++) {
      const idx = cells[(o.y + y) * save.width + o.x + x];
      if (idx === EMPTY) continue;
      const hex = save.palette[idx].hex;
      ctx.fillStyle = hex;
      ctx.fillRect(gx + x * c, gy + y * c, c, c);
      ctx.fillStyle = symbolInk(hex);
      ctx.fillText(symbols[idx], gx + x * c + c / 2, gy + y * c + c / 2);
    }
  }

  // Grid lines, heavier every 4 cells for counting.
  for (let k = 0; k <= PANEL_SIZE; k++) {
    const heavy = k % 4 === 0;
    ctx.strokeStyle = heavy ? INK : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = heavy ? 2 : 1;
    const p = k * c + (heavy ? 0 : 0.5);
    ctx.beginPath();
    ctx.moveTo(gx + p, gy);
    ctx.lineTo(gx + p, gy + grid);
    ctx.moveTo(gx, gy + p);
    ctx.lineTo(gx + grid, gy + p);
    ctx.stroke();
  }

  // Legend: swatch with symbol, name, count; filled column by column.
  used.forEach((e, n) => {
    const lx = margin + Math.floor(n / legendRows) * colW;
    const cy = legendTop + (n % legendRows) * legendRow + legendRow / 2;
    const hex = save.palette[e.i].hex;
    ctx.fillStyle = hex;
    ctx.fillRect(lx, cy - swatch / 2, swatch, swatch);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(lx + 0.5, cy - swatch / 2 + 0.5, swatch - 1, swatch - 1);
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(c * 0.36)}px ${FONT}`;
    ctx.fillStyle = symbolInk(hex);
    ctx.fillText(symbols[e.i], lx + swatch / 2, cy);
    ctx.textAlign = 'left';
    ctx.font = labelFont;
    ctx.fillStyle = INK;
    ctx.fillText(labels[e.i], lx + swatch + gap, cy);
    ctx.textAlign = 'right';
    ctx.font = countFont;
    ctx.fillText(String(e.count), lx + colW - gap * 2, cy);
  });

  return canvas;
}
