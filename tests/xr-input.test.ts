import { describe, expect, it } from 'vitest';
import { createInputModel } from '../src/xr/input';

const cell = { x: 3, y: 4 };

const make = () => {
  const calls = {
    place: [] as Array<{ x: number; y: number }>,
    start: [] as Array<{ x: number; y: number } | null>,
    move: [] as Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>,
    end: 0,
    hover: [] as Array<{ x: number; y: number } | null>,
    exit: 0,
  };
  const model = createInputModel({
    onPlace: (c) => calls.place.push({ ...c }),
    onStrokeStart: (c) => calls.start.push(c && { ...c }),
    onStrokeMove: (f, t) => calls.move.push({ from: { ...f }, to: { ...t } }),
    onStrokeEnd: () => {
      calls.end += 1;
    },
    onHover: (c) => calls.hover.push(c && { ...c }),
    onExit: () => {
      calls.exit += 1;
    },
  });
  return { model, calls };
};

const pad = (trigger: boolean, a = false, b = false) => ({
  trigger,
  a,
  b,
  grip: false,
  stickX: 0,
  stickY: 0,
});

describe('createInputModel', () => {
  it('places one cell on a trigger tap without A', () => {
    const { model, calls } = make();
    model.update(cell, pad(false));
    model.update(cell, pad(true));
    model.update(cell, pad(false));
    expect(calls.place).toEqual([cell]);
    expect(calls.end).toBe(0);
  });

  it('opens a sweep stroke with A held and commits on release', () => {
    const { model, calls } = make();
    model.update(cell, pad(false));
    model.update(cell, pad(true, true));
    expect(calls.start).toEqual([cell]);
    model.update({ x: 5, y: 4 }, pad(true, true));
    model.update({ x: 7, y: 4 }, pad(true, true));
    expect(calls.move.map((m) => m.to)).toEqual([
      { x: 5, y: 4 },
      { x: 7, y: 4 },
    ]);
    model.update({ x: 7, y: 4 }, pad(false, true));
    expect(calls.end).toBe(1);
  });

  it('ends an open stroke when the controller disconnects', () => {
    const { model, calls } = make();
    model.update(cell, pad(true, true));
    model.update(cell, null);
    expect(calls.end).toBe(1);
  });

  it('fires exit on the B edge only', () => {
    const { model, calls } = make();
    model.update(cell, pad(false, false, true));
    model.update(cell, pad(false, false, true));
    expect(calls.exit).toBe(1);
  });

  it('hovers only when no stroke is open', () => {
    const { model, calls } = make();
    model.update(cell, pad(false));
    expect(calls.hover.at(-1)).toEqual(cell);
    model.update(cell, pad(true, true));
    expect(calls.hover.at(-1)).toBeNull();
  });
});
