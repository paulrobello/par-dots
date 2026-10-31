/**
 * XR layout persistence (XR P4): where the workspace objects sat when a panel's XR session
 * ended, stored as additive optional fields on the save record (schema stays v2; absent
 * panels spawn at defaults). DOM-free and three.js-free; allowlisted validation so a
 * malformed record falls back to defaults instead of breaking entry.
 */

import type { PictureSave, XrPanelLayout, XrQuat, XrVec3 } from '../types';

export type { XrPanelLayout, XrQuat, XrVec3 } from '../types';

/** Validate one allowlisted layout record; null when malformed. */
export function validateLayout(v: unknown): XrPanelLayout | null {
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
  const o = v as XrPanelLayout;
  if (
    typeof v !== 'object' ||
    v === null ||
    !vec(o.plate?.pos) ||
    !quat(o.plate?.quat) ||
    !vec(o.frame?.pos) ||
    !quat(o.frame?.quat) ||
    !num(o.frame?.scale) ||
    typeof o.overlay !== 'boolean' ||
    !vec(o.tray?.pos) ||
    !quat(o.tray?.quat)
  ) {
    return null;
  }
  return {
    plate: { pos: { ...o.plate.pos }, quat: { ...o.plate.quat } },
    frame: { pos: { ...o.frame.pos }, quat: { ...o.frame.quat }, scale: o.frame.scale },
    tray: { pos: { ...o.tray.pos }, quat: { ...o.tray.quat } },
    overlay: o.overlay,
  };
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
  save.xrLayouts[String(panel)] = valid;
}
