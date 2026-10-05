/** Upgrades and validates persisted PictureSave records so the db layer never returns unvalidated data. */

import {
  type Aspect,
  EMPTY,
  LAYOUT,
  MAX_COLORS,
  PANEL_SIZE,
  type PictureSave,
  SAVE_SCHEMA_VERSION,
  type SaveOrigin,
} from '../types';

/** A valid drawn-save background: lowercase "#rrggbb". */
const HEX_RE = /^#[0-9a-f]{6}$/;

function isPaletteColor(c: unknown): boolean {
  return (
    typeof c === 'object' &&
    c !== null &&
    typeof (c as { hex?: unknown }).hex === 'string' &&
    typeof (c as { name?: unknown }).name === 'string'
  );
}

/**
 * Migrates a raw stored record to the current schema and validates it.
 * Returns undefined for records that are malformed or come from a newer build.
 */
export function migrateSave(raw: unknown): PictureSave | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  // Records written before versioning all have the v1 shape.
  const version = r.schemaVersion === undefined ? 1 : r.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return undefined;
  if (version > SAVE_SCHEMA_VERSION) return undefined;

  if (typeof r.id !== 'string') return undefined;
  if (typeof r.aspect !== 'string' || !Object.hasOwn(LAYOUT, r.aspect)) return undefined;
  const { cols, rows } = LAYOUT[r.aspect as Aspect];
  if (
    typeof r.width !== 'number' ||
    !Number.isInteger(r.width) ||
    typeof r.height !== 'number' ||
    !Number.isInteger(r.height)
  ) {
    return undefined;
  }
  const base = cols * PANEL_SIZE;
  const scale = r.width / base;
  if (!Number.isInteger(scale) || scale < 1) return undefined;
  const width = base * scale;
  const height = rows * PANEL_SIZE * scale;
  if (r.width !== width || r.height !== height) return undefined;

  const { palette, target, placed } = r;
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > MAX_COLORS) {
    return undefined;
  }
  if (!palette.every(isPaletteColor)) return undefined;
  const cells = width * height;
  if (!(target instanceof Uint8Array) || target.length !== cells) return undefined;
  if (!(placed instanceof Uint8Array) || placed.length !== cells) return undefined;
  if (
    r.drawBackground !== undefined &&
    (typeof r.drawBackground !== 'string' || !HEX_RE.test(r.drawBackground))
  ) {
    return undefined;
  }
  if (r.origin !== undefined && r.origin !== 'photo' && r.origin !== 'drawn') {
    return undefined;
  }
  const origin: SaveOrigin = r.origin === 'drawn' ? 'drawn' : 'photo';
  for (let i = 0; i < cells; i++) {
    if (target[i] !== EMPTY && target[i] >= palette.length) return undefined;
    if (placed[i] !== EMPTY && placed[i] >= palette.length) return undefined;
  }

  const panels = cols * rows * scale * scale;
  const elapsed = Array.isArray(r.panelElapsedMs) ? r.panelElapsedMs : [];
  const panelElapsedMs = Array.from({ length: panels }, (_, i) => {
    const v = elapsed[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  });

  return {
    ...(r as unknown as PictureSave),
    origin,
    schemaVersion: SAVE_SCHEMA_VERSION,
    panelElapsedMs,
  };
}
