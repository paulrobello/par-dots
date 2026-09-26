import { type Aspect, LAYOUT, type Mosaic, PANEL_SIZE } from '../types';

export function panelCount(aspect: Aspect): number {
  const { cols, rows } = LAYOUT[aspect];
  return cols * rows;
}

export function studDims(aspect: Aspect): { width: number; height: number } {
  const { cols, rows } = LAYOUT[aspect];
  return { width: cols * PANEL_SIZE, height: rows * PANEL_SIZE };
}

/** Top-left stud of a panel. Panels are numbered row-major. */
export function panelOrigin(aspect: Aspect, panelIndex: number): { x: number; y: number } {
  const { cols } = LAYOUT[aspect];
  if (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex >= panelCount(aspect)) {
    throw new RangeError(`Panel index ${panelIndex} out of range for ${aspect}`);
  }
  return { x: (panelIndex % cols) * PANEL_SIZE, y: Math.floor(panelIndex / cols) * PANEL_SIZE };
}

/** Panel containing stud (x, y), or -1 when outside the picture. */
export function panelIndexOf(aspect: Aspect, x: number, y: number): number {
  const { width, height } = studDims(aspect);
  if (x < 0 || y < 0 || x >= width || y >= height) return -1;
  const { cols } = LAYOUT[aspect];
  return Math.floor(y / PANEL_SIZE) * cols + Math.floor(x / PANEL_SIZE);
}

/** Distinct palette indices used by a panel's target, ascending. */
export function panelColors(mosaic: Mosaic, aspect: Aspect, panelIndex: number): number[] {
  const { x: px, y: py } = panelOrigin(aspect, panelIndex);
  const seen = new Set<number>();
  for (let y = py; y < py + PANEL_SIZE; y++) {
    for (let x = px; x < px + PANEL_SIZE; x++) {
      seen.add(mosaic.target[y * mosaic.width + x]);
    }
  }
  return [...seen].sort((a, b) => a - b);
}
