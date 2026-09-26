import { LAYOUT, PANEL_SIZE, type PictureSave } from '../types';

/** Number of panels in a picture. */
export function panelCount(save: PictureSave): number {
  const { cols, rows } = LAYOUT[save.aspect];
  return cols * rows;
}

/** Top-left stud of a panel in picture coordinates. Panels are numbered row-major. */
export function panelOrigin(save: PictureSave, panelIndex: number): { x: number; y: number } {
  const { cols, rows } = LAYOUT[save.aspect];
  if (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex >= cols * rows) {
    throw new RangeError(`panel index ${panelIndex} out of range`);
  }
  return { x: (panelIndex % cols) * PANEL_SIZE, y: Math.floor(panelIndex / cols) * PANEL_SIZE };
}

/** Flat index into target/placed for a panel-local stud. */
export function studIndex(save: PictureSave, panelIndex: number, lx: number, ly: number): number {
  const o = panelOrigin(save, panelIndex);
  return (o.y + ly) * save.width + (o.x + lx);
}
