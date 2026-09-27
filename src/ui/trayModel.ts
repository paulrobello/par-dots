/** Pure tray bookkeeping for the play screen: which color dots to add or remove, and their counts. */

export interface TrayDiff {
  /** Colors in `prev` but not `next`. */
  removed: number[];
  /** Colors in `next` but not `prev`, each with the first later color of `next` already in the tray, or null to append. */
  added: Array<{ c: number; before: number | null }>;
}

/** Reconcile tray order `prev` to `next`. Apply `removed`, then `added` in order. */
export function diffTray(prev: readonly number[], next: readonly number[]): TrayDiff {
  const kept = new Set(prev.filter((c) => next.includes(c)));
  const removed = prev.filter((c) => !next.includes(c));
  const added: TrayDiff['added'] = [];
  for (let i = 0; i < next.length; i++) {
    const c = next[i];
    if (kept.has(c)) continue;
    added.push({ c, before: next.slice(i + 1).find((n) => kept.has(n)) ?? null });
  }
  return { removed, added };
}

/** Studs still needed per tray color. */
export function trayCounts(session: {
  trayColors(): number[];
  remainingFor(c: number): number;
}): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of session.trayColors()) out.set(c, session.remainingFor(c));
  return out;
}
