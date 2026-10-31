/** Shared update state for the 2D UI and immersive worlds. */
export interface UpdateStatus {
  available: boolean;
  busy: boolean;
  error: string | null;
}

type Listener = (status: UpdateStatus) => void;
type Flush = () => void | Promise<void>;
let status: UpdateStatus = { available: false, busy: false, error: null };
const listeners = new Set<Listener>();
const flushers = new Set<Flush>();
let handler: (() => Promise<void>) | null = null;
let endImmersive: (() => Promise<void>) | null = null;

const publish = (): void => {
  for (const listener of listeners) listener({ ...status });
};
export const getUpdateStatus = (): UpdateStatus => ({ ...status });
export function subscribeToUpdates(listener: Listener): () => void {
  listeners.add(listener);
  listener(getUpdateStatus());
  return () => listeners.delete(listener);
}
export function markUpdateAvailable(): void {
  if (status.available) return;
  status = { ...status, available: true };
  publish();
}
export function configureUpdateHandler(next: () => Promise<void>): void {
  handler = next;
}
export function registerUpdateFlush(flush: Flush): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}
export function registerImmersiveEnd(end: () => Promise<void>): () => void {
  endImmersive = end;
  return () => {
    if (endImmersive === end) endImmersive = null;
  };
}
/** Stop XR first, then flush the active save before activating or reloading. */
export async function requestUpdate(): Promise<void> {
  if (!status.available || status.busy || !handler) return;
  status = { ...status, busy: true, error: null };
  publish();
  const pendingFlushers = [...flushers];
  try {
    await endImmersive?.();
    for (const flush of pendingFlushers) await flush();
    await handler();
  } catch (error) {
    console.error('Update failed', error);
    status = { ...status, busy: false, error: 'Could not reload. Try again.' };
    publish();
  }
}
