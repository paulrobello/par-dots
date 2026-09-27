/**
 * IndexedDB persistence: database `par-dots` (DB_VERSION 1) with store `saves` (PictureSave
 * records, keyPath `id`) and store `images` (uploaded image blobs keyed by sourceImageId).
 * Every write maps a quota error to StorageFullError. ui/ reaches this module through ui/saves.ts.
 */

import type { PictureSave } from '../types';
import { migrateSave } from './migrate';

const DB_NAME = 'par-dots';
const DB_VERSION = 1;
const SAVES = 'saves';
const IMAGES = 'images';
const LIBRARY_PREFIX = 'library:';

/** Thrown when the browser storage quota is exhausted. */
export class StorageFullError extends Error {
  constructor(message = 'Storage is full. Delete some saved pictures to free space.') {
    super(message);
    this.name = 'StorageFullError';
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgrading the schema must not be blocked by this connection.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    }).catch((err: unknown) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** Closes the cached connection (used by tests to reset state). */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const p = dbPromise;
  dbPromise = null;
  try {
    (await p).close();
  } catch {
    // Connection never opened; nothing to close.
  }
}

function mapError(err: unknown): unknown {
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'QuotaExceededError') {
    return new StorageFullError();
  }
  return err;
}

/** Runs `fn` in a transaction and resolves with its request's result once the transaction commits. */
async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => IDBRequest<T> | undefined,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(stores, mode);
    } catch (err) {
      reject(mapError(err));
      return;
    }
    let req: IDBRequest<T> | undefined;
    try {
      req = fn(t);
    } catch (err) {
      try {
        t.abort();
      } catch {
        // Transaction already finished.
      }
      reject(mapError(err));
      return;
    }
    t.oncomplete = () => resolve(req?.result as T);
    t.onerror = () => reject(mapError(t.error ?? req?.error));
    t.onabort = () => reject(mapError(t.error ?? req?.error));
  });
}

/** All valid saves, most recently updated first; records that fail validation are skipped with a warning. */
export async function listSaves(): Promise<PictureSave[]> {
  const all = await tx<unknown[]>([SAVES], 'readonly', (t) => t.objectStore(SAVES).getAll());
  const saves: PictureSave[] = [];
  for (const raw of all) {
    const save = migrateSave(raw);
    if (save) saves.push(save);
    else console.warn('Skipping invalid save', (raw as { id?: unknown } | null)?.id);
  }
  return saves.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A save by id, migrated and validated; undefined when missing or invalid. */
export async function getSave(id: string): Promise<PictureSave | undefined> {
  const raw = await tx<unknown>([SAVES], 'readonly', (t) => t.objectStore(SAVES).get(id));
  return raw === undefined ? undefined : migrateSave(raw);
}

/**
 * Inserts or replaces a save as-is (callers set updatedAt).
 *
 * @throws {StorageFullError} When the storage quota is exhausted.
 */
export async function putSave(save: PictureSave): Promise<void> {
  await tx([SAVES], 'readwrite', (t) => t.objectStore(SAVES).put(save));
}

/**
 * Deletes a save and, when it references an uploaded (non-library) image, that image too.
 * Deleting a missing id is a no-op.
 */
export async function deleteSave(id: string): Promise<void> {
  await tx([SAVES, IMAGES], 'readwrite', (t) => {
    const saves = t.objectStore(SAVES);
    const get = saves.get(id);
    get.onsuccess = () => {
      const save = get.result as PictureSave | undefined;
      saves.delete(id);
      if (save && !save.sourceImageId.startsWith(LIBRARY_PREFIX)) {
        t.objectStore(IMAGES).delete(save.sourceImageId);
      }
    };
    return undefined;
  });
}

/**
 * Stores an uploaded image under `save.sourceImageId` and the save in one transaction;
 * neither persists if either write fails.
 *
 * @throws {StorageFullError} When the storage quota is exhausted.
 */
export async function putSaveWithImage(save: PictureSave, blob: Blob): Promise<void> {
  await tx([SAVES, IMAGES], 'readwrite', (t) => {
    t.objectStore(IMAGES).put(blob, save.sourceImageId);
    return t.objectStore(SAVES).put(save);
  });
}

/**
 * An uploaded image blob by id, or undefined when absent. Only uploads live in this store:
 * a "library:<slug>" id never matches, because bundled pictures are served from `library/`.
 */
export function getImage(id: string): Promise<Blob | undefined> {
  return tx<Blob | undefined>([IMAGES], 'readonly', (t) => t.objectStore(IMAGES).get(id));
}
