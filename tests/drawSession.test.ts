import { describe, expect, it } from 'vitest';
import { type DrawEvent, DrawSession, type GridCell, MAX_DRAW_HISTORY } from '../src/game';
import { EMPTY, MAX_COLORS, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';

function drawnSave(): PictureSave {
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
    placed: new Uint8Array(48 * 48).fill(EMPTY),
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

function stroke(s: DrawSession, cells: GridCell[], mode: 'paint' | 'erase' = 'paint'): void {
  s.beginStroke(mode);
  for (const c of cells) s.strokeAt(c.x, c.y);
  s.endStroke();
}

describe('DrawSession strokes', () => {
  it('paints the primary color and tracks usage', () => {
    const s = new DrawSession(drawnSave());
    expect(s.currentTool).toBe('brush');
    stroke(s, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(s.save.placed[0]).toBe(0);
    expect(s.usageCounts()).toEqual([2, 0]);
    expect(s.canUndo).toBe(true);
  });

  it('a stroke that changes nothing records no move', () => {
    const s = new DrawSession(drawnSave());
    s.beginStroke('paint');
    s.endStroke();
    expect(s.canUndo).toBe(false);
    stroke(s, [{ x: 0, y: 0 }]);
    stroke(s, [{ x: 0, y: 0 }]);
    s.undo();
    expect(s.save.placed[0]).toBe(EMPTY);
  });

  it('cancelStroke reverts without an undoable move', () => {
    const s = new DrawSession(drawnSave());
    s.beginStroke('paint');
    s.strokeAt(0, 0);
    s.cancelStroke();
    expect(s.save.placed[0]).toBe(EMPTY);
    expect(s.canUndo).toBe(false);
  });

  it('erase paints the background index, or EMPTY without one', () => {
    const withBg = drawnSave();
    withBg.drawBackground = '#ffffff';
    const s = new DrawSession(withBg);
    expect(s.eraseValue()).toBe(1);
    stroke(s, [{ x: 0, y: 0 }]);
    stroke(s, [{ x: 0, y: 0 }], 'erase');
    expect(s.save.placed[0]).toBe(1);
    const bare = new DrawSession(drawnSave());
    expect(bare.eraseValue()).toBe(EMPTY);
    stroke(bare, [{ x: 0, y: 0 }]);
    stroke(bare, [{ x: 0, y: 0 }], 'erase');
    expect(bare.save.placed[0]).toBe(EMPTY);
    expect(bare.usageCounts()).toEqual([0, 0]);
  });

  it('brush size and tip change the stamp', () => {
    const s = new DrawSession(drawnSave());
    s.setBrushSize(3);
    s.setBrushTip('square');
    stroke(s, [{ x: 5, y: 5 }]);
    expect(s.usageCounts()[0]).toBe(9);
    s.setBrushTip('round');
    stroke(s, [{ x: 20, y: 20 }]);
    expect(s.usageCounts()[0]).toBe(14);
  });

  it('undo/redo restores cells and respects depth 50', () => {
    const s = new DrawSession(drawnSave());
    for (let i = 0; i < MAX_DRAW_HISTORY + 10; i++) {
      stroke(s, [{ x: i % 48, y: Math.floor(i / 48) }]);
    }
    let undos = 0;
    while (s.undo()) undos++;
    expect(undos).toBe(MAX_DRAW_HISTORY);
    // 60 strokes against depth 50: the 10 oldest moves are dropped, so 10 dots remain.
    expect(s.usageCounts()[0]).toBe(10);
    expect(s.redo()).toBe(true);
    expect(s.usageCounts()[0]).toBe(11);
  });

  it('history navigation is disabled while a stroke is open', () => {
    const s = new DrawSession(drawnSave());
    stroke(s, [{ x: 0, y: 0 }]);
    s.beginStroke('paint');
    expect(s.canUndo).toBe(false);
    s.endStroke();
    expect(s.canUndo).toBe(true);
  });
});

describe('DrawSession shapes', () => {
  it('preview never mutates placed; commit does', () => {
    const s = new DrawSession(drawnSave());
    s.beginShape('rect', 2, 2);
    expect(s.updateShape(6, 6)).toHaveLength(25);
    expect(s.usageCounts()).toEqual([0, 0]);
    expect(s.shapeActive).toBe(true);
    expect(s.commitShape()).toBe(true);
    expect(s.usageCounts()[0]).toBe(25);
    expect(s.canUndo).toBe(true);
  });

  it('rect outline paints only the border', () => {
    const s = new DrawSession(drawnSave());
    s.setFilled(false);
    s.beginShape('rect', 0, 0);
    s.updateShape(3, 3);
    s.commitShape();
    expect(s.usageCounts()[0]).toBe(12);
  });

  it('the line tool snaps to 45-degree steps', () => {
    const s = new DrawSession(drawnSave());
    s.beginShape('line', 0, 0);
    s.updateShape(10, 1);
    s.commitShape();
    expect(s.save.placed[0]).toBe(0);
    expect(s.save.placed[10]).toBe(0);
    expect(s.save.placed[10 + 48]).toBe(EMPTY);
  });

  it('cancelShape leaves placed untouched', () => {
    const s = new DrawSession(drawnSave());
    s.beginShape('ellipse', 1, 1);
    s.updateShape(5, 5);
    s.cancelShape();
    expect(s.usageCounts()).toEqual([0, 0]);
    expect(s.canUndo).toBe(false);
  });

  it('polygons commit from tapped points', () => {
    const s = new DrawSession(drawnSave());
    s.beginShape('poly', 0, 0);
    s.addPolyPoint(4, 0);
    s.addPolyPoint(4, 4);
    s.addPolyPoint(0, 4);
    expect(s.commitShape()).toBe(true);
    expect(s.usageCounts()[0]).toBe(25);
    s.beginShape('poly', 10, 10);
    // A one-point polygon previews and commits as a single dot (previewCells, [...s.points]).
    expect(s.commitShape()).toBe(true);
    expect(s.shapeActive).toBe(false);
  });

  it('flood fills the equal-value region with the primary color', () => {
    const s = new DrawSession(drawnSave());
    s.setPrimary(1);
    stroke(s, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    s.setPrimary(0);
    expect(s.flood(0, 1)).toBe(true); // an EMPTY cell: floods every EMPTY cell
    expect(s.usageCounts()).toEqual([48 * 48 - 2, 2]);
    expect(s.flood(0, 1)).toBe(false);
    expect(s.flood(0, 0)).toBe(true); // the white pair floods to color 0
    expect(s.usageCounts()).toEqual([48 * 48, 0]);
  });

  it('pick returns the placed color or null', () => {
    const s = new DrawSession(drawnSave());
    expect(s.pick(3, 3)).toBeNull();
    stroke(s, [{ x: 3, y: 3 }]);
    expect(s.pick(3, 3)).toBe(0);
    expect(s.pick(-1, 0)).toBeNull();
  });
});

describe('DrawSession palette', () => {
  it('addColor caps at MAX_COLORS', () => {
    const s = new DrawSession(drawnSave());
    while (s.save.palette.length < MAX_COLORS) s.addColor({ hex: '#123456', name: 'X' });
    expect(() => s.addColor({ hex: '#654321', name: 'Y' })).toThrow(RangeError);
  });

  it('removeColor rejects out-of-range indices without touching state', () => {
    const s = new DrawSession(drawnSave());
    stroke(s, [{ x: 0, y: 0 }]);
    const placedBefore = s.save.placed.slice();
    const paletteBefore = [...s.save.palette];
    const usageBefore = s.usageCounts();
    expect(() => s.removeColor(-1)).toThrow(RangeError);
    expect(() => s.removeColor(2)).toThrow(RangeError);
    expect([...s.save.palette]).toEqual(paletteBefore);
    expect(s.usageCounts()).toEqual(usageBefore);
    expect(s.save.placed).toEqual(placedBefore);
  });

  it('removeColor rejects used colors and remaps unused ones', () => {
    const s = new DrawSession(drawnSave());
    s.setPrimary(1);
    stroke(s, [{ x: 0, y: 0 }]);
    s.addColor({ hex: '#123456', name: 'X' });
    expect(() => s.removeColor(1)).toThrow(RangeError);
    s.removeColor(0);
    expect(s.save.palette).toHaveLength(2);
    expect(s.save.placed[0]).toBe(0);
    expect(s.primary).toBe(0);
    s.undo();
    expect(s.save.placed[0]).toBe(1);
    expect(s.save.palette[0].hex).toBe('#05131d');
  });

  it('removing a color drops earlier history', () => {
    const s = new DrawSession(drawnSave());
    stroke(s, [{ x: 0, y: 0 }]);
    s.addColor({ hex: '#123456', name: 'X' });
    s.removeColor(2);
    s.undo();
    expect(s.save.palette).toHaveLength(3);
    expect(s.canUndo).toBe(false);
  });

  it('recolor swaps the entry and is undoable', () => {
    const s = new DrawSession(drawnSave());
    stroke(s, [{ x: 0, y: 0 }]);
    s.recolor(0, { hex: '#c91a09', name: 'Red' });
    expect(s.save.palette[0]).toEqual({ hex: '#c91a09', name: 'Red' });
    expect(s.usageCounts()).toEqual([1, 0]);
    s.undo();
    expect(s.save.palette[0].hex).toBe('#05131d');
    expect(s.save.placed[0]).toBe(0);
  });

  it('symmetry mirrors every draw operation', () => {
    const s = new DrawSession(drawnSave());
    s.setSymmetry('vertical');
    stroke(s, [{ x: 0, y: 10 }]);
    expect(s.save.placed[10 * 48]).toBe(0);
    expect(s.save.placed[10 * 48 + 47]).toBe(0);
    expect(s.usageCounts()[0]).toBe(2);
    s.setSymmetry('none');
    stroke(s, [{ x: 20, y: 20 }]);
    expect(s.usageCounts()[0]).toBe(3);
  });

  it('clearAll paints the erase value everywhere in one move', () => {
    const save = drawnSave();
    save.drawBackground = '#ffffff';
    const s = new DrawSession(save);
    stroke(s, [{ x: 0, y: 0 }]);
    expect(s.clearAll()).toBe(true);
    expect(s.usageCounts()).toEqual([0, 48 * 48]);
    expect(s.clearAll()).toBe(false);
    s.undo();
    // Undo fully reverts clearAll: the black stroke is back, everything else EMPTY.
    expect(s.usageCounts()).toEqual([1, 0]);
  });

  it('emits cells and palette events with usage', () => {
    const s = new DrawSession(drawnSave());
    const events: DrawEvent[] = [];
    const off = s.onChange((e) => events.push(e));
    stroke(s, [{ x: 0, y: 0 }]);
    s.addColor({ hex: '#123456', name: 'X' });
    s.recolor(0, { hex: '#c91a09', name: 'Red' });
    off();
    s.strokeAt(1, 1);
    expect(events.map((e) => e.type)).toEqual(['cells', 'palette', 'palette']);
    expect(events[0]).toMatchObject({
      cause: 'draw',
      changes: [{ x: 0, y: 0, before: EMPTY, after: 0 }],
    });
    expect(events[0].usage).toEqual([1, 0]);
  });
});
