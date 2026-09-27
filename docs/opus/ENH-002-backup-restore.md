# ENH-002 — Back up and restore pictures to a local file

## Goal

Let a player export one picture, or all of them, to a `.pardots` file and import it on another browser or device, or after clearing site data. This is a manual file round-trip. It is not cloud sync, which PRD §2 lists as a non-goal. Browsers evict IndexedDB under storage pressure, and iOS does so aggressively, so this is the only way a player can protect hours of progress.

## Current state

- Saves live in IndexedDB `par-dots` v1 in two stores (`src/storage/db.ts`):
  - `saves`, keyPath `id`, holding `PictureSave` records with `Uint8Array` `target`/`placed`
  - `images`, holding upload blobs keyed by id
- A save with `sourceImageId` `library:<slug>` references a bundled image and needs no blob.
- There is no export or import path. `downloadBlob(blob, filename)` exists in `src/ui/dom.ts`.
- Loaded records are not validated. **Audit ARC-004 (`migrateSave`) must land first**, because import feeds untrusted data into the same load path.

## Implementation

1. **Format** in `src/storage/backup.ts` (new). The file is a single JSON document:
   ```ts
   interface BackupFileV1 { format: 'par-dots-backup'; version: 1; exportedAt: number;
     saves: Array<Omit<PictureSave, 'target' | 'placed'> & { target: string; placed: string; image?: { type: string; data: string } }> }
   ```
   `target`/`placed` are base64-encoded bytes, and `image.data` is the base64 upload blob. Library saves omit `image`.
2. **Encode**: `export async function buildBackup(saves: PictureSave[], getImage: (id) => Promise<Blob | undefined>): Promise<Blob>` returns `new Blob([JSON.stringify(file)], { type: 'application/json' })`. Encode base64 with chunked `String.fromCharCode` over 32 KB slices, then `btoa`, to avoid argument-length limits.
3. **Decode**: `export async function parseBackup(text: string): Promise<Array<{ save: PictureSave; image?: Blob }>>`.
   - Check `format`/`version`, and cap `saves.length` at 200.
   - Decode each save and run it through `migrateSave` (ARC-004). Drop any record that returns `undefined`.
   - Decode each image to a `Blob` and reject any over 20 MB (`MAX_UPLOAD_BYTES`).
   - Reject a whole file over 200 MB before parsing (check `file.size` in the UI).
4. **Import writes**: for each entry, assign a **fresh** `id` (`newId()`) and a fresh image id, so imports never overwrite existing saves. Write each save and its image in one transaction. Reuse `putSaveWithImage` from audit QA-003 if it has landed; otherwise add it (same code as QA-003's playbook). Library saves use `putSave`.
5. **UI**:
   - Gallery header: add an overflow of two `chip` buttons, "Back up all" and "Restore".
   - Each save card: add a "Back up" `icon-btn` next to Download PNG.
   - "Restore" opens a hidden `<input type="file" accept=".pardots,application/json">`. Import, toast `Restored N picture(s)` or `userMessage(err)`, then re-render the gallery.
   - The file name is `par-dots-backup-YYYY-MM-DD.pardots`, or `<safe-name>.pardots` for a single picture (reuse the sanitizer from `src/ui/exportImage.ts`).
6. **Tests** in `tests/backup.test.ts`, using fake-indexeddb:
   - A round trip of one library save and one upload save gives byte-equal `target`/`placed`, an equal image blob `size`, and new ids.
   - A tampered file (short `placed`) imports 0 saves.
   - A wrong `format` string throws.

## Files to touch

- `src/storage/backup.ts` (new)
- `src/storage/db.ts` (only if `putSaveWithImage` is absent)
- `src/ui/gallery.ts`
- `src/styles.css`
- `tests/backup.test.ts` (new)

## Dependencies

- **Requires audit ARC-004 (`migrateSave`).**
- Prefers QA-003 (`putSaveWithImage`) and QA-009 (`userMessage`).

## Verify

1. `bunx vitest run tests/backup.test.ts` passes. It covers the round trip with byte equality and new ids, rejection of a tampered file, and rejection of a wrong format.
2. GATE passes.
3. `bun run build && bun run preview`, then in a browser:
   - "Back up all" downloads a `.pardots` file
   - delete every picture, then "Restore" that file: the gallery shows the same pictures with the same progress percentages

## Rollback

Revert the commit. The backup file format is new and nothing existing reads it. IndexedDB is unchanged, apart from imported records, which are ordinary saves.
