/**
 * Panel geometry: the single owner of how a picture is split into 16x16 panels.
 * Keyed on Aspect (LAYOUT); the PictureSave wrappers delegate to the aspect functions.
 * Panels are numbered row-major.
 */

import { type Aspect, LAYOUT, PANEL_SIZE, type PictureSave } from '../types';

/** Panel grid (columns x rows of panels) for an aspect. */
export function panelGridOf(aspect: Aspect): { cols: number; rows: number } {
  const { cols, rows } = LAYOUT[aspect];
  return { cols, rows };
}

/** Number of panels for an aspect. */
export function panelCountOf(aspect: Aspect): number {
  const { cols, rows } = LAYOUT[aspect];
  return cols * rows;
}

/** Picture size in studs for an aspect. */
export function studDims(aspect: Aspect): { width: number; height: number } {
  const { cols, rows } = LAYOUT[aspect];
  return { width: cols * PANEL_SIZE, height: rows * PANEL_SIZE };
}

/** Aspect whose stud dimensions are exactly width x height. Throws for any other size. */
export function aspectOf(width: number, height: number): Aspect {
  for (const aspect of Object.keys(LAYOUT) as Aspect[]) {
    const d = studDims(aspect);
    if (d.width === width && d.height === height) return aspect;
  }
  throw new RangeError(`No layout is ${width}x${height} studs`);
}

/** Top-left stud of a panel in picture coordinates. */
export function panelOriginOf(aspect: Aspect, panelIndex: number): { x: number; y: number } {
  const { cols } = LAYOUT[aspect];
  if (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex >= panelCountOf(aspect)) {
    throw new RangeError(`panel index ${panelIndex} out of range`);
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

/**
 * Physical build plan for a picture: rows of panels joined with black connectors and
 * hanging hooks on the top row. Counts derive from the panel grid alone.
 */
export function assemblyPlanOf(aspect: Aspect): {
  cols: number;
  rows: number;
  rowJoints: number;
  joinConnectors: number;
  hooks: number;
} {
  const { cols, rows } = LAYOUT[aspect];
  return {
    cols,
    rows,
    rowJoints: (cols - 1) * rows,
    joinConnectors: (rows - 1) * cols,
    hooks: 2,
  };
}

/**
 * Per-panel fraction of studs whose placed value equals the target (0..1), row-major
 * panel order. `placed` may be shorter than target; missing entries count as empty.
 */
export function panelFractions(
  aspect: Aspect,
  width: number,
  target: ArrayLike<number>,
  placed: ArrayLike<number>,
): number[] {
  const out: number[] = [];
  for (let p = 0; p < panelCountOf(aspect); p++) {
    const o = panelOriginOf(aspect, p);
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
  return panelCountOf(save.aspect);
}

/** Top-left stud of a panel in picture coordinates. */
export function panelOrigin(save: PictureSave, panelIndex: number): { x: number; y: number } {
  return panelOriginOf(save.aspect, panelIndex);
}

/** Flat index into target/placed for a panel-local stud. */
export function studIndex(save: PictureSave, panelIndex: number, lx: number, ly: number): number {
  const o = panelOrigin(save, panelIndex);
  return (o.y + ly) * save.width + (o.x + lx);
}
