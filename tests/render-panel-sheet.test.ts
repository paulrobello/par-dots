// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';

import { panelColorCounts } from '../src/game';
import { renderPanelSheet } from '../src/render/panelSheet';
import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';

// happy-dom has no 2D context; record fillRect/fillText calls instead of pixels.
const rects: Array<{ x: number; y: number; w: number; h: number; fill: string }> = [];
const texts: string[] = [];
const ctxFake = {
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  font: '',
  textAlign: 'left',
  textBaseline: 'middle',
  globalAlpha: 1,
  fillRect(x: number, y: number, w: number, h: number): void {
    rects.push({ x, y, w, h, fill: String(ctxFake.fillStyle) });
  },
  strokeRect: () => undefined,
  fillText(text: string): void {
    texts.push(text);
  },
  measureText: () => ({ width: 0 }),
  beginPath: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  stroke: () => undefined,
} as unknown as CanvasRenderingContext2D;
HTMLCanvasElement.prototype.getContext = (() =>
  ctxFake) as unknown as typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  rects.length = 0;
  texts.length = 0;
});

// With cellPx 40 the grid starts at gx=60, gy=120 and each cell is 40x40.
const GX = 60;
const GY = 120;
const C = 40;

function drawnSave(): PictureSave {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: 'd1',
    createdAt: 1,
    updatedAt: 1,
    name: 'doodle',
    sourceImageId: '',
    aspect: '1:1',
    paletteMode: 'lego',
    origin: 'drawn',
    palette: [
      { hex: '#05131d', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
    ],
    width: 16,
    height: 16,
    target: new Uint8Array(16 * 16).fill(EMPTY),
    placed: new Uint8Array(16 * 16).fill(EMPTY),
    panelElapsedMs: [0],
  };
}

describe('renderPanelSheet for drawn saves', () => {
  it('renders placed dots with their color and symbol where the target is EMPTY', () => {
    const save = drawnSave();
    save.placed[0] = 1; // White at (0, 0)
    save.placed[5] = 0; // Black at (5, 0)
    const canvas = renderPanelSheet(
      save,
      0,
      ['Black', 'White'],
      ['B', 'W'],
      panelColorCounts(save, 0),
    );
    expect(canvas.width).toBeGreaterThan(0);

    const whiteCell = rects.find((r) => r.fill === '#ffffff');
    expect(whiteCell).toEqual({ x: GX, y: GY, w: C, h: C, fill: '#ffffff' });
    const blackCell = rects.find((r) => r.fill === '#05131d');
    expect(blackCell).toEqual({ x: GX + 5 * C, y: GY, w: C, h: C, fill: '#05131d' });
    expect(texts).toContain('W');
    expect(texts).toContain('B');
    expect(texts).toContain('Panel 1 of 9');
  });
});
