/**
 * Visible-time accounting for one panel: time accrues only while the page is visible,
 * and never for a panel that was already complete when opened. DOM-free; `now` is injected.
 */

export interface PanelTimerOptions {
  now: () => number;
  /** Milliseconds already recorded for this panel. */
  initialMs: number;
  /** Whether the page is visible at mount. */
  visible: boolean;
  /** A panel complete at open never accrues time. */
  locked: boolean;
}

export interface PanelTimer {
  /** Recorded plus in-flight milliseconds. In-flight time is excluded once `finished`. */
  elapsed(finished: boolean): number;
  /** Fold in-flight time into the recorded total and return that total. */
  flush(): number;
  setVisible(visible: boolean): void;
  /** Flush and stop accruing. */
  stop(): number;
}

export function createPanelTimer(opts: PanelTimerOptions): PanelTimer {
  let recorded = opts.initialMs;
  let visibleSince: number | null = opts.visible ? opts.now() : null;

  const flush = (): number => {
    if (visibleSince === null || opts.locked) return recorded;
    const t = opts.now();
    recorded += t - visibleSince;
    visibleSince = t;
    return recorded;
  };

  return {
    elapsed: (finished) =>
      recorded +
      (visibleSince !== null && !opts.locked && !finished ? opts.now() - visibleSince : 0),
    flush,
    setVisible(visible) {
      if (visible) {
        visibleSince = opts.now();
      } else {
        flush();
        visibleSince = null;
      }
    },
    stop() {
      const total = flush();
      visibleSince = null;
      return total;
    },
  };
}
