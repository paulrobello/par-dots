import { beforeEach, describe, expect, it } from 'vitest';
import {
  type BoardGestures,
  createBoardGestures,
  type GestureIntent,
  type GesturePointer,
  PINCH_GRACE_MS,
  TOUCH_HOLD_MS,
  TOUCH_SLOP_PX,
} from '../src/ui/gestures';

/** Fake clock + scheduler: `advance(ms)` fires due timers in order. */
function fakeTime() {
  let t = 1000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (id: unknown): void => {
      timers.delete(id as number);
    },
    advance(ms: number): void {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, v]) => v.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
    pending: () => timers.size,
  };
}

const touch = (id: number, x: number, y: number): GesturePointer => ({ id, x, y, type: 'touch' });
const mouse = (id: number, x: number, y: number): GesturePointer => ({ id, x, y, type: 'mouse' });

describe('createBoardGestures', () => {
  let time: ReturnType<typeof fakeTime>;
  let paint: boolean;
  let pan: boolean;
  let g: BoardGestures;
  let out: GestureIntent[];

  beforeEach(() => {
    time = fakeTime();
    paint = true;
    pan = false;
    g = createBoardGestures({
      now: time.now,
      setTimer: time.setTimer,
      clearTimer: time.clearTimer,
      canPaint: () => paint,
      panMode: () => pan,
    });
    out = [];
    g.onIntent((i) => out.push(i));
  });

  const types = (): string[] => out.map((i) => i.type);

  it('exports the gesture constants', () => {
    expect(TOUCH_HOLD_MS).toBe(70);
    expect(TOUCH_SLOP_PX).toBe(10);
    expect(PINCH_GRACE_MS).toBe(300);
  });

  describe('mouse and pen', () => {
    it('start a stroke immediately on pointerdown', () => {
      g.down(mouse(1, 10, 20));
      expect(out).toEqual([{ type: 'strokeStart', id: 1, x: 10, y: 20 }]);
    });

    it('pen starts a stroke immediately too', () => {
      g.down({ id: 2, x: 5, y: 5, type: 'pen' });
      expect(out).toEqual([{ type: 'strokeStart', id: 2, x: 5, y: 5 }]);
    });

    it('move emits the coalesced points when given, else the event point', () => {
      g.down(mouse(1, 0, 0));
      g.move(mouse(1, 5, 5), [
        { id: 1, x: 3, y: 3, type: 'mouse' },
        { id: 1, x: 5, y: 5, type: 'mouse' },
      ]);
      g.move(mouse(1, 7, 7), []);
      g.move(mouse(1, 9, 9));
      expect(out.slice(1)).toEqual([
        {
          type: 'strokeMove',
          points: [
            { x: 3, y: 3 },
            { x: 5, y: 5 },
          ],
        },
        { type: 'strokeMove', points: [{ x: 7, y: 7 }] },
        { type: 'strokeMove', points: [{ x: 9, y: 9 }] },
      ]);
    });

    it('pointerup of the stroke pointer ends the stroke', () => {
      g.down(mouse(1, 0, 0));
      g.up(mouse(1, 0, 0), false);
      expect(types()).toEqual(['strokeStart', 'strokeEnd']);
    });

    it('does nothing when painting is not allowed', () => {
      paint = false;
      g.down(mouse(1, 0, 0));
      g.move(mouse(1, 50, 50));
      g.up(mouse(1, 50, 50), false);
      expect(out).toEqual([]);
    });

    it('ignores moves of unknown pointers', () => {
      g.move(mouse(9, 1, 1));
      expect(out).toEqual([]);
    });
  });

  describe('touch hold', () => {
    it('starts the stroke after TOUCH_HOLD_MS at the touch-down point', () => {
      g.down(touch(1, 10, 10));
      time.advance(TOUCH_HOLD_MS - 1);
      expect(out).toEqual([]);
      time.advance(1);
      expect(out).toEqual([{ type: 'strokeStart', id: 1, x: 10, y: 10 }]);
    });

    it('ignores drift under TOUCH_SLOP_PX while held', () => {
      g.down(touch(1, 10, 10));
      g.move(touch(1, 10 + TOUCH_SLOP_PX - 1, 10));
      expect(out).toEqual([]);
    });

    it('starts early once the touch moves TOUCH_SLOP_PX, then strokes to the new point', () => {
      g.down(touch(1, 10, 10));
      g.move(touch(1, 10 + TOUCH_SLOP_PX, 10), [touch(1, 15, 10), touch(1, 20, 10)]);
      expect(out).toEqual([
        { type: 'strokeStart', id: 1, x: 10, y: 10 },
        {
          type: 'strokeMove',
          points: [
            { x: 15, y: 10 },
            { x: 20, y: 10 },
          ],
        },
      ]);
      time.advance(TOUCH_HOLD_MS * 2);
      expect(out).toHaveLength(2);
    });

    it('a tap (pointerup before the hold fires) paints and ends', () => {
      g.down(touch(1, 4, 4));
      time.advance(20);
      g.up(touch(1, 4, 4), false);
      expect(out).toEqual([{ type: 'strokeStart', id: 1, x: 4, y: 4 }, { type: 'strokeEnd' }]);
      time.advance(TOUCH_HOLD_MS);
      expect(out).toHaveLength(2);
    });

    it('pointercancel drops a pending touch without painting', () => {
      g.down(touch(1, 4, 4));
      g.up(touch(1, 4, 4), true);
      time.advance(TOUCH_HOLD_MS * 2);
      expect(out).toEqual([]);
    });

    it('pointercancel of an active stroke ends it', () => {
      g.down(touch(1, 4, 4));
      time.advance(TOUCH_HOLD_MS);
      g.up(touch(1, 4, 4), true);
      expect(types()).toEqual(['strokeStart', 'strokeEnd']);
    });

    it('checks canPaint when the hold fires, not at touch-down', () => {
      g.down(touch(1, 4, 4));
      paint = false;
      time.advance(TOUCH_HOLD_MS);
      g.move(touch(1, 60, 60));
      g.up(touch(1, 60, 60), false);
      expect(out).toEqual([]);
    });
  });

  describe('late second finger', () => {
    it('within PINCH_GRACE_MS of touch-down cancels the stroke and enters pinch', () => {
      g.down(touch(1, 0, 0));
      time.advance(TOUCH_HOLD_MS);
      time.advance(250 - TOUCH_HOLD_MS);
      g.down(touch(2, 40, 0));
      expect(types()).toEqual(['strokeStart', 'strokeCancel', 'pinchStart']);
    });

    it('measures the grace window from touch-down, not from when the hold fired', () => {
      g.down(touch(1, 0, 0));
      time.advance(PINCH_GRACE_MS + 20);
      g.down(touch(2, 40, 0));
      expect(types()).toEqual(['strokeStart', 'strokeEnd', 'pinchStart']);
    });

    it('a second finger during the hold cancels the pending touch without painting', () => {
      g.down(touch(1, 0, 0));
      time.advance(30);
      g.down(touch(2, 40, 0));
      time.advance(TOUCH_HOLD_MS * 2);
      expect(types()).toEqual(['pinchStart']);
    });

    it('a mouse stroke is ended, not cancelled, by a second pointer', () => {
      g.down(mouse(1, 0, 0));
      g.down(touch(2, 40, 0));
      expect(types()).toEqual(['strokeStart', 'strokeEnd', 'pinchStart']);
    });
  });

  describe('pinch', () => {
    it('moves emit zoom with factor and midpoint delta, then pinchEnd below two pointers', () => {
      g.down(touch(1, 0, 0));
      g.down(touch(2, 100, 0));
      out = [];
      g.move(touch(2, 200, 0));
      expect(out).toEqual([{ type: 'zoom', factor: 2, mx: 50, my: 0, dmx: 50, dmy: 0 }]);
      g.move(touch(1, 0, 20));
      const z = out[1];
      expect(z.type).toBe('zoom');
      if (z.type === 'zoom') {
        expect(z.mx).toBe(100);
        expect(z.my).toBe(0);
        expect(z.dmx).toBe(0);
        expect(z.dmy).toBe(10);
        expect(z.factor).toBeCloseTo(Math.hypot(200, 20) / 200);
      }
      g.up(touch(1, 0, 20), false);
      expect(out[2]).toEqual({ type: 'pinchEnd' });
      g.move(touch(2, 300, 0));
      g.up(touch(2, 300, 0), false);
      expect(out).toHaveLength(3);
    });

    it('a coincident pinch start reports factor 1', () => {
      g.down(touch(1, 5, 5));
      g.down(touch(2, 5, 5));
      out = [];
      g.move(touch(2, 25, 5));
      expect(out[0]).toMatchObject({ type: 'zoom', factor: 1 });
    });
  });

  describe('pan', () => {
    it('in pan mode one pointer emits pan deltas and never strokes', () => {
      pan = true;
      g.down(touch(1, 10, 10));
      g.move(touch(1, 15, 8));
      g.move(touch(1, 20, 8));
      g.up(touch(1, 20, 8), false);
      time.advance(TOUCH_HOLD_MS * 2);
      expect(out).toEqual([
        { type: 'pan', dx: 5, dy: -2 },
        { type: 'pan', dx: 5, dy: 0 },
      ]);
    });

    it('pan mode works for mouse pointers too', () => {
      pan = true;
      g.down(mouse(1, 0, 0));
      g.move(mouse(1, 3, 4));
      expect(out).toEqual([{ type: 'pan', dx: 3, dy: 4 }]);
    });

    it('a pinch replaces the drag; the remaining finger does not resume panning', () => {
      pan = true;
      g.down(touch(1, 0, 0));
      g.down(touch(2, 100, 0));
      g.up(touch(2, 100, 0), false);
      out = [];
      g.move(touch(1, 10, 0));
      expect(out).toEqual([]);
    });
  });

  describe('dispose', () => {
    it('clears a pending touch without emitting', () => {
      g.down(touch(1, 0, 0));
      g.dispose();
      time.advance(TOUCH_HOLD_MS * 2);
      expect(out).toEqual([]);
      expect(time.pending()).toBe(0);
    });

    it('ends an active stroke', () => {
      g.down(mouse(1, 0, 0));
      g.dispose();
      expect(types()).toEqual(['strokeStart', 'strokeEnd']);
    });
  });

  it('onIntent returns an unsubscribe', () => {
    const seen: GestureIntent[] = [];
    const off = g.onIntent((i) => seen.push(i));
    off();
    g.down(mouse(1, 0, 0));
    expect(seen).toEqual([]);
    expect(out).toHaveLength(1);
  });
});
