/**
 * Picture downloads: the picture as built (`<name>-dots.png`), and building sheets for making
 * the mosaic from real dots (`<name>-panel-N.png`, or every panel as one page of `<name>-guide.pdf`).
 */

import { panelColorCounts, panelCount } from '../game';
import { renderMosaicToCanvas } from '../render/mosaicImage';
import { renderAssemblySheet, renderGuideOverview, renderPanelSheet } from '../render/panelSheet';
import { buildImagePdf } from '../render/pdf';
import type { PictureSave } from '../types';
import { downloadBlob, toast } from './dom';
import { paletteLabels, paletteSymbols, safeFileStem } from './pure';

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
  const labels = paletteLabels(save.palette, save.paletteMode);
  const symbols = paletteSymbols(save.palette.length);
  return renderPanelSheet(save, i, labels, symbols, panelColorCounts(save, i));
}

/** Download the building sheet for panel `i`. */
export function exportPanelSheet(save: PictureSave, i: number): void {
  downloadCanvas(panelSheet(save, i), `${safeFileStem(save.name)}-panel-${i + 1}.png`);
}

/** Download every panel's sheet as one PDF: overview, assembly, then one panel per US Letter page. */
export async function exportAllSheets(save: PictureSave): Promise<void> {
  try {
    const front = [renderGuideOverview(save), renderAssemblySheet(save)];
    const pages = await Promise.all([
      ...front.map(async (sheet) => ({
        jpeg: await canvasJpeg(sheet),
        width: sheet.width,
        height: sheet.height,
      })),
      ...Array.from({ length: panelCount(save) }, async (_, i) => {
        const sheet = panelSheet(save, i);
        return { jpeg: await canvasJpeg(sheet), width: sheet.width, height: sheet.height };
      }),
    ]);
    const pdf = buildImagePdf(pages);
    downloadBlob(
      new Blob([pdf as BlobPart], { type: 'application/pdf' }),
      `${safeFileStem(save.name)}-guide.pdf`,
    );
  } catch (err) {
    console.error('guide PDF export failed', err);
    toast('Export failed');
  }
}

function canvasJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('canvas.toBlob returned null'));
        else blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      },
      'image/jpeg',
      0.92,
    );
  });
}
