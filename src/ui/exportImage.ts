import { renderMosaicToCanvas } from '../render/mosaicImage';
import type { PictureSave } from '../types';
import { downloadBlob, toast } from './dom';

/** Download the picture as built (placed dots) as a PNG. */
export function exportPng(save: PictureSave): void {
  const canvasOut = renderMosaicToCanvas(save, 24, 'dots', { cells: save.placed });
  canvasOut.toBlob((blob) => {
    if (!blob) {
      toast('Export failed');
      return;
    }
    const safe = save.name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'mosaic';
    downloadBlob(blob, `${safe}-dots.png`);
  }, 'image/png');
}
