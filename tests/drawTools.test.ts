import { describe, expect, it } from 'vitest';
import {
  brushCells,
  ellipseCells,
  floodCells,
  lineCells,
  polygonCells,
  rectCells,
  snapLine,
} from '../src/game/drawTools';

describe('brushCells', () => {
  it('stamps square and round tips', () => {
    expect(brushCells(3, 3, 1, 'round')).toEqual([{ x: 3, y: 3 }]);
    expect(brushCells(3, 3, 3, 'square')).toHaveLength(9);
    const plus = brushCells(3, 3, 3, 'round');
    expect(plus).toHaveLength(5);
    expect(plus).toEqual(
      expect.arrayContaining([
        { x: 3, y: 3 },
        { x: 2, y: 3 },
        { x: 4, y: 3 },
        { x: 3, y: 2 },
        { x: 3, y: 4 },
      ]),
    );
    // Stamps may leave the grid near edges; the applier clips.
    expect(brushCells(0, 0, 3, 'round').every((c) => c.x >= -1 && c.y >= -1)).toBe(true);
  });
});

describe('lineCells', () => {
  it('draws a Bresenham line inclusive of both ends', () => {
    expect(lineCells(0, 0, 2, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
    expect(lineCells(1, 1, 1, 4)).toHaveLength(4);
  });
});

describe('snapLine', () => {
  it('snaps near-axis lines and leaves others', () => {
    expect(snapLine(0, 0, 10, 1)).toEqual({ x: 10, y: 0 });
    expect(snapLine(0, 0, 7, 7)).toEqual({ x: 7, y: 7 });
    expect(snapLine(0, 0, 10, 4)).toEqual({ x: 10, y: 4 }); // 21.8 degrees is not near 0/45/90
    expect(snapLine(5, 5, 5, 5)).toEqual({ x: 5, y: 5 });
  });
});

describe('rectCells', () => {
  it('builds rect outlines and fills', () => {
    expect(rectCells(0, 0, 2, 2, false)).toHaveLength(8);
    expect(rectCells(0, 0, 2, 2, true)).toHaveLength(9);
    expect(rectCells(2, 1, 0, 3, true)).toHaveLength(9); // corners in any order: 3x3 box
  });
});

describe('ellipseCells', () => {
  it('builds ellipse outlines and fills', () => {
    const filled = ellipseCells(0, 0, 4, 4, true);
    expect(filled).toContainEqual({ x: 2, y: 2 });
    expect(filled).toContainEqual({ x: 2, y: 0 });
    expect(ellipseCells(0, 0, 4, 4, false).some((c) => c.x === 2 && c.y === 1)).toBe(false);
    expect(ellipseCells(3, 3, 3, 3, true)).toEqual([{ x: 3, y: 3 }]);
  });
});

describe('polygonCells', () => {
  it('fills and outlines polygons', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
    ];
    expect(polygonCells(square, true)).toHaveLength(16);
    expect(polygonCells(square, false)).toHaveLength(12);
    expect(polygonCells(square.slice(0, 2), true)).toEqual([]); // fewer than 3 points
  });
});

describe('floodCells', () => {
  it('floods the connected equal-value region', () => {
    const grid = [0, 0, 1, 0, 1, 1, 0, 0, 1];
    expect(floodCells(grid, 3, 3, 0, 0)).toHaveLength(5);
    expect(floodCells(grid, 3, 3, 2, 2)).toHaveLength(4);
    expect(floodCells(grid, 3, 3, 9, 0)).toEqual([]);
  });
});
