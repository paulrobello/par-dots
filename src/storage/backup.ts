/**
 * `.pardots` backup files: one JSON document holding saves with base64 `target`/`placed` bytes
 * and, for uploads, the base64 source image. Imports are validated through migrateSave and
 * always get fresh ids, so a restore never overwrites an existing save.
 */

import type { PictureSave } from '../types';
import { putSave, putSaveWithImage } from './db';
import { newId } from './id';
import { migrateSave } from './migrate';

const FORMAT = 'par-dots-backup';
const VERSION = 1;
const LIBRARY_PREFIX = 'library:';
/** Most saves one backup file may carry. */
export const MAX_BACKUP_SAVES = 200;
/** Largest image a backup may carry; matches the upload cap. */
export const MAX_BACKUP_IMAGE_BYTES = 20 * 1024 * 1024;
/** Largest backup file the UI will read. */
export const MAX_BACKUP_FILE_BYTES = 200 * 1024 * 1024;
const CHUNK = 0x8000;

type EncodedSave = Omit<PictureSave, 'target' | 'placed'> & {
  target: string;
  placed: string;
  image?: { type: string; data: string };
};

/** Backup file shape, version 1. */
export interface BackupFileV1 {
  format: typeof FORMAT;
  version: typeof VERSION;
  exportedAt: number;
  saves: EncodedSave[];
}

/** One save read from a backup, with its upload image when it has one. */
export interface BackupEntry {
  save: PictureSave;
  image?: Blob;
}

/** Thrown when a file is not a par-dots backup this build can read. */
export class BackupFormatError extends Error {
  constructor(message = 'That file is not a par-dots backup.') {
    super(message);
    this.name = 'BackupFormatError';
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encodes saves (and their upload images via getImage) as a `.pardots` JSON blob. */
export async function buildBackup(
  saves: PictureSave[],
  getImage: (id: string) => Promise<Blob | undefined>,
): Promise<Blob> {
  const encoded: EncodedSave[] = [];
  for (const save of saves) {
    const entry: EncodedSave = {
      ...save,
      target: toBase64(save.target),
      placed: toBase64(save.placed),
    };
    if (!save.sourceImageId.startsWith(LIBRARY_PREFIX)) {
      const blob = await getImage(save.sourceImageId);
      if (blob) {
        entry.image = {
          type: blob.type,
          data: toBase64(new Uint8Array(await blob.arrayBuffer())),
        };
      }
    }
    encoded.push(entry);
  }
  const file: BackupFileV1 = {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    saves: encoded,
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

function decodeEntry(raw: unknown): BackupEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { image, target, placed, ...rest } = raw as Record<string, unknown>;
  if (typeof target !== 'string' || typeof placed !== 'string') return undefined;
  if (typeof rest.name !== 'string' || typeof rest.sourceImageId !== 'string') return undefined;
  if (rest.paletteMode !== 'lego' && rest.paletteMode !== 'free') return undefined;
  let save: PictureSave | undefined;
  try {
    save = migrateSave({ ...rest, target: fromBase64(target), placed: fromBase64(placed) });
  } catch {
    return undefined;
  }
  if (!save) return undefined;
  const now = Date.now();
  if (!Number.isFinite(save.createdAt)) save.createdAt = now;
  if (!Number.isFinite(save.updatedAt)) save.updatedAt = now;
  if (save.sourceImageId.startsWith(LIBRARY_PREFIX)) return { save };

  // Drawn saves carry no image at all.
  if (save.sourceImageId === '') return { save };

  if (typeof image !== 'object' || image === null) return undefined;
  const { type, data } = image as Record<string, unknown>;
  if (typeof type !== 'string' || typeof data !== 'string') return undefined;
  // Base64 is 4 chars per 3 bytes; reject before decoding an oversized image.
  if ((data.length / 4) * 3 > MAX_BACKUP_IMAGE_BYTES + 3) return undefined;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64(data);
  } catch {
    return undefined;
  }
  if (bytes.length > MAX_BACKUP_IMAGE_BYTES) return undefined;
  return { save, image: new Blob([bytes], { type }) };
}

/**
 * Parses a backup file's text into validated entries; invalid saves are dropped.
 *
 * @throws {BackupFormatError} When the text is not a readable par-dots backup.
 */
export async function parseBackup(text: string): Promise<BackupEntry[]> {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new BackupFormatError();
  }
  if (typeof file !== 'object' || file === null) throw new BackupFormatError();
  const { format, version, saves } = file as Record<string, unknown>;
  if (format !== FORMAT) throw new BackupFormatError();
  if (version !== VERSION) {
    throw new BackupFormatError('That backup was made by a newer version of par-dots.');
  }
  if (!Array.isArray(saves)) throw new BackupFormatError();
  if (saves.length > MAX_BACKUP_SAVES) {
    throw new BackupFormatError(`A backup can hold at most ${MAX_BACKUP_SAVES} pictures.`);
  }
  const entries: BackupEntry[] = [];
  for (const raw of saves) {
    const entry = decodeEntry(raw);
    if (entry) entries.push(entry);
    else console.warn('Skipping invalid backup save', (raw as { id?: unknown } | null)?.id);
  }
  return entries;
}

/**
 * Writes entries as new saves (fresh save and image ids) and returns how many were written.
 *
 * @throws {StorageFullError} When the storage quota is exhausted.
 */
export async function importEntries(entries: BackupEntry[]): Promise<number> {
  let count = 0;
  for (const { save, image } of entries) {
    const copy: PictureSave = { ...save, id: newId() };
    if (image) {
      copy.sourceImageId = newId();
      await putSaveWithImage(copy, image);
    } else {
      await putSave(copy);
    }
    count++;
  }
  return count;
}
