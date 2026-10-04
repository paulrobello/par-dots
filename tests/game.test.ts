import { describe, expect, it } from 'vitest';
import {
  aspectOf,
  colorCounts,
  effectiveCells,
  MAX_HISTORY,
  nextUnfinishedPanel,
  overallProgress,
  type PanelEvent,
  PanelSession,
  panelColorCounts,
  panelComplete,
  panelCount,
  panelCountOf,
  panelFractions,
  panelGridOf,
  panelIndexOf,
  panelOrigin,
  panelOriginOf,
  panelProgress,
  pictureComplete,
  placedCount,
  studDims,
  studIndex,
} from '../src/game';
import { fitGrid, IDENTITY_VIEWPORT, screenToCell } from '../src/render/layout';
import {
  type Aspect,
  EMPTY,
  LAYOUT,
  PANEL_SIZE,
  type PictureSave,
  SAVE_SCHEMA_VERSION,
} from '../src/types';

/** Target color = (x + y) % colors, so every panel uses all colors. */
function makeSave(aspect: Aspect = '1:1', colors = 3): PictureSave {
  const { cols, rows } = LAYOUT[aspect];
  const width = cols * 16;
  const height = rows * 16;
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
    aspect,
    paletteMode: 'free',
    origin: 'photo',
    palette: Array.from({ length: colors }, (_, i) => ({ hex: '#000000', name: `c${i}` })),
    width,
    height,
    target,
    placed: new Uint8Array(width * height).fill(EMPTY),
    panelElapsedMs: new Array(cols * rows).fill(0),
  };
}

/** Fill a panel correctly except the listed local cells. */
function fillPanel(save: PictureSave, panel: number, skip: Array<[number, number]> = []): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (skip.some(([sx, sy]) => sx === x && sy === y)) continue;
      const i = studIndex(save, panel, x, y);
      save.placed[i] = save.target[i];
    }
  }
}

function paint(s: PanelSession, color: number, cells: Array<[number, number]>): boolean[] {
  s.beginStroke('paint', color);
  const r = cells.map(([x, y]) => s.applyAt(x, y));
  s.endStroke();
  return r;
}

function remove(s: PanelSession, cells: Array<[number, number]>): boolean[] {
  s.beginStroke('remove');
  const r = cells.map(([x, y]) => s.applyAt(x, y));
  s.endStroke();
  return r;
}

describe('geometry', () => {
  it('computes panel counts and origins per aspect', () => {
    expect(panelCount(makeSave('1:1'))).toBe(9);
    expect(panelCount(makeSave('3:4'))).toBe(12);
    expect(panelCount(makeSave('4:3'))).toBe(12);
    const land = makeSave('4:3');
    expect(panelOrigin(land, 0)).toEqual({ x: 0, y: 0 });
    expect(panelOrigin(land, 3)).toEqual({ x: 48, y: 0 });
    expect(panelOrigin(land, 4)).toEqual({ x: 0, y: 16 });
    expect(panelOrigin(land, 11)).toEqual({ x: 48, y: 32 });
    const port = makeSave('3:4');
    expect(panelOrigin(port, 11)).toEqual({ x: 32, y: 48 });
    expect(studIndex(port, 4, 2, 3)).toBe((16 + 3) * 48 + 16 + 2);
  });

  it('rejects out-of-range panels', () => {
    expect(() => panelOrigin(makeSave('1:1'), 9)).toThrow(RangeError);
    expect(() => panelOrigin(makeSave('1:1'), -1)).toThrow(RangeError);
    expect(() => new PanelSession(makeSave('1:1'), 9)).toThrow(RangeError);
  });
});

describe('PanelSession painting', () => {
  it('paints empty studs into save.placed at the panel offset', () => {
    const save = makeSave('4:3');
    const s = new PanelSession(save, 5);
    expect(paint(s, 1, [[2, 3]])).toEqual([true]);
    expect(save.placed[studIndex(save, 5, 2, 3)]).toBe(1);
    expect(s.cellAt(2, 3)).toEqual({ target: (16 + 2 + 16 + 3) % 3, placed: 1 });
    expect(save.placed[studIndex(save, 0, 2, 3)]).toBe(EMPTY);
  });

  it('ignores occupied studs, out-of-bounds, and calls without a stroke', () => {
    const save = makeSave();
    const s = new PanelSession(save, 0);
    expect(s.applyAt(0, 0)).toBe(false);
    s.beginStroke('paint', 0);
    expect(s.applyAt(0, 0)).toBe(true);
    s.endStroke();
    s.beginStroke('paint', 2);
    expect(s.applyAt(0, 0)).toBe(false);
    expect(s.applyAt(16, 0)).toBe(false);
    expect(s.applyAt(-1, 0)).toBe(false);
    expect(s.applyAt(0.5, 0)).toBe(false);
    s.endStroke();
    expect(s.cellAt(0, 0).placed).toBe(0);
  });

  it('allows incorrect colors and reports them as wrong', () => {
    const save = makeSave();
    const s = new PanelSession(save, 0);
    paint(s, 1, [
      [0, 0],
      [1, 0],
    ]);
    expect(s.wrongCells()).toEqual([{ x: 0, y: 0 }]);
    expect(s.progress()).toEqual({ correct: 1, total: 256 });
  });

  it('removes any dot in remove mode, and ignores empty studs', () => {
    const save = makeSave();
    const s = new PanelSession(save, 0);
    paint(s, 1, [
      [0, 0],
      [1, 0],
    ]);
    expect(
      remove(s, [
        [0, 0],
        [1, 0],
        [5, 5],
      ]),
    ).toEqual([true, true, false]);
    expect(s.cellAt(0, 0).placed).toBe(EMPTY);
    expect(s.wrongCells()).toEqual([]);
    expect(s.progress().correct).toBe(0);
  });

  it('validates paint colors', () => {
    const s = new PanelSession(makeSave(), 0);
    expect(() => s.beginStroke('paint')).toThrow(RangeError);
    expect(() => s.beginStroke('paint', 3)).toThrow(RangeError);
    expect(() => s.beginStroke('paint', -1)).toThrow(RangeError);
    expect(() => s.cellAt(16, 0)).toThrow(RangeError);
  });

  it('reads existing progress from the save at construction', () => {
    const save = makeSave();
    fillPanel(save, 2, [[0, 0]]);
    const s = new PanelSession(save, 2);
    expect(s.progress()).toEqual({ correct: 255, total: 256 });
    const t = save.target[studIndex(save, 2, 0, 0)];
    expect(s.trayColors()).toEqual([t]);
  });
});

describe('PanelSession undo/redo', () => {
  it('cancelStroke reverts the open stroke without recording a move', () => {
    const save = makeSave();
    const s = new PanelSession(save, 0);
    const trayBefore = s.trayColors();
    const events: PanelEvent[] = [];
    s.onChange((e) => events.push(e));
    s.beginStroke('paint', 0);
    s.applyAt(0, 0);
    s.applyAt(1, 0);
    s.cancelStroke();
    expect(s.strokeActive).toBe(false);
    expect(s.cellAt(0, 0).placed).toBe(EMPTY);
    expect(s.cellAt(1, 0).placed).toBe(EMPTY);
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.trayColors()).toEqual(trayBefore);
    expect(s.progress().correct).toBe(0);
    expect(events.filter((e) => e.type === 'removed')).toHaveLength(2);
    s.cancelStroke();
  });

  it('treats one stroke as one move', () => {
    const save = makeSave();
    const s = new PanelSession(save, 0);
    paint(s, 0, [
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(s.canUndo).toBe(true);
    expect(s.undo()).toBe(true);
    expect(s.cellAt(0, 0).placed).toBe(EMPTY);
    expect(s.cellAt(2, 2).placed).toBe(EMPTY);
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(true);
    expect(s.redo()).toBe(true);
    expect(s.cellAt(1, 1).placed).toBe(0);
    expect(s.progress().correct).toBe(1);
    expect(s.canRedo).toBe(false);
  });

  it('does not record empty strokes', () => {
    const s = new PanelSession(makeSave(), 0);
    s.beginStroke('remove');
    s.applyAt(0, 0);
    s.endStroke();
    s.beginStroke('paint', 0);
    s.endStroke();
    expect(s.canUndo).toBe(false);
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(false);
  });

  it('empty stroke does not clear redo', () => {
    const s = new PanelSession(makeSave(), 0);
    paint(s, 0, [[0, 0]]);
    s.undo();
    s.beginStroke('paint', 0);
    s.endStroke();
    expect(s.canRedo).toBe(true);
  });

  it('a new move clears redo', () => {
    const s = new PanelSession(makeSave(), 0);
    paint(s, 0, [[0, 0]]);
    s.undo();
    paint(s, 1, [[3, 3]]);
    expect(s.canRedo).toBe(false);
    expect(s.redo()).toBe(false);
  });

  it('keeps at most MAX_HISTORY moves', () => {
    const save = makeSave();
    const s = new PanelSession(save, 0);
    for (let i = 0; i < MAX_HISTORY + 2; i++) paint(s, 0, [[i, 0]]);
    let undos = 0;
    while (s.undo()) undos++;
    expect(undos).toBe(MAX_HISTORY);
    expect(s.cellAt(0, 0).placed).toBe(0);
    expect(s.cellAt(1, 0).placed).toBe(0);
    expect(s.cellAt(2, 0).placed).toBe(EMPTY);
  });

  it('undoes remove strokes restoring previous colors', () => {
    const s = new PanelSession(makeSave(), 0);
    paint(s, 1, [
      [0, 0],
      [1, 0],
    ]);
    remove(s, [
      [0, 0],
      [1, 0],
    ]);
    s.undo();
    expect(s.cellAt(0, 0).placed).toBe(1);
    expect(s.cellAt(1, 0).placed).toBe(1);
  });

  it('history is per session (per panel)', () => {
    const save = makeSave();
    const a = new PanelSession(save, 0);
    paint(a, 0, [[0, 0]]);
    const b = new PanelSession(save, 1);
    expect(b.canUndo).toBe(false);
  });

  it('disables undo while a stroke is open', () => {
    const s = new PanelSession(makeSave(), 0);
    paint(s, 0, [[0, 0]]);
    s.beginStroke('paint', 0);
    expect(s.strokeActive).toBe(true);
    expect(s.canUndo).toBe(false);
    s.endStroke();
    expect(s.canUndo).toBe(true);
  });
});

describe('PanelSession tray', () => {
  it('lists needed colors in palette order and depletes/returns them', () => {
    const save = makeSave('1:1', 3);
    fillPanel(save, 0, [
      [0, 0],
      [1, 0],
    ]);
    // targets: (0,0)=0, (1,0)=1
    const s = new PanelSession(save, 0);
    expect(s.trayColors()).toEqual([0, 1]);
    paint(s, 0, [[0, 0]]);
    expect(s.trayColors()).toEqual([1]);
    remove(s, [[0, 0]]);
    expect(s.trayColors()).toEqual([0, 1]);
    s.undo();
    expect(s.trayColors()).toEqual([1]);
    s.redo();
    expect(s.trayColors()).toEqual([0, 1]);
  });

  it('a wrong dot on a color C stud keeps C in the tray', () => {
    const save = makeSave('1:1', 3);
    fillPanel(save, 0, [[0, 0]]);
    const s = new PanelSession(save, 0);
    paint(s, 2, [[0, 0]]);
    expect(s.trayColors()).toEqual([0]);
    expect(s.isComplete()).toBe(false);
  });

  it('never includes palette colors absent from the panel', () => {
    const save = makeSave('1:1', 4);
    save.palette.push({ hex: '#ffffff', name: 'unused' });
    const s = new PanelSession(save, 0);
    expect(s.trayColors()).toEqual([0, 1, 2, 3]);
  });
});

describe('PanelSession events', () => {
  it('emits placed/removed/colorDone/colorReturned/complete', () => {
    const save = makeSave('1:1', 3);
    fillPanel(save, 4, [
      [0, 0],
      [1, 0],
    ]);
    const s = new PanelSession(save, 4);
    const t0 = s.cellAt(0, 0).target;
    const t1 = s.cellAt(1, 0).target;
    const events: PanelEvent[] = [];
    const off = s.onChange((e) => events.push(e));

    paint(s, t0, [[0, 0]]);
    expect(events).toEqual([
      { type: 'placed', x: 0, y: 0, colorIndex: t0, correct: true, cause: 'stroke' },
      { type: 'colorDone', colorIndex: t0 },
    ]);

    events.length = 0;
    remove(s, [[0, 0]]);
    expect(events).toEqual([
      { type: 'removed', x: 0, y: 0, colorIndex: t0, cause: 'stroke' },
      { type: 'colorReturned', colorIndex: t0 },
    ]);

    events.length = 0;
    paint(s, t0, [[0, 0]]);
    paint(s, t1, [[1, 0]]);
    expect(events.map((e) => e.type)).toEqual([
      'placed',
      'colorDone',
      'placed',
      'colorDone',
      'complete',
    ]);
    expect(s.isComplete()).toBe(true);

    events.length = 0;
    off();
    s.beginStroke('remove');
    expect(s.applyAt(0, 0)).toBe(false);
    s.endStroke();
    expect(events).toEqual([]);
  });

  it('marks wrong placements with correct: false and emits no colorDone', () => {
    const s = new PanelSession(makeSave(), 0);
    const events: PanelEvent[] = [];
    s.onChange((e) => events.push(e));
    paint(s, 1, [[0, 0]]);
    expect(events).toEqual([
      { type: 'placed', x: 0, y: 0, colorIndex: 1, correct: false, cause: 'stroke' },
    ]);
  });

  it('tags undo/redo events with their cause', () => {
    const s = new PanelSession(makeSave(), 0);
    paint(s, 0, [[0, 0]]);
    const events: PanelEvent[] = [];
    s.onChange((e) => events.push(e));
    s.undo();
    s.redo();
    expect(events).toContainEqual({
      type: 'removed',
      x: 0,
      y: 0,
      colorIndex: 0,
      cause: 'undo',
    });
    expect(events).toContainEqual({
      type: 'placed',
      x: 0,
      y: 0,
      colorIndex: 0,
      correct: true,
      cause: 'redo',
    });
  });
});

describe('PanelSession completion lock', () => {
  it('locks strokes and history once complete', () => {
    const save = makeSave();
    fillPanel(save, 0, [[0, 0]]);
    const s = new PanelSession(save, 0);
    paint(s, s.cellAt(0, 0).target, [[0, 0]]);
    expect(s.isComplete()).toBe(true);
    expect(s.canUndo).toBe(false);
    expect(s.undo()).toBe(false);
    expect(s.trayColors()).toEqual([]);
    expect(remove(s, [[3, 3]])).toEqual([false]);
    expect(s.progress()).toEqual({ correct: 256, total: 256 });
  });

  it('a panel already complete at construction is complete', () => {
    const save = makeSave();
    fillPanel(save, 8);
    expect(new PanelSession(save, 8).isComplete()).toBe(true);
  });
});

describe('progress helpers', () => {
  it('computes overall and panel progress', () => {
    const save = makeSave('3:4');
    expect(overallProgress(save)).toEqual({ correct: 0, total: 48 * 64, percent: 0 });
    fillPanel(save, 7);
    expect(panelProgress(save, 7)).toEqual({ correct: 256, total: 256, percent: 100 });
    expect(panelComplete(save, 7)).toBe(true);
    expect(panelComplete(save, 6)).toBe(false);
    expect(overallProgress(save)).toEqual({ correct: 256, total: 3072, percent: 8.3 });
  });

  it('does not count wrong dots', () => {
    const save = makeSave();
    const i = studIndex(save, 0, 0, 0);
    save.placed[i] = (save.target[i] + 1) % 3;
    expect(panelProgress(save, 0).correct).toBe(0);
    expect(overallProgress(save).correct).toBe(0);
  });

  it('detects picture completion', () => {
    const save = makeSave('4:3');
    for (let p = 0; p < 11; p++) fillPanel(save, p);
    expect(pictureComplete(save)).toBe(false);
    fillPanel(save, 11);
    expect(pictureComplete(save)).toBe(true);
    expect(overallProgress(save).percent).toBe(100);
  });

  it('nextUnfinishedPanel wraps past the last panel', () => {
    const save = makeSave('4:3');
    expect(nextUnfinishedPanel(save, 11)).toBe(0);
    expect(nextUnfinishedPanel(save, 3)).toBe(4);
  });

  it('nextUnfinishedPanel skips complete panels', () => {
    const save = makeSave('4:3');
    fillPanel(save, 4);
    fillPanel(save, 5);
    expect(nextUnfinishedPanel(save, 3)).toBe(6);
    fillPanel(save, 11);
    fillPanel(save, 0);
    expect(nextUnfinishedPanel(save, 10)).toBe(1);
  });

  it('nextUnfinishedPanel is null when every panel is complete', () => {
    const save = makeSave('4:3');
    for (let p = 0; p < 12; p++) fillPanel(save, p);
    expect(nextUnfinishedPanel(save, 5)).toBeNull();
  });

  it('nextUnfinishedPanel returns from when only it is incomplete', () => {
    const save = makeSave('4:3');
    for (let p = 0; p < 12; p++) if (p !== 7) fillPanel(save, p);
    expect(nextUnfinishedPanel(save, 7)).toBe(7);
  });

  it('agrees with PanelSession.progress', () => {
    const save = makeSave();
    const s = new PanelSession(save, 3);
    paint(s, 0, [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(panelProgress(save, 3).correct).toBe(s.progress().correct);
  });
});

describe('color counts', () => {
  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

  it('colorCounts sums to width*height', () => {
    const save = makeSave('3:4', 5);
    const counts = colorCounts(save);
    expect(counts).toHaveLength(5);
    expect(sum(counts)).toBe(save.width * save.height);
  });

  it('panelColorCounts over all panels equals colorCounts', () => {
    const save = makeSave('4:3', 4);
    const total = new Array<number>(4).fill(0);
    for (let p = 0; p < panelCount(save); p++) {
      panelColorCounts(save, p).forEach((n, c) => {
        total[c] += n;
      });
    }
    expect(total).toEqual(colorCounts(save));
  });

  it('panelColorCounts for one panel sums to 256', () => {
    const save = makeSave('1:1', 3);
    expect(sum(panelColorCounts(save, 4))).toBe(PANEL_SIZE * PANEL_SIZE);
  });
});

describe('aspect-keyed panel geometry', () => {
  const ASPECTS = Object.keys(LAYOUT) as Aspect[];

  it('counts panels and stud dims per aspect', () => {
    expect(panelCountOf('1:1')).toBe(9);
    expect(panelCountOf('3:4')).toBe(12);
    expect(panelCountOf('4:3')).toBe(12);
    expect(studDims('1:1')).toEqual({ width: 48, height: 48 });
    expect(studDims('3:4')).toEqual({ width: 48, height: 64 });
    expect(studDims('4:3')).toEqual({ width: 64, height: 48 });
  });

  it('maps stud dims back to their aspect', () => {
    for (const aspect of ASPECTS) {
      const { width, height } = studDims(aspect);
      expect(aspectOf(width, height)).toBe(aspect);
    }
    expect(() => aspectOf(50, 48)).toThrow(RangeError);
  });

  for (const aspect of ASPECTS) {
    it(`${aspect}: origin and index are inverse and tile the picture`, () => {
      const { width, height } = studDims(aspect);
      const counts = new Array(panelCountOf(aspect)).fill(0);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = panelIndexOf(aspect, x, y);
          counts[p]++;
          const o = panelOriginOf(aspect, p);
          expect(x - o.x).toBeGreaterThanOrEqual(0);
          expect(x - o.x).toBeLessThan(PANEL_SIZE);
          expect(y - o.y).toBeGreaterThanOrEqual(0);
          expect(y - o.y).toBeLessThan(PANEL_SIZE);
        }
      }
      for (const c of counts) expect(c).toBe(PANEL_SIZE * PANEL_SIZE);
      for (let p = 0; p < panelCountOf(aspect); p++) {
        const o = panelOriginOf(aspect, p);
        expect(panelIndexOf(aspect, o.x, o.y)).toBe(p);
      }
      expect(panelIndexOf(aspect, -1, 0)).toBe(-1);
      expect(panelIndexOf(aspect, width, 0)).toBe(-1);
      expect(panelIndexOf(aspect, 0, height)).toBe(-1);
      expect(() => panelOriginOf(aspect, panelCountOf(aspect))).toThrow(RangeError);
    });
  }

  it('panels are numbered row-major', () => {
    expect(panelOriginOf('4:3', 5)).toEqual({ x: 16, y: 16 });
    expect(panelOriginOf('3:4', 11)).toEqual({ x: 32, y: 48 });
  });

  it('indexes panels row-major for every layout', () => {
    for (const aspect of ASPECTS) {
      const { cols, rows } = LAYOUT[aspect];
      expect(panelGridOf(aspect)).toEqual({ cols, rows });
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          expect(panelIndexOf(aspect, c * 16, r * 16)).toBe(r * cols + c);
          expect(panelIndexOf(aspect, c * 16 + 15, r * 16 + 15)).toBe(r * cols + c);
        }
      }
    }
  });

  it('hit-tests overview panels via the layout transform', () => {
    for (const aspect of ASPECTS) {
      const { cols, rows } = LAYOUT[aspect];
      const w = cols * 16;
      const h = rows * 16;
      const L = fitGrid(360, 480, w, h, 0.6);
      for (let p = 0; p < cols * rows; p++) {
        const sx = L.originX + ((p % cols) * 16 + 8) * L.cell;
        const sy = L.originY + (Math.floor(p / cols) * 16 + 8) * L.cell;
        const cell = screenToCell(L, IDENTITY_VIEWPORT, sx, sy);
        expect(cell).not.toBeNull();
        if (cell) expect(panelIndexOf(aspect, cell.x, cell.y)).toBe(p);
      }
      expect(screenToCell(L, IDENTITY_VIEWPORT, L.originX - 1, L.originY)).toBeNull();
    }
  });

  it('computes per-panel completion', () => {
    const w = 48;
    const h = 48;
    const target = new Uint8Array(w * h).fill(2);
    const placed = new Uint8Array(w * h).fill(EMPTY);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) placed[y * w + x] = 2;
    placed[16] = 2; // one correct stud in panel 1
    placed[17] = 3; // a wrong stud does not count
    const c = panelFractions('1:1', w, target, placed);
    expect(c).toHaveLength(9);
    expect(c[0]).toBe(1);
    expect(c[1]).toBeCloseTo(1 / 256);
    expect(c[8]).toBe(0);
  });
});

describe('PanelSession remainingFor/emptyCount', () => {
  /** Deterministic LCG so failures reproduce. */
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  function recount(
    s: PanelSession,
    colors: number,
  ): { remaining: number[]; available: number[]; empty: number } {
    const remaining = new Array<number>(colors).fill(0);
    const available = new Array<number>(colors).fill(0);
    let empty = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const cell = s.cellAt(x, y);
        available[cell.target]++;
        if (cell.placed === EMPTY) empty++;
        else available[cell.placed]--;
        if (cell.placed !== cell.target) remaining[cell.target]++;
      }
    }
    return { remaining, available, empty };
  }

  function expectMatches(s: PanelSession, colors: number): void {
    const want = recount(s, colors);
    expect(s.emptyCount()).toBe(want.empty);
    for (let c = 0; c < colors; c++) {
      expect(s.remainingFor(c)).toBe(want.remaining[c]);
      expect(s.availableFor(c)).toBe(want.available[c]);
      expect(s.availableFor(c)).toBeGreaterThanOrEqual(0);
    }
  }

  it('starts in agreement with a partially filled panel', () => {
    const save = makeSave('1:1', 4);
    fillPanel(save, 0, [
      [0, 0],
      [3, 5],
      [15, 15],
    ]);
    const wrong = studIndex(save, 0, 1, 0);
    save.placed[wrong] = (save.target[wrong] + 1) % 4;
    const s = new PanelSession(save, 0);
    expectMatches(s, 4);
    expect(s.emptyCount()).toBe(3);
    expect(s.remainingFor(99)).toBe(0);
  });

  it('matches a brute-force recount after random strokes, cancel, undo and redo', () => {
    const colors = 4;
    for (const seed of [1, 42, 1234]) {
      const save = makeSave('4:3', colors);
      const s = new PanelSession(save, 5);
      const r = rng(seed);
      const pick = (n: number): number => Math.floor(r() * n);
      expectMatches(s, colors);
      for (let step = 0; step < 400; step++) {
        const op = pick(10);
        if (op < 6) {
          const mode = pick(3) === 0 ? 'remove' : 'paint';
          s.beginStroke(mode, mode === 'paint' ? pick(colors) : undefined);
          const n = 1 + pick(12);
          for (let k = 0; k < n; k++) s.applyAt(pick(16), pick(16));
          if (pick(5) === 0) s.cancelStroke();
          else s.endStroke();
        } else if (op < 8) {
          s.undo();
        } else {
          s.redo();
        }
        expectMatches(s, colors);
        if (s.isComplete()) break;
      }
    }
  });
});

describe('PanelSession dot supply', () => {
  it('refuses to paint a color once all its dots are placed, even with some misplaced', () => {
    const save = makeSave('1:1', 3);
    const s = new PanelSession(save, 0);
    const c = save.target[studIndex(save, 0, 0, 0)];
    const supply = s.availableFor(c);
    const empties: Array<[number, number]> = [];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) if (s.cellAt(x, y).target !== c) empties.push([x, y]);
    s.beginStroke('paint', c);
    for (let k = 0; k < supply; k++) expect(s.applyAt(empties[k][0], empties[k][1])).toBe(true);
    expect(s.availableFor(c)).toBe(0);
    expect(s.applyAt(0, 0)).toBe(false);
    s.endStroke();
    expect(s.trayColors()).toContain(c);
    expect(s.remainingFor(c)).toBe(supply);
    s.beginStroke('remove');
    s.applyAt(empties[0][0], empties[0][1]);
    s.endStroke();
    expect(s.availableFor(c)).toBe(1);
    s.beginStroke('paint', c);
    expect(s.applyAt(0, 0)).toBe(true);
    s.endStroke();
  });
});

function drawnSaveFixture(): PictureSave {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: 'd1',
    createdAt: 1,
    updatedAt: 1,
    name: 'd',
    sourceImageId: '',
    aspect: '1:1',
    paletteMode: 'lego',
    origin: 'drawn',
    palette: [
      { hex: '#05131d', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
    ],
    width: 48,
    height: 48,
    target: new Uint8Array(48 * 48).fill(EMPTY),
    placed: new Uint8Array(48 * 48),
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

describe('effectiveCells (drawn saves)', () => {
  it('counts placed dots for a drawn save and skips EMPTY', () => {
    const save = drawnSaveFixture();
    save.placed[0] = 1;
    save.placed[1] = 1;
    expect(colorCounts(save)).toEqual([2302, 2]);
    expect(effectiveCells(save)).toBe(save.placed);
  });

  it('counts target for a photo save', () => {
    const save = drawnSaveFixture();
    save.origin = 'photo';
    save.target.fill(0); // a photo save's target is quantized: EMPTY never appears
    save.target[0] = 1;
    expect(colorCounts(save)).toEqual([2303, 1]);
  });

  it('panelColorCounts reads placed dots for drawn saves', () => {
    const save = drawnSaveFixture();
    save.placed[0] = 1;
    expect(panelColorCounts(save, 0)).toEqual([255, 1]);
  });
});

describe('placedCount', () => {
  it('counts non-empty placed cells', () => {
    const save = makeSave();
    expect(placedCount(save)).toBe(0);
    save.placed[0] = 1;
    save.placed[5] = 2;
    expect(placedCount(save)).toBe(2);
  });
});
