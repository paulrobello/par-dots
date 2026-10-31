/**
 * Service-worker update polling: asks the registration to check for a new deploy on a fixed
 * interval and whenever the page becomes visible again. Applying the update is main.ts's job.
 */

/** How often a long-open page checks for a new deploy. */
export const UPDATE_CHECK_MS = 5 * 60 * 1000;

/** The slice of ServiceWorkerRegistration this module uses. */
interface Registration {
  update(): Promise<unknown>;
}
type VisibilitySource = Pick<
  Document,
  'visibilityState' | 'addEventListener' | 'removeEventListener'
>;

let immersiveActive = false;
export const setImmersiveActive = (active: boolean): void => {
  immersiveActive = active;
};
export const isImmersiveActive = (): boolean => immersiveActive;

/** The manifest is network-only, never a service-worker precache entry. */
export async function checkBuild(
  current: string,
  changed: () => void,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!current) return;
  try {
    const response = await fetcher('/version.json', { cache: 'no-store' });
    if (!response.ok) return;
    const latest: unknown = await response.json();
    const fingerprint = (latest as { fingerprint?: unknown } | null)?.fingerprint;
    if (
      typeof fingerprint === 'string' &&
      /^[a-f0-9]{64}$/.test(fingerprint) &&
      fingerprint !== current
    ) {
      changed();
    }
  } catch {
    // Offline pages keep their working build and check again when connected.
  }
}

/** Start polling `reg` for updates. Returns a function that stops polling. */
export function watchForUpdates(
  reg: Registration,
  doc: VisibilitySource,
  intervalMs = UPDATE_CHECK_MS,
): () => void {
  const check = (): void => {
    // Offline or a transient network error: the next check retries.
    reg.update().catch(() => {});
  };
  const onVisibility = (): void => {
    if (doc.visibilityState === 'visible') check();
  };
  check();
  const timer = setInterval(check, intervalMs);
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * When the page hides, call `apply` once the saves that hiding triggers have settled. Screens
 * start their hide-time save in their own visibilitychange listener, possibly after this one
 * runs, so the wait begins on the next task. Returns a function that stops listening.
 */
export function applyWhenHidden(
  doc: VisibilitySource,
  whenSaved: () => Promise<void>,
  apply: () => void,
): () => void {
  const onVisibility = (): void => {
    if (doc.visibilityState !== 'hidden') return;
    setTimeout(() => {
      whenSaved().then(apply, apply);
    }, 0);
  };
  doc.addEventListener('visibilitychange', onVisibility);
  return () => doc.removeEventListener('visibilitychange', onVisibility);
}
