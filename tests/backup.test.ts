import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BackupFormatError,
  buildBackup,
  importEntries,
  MAX_BACKUP_SAVES,
  parseBackup,
} from '../src/storage/backup';
import { closeDb, getImage, listSaves, putSave, putSaveWithImage } from '../src/storage/db';
import { newId } from '../src/storage/id';
import { EMPTY, type PictureSave } from '../src/types';

function makeSave(overrides: Partial<PictureSave> = {}): PictureSave {
  const target = new Uint8Array(48 * 48).map((_, i) => i % 5);
  const placed = new Uint8Array(48 * 48).fill(EMPTY);
  for (let i = 0; i < 300; i++) placed[i * 7] = target[i * 7];
  return {
    schemaVersion: 1,
    id: newId(),
    createdAt: 1,
    updatedAt: 2,
    name: 'Test',
    sourceImageId: 'library:lighthouse',
    aspect: '1:1',
    paletteMode: 'lego',
    width: 48,
    height: 48,
    palette: [
      { hex: '#000000', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
      { hex: '#ff0000', name: 'Red' },
      { hex: '#00ff00', name: 'Green' },
      { hex: '#0000ff', name: 'Blue' },
    ],
    target,
    placed,
    panelElapsedMs: [1000, 0, 0, 0, 0, 0, 0, 0, 0],
    ...overrides,
  };
}

async function clearDb(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('par-dots');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

describe('backup files', () => {
  beforeEach(clearDb);
  afterEach(clearDb);

  it('round-trips a library save and an upload save as new records', async () => {
    const lib = makeSave({ name: 'Lighthouse' });
    const upload = makeSave({ name: 'Cat', sourceImageId: newId(), paletteMode: 'free' });
    const imageBytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    await putSave(lib);
    await putSaveWithImage(upload, new Blob([imageBytes], { type: 'image/jpeg' }));

    const blob = await buildBackup(await listSaves(), getImage);
    const entries = await parseBackup(await blob.text());
    expect(entries).toHaveLength(2);
    expect(await importEntries(entries)).toBe(2);

    const all = await listSaves();
    expect(all).toHaveLength(4);
    const originalIds = new Set([lib.id, upload.id]);
    for (const src of [lib, upload]) {
      const copy = all.find((s) => s.name === src.name && !originalIds.has(s.id));
      expect(copy).toBeDefined();
      if (!copy) return;
      expect(copy.id).not.toBe(src.id);
      expect(Array.from(copy.target)).toEqual(Array.from(src.target));
      expect(Array.from(copy.placed)).toEqual(Array.from(src.placed));
      expect(copy.panelElapsedMs).toEqual(src.panelElapsedMs);
      if (src === lib) {
        expect(copy.sourceImageId).toBe('library:lighthouse');
      } else {
        expect(copy.sourceImageId).not.toBe(src.sourceImageId);
        const img = await getImage(copy.sourceImageId);
        expect(img?.size).toBe(imageBytes.length);
        expect(img?.type).toBe('image/jpeg');
      }
    }
  });

  it('imports nothing from a file whose placed bytes are the wrong length', async () => {
    const text = await (await buildBackup([makeSave()], getImage)).text();
    const file = JSON.parse(text);
    file.saves[0].placed = btoa('\u0000\u0001');
    const entries = await parseBackup(JSON.stringify(file));
    expect(entries).toHaveLength(0);
    expect(await importEntries(entries)).toBe(0);
    expect(await listSaves()).toHaveLength(0);
  });

  it('drops an upload save whose image is missing', async () => {
    const text = await (await buildBackup([makeSave({ sourceImageId: 'gone' })], getImage)).text();
    expect(await parseBackup(text)).toHaveLength(0);
  });

  it('rejects a file with the wrong format string', async () => {
    const text = await (await buildBackup([makeSave()], getImage)).text();
    const file = JSON.parse(text);
    file.format = 'something-else';
    await expect(parseBackup(JSON.stringify(file))).rejects.toBeInstanceOf(BackupFormatError);
  });

  it('rejects non-JSON text and an oversized save list', async () => {
    await expect(parseBackup('not json')).rejects.toBeInstanceOf(BackupFormatError);
    const saves = Array.from({ length: MAX_BACKUP_SAVES + 1 }, () => ({}));
    await expect(
      parseBackup(JSON.stringify({ format: 'par-dots-backup', version: 1, saves })),
    ).rejects.toBeInstanceOf(BackupFormatError);
  });
});
