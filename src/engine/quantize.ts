/**
 * Mosaic quantization: turns stud-resolution RGBA pixels into a palette and a target index
 * per stud. Deterministic for identical input.
 *
 * 1. Collect distinct colors with pixel counts, compositing transparency over white.
 * 2. Choose candidates. LEGO mode: when the LEGO colors nearest to some pixel color already
 *    fit the limit, use them; otherwise greedy selection from LEGO_COLORS by weighted Lab
 *    error, then swap refinement. Free mode: when the distinct colors fit, use them;
 *    otherwise weighted k-means++ seeding (fixed FREE_SEED) and Lloyd iterations in Lab,
 *    each centroid colored by its RGB mean and named after the nearest LEGO color.
 * 3. Merge candidates closer than MIN_DELTA_E, dropping the one covering fewer pixels.
 * 4. Map pixels to their nearest candidate (or, with dithering, Floyd–Steinberg error diffusion
 *    in serpentine order), keep used candidates only, and sort by L*, then hex.
 */

import { MAX_COLORS, MIN_COLORS, type Mosaic, type PaletteColor, type PaletteMode } from '../types';
import { deltaE76Sq, hexToRgb, type Lab, rgbToHex, rgbToLab } from './color';
import { LEGO_COLORS } from './legoPalette';

/** Distinct pixel colors with their occurrence counts (the weighted point set). */
interface ColorSet {
  rgb: number[]; // packed 0xRRGGBB per distinct color
  lab: Lab[];
  weight: number[];
  /** Index into rgb/lab/weight for every pixel. */
  pixelColor: Uint32Array;
}

interface Entry {
  color: PaletteColor;
  lab: Lab;
}

const FREE_SEED = 0x5eed_d075;

/** Minimum CIE76 distance between palette colors, so every shade is tellable apart. */
export const MIN_DELTA_E = 12;
const KMEANS_MAX_ITER = 24;
const SWAP_MAX_ROUNDS = 16;

/** Composite RGBA over white and collect distinct colors (first-seen order). */
function collectColors(pixels: Uint8ClampedArray, count: number): ColorSet {
  const indexOf = new Map<number, number>();
  const set: ColorSet = { rgb: [], lab: [], weight: [], pixelColor: new Uint32Array(count) };
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const a = pixels[p + 3] / 255;
    const r = Math.round(pixels[p] * a + 255 * (1 - a));
    const g = Math.round(pixels[p + 1] * a + 255 * (1 - a));
    const b = Math.round(pixels[p + 2] * a + 255 * (1 - a));
    const key = (r << 16) | (g << 8) | b;
    let idx = indexOf.get(key);
    if (idx === undefined) {
      idx = set.rgb.length;
      indexOf.set(key, idx);
      set.rgb.push(key);
      set.lab.push(rgbToLab(r, g, b));
      set.weight.push(0);
    }
    set.weight[idx]++;
    set.pixelColor[i] = idx;
  }
  return set;
}

function nearest(lab: Lab, entries: readonly Entry[]): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let j = 0; j < entries.length; j++) {
    const d = deltaE76Sq(lab, entries[j].lab);
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  }
  return best;
}

/** Total weighted squared error of mapping every color to its nearest selected candidate. */
function selectionError(dist: Float64Array[], weight: number[], selected: number[]): number {
  let total = 0;
  for (let i = 0; i < weight.length; i++) {
    let m = Number.POSITIVE_INFINITY;
    for (const s of selected) if (dist[s][i] < m) m = dist[s][i];
    total += m * weight[i];
  }
  return total;
}

/** Every LEGO color with its Lab value, computed once. */
const LEGO_ENTRIES: readonly Entry[] = LEGO_COLORS.map((c) => {
  const [r, g, b] = hexToRgb(c.hex);
  return { color: c, lab: rgbToLab(r, g, b) };
});

/** Greedy forward selection of `limit` candidate rows minimizing weighted error. */
function greedySelect(dist: Float64Array[], weight: number[], limit: number): number[] {
  const n = weight.length;
  const selected: number[] = [];
  const cur = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  while (selected.length < limit) {
    let bestJ = -1;
    let bestErr = Number.POSITIVE_INFINITY;
    for (let j = 0; j < dist.length; j++) {
      if (selected.includes(j)) continue;
      let err = 0;
      const row = dist[j];
      for (let i = 0; i < n; i++) err += Math.min(cur[i], row[i]) * weight[i];
      if (err < bestErr) {
        bestErr = err;
        bestJ = j;
      }
    }
    selected.push(bestJ);
    const row = dist[bestJ];
    for (let i = 0; i < n; i++) if (row[i] < cur[i]) cur[i] = row[i];
  }
  return selected;
}

/** For every color: nearest (d1, slot s1) and second-nearest (d2) distance among `selected`. */
function nearestTwo(
  dist: Float64Array[],
  selected: number[],
  d1: Float64Array,
  d2: Float64Array,
  s1: Int32Array,
): void {
  for (let i = 0; i < d1.length; i++) {
    let a = Number.POSITIVE_INFINITY;
    let b = Number.POSITIVE_INFINITY;
    let sa = 0;
    for (let s = 0; s < selected.length; s++) {
      const d = dist[selected[s]][i];
      if (d < a) {
        b = a;
        a = d;
        sa = s;
      } else if (d < b) {
        b = d;
      }
    }
    d1[i] = a;
    d2[i] = b;
    s1[i] = sa;
  }
}

/**
 * Swap refinement: apply the best (selected slot -> unselected candidate) swap while it helps.
 * Tracking nearest and second-nearest selected distances scores every slot for a candidate
 * in one pass over the colors. Mutates `selected`.
 */
function swapRefine(dist: Float64Array[], w: number[], selected: number[]): void {
  const n = w.length;
  const d1 = new Float64Array(n);
  const d2 = new Float64Array(n);
  const s1 = new Int32Array(n);
  const gain = new Float64Array(selected.length);
  let err = selectionError(dist, w, selected);
  for (let round = 0; round < SWAP_MAX_ROUNDS; round++) {
    nearestTwo(dist, selected, d1, d2, s1);
    let bestErr = err;
    let bestS = -1;
    let bestJ = -1;
    for (let j = 0; j < dist.length; j++) {
      if (selected.includes(j)) continue;
      const row = dist[j];
      let base = 0;
      gain.fill(0);
      for (let i = 0; i < n; i++) {
        const withJ = Math.min(row[i], d1[i]);
        base += withJ * w[i];
        gain[s1[i]] += (Math.min(row[i], d2[i]) - withJ) * w[i];
      }
      for (let s = 0; s < selected.length; s++) {
        const e = base + gain[s];
        if (e < bestErr - 1e-9) {
          bestErr = e;
          bestS = s;
          bestJ = j;
        }
      }
    }
    if (bestS < 0) break;
    selected[bestS] = bestJ;
    err = bestErr;
  }
}

/** Choose up to maxColors LEGO colors minimizing weighted Lab error. */
function chooseLegoEntries(colors: ColorSet, maxColors: number): Entry[] {
  const lego = LEGO_ENTRIES;
  const n = colors.lab.length;

  // Candidates that are the nearest LEGO color for at least one pixel color.
  const used = new Set<number>();
  for (let i = 0; i < n; i++) used.add(nearest(colors.lab[i], lego));
  if (used.size <= maxColors) return [...used].map((j) => lego[j]);

  const dist = lego.map((e) => {
    const row = new Float64Array(n);
    for (let i = 0; i < n; i++) row[i] = deltaE76Sq(colors.lab[i], e.lab);
    return row;
  });
  const selected = greedySelect(dist, colors.weight, maxColors);
  swapRefine(dist, colors.weight, selected);
  return selected.map((j) => lego[j]);
}

/** Deterministic 32-bit PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function legoName(lab: Lab): string {
  let best = LEGO_ENTRIES[0].color.name;
  let bestD = Number.POSITIVE_INFINITY;
  for (const e of LEGO_ENTRIES) {
    const d = deltaE76Sq(lab, e.lab);
    if (d < bestD) {
      bestD = d;
      best = e.color.name;
    }
  }
  return best;
}

function entryFromPacked(rgb: number): Entry {
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  const lab = rgbToLab(r, g, b);
  return { color: { hex: rgbToHex(r, g, b), name: legoName(lab) }, lab };
}

/** Weighted k-means++ seeding: up to k initial centers drawn with `rand`. */
function kmeansPlusPlusSeed(colors: ColorSet, k: number, rand: () => number): Lab[] {
  const n = colors.lab.length;
  const centers: Lab[] = [];
  const total = colors.weight.reduce((s, w) => s + w, 0);
  let pick = rand() * total;
  let first = 0;
  while (pick >= colors.weight[first] && first < n - 1) {
    pick -= colors.weight[first];
    first++;
  }
  centers.push(colors.lab[first]);
  const d2 = new Float64Array(n);
  for (let i = 0; i < n; i++) d2[i] = deltaE76Sq(colors.lab[i], centers[0]);
  while (centers.length < k) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d2[i] * colors.weight[i];
    if (sum <= 0) break;
    let r = rand() * sum;
    let idx = 0;
    for (; idx < n - 1; idx++) {
      r -= d2[idx] * colors.weight[idx];
      if (r < 0) break;
    }
    centers.push(colors.lab[idx]);
    for (let i = 0; i < n; i++) {
      const d = deltaE76Sq(colors.lab[i], colors.lab[idx]);
      if (d < d2[i]) d2[i] = d;
    }
  }
  return centers;
}

/** Per-cluster weighted RGB sums and total weights from the final Lloyd assignment. */
interface ClusterSums {
  rgbSum: Float64Array;
  wSum: Float64Array;
}

/** Lloyd iterations in Lab, updating `centers` in place until assignments settle. */
function lloydRefine(colors: ColorSet, centers: Lab[], iterations: number): ClusterSums {
  const n = colors.lab.length;
  const assign = new Int32Array(n).fill(-1);
  const rgbSum = new Float64Array(centers.length * 3);
  const wSum = new Float64Array(centers.length);
  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centers.length; c++) {
        const d = deltaE76Sq(colors.lab[i], centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }
    const labSum = new Float64Array(centers.length * 3);
    rgbSum.fill(0);
    wSum.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      const w = colors.weight[i];
      const lab = colors.lab[i];
      const rgb = colors.rgb[i];
      labSum[c * 3] += lab[0] * w;
      labSum[c * 3 + 1] += lab[1] * w;
      labSum[c * 3 + 2] += lab[2] * w;
      rgbSum[c * 3] += ((rgb >> 16) & 255) * w;
      rgbSum[c * 3 + 1] += ((rgb >> 8) & 255) * w;
      rgbSum[c * 3 + 2] += (rgb & 255) * w;
      wSum[c] += w;
    }
    for (let c = 0; c < centers.length; c++) {
      if (wSum[c] > 0) {
        centers[c] = [
          labSum[c * 3] / wSum[c],
          labSum[c * 3 + 1] / wSum[c],
          labSum[c * 3 + 2] / wSum[c],
        ];
      }
    }
    if (!changed) break;
  }
  return { rgbSum, wSum };
}

/** One entry per non-empty cluster, colored by its RGB mean; duplicate hexes are dropped. */
function centroidsToEntries({ rgbSum, wSum }: ClusterSums): Entry[] {
  const channel = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  const entries: Entry[] = [];
  const seen = new Set<number>();
  for (let c = 0; c < wSum.length; c++) {
    if (wSum[c] <= 0) continue;
    const packed =
      (channel(rgbSum[c * 3] / wSum[c]) << 16) |
      (channel(rgbSum[c * 3 + 1] / wSum[c]) << 8) |
      channel(rgbSum[c * 3 + 2] / wSum[c]);
    if (seen.has(packed)) continue;
    seen.add(packed);
    entries.push(entryFromPacked(packed));
  }
  return entries;
}

/** Seeded weighted k-means (k-means++ init) in Lab. Centroid colors are RGB means. */
function chooseFreeEntries(colors: ColorSet, maxColors: number): Entry[] {
  if (colors.lab.length <= maxColors) return colors.rgb.map(entryFromPacked);
  const centers = kmeansPlusPlusSeed(colors, maxColors, mulberry32(FREE_SEED));
  return centroidsToEntries(lloydRefine(colors, centers, KMEANS_MAX_ITER));
}

/**
 * Merge candidates closer than MIN_DELTA_E: the one covering fewer pixels is dropped, and
 * its pixels fall to their next-nearest color. May leave fewer colors than requested.
 */
function enforceContrast(colors: ColorSet, candidates: Entry[]): void {
  for (;;) {
    const weight = new Float64Array(candidates.length);
    for (let i = 0; i < colors.lab.length; i++) {
      weight[nearest(colors.lab[i], candidates)] += colors.weight[i];
    }
    let a = -1;
    let b = -1;
    let best = MIN_DELTA_E * MIN_DELTA_E;
    for (let i = 0; i < candidates.length; i++) {
      if (weight[i] === 0) continue;
      for (let j = i + 1; j < candidates.length; j++) {
        if (weight[j] === 0) continue;
        const d = deltaE76Sq(candidates[i].lab, candidates[j].lab);
        if (d < best) {
          best = d;
          a = i;
          b = j;
        }
      }
    }
    if (a < 0) return;
    candidates.splice(weight[a] >= weight[b] ? b : a, 1);
  }
}

/** Candidate index per pixel: each distinct color maps to its nearest candidate. */
function mapNearest(colors: ColorSet, candidates: readonly Entry[]): Int32Array {
  const colorToCand = colors.lab.map((lab) => nearest(lab, candidates));
  const out = new Int32Array(colors.pixelColor.length);
  for (let i = 0; i < out.length; i++) out[i] = colorToCand[colors.pixelColor[i]];
  return out;
}

/**
 * Candidate index per pixel by Floyd–Steinberg error diffusion in RGB, scanning serpentine
 * (even rows left to right, odd rows right to left, kernel mirrored). Deterministic.
 */
function ditherMap(
  colors: ColorSet,
  width: number,
  height: number,
  candidates: readonly Entry[],
): Int32Array {
  const count = width * height;
  const work = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const rgb = colors.rgb[colors.pixelColor[i]];
    work[i * 3] = (rgb >> 16) & 255;
    work[i * 3 + 1] = (rgb >> 8) & 255;
    work[i * 3 + 2] = rgb & 255;
  }
  const candRgb = candidates.map((e) => hexToRgb(e.color.hex));
  const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  const spread = (x: number, y: number, er: number, eg: number, eb: number, w: number): void => {
    if (x < 0 || x >= width || y >= height) return;
    const p = (y * width + x) * 3;
    work[p] = clamp(work[p] + er * w);
    work[p + 1] = clamp(work[p + 1] + eg * w);
    work[p + 2] = clamp(work[p + 2] + eb * w);
  };
  const out = new Int32Array(count);
  for (let y = 0; y < height; y++) {
    const ltr = y % 2 === 0;
    const dir = ltr ? 1 : -1;
    for (let k = 0; k < width; k++) {
      const x = ltr ? k : width - 1 - k;
      const i = y * width + x;
      const r = work[i * 3];
      const g = work[i * 3 + 1];
      const b = work[i * 3 + 2];
      const c = nearest(rgbToLab(r, g, b), candidates);
      out[i] = c;
      const [cr, cg, cb] = candRgb[c];
      const er = r - cr;
      const eg = g - cg;
      const eb = b - cb;
      spread(x + dir, y, er, eg, eb, 7 / 16);
      spread(x - dir, y + 1, er, eg, eb, 3 / 16);
      spread(x, y + 1, er, eg, eb, 5 / 16);
      spread(x + dir, y + 1, er, eg, eb, 1 / 16);
    }
  }
  return out;
}

/**
 * Quantize RGBA pixels (already at stud resolution) to a <=32 color mosaic.
 * Deterministic for identical input. Palette is sorted by luminance (dark to light),
 * contains only colors actually used, and in 'lego' mode only LEGO_COLORS entries. With
 * `dither`, pixels map by Floyd–Steinberg error diffusion instead of nearest color.
 */
export function buildMosaic(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mode: PaletteMode,
  maxColors: number = MAX_COLORS,
  dither = false,
): Mosaic {
  const count = width * height;
  const limit = Math.max(MIN_COLORS, Math.min(MAX_COLORS, Math.round(maxColors)));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid mosaic size ${width}x${height}`);
  }
  if (pixels.length < count * 4) {
    throw new RangeError(`Expected ${count * 4} RGBA bytes, got ${pixels.length}`);
  }
  const colors = collectColors(pixels, count);
  const candidates =
    mode === 'lego' ? chooseLegoEntries(colors, limit) : chooseFreeEntries(colors, limit);

  enforceContrast(colors, candidates);

  // Map each pixel to a candidate, then keep only used candidates.
  const pixelCand = dither
    ? ditherMap(colors, width, height, candidates)
    : mapNearest(colors, candidates);
  const usedCands = [...new Set(pixelCand)];
  usedCands.sort((a, b) => {
    const la = candidates[a].lab[0];
    const lb = candidates[b].lab[0];
    if (la !== lb) return la - lb;
    return candidates[a].color.hex < candidates[b].color.hex ? -1 : 1;
  });
  const candToPalette = new Map<number, number>();
  usedCands.forEach((c, i) => {
    candToPalette.set(c, i);
  });

  const target = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    target[i] = candToPalette.get(pixelCand[i]) as number;
  }
  const palette = usedCands.map((c) => ({ ...candidates[c].color }));
  return { width, height, palette, target };
}
