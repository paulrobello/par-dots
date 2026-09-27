# ENH-005 — Request persistent storage and show storage usage

## Goal

Stop the browser from silently evicting saved pictures, and let the player see how much space is used. The app calls `navigator.storage.persist()` after the first picture is created, and the Settings sheet shows "Storage: 12.4 MB used" along with whether storage is persistent.

## Current state

- All progress lives in IndexedDB (`src/storage/db.ts`). The app never calls `navigator.storage.persist()` or `estimate()`. `grep -rn "navigator.storage" src` finds nothing.
- Under storage pressure, best-effort storage can be evicted: Safari's ITP evicts script-writable storage after 7 days without interaction for non-installed sites, and Chrome evicts by LRU. An installed PWA is exempt on Safari, but the prompt to install is optional (`src/ui/install.ts`).
- `StorageFullError` exists and is surfaced on save failures.
- The Settings sheet (`src/ui/settingsSheet.ts`) builds rows with `h('div', { class: 'setting-row' }, …)`.

## Implementation

1. Create `src/storage/quota.ts`:
   ```ts
   /** Ask the browser to keep this origin's data under storage pressure. Resolves false when unsupported. */
   export async function requestPersistence(): Promise<boolean>
   /** Whether storage is already persistent (false when unsupported). */
   export async function isPersisted(): Promise<boolean>
   /** Bytes used and quota, or null when unsupported. */
   export async function storageEstimate(): Promise<{ usage: number; quota: number } | null>
   ```
   Each function feature-detects `navigator.storage?.persist`, `.persisted` and `.estimate`, and wraps the call in try/catch. It returns the fallback on any error.
2. Add `formatBytes(n: number): string` to `src/ui/pure.ts`. It produces `"512 B"`, `"12.4 KB"`, `"12.4 MB"` or `"1.2 GB"`, with one decimal place above 1 KB.
3. **When to ask**: in Setup's Start success path, right after the save is persisted and before navigating, call `void requestPersistence()`. Chrome grants it silently based on engagement, and Firefox may show a prompt. Asking on a user action (the Start click) satisfies the user-activation heuristics. Do not ask on page load.
4. **Settings row**: in `openSettingsSheet`, add a row "Storage" whose `<small>` fills in asynchronously:
   - `"<usage> used · kept safe"` when persisted
   - `"<usage> used · may be cleared by the browser"` otherwise
   - `"Unavailable"` when unsupported
   
   When it is not persisted and `navigator.storage.persist` exists, add a button "Keep safe" that calls `requestPersistence()` and updates the row.
5. **Tests**:
   - `tests/ui-pure.test.ts`: `formatBytes` for 0, 1023, 1536, 5×1024², and 3×1024³.
   - `tests/storage.test.ts`: stub `navigator.storage` with `vi.stubGlobal('navigator', { storage: { persist: async () => true, persisted: async () => false, estimate: async () => ({ usage: 10, quota: 100 }) } })`. Assert the three functions return those values, and that each returns its fallback when `navigator.storage` is undefined.

## Files to touch

- `src/storage/quota.ts` (new)
- `src/ui/pure.ts`
- `src/ui/setup.ts` (or `src/ui/saves.ts` if audit ARC-003 moved save creation there)
- `src/ui/settingsSheet.ts`
- `tests/ui-pure.test.ts`
- `tests/storage.test.ts`

## Dependencies

- None blocking. If ARC-003 or QA-003 has landed, hook `requestPersistence` into `createSave` success instead of setup.

## Verify

1. `bunx vitest run tests/ui-pure.test.ts tests/storage.test.ts` passes, including the `formatBytes` cases and the three `quota.ts` functions, both supported and unsupported.
2. GATE passes.
3. A test with a stubbed `navigator.storage.persist` spy asserts the Start success path calls `requestPersistence` exactly once. Chrome grants persistence by engagement heuristics, so the live result is not asserted.
4. In `bun run build && bun run preview`, the Settings sheet shows a "Storage" row with a byte figure.

## Rollback

Revert the commit. A granted persistence permission stays on the origin, which is harmless.
