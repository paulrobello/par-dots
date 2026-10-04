// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DrawBoard } from '../src/render/drawBoard';
import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';

// happy-dom has no 2D context; a recording proxy keeps constructor/draw calls harmless.
const ctxStub = new Proxy(
  {},
  {
    get: () => () => ctxStub,
    set: () => true,
  },
) as unknown as CanvasRenderingContext2D;

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

describe('DrawBoard', () => {
  it('constructs, tracks state, and destroys safely before any layout', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = (() => ctxStub) as unknown as typeof canvas.getContext;
    const board = new DrawBoard(canvas);
    const save = drawnSave();
    board.setData(save, 0);
    expect(board.hitTest(0, 0)).toBeNull(); // no layout until resize()
    board.setViewport(2, -10, -10);
    expect(board.getViewport().scale).toBe(2);
    board.setPreview([
      { x: 0, y: 0 },
      { x: 99, y: 99 },
    ]);
    expect(() => board.drawCells([{ x: 0, y: 0 }])).not.toThrow(); // cell size 0: no-op
    expect(() => board.draw()).not.toThrow();
    expect(() => board.destroy()).not.toThrow();
  });

  it('oneToOneScale never drops below fit', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = (() => ctxStub) as unknown as typeof canvas.getContext;
    const board = new DrawBoard(canvas);
    board.setData(drawnSave(), 0);
    expect(board.oneToOneScale()).toBeGreaterThanOrEqual(1);
  });
});
