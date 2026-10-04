import { describe, expect, it } from 'vitest';
import { PanelSession } from '../src/game';
import { EMPTY, type PictureSave } from '../src/types';
import { diffTray, trayCounts } from '../src/ui/trayModel';

/** Replay a diff onto `prev` the way the tray DOM does: remove, then insert before `before`. */
function apply(prev: number[], next: number[]): number[] {
  const d = diffTray(prev, next);
  const out = prev.filter((c) => !d.removed.includes(c));
  for (const { c, before } of d.added) {
    const at = before === null ? -1 : out.indexOf(before);
    if (at < 0) out.push(c);
    else out.splice(at, 0, c);
  }
  return out;
}

describe('diffTray', () => {
  it('is empty for identical orders', () => {
    expect(diffTray([0, 2, 5], [0, 2, 5])).toEqual({ removed: [], added: [] });
  });

  it('reports removed colors', () => {
    expect(diffTray([0, 2, 5], [0, 5])).toEqual({ removed: [2], added: [] });
  });

  it('inserts a returned color before the next color already in the tray', () => {
    expect(diffTray([0, 5], [0, 2, 5])).toEqual({ removed: [], added: [{ c: 2, before: 5 }] });
  });

  it('appends when no later color is in the tray', () => {
    expect(diffTray([0, 2], [0, 2, 7])).toEqual({ removed: [], added: [{ c: 7, before: null }] });
  });

  it('builds a tray from empty in order', () => {
    expect(diffTray([], [1, 3, 4])).toEqual({
      removed: [],
      added: [
        { c: 1, before: null },
        { c: 3, before: null },
        { c: 4, before: null },
      ],
    });
  });

  it('handles simultaneous removal and insertion', () => {
    expect(diffTray([1, 4, 6], [0, 4, 5])).toEqual({
      removed: [1, 6],
      added: [
        { c: 0, before: 4 },
        { c: 5, before: null },
      ],
    });
  });

  it('replaying any diff reproduces the next order', () => {
    const orders = [[], [0], [0, 1, 2, 3, 4], [1, 3], [0, 2, 4], [4], [2, 3], [0, 1, 4]];
    for (const a of orders) for (const b of orders) expect(apply(a, b)).toEqual(b);
  });
});

function makeSave(colors = 3): PictureSave {
  const width = 48;
  const height = 48;
  const target = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) target[y * width + x] = (x + y) % colors;
  return {
    schemaVersion: 1,
    id: 't',
    createdAt: 0,
    updatedAt: 0,
    name: 'test',
    sourceImageId: 'library:test',
    aspect: '1:1',
    paletteMode: 'free',
    origin: 'photo',
    palette: Array.from({ length: colors }, (_, i) => ({ hex: '#000000', name: `c${i}` })),
    width,
    height,
    target,
    placed: new Uint8Array(width * height).fill(EMPTY),
    panelElapsedMs: new Array(9).fill(0),
  };
}

describe('trayCounts', () => {
  it('counts studs still needed per tray color', () => {
    const s = new PanelSession(makeSave(3), 0);
    const counts = trayCounts(s);
    expect([...counts.keys()]).toEqual([0, 1, 2]);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(256);
    expect(counts.get(0)).toBe(86);
    expect(counts.get(1)).toBe(85);
    expect(counts.get(2)).toBe(85);
  });

  it('drops a finished color and counts a wrong dot against the color placed', () => {
    const save = makeSave(3);
    const s = new PanelSession(save, 0);
    s.beginStroke('paint', 0);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) if ((x + y) % 3 === 0) s.applyAt(x, y);
    s.endStroke();
    expect(trayCounts(s).has(0)).toBe(false);
    s.beginStroke('paint', 2);
    s.applyAt(1, 0);
    s.endStroke();
    expect(trayCounts(s).get(1)).toBe(85);
    expect(trayCounts(s).get(2)).toBe(84);
  });

  it('works against a structural session', () => {
    const counts = trayCounts({ trayColors: () => [2, 5], availableFor: (c) => c * 10 });
    expect([...counts]).toEqual([
      [2, 20],
      [5, 50],
    ]);
  });
});
