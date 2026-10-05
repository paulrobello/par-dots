/**
 * Panel geometry: the single owner of how a picture is split into 16x16 panels.
 * Keyed on Aspect (LAYOUT) and an integer size scale (1 = the base grid; N scales both
 * grid axes by N). The PictureSave wrappers derive the scale from the save's own stud
 * dimensions. Panels are numbered row-major.
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

/** Size scale of an aspect picture `width` studs wide (1 = the base grid). */
export function panelScaleOf(aspect: Aspect, width: number): number {
  const base = LAYOUT[aspect].cols * PANEL_SIZE;
  const scale = width / base;
  if (!Number.isInteger(scale) || scale < 1) {
    throw new RangeError(`width ${width} is not a whole multiple of the base ${aspect} grid`);
  }
  return scale;
}

/** Aspect whose stud dimensions are exactly width x height. Throws for any other size. */
export function aspectOf(width: number, height: number): Aspect {
  for (const aspect of Object.keys(LAYOUT) as Aspect[]) {
    const base = LAYOUT[aspect].cols * PANEL_SIZE;
    if (width < base) continue;
    if (width % base === 0 && (width / base) * LAYOUT[aspect].rows * PANEL_SIZE === height) {
      return aspect;
    }
  }
  throw new RangeError(`No layout is ${width}x${height} studs`);
}

/** Top-left stud of a panel in picture coordinates. */
export function panelOriginOf(
  aspect: Aspect,
  panelIndex: number,
  scale = 1,
): { x: number; y: number } {
  if (
    !Number.isInteger(panelIndex) ||
    panelIndex < 0 ||
    panelIndex >= panelCountOf(aspect, scale)
  ) {
    throw new RangeError(`panel index ${panelIndex} out of range`);
  }
  const cols = LAYOUT[aspect].cols * scale;
  return { x: (panelIndex % cols) * PANEL_SIZE, y: Math.floor(panelIndex / cols) * PANEL_SIZE };
}

/** Panel containing stud (x, y), or -1 when outside the picture. */
export function panelIndexOf(aspect: Aspect, x: number, y: number, scale = 1): number {
  const { width, height } = studDims(aspect, scale);
  if (x < 0 || y < 0 || x >= width || y >= height) return -1;
  const cols = LAYOUT[aspect].cols * scale;
  return Math.floor(y / PANEL_SIZE) * cols + Math.floor(x / PANEL_SIZE);
}

/**
 * Physical build plan for a picture: rows of panels joined with black connectors (three
 * per shared panel edge) and hanging hooks on the top row. Counts derive from the panel
 * grid alone.
 */
export function assemblyPlanOf(
  aspect: Aspect,
  scale = 1,
): {
  cols: number;
  rows: number;
  rowJoints: number;
  joinConnectors: number;
  hooks: number;
} {
  const { cols, rows } = panelGridOf(aspect, scale);
  return {
    cols,
    rows,
    rowJoints: 3 * (cols - 1) * rows,
    joinConnectors: 3 * (rows - 1) * cols,
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
  const scale = panelScaleOf(aspect, width);
  const out: number[] = [];
  for (let p = 0; p < panelCountOf(aspect, scale); p++) {
    const o = panelOriginOf(aspect, p, scale);
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
  return panelCountOf(save.aspect, panelScaleOf(save.aspect, save.width));
}

/** Top-left stud of a panel in picture coordinates. */
export function panelOrigin(save: PictureSave, panelIndex: number): { x: number; y: number } {
  return panelOriginOf(save.aspect, panelIndex, panelScaleOf(save.aspect, save.width));
}

/** Flat index into target/placed for a panel-local stud. */
export function studIndex(save: PictureSave, panelIndex: number, lx: number, ly: number): number {
  const o = panelOrigin(save, panelIndex);
  return (o.y + ly) * save.width + (o.x + lx);
}
