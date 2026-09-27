/** Bundled picture library manifest. */

import type { LibraryEntry } from '../types';

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
