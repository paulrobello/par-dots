/**
 * Board pointer model: turns pointer down/move/up (client coordinates) and time into
 * stroke, pan and pinch-zoom intents. DOM-free; the clock and timers are injected.
 *
 * - Mouse/pen strokes start on pointerdown. A touch is held `TOUCH_HOLD_MS` (or until it
 *   drifts `TOUCH_SLOP_PX`) before it paints, so the first finger of a pinch never paints.
 * - A second pointer within `PINCH_GRACE_MS` of the stroke's touch-down cancels the stroke;
 *   later it ends it. Either way the gesture becomes a pinch.
 * - In pan mode one pointer pans.
 * - A mouse right-button drag is always an erase stroke, even in pan mode.
 */

export const TOUCH_HOLD_MS = 70;
/** Touch drift (CSS px) tolerated while a first touch is held, before it counts as a drag. */
export const TOUCH_SLOP_PX = 10;
/** A second finger this soon after the first turns the touch into a pinch and discards its stroke. */
export const PINCH_GRACE_MS = 300;

export interface GesturePointer {
  id: number;
  x: number;
  y: number;
  type: 'touch' | 'mouse' | 'pen';
  /** Right mouse button: the stroke removes dots whatever tool is selected. */
  erase?: boolean;
}

export type GestureIntent =
  | { type: 'strokeStart'; id: number; x: number; y: number; erase: boolean }
  | { type: 'strokeMove'; points: Array<{ x: number; y: number }> }
  | { type: 'strokeEnd' }
  | { type: 'strokeCancel' }
  | { type: 'pan'; dx: number; dy: number }
  /** Scale by `factor` about the previous pinch midpoint (`mx`, `my`), then translate by (`dmx`, `dmy`). */
  | { type: 'zoom'; factor: number; mx: number; my: number; dmx: number; dmy: number }
  | { type: 'pinchStart' }
  | { type: 'pinchEnd' };

export interface BoardGesturesOptions {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  /**
   * Whether a stroke may start now (`erase` for a right-button stroke). Checked when the
   * stroke would begin, not on pointerdown.
   */
  canPaint: (erase: boolean) => boolean;
  /** Whether a single pointer pans instead of painting. */
  panMode: () => boolean;
}

export interface BoardGestures {
  down(p: GesturePointer): void;
  /** `coalesced` are the pointer's coalesced samples, painted in order when non-empty. */
  move(p: GesturePointer, coalesced?: GesturePointer[]): void;
  /** `cancelled` is true for pointercancel: a pending touch is dropped instead of painted. */
  up(p: GesturePointer, cancelled: boolean): void;
  onIntent(cb: (intent: GestureIntent) => void): () => void;
  /** Drop a pending touch and end any open stroke. */
  dispose(): void;
}

export function createBoardGestures(opts: BoardGesturesOptions): BoardGestures {
  const listeners = new Set<(intent: GestureIntent) => void>();
  const emit = (intent: GestureIntent): void => {
    for (const cb of [...listeners]) cb(intent);
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let strokePointer: number | null = null;
  let strokeTouchDownAt: number | null = null;
  let pinch: { dist: number; mx: number; my: number } | null = null;
  let pinching = false;
  let drag: { id: number; x: number; y: number } | null = null;
  let pending: { id: number; x: number; y: number; downAt: number; timer: unknown } | null = null;

  const cancelPending = (): void => {
    if (pending) opts.clearTimer(pending.timer);
    pending = null;
  };
  const pinchState = (): { dist: number; mx: number; my: number } | null => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  const startStroke = (
    id: number,
    x: number,
    y: number,
    touchDownAt: number | null,
    erase = false,
  ): void => {
    cancelPending();
    if (!opts.canPaint(erase)) return;
    strokePointer = id;
    strokeTouchDownAt = touchDownAt;
    emit({ type: 'strokeStart', id, x, y, erase });
  };
  const endStroke = (): void => {
    cancelPending();
    if (strokePointer === null) return;
    strokePointer = null;
    strokeTouchDownAt = null;
    emit({ type: 'strokeEnd' });
  };

  return {
    down(p) {
      pointers.set(p.id, { x: p.x, y: p.y });
      if (pointers.size >= 2) {
        cancelPending();
        if (
          strokePointer !== null &&
          strokeTouchDownAt !== null &&
          opts.now() - strokeTouchDownAt < PINCH_GRACE_MS
        ) {
          strokePointer = null;
          strokeTouchDownAt = null;
          emit({ type: 'strokeCancel' });
        } else {
          endStroke();
        }
        drag = null;
        pinch = pinchState();
        pinching = true;
        emit({ type: 'pinchStart' });
        return;
      }
      if (p.erase) {
        startStroke(p.id, p.x, p.y, null, true);
        return;
      }
      if (opts.panMode()) {
        drag = { id: p.id, x: p.x, y: p.y };
        return;
      }
      if (p.type !== 'touch') {
        startStroke(p.id, p.x, p.y, null);
        return;
      }
      const { id, x, y } = p;
      const downAt = opts.now();
      cancelPending();
      pending = {
        id,
        x,
        y,
        downAt,
        timer: opts.setTimer(() => startStroke(id, x, y, downAt), TOUCH_HOLD_MS),
      };
    },

    move(p, coalesced) {
      if (!pointers.has(p.id)) return;
      pointers.set(p.id, { x: p.x, y: p.y });
      if (pointers.size >= 2 && pinch) {
        const next = pinchState();
        if (!next) return;
        emit({
          type: 'zoom',
          factor: pinch.dist > 0 ? next.dist / pinch.dist : 1,
          mx: pinch.mx,
          my: pinch.my,
          dmx: next.mx - pinch.mx,
          dmy: next.my - pinch.my,
        });
        pinch = next;
        return;
      }
      if (drag && p.id === drag.id) {
        emit({ type: 'pan', dx: p.x - drag.x, dy: p.y - drag.y });
        drag = { id: drag.id, x: p.x, y: p.y };
        return;
      }
      if (pending && p.id === pending.id) {
        if (Math.hypot(p.x - pending.x, p.y - pending.y) < TOUCH_SLOP_PX) return;
        startStroke(pending.id, pending.x, pending.y, pending.downAt);
      }
      if (p.id !== strokePointer) return;
      const samples = coalesced && coalesced.length > 0 ? coalesced : [p];
      emit({ type: 'strokeMove', points: samples.map((s) => ({ x: s.x, y: s.y })) });
    },

    up(p, cancelled) {
      if (!cancelled && pending && pending.id === p.id) {
        startStroke(pending.id, pending.x, pending.y, pending.downAt);
      }
      pointers.delete(p.id);
      if (drag && drag.id === p.id) drag = null;
      if (p.id === strokePointer) endStroke();
      else if (pending && pending.id === p.id) cancelPending();
      pinch = pointers.size >= 2 ? pinchState() : null;
      if (pinching && pointers.size < 2) {
        pinching = false;
        emit({ type: 'pinchEnd' });
      }
    },

    onIntent(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    dispose() {
      endStroke();
    },
  };
}
