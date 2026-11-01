/**
 * XR layout persistence (XR P4): where the workspace objects sat when a panel's XR session
 * ended, stored as additive optional fields on the save record (schema stays v2; absent
 * panels spawn at defaults). DOM-free and three.js-free; allowlisted validation so a
 * malformed record falls back to defaults instead of breaking entry.
 */

import type { PictureSave, XrPanelLayout, XrQuat, XrVec3 } from '../types';

export type { XrPanelLayout, XrQuat, XrVec3 } from '../types';

/** Optional objects that may be included in a reusable local XR layout. */
export interface XrLayoutTransform {
  pos: XrVec3;
  quat: XrQuat;
  scale?: number;
}

export type ReusableXrLayout = XrPanelLayout & {
  overview?: XrLayoutTransform;
  tools?: XrLayoutTransform;
};

const CUSTOM_LAYOUTS_KEY = 'par-dots:xr-custom-layouts';
const CUSTOM_LAYOUTS_VERSION = 1;

/** Validate one allowlisted layout record; null when malformed. */
export function validateLayout(v: unknown): ReusableXrLayout | null {
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const vec = (x: unknown): x is XrVec3 =>
    typeof x === 'object' &&
    x !== null &&
    num((x as XrVec3).x) &&
    num((x as XrVec3).y) &&
    num((x as XrVec3).z);
  const quat = (x: unknown): x is XrQuat =>
    typeof x === 'object' &&
    x !== null &&
    num((x as XrQuat).x) &&
    num((x as XrQuat).y) &&
    num((x as XrQuat).z) &&
    num((x as XrQuat).w);
  const scale = (x: unknown): boolean => x === undefined || (num(x) && x > 0);
  const safeScale = (x: number | undefined): number => Math.min(3, Math.max(0.4, x ?? 1));
  const transform = (x: unknown): x is XrLayoutTransform =>
    typeof x === 'object' &&
    x !== null &&
    vec((x as XrLayoutTransform).pos) &&
    quat((x as XrLayoutTransform).quat) &&
    scale((x as XrLayoutTransform).scale);
  const o = v as ReusableXrLayout;
  if (
    typeof v !== 'object' ||
    v === null ||
    !vec(o.plate?.pos) ||
    !quat(o.plate?.quat) ||
    !scale(o.plate?.scale) ||
    !vec(o.frame?.pos) ||
    !quat(o.frame?.quat) ||
    !num(o.frame?.scale) ||
    o.frame.scale <= 0 ||
    typeof o.overlay !== 'boolean' ||
    !vec(o.tray?.pos) ||
    !quat(o.tray?.quat) ||
    !scale(o.tray?.scale)
  ) {
    return null;
  }
  const result: ReusableXrLayout = {
    plate: { pos: { ...o.plate.pos }, quat: { ...o.plate.quat }, scale: safeScale(o.plate.scale) },
    frame: { pos: { ...o.frame.pos }, quat: { ...o.frame.quat }, scale: safeScale(o.frame.scale) },
    tray: { pos: { ...o.tray.pos }, quat: { ...o.tray.quat }, scale: safeScale(o.tray.scale) },
    overlay: o.overlay,
  };
  if (transform(o.overview)) {
    result.overview = {
      pos: { ...o.overview.pos },
      quat: { ...o.overview.quat },
      scale: safeScale(o.overview.scale),
    };
  } else if (o.overview !== undefined) return null;
  if (transform(o.tools)) {
    result.tools = {
      pos: { ...o.tools.pos },
      quat: { ...o.tools.quat },
      scale: safeScale(o.tools.scale),
    };
  } else if (o.tools !== undefined) return null;
  return result;
}

/** The saved layout for a panel, or null (defaults). Malformed records fall back. */
export function getLayout(save: PictureSave, panel: number): XrPanelLayout | null {
  const raw = save.xrLayouts?.[String(panel)];
  return raw ? validateLayout(raw) : null;
}

/** Snapshot the layout for a panel onto the save (in place, like placed mutations). */
export function setLayout(save: PictureSave, panel: number, layout: XrPanelLayout): void {
  const valid = validateLayout(layout);
  if (!valid) return;
  save.xrLayouts ??= {};
  save.xrLayouts[String(panel)] = {
    plate: valid.plate,
    frame: valid.frame,
    tray: valid.tray,
    overlay: valid.overlay,
  };
}

const customLayoutRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Read reusable layouts from local storage. Storage failures are treated as an empty list. */
export function getCustomLayouts(): Record<string, ReusableXrLayout> {
  try {
    const encoded = globalThis.localStorage?.getItem(CUSTOM_LAYOUTS_KEY);
    if (!encoded) return {};
    const parsed: unknown = JSON.parse(encoded);
    if (!customLayoutRecord(parsed) || parsed.version !== CUSTOM_LAYOUTS_VERSION) return {};
    const layouts: Record<string, ReusableXrLayout> = {};
    if (!customLayoutRecord(parsed.layouts)) return {};
    for (const [name, value] of Object.entries(parsed.layouts)) {
      const valid = validateLayout(value);
      if (valid) layouts[name] = valid as ReusableXrLayout;
    }
    return layouts;
  } catch {
    return {};
  }
}

/** Save a named reusable layout locally. Returns false for invalid names/layouts or storage errors. */
export function saveCustomLayout(name: string, layout: unknown): boolean {
  const key = name.trim();
  const valid = validateLayout(layout);
  if (!key || key.length > 64 || !valid) return false;
  try {
    const store = globalThis.localStorage;
    if (!store) return false;
    const layouts = getCustomLayouts();
    layouts[key] = valid;
    store.setItem(CUSTOM_LAYOUTS_KEY, JSON.stringify({ version: CUSTOM_LAYOUTS_VERSION, layouts }));
    return true;
  } catch {
    return false;
  }
}
