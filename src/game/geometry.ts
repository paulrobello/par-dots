/**
 * Panel geometry: the single owner of how a picture is split into 16x16 panels.
 * Pictures are addressed through their own stud dimensions (gridOfDims); the aspect-keyed
 * helpers exist for the creation screens, where a named aspect plus a size scale picks the
 * grid. Panels are numbered row-major.
 */

import { type Aspect, LAYOUT, PANEL_SIZE, type PictureSave } from '../types';

/** Panel grid (columns x rows of panels) for an aspect at a size scale. */
export function panelGridOf(aspect: Aspect, scale = 1): { cols: number; rows: number } {
  const { cols, rows } = LAYOUT[aspect];
  return { cols: cols * scale, rows: rows * scale };
}

/** Number of panels for an aspect at a size scale. */
export function panelCountOf(aspect: Aspect, scale = 1): number {
  const { cols, rows } = LAYOUT[aspect];
  return cols * rows * scale * scale;
}

/** Picture size in studs for an aspect at a size scale. */
export function studDims(aspect: Aspect, scale = 1): { width: number; height: number } {
  const { cols, rows } = LAYOUT[aspect];
  return { width: cols * scale * PANEL_SIZE, height: rows * scale * PANEL_SIZE };
}

/** Panel grid of a picture, from its own stud dimensions. Throws for non-panel dims. */
export function gridOfDims(width: number, height: number): { cols: number; rows: number } {
  const cols = width / PANEL_SIZE;
  const rows = height / PANEL_SIZE;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new RangeError(`${width}x${height} studs is not whole 16-stud panels`);
  }
  return { cols, rows };
}

/** Top-left stud of a panel in picture coordinates, in a cols x rows grid. */
export function panelOriginInGrid(
  grid: { cols: number; rows: number },
  panelIndex: number,
): { x: number; y: number } {
  if (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex >= grid.cols * grid.rows) {
    throw new RangeError(`panel index ${panelIndex} out of range`);
  }
  return {
    x: (panelIndex % grid.cols) * PANEL_SIZE,
    y: Math.floor(panelIndex / grid.cols) * PANEL_SIZE,
  };
}

/** Top-left stud of a panel in picture coordinates for an aspect grid. */
export function panelOriginOf(
  aspect: Aspect,
  panelIndex: number,
  scale = 1,
): { x: number; y: number } {
  return panelOriginInGrid(panelGridOf(aspect, scale), panelIndex);
}

/** Panel containing stud (x, y) in a width x height stud picture, or -1 when outside. */
export function panelIndexOfDims(width: number, height: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return -1;
  const { cols } = gridOfDims(width, height);
  return Math.floor(y / PANEL_SIZE) * cols + Math.floor(x / PANEL_SIZE);
}

/**
 * Physical build plan for a picture: rows of panels joined with black connectors (three
 * per shared panel edge) and hanging hooks on the top row. Counts derive from the panel
 * grid alone.
 */
export function assemblyPlanOfGrid(grid: { cols: number; rows: number }): {
  cols: number;
  rows: number;
  rowJoints: number;
  joinConnectors: number;
  hooks: number;
} {
  return {
    cols: grid.cols,
    rows: grid.rows,
    rowJoints: 3 * (grid.cols - 1) * grid.rows,
    joinConnectors: 3 * (grid.rows - 1) * grid.cols,
    hooks: 2,
  };
}

/** Physical build plan for an aspect grid at a size scale. */
export function assemblyPlanOf(aspect: Aspect, scale = 1): ReturnType<typeof assemblyPlanOfGrid> {
  return assemblyPlanOfGrid(panelGridOf(aspect, scale));
}

/**
 * Per-panel fraction of studs whose placed value equals the target (0..1), row-major
 * panel order. `placed` may be shorter than target; missing entries count as empty.
 */
export function panelFractions(
  width: number,
  height: number,
  target: ArrayLike<number>,
  placed: ArrayLike<number>,
): number[] {
  const grid = gridOfDims(width, height);
  const out: number[] = [];
  for (let p = 0; p < grid.cols * grid.rows; p++) {
    const o = panelOriginInGrid(grid, p);
    let correct = 0;
    for (let ly = 0; ly < PANEL_SIZE; ly++) {
      for (let lx = 0; lx < PANEL_SIZE; lx++) {
        const i = (o.y + ly) * width + (o.x + lx);
        if (i < placed.length && placed[i] === target[i]) correct++;
      }
    }
    out.push(correct / (PANEL_SIZE * PANEL_SIZE));
  }
  return out;
}

/** Number of panels in a picture. */
export function panelCount(save: PictureSave): number {
  const { cols, rows } = gridOfDims(save.width, save.height);
  return cols * rows;
}

/** Top-left stud of a panel in picture coordinates. */
export function panelOrigin(save: PictureSave, panelIndex: number): { x: number; y: number } {
  return panelOriginInGrid(gridOfDims(save.width, save.height), panelIndex);
}

/** Flat index into target/placed for a panel-local stud. */
export function studIndex(save: PictureSave, panelIndex: number, lx: number, ly: number): number {
  const o = panelOrigin(save, panelIndex);
  return (o.y + ly) * save.width + (o.x + lx);
}
