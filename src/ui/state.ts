/** App-wide in-memory state: the pending picture source and cached saves. */

import { getSave, putSave } from '../storage/db';
import type { LibraryEntry, PictureSave } from '../types';

/** Source chosen on the New Picture screen, consumed by Setup. */
export interface PendingSource {
  kind: 'library' | 'upload';
  name: string;
  /** Library slug, or undefined for uploads. */
  slug?: string;
  /** Default aspect (library) or best guess from dimensions (upload). */
  aspect: LibraryEntry['aspect'];
  /** Decoded, downscaled pixels. */
  image: ImageData;
  /** Original upload blob, stored at Start. */
  blob?: Blob;
}

let pending: PendingSource | null = null;

export function setPendingSource(s: PendingSource | null): void {
  pending = s;
}

export function getPendingSource(): PendingSource | null {
  return pending;
}

const saves = new Map<string, PictureSave>();

/** Load a save, reusing the in-memory copy so the overview and panel share one placed array. */
export async function loadSave(id: string): Promise<PictureSave | undefined> {
  const hit = saves.get(id);
  if (hit) return hit;
  const s = await getSave(id);
  if (s) saves.set(id, s);
  return s;
}

export function cacheSave(save: PictureSave): void {
  saves.set(save.id, save);
}

export function forgetSave(id: string): void {
  saves.delete(id);
}

/** Persist a save, stamping updatedAt. Errors surface as a rejected promise. */
export async function persist(save: PictureSave): Promise<void> {
  save.updatedAt = Date.now();
  saves.set(save.id, save);
  await putSave(save);
}

let manifest: Promise<LibraryEntry[]> | null = null;

/** Bundled library manifest (cached). */
export function loadLibrary(): Promise<LibraryEntry[]> {
  if (!manifest) {
    manifest = fetch('library/manifest.json')
      .then((r) => {
        if (!r.ok) throw new Error(`library manifest: HTTP ${r.status}`);
        return r.json() as Promise<LibraryEntry[]>;
      })
      .catch((err: unknown) => {
        manifest = null;
        throw err;
      });
  }
  return manifest;
}

/** Decode an image blob with EXIF orientation applied, downscaled to maxEdge. */
export async function decodeImage(blob: Blob, maxEdge = 1024): Promise<ImageData> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const hgt = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, hgt);
    return ctx.getImageData(0, 0, w, hgt);
  } finally {
    bmp.close();
  }
}

/** Transition hints passed between Overview and Panel play. */
export interface TransitionHint {
  /** Panel the player just left (Overview animates a zoom-out from it). */
  fromPanel?: number;
  /** The panel was just completed (Overview may show the finale). */
  justCompleted?: boolean;
}

let hint: TransitionHint = {};

export function setTransitionHint(t: TransitionHint): void {
  hint = t;
}

/** Read and clear the transition hint. */
export function takeTransitionHint(): TransitionHint {
  const t = hint;
  hint = {};
  return t;
}
