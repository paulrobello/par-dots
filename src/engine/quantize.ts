import { MAX_COLORS, type Mosaic, type PaletteColor, type PaletteMode } from '../types';
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

function nearest(lab: Lab, entries: Entry[]): number {
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

/** Choose up to MAX_COLORS LEGO colors minimizing weighted Lab error. */
function chooseLegoEntries(colors: ColorSet): Entry[] {
  const lego: Entry[] = LEGO_COLORS.map((c) => {
    const [r, g, b] = hexToRgb(c.hex);
    return { color: c, lab: rgbToLab(r, g, b) };
  });
  const n = colors.lab.length;

  // Candidates that are the nearest LEGO color for at least one pixel color.
  const used = new Set<number>();
  for (let i = 0; i < n; i++) used.add(nearest(colors.lab[i], lego));
  if (used.size <= MAX_COLORS) return [...used].map((j) => lego[j]);

  const dist = lego.map((e) => {
    const row = new Float64Array(n);
    for (let i = 0; i < n; i++) row[i] = deltaE76Sq(colors.lab[i], e.lab);
    return row;
  });

  // Greedy forward selection.
  const selected: number[] = [];
  const cur = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  while (selected.length < MAX_COLORS) {
    let bestJ = -1;
    let bestErr = Number.POSITIVE_INFINITY;
    for (let j = 0; j < lego.length; j++) {
      if (selected.includes(j)) continue;
      let err = 0;
      const row = dist[j];
      for (let i = 0; i < n; i++) err += Math.min(cur[i], row[i]) * colors.weight[i];
      if (err < bestErr) {
        bestErr = err;
        bestJ = j;
      }
    }
    selected.push(bestJ);
    const row = dist[bestJ];
    for (let i = 0; i < n; i++) if (row[i] < cur[i]) cur[i] = row[i];
  }

  // Swap refinement: apply the best (selected slot -> unselected color) swap while it helps.
  // Tracking nearest and second-nearest selected distances scores every slot for a
  // candidate in one pass over the colors.
  const w = colors.weight;
  const d1 = new Float64Array(n);
  const d2 = new Float64Array(n);
  const s1 = new Int32Array(n);
  const gain = new Float64Array(selected.length);
  let err = selectionError(dist, w, selected);
  for (let round = 0; round < SWAP_MAX_ROUNDS; round++) {
    for (let i = 0; i < n; i++) {
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
    let bestErr = err;
    let bestS = -1;
    let bestJ = -1;
    for (let j = 0; j < lego.length; j++) {
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
  let best = LEGO_COLORS[0].name;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of LEGO_COLORS) {
    const [r, g, b] = hexToRgb(c.hex);
    const d = deltaE76Sq(lab, rgbToLab(r, g, b));
    if (d < bestD) {
      bestD = d;
      best = c.name;
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

/** Seeded weighted k-means (k-means++ init) in Lab. Centroid colors are RGB means. */
function chooseFreeEntries(colors: ColorSet): Entry[] {
  const n = colors.lab.length;
  if (n <= MAX_COLORS) return colors.rgb.map(entryFromPacked);

  const k = MAX_COLORS;
  const rand = mulberry32(FREE_SEED);
  const centers: Lab[] = [];

  // k-means++ seeding, weighted by pixel counts.
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

  const assign = new Int32Array(n).fill(-1);
  const rgbSum = new Float64Array(centers.length * 3);
  const wSum = new Float64Array(centers.length);
  for (let iter = 0; iter < KMEANS_MAX_ITER; iter++) {
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

  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (let c = 0; c < centers.length; c++) {
    if (wSum[c] <= 0) continue;
    const r = rgbSum[c * 3] / wSum[c];
    const g = rgbSum[c * 3 + 1] / wSum[c];
    const b = rgbSum[c * 3 + 2] / wSum[c];
    const hex = rgbToHex(r, g, b);
    if (seen.has(hex)) continue;
    seen.add(hex);
    entries.push(entryFromPacked(Number.parseInt(hex.slice(1), 16)));
  }
  return entries;
}

/**
 * Quantize RGBA pixels (already at stud resolution) to a <=32 color mosaic.
 * Deterministic for identical input. Palette is sorted by luminance (dark to light),
 * contains only colors actually used, and in 'lego' mode only LEGO_COLORS entries.
 */
export function buildMosaic(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mode: PaletteMode,
): Mosaic {
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid mosaic size ${width}x${height}`);
  }
  if (pixels.length < count * 4) {
    throw new RangeError(`Expected ${count * 4} RGBA bytes, got ${pixels.length}`);
  }
  const colors = collectColors(pixels, count);
  const candidates = mode === 'lego' ? chooseLegoEntries(colors) : chooseFreeEntries(colors);

  // Map each distinct color to its nearest candidate, then keep only used candidates.
  const colorToCand = colors.lab.map((lab) => nearest(lab, candidates));
  const usedCands = [...new Set(colorToCand)];
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
    target[i] = candToPalette.get(colorToCand[colors.pixelColor[i]]) as number;
  }
  const palette = usedCands.map((c) => ({ ...candidates[c].color }));
  return { width, height, palette, target };
}
