/**
 * Rasterizers for the draw mode: pure cell-set generators over the whole stud grid.
 * Coordinates are whole-grid studs, so shapes span panel seams freely. Generators may
 * return out-of-bounds cells (brush stamps near edges); the applier clips.
 */

/** A whole-grid stud coordinate. */
export interface GridCell {
  x: number;
  y: number;
}

/** Brush stamp tip. */
export type BrushTip = 'round' | 'square';

/** Cells covered by a brush stamp centered on (x, y). `size` is an odd stud count (1..9). */
export function brushCells(x: number, y: number, size: number, tip: BrushTip): GridCell[] {
  const half = Math.max(0, Math.floor((size - 1) / 2));
  const out: GridCell[] = [];
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      if (tip === 'round' && dx * dx + dy * dy > (half + 0.25) * (half + 0.25)) continue;
      out.push({ x: x + dx, y: y + dy });
    }
  }
  return out;
}

/** Cells on the Bresenham line from (x0, y0) to (x1, y1), inclusive of both ends. */
export function lineCells(x0: number, y0: number, x1: number, y1: number): GridCell[] {
  const out: GridCell[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** Degrees of tolerance for the line tool's 0/45/90-degree snap. */
export const SNAP_TOLERANCE_DEG = 7;

/** (x1, y1) snapped to the nearest 45-degree step within tolerance, keeping its length. */
export function snapLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  toleranceDeg: number = SNAP_TOLERANCE_DEG,
): GridCell {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return { x: x1, y: y1 };
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const k = Math.round(angle / step);
  const offDeg = Math.abs(angle - k * step) * (180 / Math.PI);
  if (offDeg > toleranceDeg) return { x: x1, y: y1 };
  const len = Math.round(Math.hypot(dx, dy));
  return {
    x: x0 + Math.round(len * Math.cos(k * step)),
    y: y0 + Math.round(len * Math.sin(k * step)),
  };
}

/** Cells of the axis-aligned box with corners (x0, y0) and (x1, y1): outline or fill. */
export function rectCells(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  filled: boolean,
): GridCell[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const out: GridCell[] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (filled || x === left || x === right || y === top || y === bottom) out.push({ x, y });
    }
  }
  return out;
}

/** Cells of the ellipse inscribed in the box with corners (x0, y0) and (x1, y1). */
export function ellipseCells(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  filled: boolean,
): GridCell[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  if (rx === 0 && ry === 0) return [{ x: left, y: top }];
  const value = (x: number, y: number): number => {
    const nx = rx === 0 ? 0 : (x - cx) / rx;
    const ny = ry === 0 ? 0 : (y - cy) / ry;
    return nx * nx + ny * ny;
  };
  const out: GridCell[] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const v = value(x, y);
      if (filled) {
        if (v <= 1) out.push({ x, y });
      } else if (
        v <= 1 &&
        (value(x - 1, y) > 1 || value(x + 1, y) > 1 || value(x, y - 1) > 1 || value(x, y + 1) > 1)
      ) {
        out.push({ x, y });
      }
    }
  }
  return out;
}

/** Cells of the closed polygon through `points`: edge lines, or edge lines plus scanline fill. */
export function polygonCells(points: GridCell[], filled: boolean): GridCell[] {
  if (points.length < 3) return [];
  const out: GridCell[] = [];
  const seen = new Set<number>();
  const push = (x: number, y: number): void => {
    const k = y * 4096 + x;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x, y });
  };
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (const c of lineCells(a.x, a.y, b.x, b.y)) push(c.x, c.y);
  }
  if (!filled) return out;
  const ys = points.map((p) => p.y);
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
    const crosses: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        crosses.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    crosses.sort((m, n) => m - n);
    for (let k = 0; k + 1 < crosses.length; k += 2) {
      for (let x = Math.round(crosses[k]); x <= Math.round(crosses[k + 1]); x++) push(x, y);
    }
  }
  return out;
}

/** The 4-connected region of equal values containing (x, y); empty when out of bounds. */
export function floodCells(
  grid: ArrayLike<number>,
  w: number,
  h: number,
  x: number,
  y: number,
): GridCell[] {
  if (x < 0 || y < 0 || x >= w || y >= h) return [];
  const target = grid[y * w + x];
  const seen = new Uint8Array(w * h);
  const out: GridCell[] = [];
  const queue = [y * w + x];
  seen[y * w + x] = 1;
  const tryPush = (nx: number, ny: number): void => {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
    const j = ny * w + nx;
    if (seen[j] || grid[j] !== target) return;
    seen[j] = 1;
    queue.push(j);
  };
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const cx = i % w;
    const cy = Math.floor(i / w);
    out.push({ x: cx, y: cy });
    tryPush(cx + 1, cy);
    tryPush(cx - 1, cy);
    tryPush(cx, cy + 1);
    tryPush(cx, cy - 1);
  }
  return out;
}
