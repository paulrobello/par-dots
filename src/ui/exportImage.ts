/**
 * PNG download of a picture as built: renders the placed dots in the dot style and saves
 * `<name>-dots.png`.
 */

import { renderMosaicToCanvas } from '../render/mosaicImage';
import type { PictureSave } from '../types';
import { downloadBlob, toast } from './dom';
import { safeFileStem } from './pure';

/** Download the picture as built (placed dots) as a PNG. */
export function exportPng(save: PictureSave): void {
  const canvasOut = renderMosaicToCanvas(save, 24, 'dots', { cells: save.placed });
  canvasOut.toBlob((blob) => {
    if (!blob) {
      toast('Export failed');
      return;
    }
    downloadBlob(blob, `${safeFileStem(save.name)}-dots.png`);
  }, 'image/png');
}
