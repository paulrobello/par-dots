/** Storage persistence and usage via navigator.storage, with safe fallbacks when unsupported. */

function storageManager(): StorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

/** Ask the browser to keep this origin's data under storage pressure. Resolves false when unsupported. */
export async function requestPersistence(): Promise<boolean> {
  try {
    const sm = storageManager();
    if (typeof sm?.persist !== 'function') return false;
    return await sm.persist();
  } catch {
    return false;
  }
}

/** Whether storage is already persistent (false when unsupported). */
export async function isPersisted(): Promise<boolean> {
  try {
    const sm = storageManager();
    if (typeof sm?.persisted !== 'function') return false;
    return await sm.persisted();
  } catch {
    return false;
  }
}

/** Bytes used and quota, or null when unsupported. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const sm = storageManager();
    if (typeof sm?.estimate !== 'function') return null;
    const e = await sm.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Whether the browser offers navigator.storage.persist. */
export function canRequestPersistence(): boolean {
  return typeof storageManager()?.persist === 'function';
}
