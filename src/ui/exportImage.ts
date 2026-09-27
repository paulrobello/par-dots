/**
 * PNG downloads: the picture as built (`<name>-dots.png`), and building sheets for making
 * the mosaic from real dots (`<name>-panel-N.png`, or every panel stacked in `<name>-guide.png`).
 */

import { panelColorCounts, panelCount } from '../game';
import { renderMosaicToCanvas } from '../render/mosaicImage';
import { renderPanelSheet } from '../render/panelSheet';
import type { PictureSave } from '../types';
import { downloadBlob, toast } from './dom';
import { paletteLabels, paletteSymbols, safeFileStem } from './pure';

/** Browsers refuse canvases taller than this. */
const MAX_CANVAS_PX = 16384;

function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) {
      toast('Export failed');
      return;
    }
    downloadBlob(blob, filename);
  }, 'image/png');
}

/** Download the picture as built (placed dots) as a PNG. */
export function exportPng(save: PictureSave): void {
  const canvasOut = renderMosaicToCanvas(save, 24, 'dots', { cells: save.placed });
  downloadCanvas(canvasOut, `${safeFileStem(save.name)}-dots.png`);
}

function panelSheet(save: PictureSave, i: number): HTMLCanvasElement {
  const labels = paletteLabels(save.palette);
  const symbols = paletteSymbols(save.palette.length);
  return renderPanelSheet(save, i, labels, symbols, panelColorCounts(save, i));
}

/** Download the building sheet for panel `i`. */
export function exportPanelSheet(save: PictureSave, i: number): void {
  downloadCanvas(panelSheet(save, i), `${safeFileStem(save.name)}-panel-${i + 1}.png`);
}

/**
 * Download every panel's sheet stacked into one tall PNG. When that would exceed the browser's
 * canvas limit, download one PNG per panel instead.
 */
export function exportAllSheets(save: PictureSave): void {
  const sheets = Array.from({ length: panelCount(save) }, (_, i) => panelSheet(save, i));
  const width = Math.max(...sheets.map((s) => s.width));
  const height = sheets.reduce((sum, s) => sum + s.height, 0);
  if (height > MAX_CANVAS_PX) {
    toast('Guide too tall for one image; downloading one per panel', 3000);
    sheets.forEach((s, i) => {
      downloadCanvas(s, `${safeFileStem(save.name)}-panel-${i + 1}.png`);
    });
    return;
  }
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) {
    toast('Export failed');
    return;
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const s of sheets) {
    ctx.drawImage(s, 0, y);
    y += s.height;
  }
  downloadCanvas(out, `${safeFileStem(save.name)}-guide.png`);
}
