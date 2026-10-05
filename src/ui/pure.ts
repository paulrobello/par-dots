/** DOM-free UI helpers: routing, labels, stroke interpolation, crop math, formatting. */

import { describeColor } from '../engine/colorNames';
import { LEGO_COLORS } from '../engine/legoPalette';
import { panelCountOf, studDims } from '../game';
import { newId } from '../storage/id';
import {
  type Aspect,
  type CropRect,
  EMPTY,
  type NormalizedCrop,
  type PaletteColor,
  type PaletteMode,
  type PictureSave,
  SAVE_SCHEMA_VERSION,
} from '../types';

export type Route =
  | { name: 'gallery' }
  | { name: 'new' }
  | { name: 'setup' }
  | { name: 'drawNew' }
  | { name: 'drawEditor'; id: string }
  | { name: 'overview'; id: string }
  | { name: 'panel'; id: string; panel: number };

/** Parse a location hash ("#/play/abc/3") into a route. Unknown hashes go to the gallery. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = path.split('/').filter((p) => p.length > 0);
  if (parts.length === 0) return { name: 'gallery' };
  if (parts[0] === 'new' && parts.length === 1) return { name: 'new' };
  if (parts[0] === 'setup' && parts.length === 1) return { name: 'setup' };
  if (parts[0] === 'draw' && parts.length === 2) {
    if (parts[1] === 'new') return { name: 'drawNew' };
    try {
      return { name: 'drawEditor', id: decodeURIComponent(parts[1]) };
    } catch {
      return { name: 'gallery' };
    }
  }
  if (parts[0] === 'play' && parts.length >= 2) {
    let id: string;
    try {
      id = decodeURIComponent(parts[1]);
    } catch {
      return { name: 'gallery' };
    }
    if (parts.length === 2) return { name: 'overview', id };
    if (parts.length === 3 && /^\d+$/.test(parts[2])) {
      return { name: 'panel', id, panel: Number.parseInt(parts[2], 10) };
    }
  }
  return { name: 'gallery' };
}

/** Inverse of parseRoute. */
export function routeHash(route: Route): string {
  switch (route.name) {
    case 'gallery':
      return '#/';
    case 'new':
      return '#/new';
    case 'setup':
      return '#/setup';
    case 'drawNew':
      return '#/draw/new';
    case 'drawEditor':
      return `#/draw/${encodeURIComponent(route.id)}`;
    case 'overview':
      return `#/play/${encodeURIComponent(route.id)}`;
    case 'panel':
      return `#/play/${encodeURIComponent(route.id)}/${route.panel}`;
  }
}

/**
 * Validate a color for the mode: LEGO mode accepts only LEGO table hexes (names and
 * catalog IDs must stay valid for parts exports); Free mode names the shade.
 */
export function paletteEntryFor(mode: PaletteMode, hex: string): PaletteColor {
  if (mode === 'lego') {
    const hit = LEGO_COLORS.find((c) => c.hex === hex.toLowerCase());
    if (!hit) throw new Error('Choose a LEGO color');
    return { hex: hit.hex, name: hit.name };
  }
  return { hex: hex.toLowerCase(), name: describeColor(hex) };
}

/** Seeded two-color palette for a new drawing: the LEGO table's black and white, or pure ones. */
export function seededPalette(mode: PaletteMode): PaletteColor[] {
  if (mode === 'lego') {
    return [{ ...LEGO_COLORS[0] }, { ...LEGO_COLORS[1] }];
  }
  return [
    { hex: '#000000', name: 'Black' },
    { hex: '#ffffff', name: 'White' },
  ];
}

/** Build a new drawn save: empty target, seeded palette, background pre-placed. */
export function buildDrawnSave(opts: {
  name: string;
  aspect: Aspect;
  mode: PaletteMode;
  /** Background hex ("#rrggbb") or null for None. */
  background: string | null;
  /** Panel-grid size scale; 1 = the base grid. */
  scale?: number;
}): PictureSave {
  const scale = opts.scale ?? 1;
  const { width, height } = studDims(opts.aspect, scale);
  const palette = seededPalette(opts.mode);
  let fill = EMPTY;
  if (opts.background) {
    const hit = palette.findIndex((c) => c.hex === opts.background);
    if (hit >= 0) {
      fill = hit;
    } else {
      fill = palette.length;
      palette.push({ hex: opts.background, name: describeColor(opts.background) });
    }
  }
  const nowMs = Date.now();
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: newId(),
    createdAt: nowMs,
    updatedAt: nowMs,
    name: opts.name,
    sourceImageId: '',
    aspect: opts.aspect,
    paletteMode: opts.mode,
    origin: 'drawn',
    ...(opts.background ? { drawBackground: opts.background } : {}),
    palette,
    width,
    height,
    target: new Uint8Array(width * height).fill(EMPTY),
    placed: new Uint8Array(width * height).fill(fill),
    panelElapsedMs: new Array<number>(panelCountOf(opts.aspect, scale)).fill(0),
  };
}

/**
 * Free colors are named from their hex value, including saves with old LEGO-derived names.
 * Duplicate labels get stable suffixes in palette order across every panel and guide.
 */
export function paletteLabels(palette: PaletteColor[], mode: PaletteMode): string[] {
  const seen = new Map<string, number>();
  return palette.map((c) => {
    const name = mode === 'free' ? describeColor(c.hex) : c.name;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} ${n}`;
  });
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SYMBOL_CHARS = `${UPPER}abcdefghijklmnopqrstuvwxyz`;

/**
 * Stable 1–2 char symbol per palette index: A..Z, then a..z, then two-letter codes (AA, AB, ...).
 * Palettes are sorted dark to light, so dark colors get the early letters.
 */
export function paletteSymbols(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    if (i < SYMBOL_CHARS.length) return SYMBOL_CHARS[i];
    const k = i - SYMBOL_CHARS.length;
    return UPPER[Math.floor(k / UPPER.length) % UPPER.length] + UPPER[k % UPPER.length];
  });
}

export { lineCells as cellLine } from '../game/drawTools';

/** Width / height ratio of an aspect. */
export function aspectRatio(aspect: Aspect): number {
  const [w, h] = aspect.split(':').map(Number);
  return w / h;
}

/** Crop state: zoom >= 1 (1 = largest frame that fits), center in source pixels. */
export interface CropState {
  zoom: number;
  cx: number;
  cy: number;
}

export const MAX_CROP_ZOOM = 6;

/** Size of the crop frame in source pixels for an aspect and zoom. */
export function cropSize(
  imgW: number,
  imgH: number,
  aspect: Aspect,
  zoom: number,
): { w: number; h: number } {
  const r = aspectRatio(aspect);
  let w = imgW;
  let h = w / r;
  if (h > imgH) {
    h = imgH;
    w = h * r;
  }
  const z = Math.max(1, Math.min(MAX_CROP_ZOOM, zoom));
  return { w: w / z, h: h / z };
}

/** Clamp zoom and center so the crop frame stays fully inside the image. */
export function clampCrop(imgW: number, imgH: number, aspect: Aspect, s: CropState): CropState {
  const zoom = Math.max(1, Math.min(MAX_CROP_ZOOM, s.zoom));
  const { w, h } = cropSize(imgW, imgH, aspect, zoom);
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  return { zoom, cx: clamp(s.cx, w / 2, imgW - w / 2), cy: clamp(s.cy, h / 2, imgH - h / 2) };
}

/** Crop rectangle (source pixels) for a crop state, clamped inside the image. */
export function cropRectFor(imgW: number, imgH: number, aspect: Aspect, s: CropState): CropRect {
  const c = clampCrop(imgW, imgH, aspect, s);
  const { w, h } = cropSize(imgW, imgH, aspect, c.zoom);
  return { x: c.cx - w / 2, y: c.cy - h / 2, w, h };
}

/** Initial crop state: a normalized default (library manifest) in pixels, else centered at zoom 1. */
export function defaultCrop(imgW: number, imgH: number, n?: NormalizedCrop): CropState {
  if (!n) return { zoom: 1, cx: imgW / 2, cy: imgH / 2 };
  return { zoom: n.zoom, cx: n.cx * imgW, cy: n.cy * imgH };
}

/** Fit (w, h) within a maxEdge x maxEdge box, never enlarging. Integer output. */
export function fitWithin(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const k = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Fraction of the stage a zoomed panel fills, leaving a margin around it. */
const PANEL_ZOOM_FILL = 0.92;

/** Scale and translation that center `rect` (stage pixels) in the stage, nearly filling it. */
export function panelZoomTransform(
  rect: { x: number; y: number; w: number; h: number },
  stageW: number,
  stageH: number,
): { s: number; tx: number; ty: number } {
  const s = Math.min(stageW / rect.w, stageH / rect.h) * PANEL_ZOOM_FILL;
  return {
    s,
    tx: stageW / 2 - (rect.x + rect.w / 2) * s,
    ty: stageH / 2 - (rect.y + rect.h / 2) * s,
  };
}

/** Whole-number percent label, floored so "100%" appears only when complete. */
export function formatPercent(p: number): string {
  return `${Math.floor(p)}%`;
}

/** Byte count for display: "512 B" below 1 KB, then one decimal in KB, MB or GB ("12.4 MB"). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.max(0, Math.round(n))} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  // 1023.95 so a value that would round to "1024.0" moves up a unit instead.
  while (v >= 1023.95 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** A picture name reduced to a safe file-name stem ("mosaic" when nothing survives). */
export function safeFileStem(name: string): string {
  return name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'mosaic';
}

/** Short user-facing text for an unknown error. */
export function userMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

/** "m:ss" under an hour, "h:mm:ss" above. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Picture name from an upload filename: "IMG_2041.HEIC" -> "IMG 2041". */
export function nameFromFile(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'My Picture';
}

/** Parse a user-typed image link; only https URLs are accepted. */
export function parseImageUrl(raw: string): URL | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Picture name from the last path segment of an image URL. */
export function nameFromUrl(url: URL): string {
  const seg = url.pathname.split('/').filter(Boolean).pop() ?? '';
  let decoded = seg;
  try {
    decoded = decodeURIComponent(seg);
  } catch {
    // keep the raw segment
  }
  const name = nameFromFile(decoded);
  return name === 'My Picture' ? url.hostname.replace(/^www\./, '') : name;
}

/** Next color to select after `current` leaves the tray: the following one, else the previous. */
export function nextSelection(tray: number[], previousTray: number[], current: number): number {
  if (tray.length === 0) return -1;
  if (tray.includes(current)) return current;
  const pos = previousTray.indexOf(current);
  if (pos < 0) return tray[0];
  for (let i = pos + 1; i < previousTray.length; i++) {
    if (tray.includes(previousTray[i])) return previousTray[i];
  }
  for (let i = pos - 1; i >= 0; i--) {
    if (tray.includes(previousTray[i])) return previousTray[i];
  }
  return tray[0];
}

/** Whether any pixel's alpha is below 255 (i.e. the source image has transparency). */
export function hasTransparency(data: Uint8ClampedArray | Uint8Array): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/** Composites RGBA pixels over an opaque RGB background, in place. */
export function flattenAlpha(
  pixels: Uint8ClampedArray,
  bg: readonly [number, number, number],
): Uint8ClampedArray {
  for (let p = 0; p < pixels.length; p += 4) {
    const a = pixels[p + 3] / 255;
    pixels[p] = pixels[p] * a + bg[0] * (1 - a);
    pixels[p + 1] = pixels[p + 1] * a + bg[1] * (1 - a);
    pixels[p + 2] = pixels[p + 2] * a + bg[2] * (1 - a);
    pixels[p + 3] = 255;
  }
  return pixels;
}

/**
 * Whether a waiting service-worker update may reload the page now: always when the page is
 * hidden, otherwise only on the gallery or overview with no overlay open (no stroke or setup
 * state to lose).
 */
export function shouldApplyUpdate(
  route: Route['name'],
  overlayOpen: boolean,
  hidden: boolean,
): boolean {
  if (hidden) return true;
  if (overlayOpen) return false;
  return route === 'gallery' || route === 'overview';
}
