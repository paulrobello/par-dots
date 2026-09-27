/** Save repository: the only persistence entry point for ui/, backed by a shared in-memory cache. */

import * as db from '../storage/db';
import { newId } from '../storage/id';
import { EMPTY, type PictureSave } from '../types';

/** One object per save id, so the overview and panel play mutate the same placed array. */
const cache = new Map<string, PictureSave>();
/** Writes still in flight, so a reload can wait for them instead of racing them. */
const pending = new Set<Promise<unknown>>();

function track<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  const done = (): void => {
    pending.delete(p);
  };
  p.then(done, done);
  return p;
}

/** Resolves once every write started so far has settled, including writes started meanwhile. */
export async function whenSaved(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

function remember(save: PictureSave): PictureSave {
  const hit = cache.get(save.id);
  if (hit) return hit;
  cache.set(save.id, save);
  return save;
}

/** All saves, reusing cached instances for ids already loaded. */
export async function listSaves(): Promise<PictureSave[]> {
  return (await db.listSaves()).map(remember);
}

/** Load a save, reusing the in-memory copy when present. */
export async function loadSave(id: string): Promise<PictureSave | undefined> {
  const hit = cache.get(id);
  if (hit) return hit;
  const s = await db.getSave(id);
  return s ? remember(s) : undefined;
}

/** Persist a save, stamping updatedAt and caching it. Errors surface as a rejected promise. */
export async function persistSave(save: PictureSave): Promise<void> {
  save.updatedAt = Date.now();
  cache.set(save.id, save);
  await track(db.putSave(save));
}

/**
 * Store a new save. With an uploaded image blob, mints the image id, sets sourceImageId, and
 * writes image and save in one transaction so a failure leaves neither behind.
 */
export async function createSave(save: PictureSave, blob?: Blob): Promise<void> {
  save.updatedAt = Date.now();
  if (blob) {
    save.sourceImageId = newId();
    await track(db.putSaveWithImage(save, blob));
  } else {
    await track(db.putSave(save));
  }
  cache.set(save.id, save);
}

/** Delete a save from storage and the cache. */
export async function removeSave(id: string): Promise<void> {
  await db.deleteSave(id);
  cache.delete(id);
}

/** Clear all placed dots, timers and completion, then persist. */
export async function restartSave(save: PictureSave): Promise<void> {
  save.placed.fill(EMPTY);
  save.panelElapsedMs = save.panelElapsedMs.map(() => 0);
  delete save.completedAt;
  await persistSave(save);
}
