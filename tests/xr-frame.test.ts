import { describe, expect, it } from 'vitest';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../src/types';
import {
  clampFrameScale,
  FRAME_SCALE_MAX,
  FRAME_SCALE_MIN,
  type FrameSource,
  frameDrawList,
  grabbedPosition,
} from '../src/xr/frame';

const makeSave = (placed: Uint8Array): PictureSave => {
  const n = PANEL_SIZE * PANEL_SIZE;
  const target = new Uint8Array(n);
  for (let i = 0; i < n; i++) target[i] = i % 3;
  return {
    schemaVersion: 2,
    id: 't1',
    createdAt: 1,
    updatedAt: 1,
    name: 't',
    sourceImageId: 'img',
    aspect: '1:1',
    width: PANEL_SIZE,
    height: PANEL_SIZE,
    palette: [
      { hex: '#101010', name: 'Dark' },
      { hex: '#eeeeee', name: 'Light' },
      { hex: '#3366cc', name: 'Blue' },
    ],
    paletteMode: 'lego',
    origin: 'photo',
    target,
    placed,
    panelElapsedMs: [0],
  };
};

const sourceOf = (save: PictureSave): FrameSource => ({
  cellAt: (x, y) => {
    const i = y * PANEL_SIZE + x;
    return { target: save.target[i], placed: save.placed[i] };
  },
});

const empty = (): Uint8Array => new Uint8Array(PANEL_SIZE * PANEL_SIZE).fill(EMPTY);

describe('frameDrawList', () => {
  it('lists placed dots with their symbol at full alpha', () => {
    const placed = empty();
    placed[0] = 2;
    placed[1] = 0;
    const list = frameDrawList(
      sourceOf(makeSave(placed)),
      makeSave(empty()).palette,
      ['A', 'B', 'C'],
      false,
    );
    expect(list).toContainEqual({ x: 0, y: 0, hex: '#3366cc', symbol: 'A', alpha: 1 });
    expect(list).toContainEqual({ x: 1, y: 0, hex: '#101010', symbol: 'B', alpha: 1 });
    expect(list).toHaveLength(2);
  });

  it('adds faint overlay entries for empty studs only when the overlay is on', () => {
    const placed = empty();
    placed[0] = 2;
    const palette = makeSave(empty()).palette;
    const off = frameDrawList(sourceOf(makeSave(placed)), palette, ['A', 'B', 'C'], false);
    const on = frameDrawList(sourceOf(makeSave(placed)), palette, ['A', 'B', 'C'], true);
    expect(off).toHaveLength(1);
    expect(on.length).toBe(PANEL_SIZE * PANEL_SIZE);
    const overlayCell = on.find((c) => c.x === 1 && c.y === 0);
    expect(overlayCell).toEqual({ x: 1, y: 0, hex: '#eeeeee', symbol: 'B', alpha: 0.45 });
  });
});

describe('clampFrameScale', () => {
  it('clamps to 0.4x-3x', () => {
    expect(clampFrameScale(0.1)).toBe(FRAME_SCALE_MIN);
    expect(clampFrameScale(5)).toBe(FRAME_SCALE_MAX);
    expect(clampFrameScale(1.7)).toBe(1.7);
  });
});

describe('grabbedPosition', () => {
  it('keeps the fixed grab offset', () => {
    expect(grabbedPosition({ x: 1, y: 2, z: 3 }, { x: -0.5, y: 0, z: 0.5 })).toEqual({
      x: 0.5,
      y: 2,
      z: 3.5,
    });
  });
});
