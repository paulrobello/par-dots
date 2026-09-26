import { describe, expect, it } from 'vitest';
import {
  cellLine,
  clampCrop,
  cropRectFor,
  cropSize,
  fitWithin,
  formatDuration,
  nameFromFile,
  nextSelection,
  paletteLabels,
  parseRoute,
  routeHash,
} from '../src/ui/pure';

describe('router', () => {
  it('parses every route', () => {
    expect(parseRoute('')).toEqual({ name: 'gallery' });
    expect(parseRoute('#/')).toEqual({ name: 'gallery' });
    expect(parseRoute('#/new')).toEqual({ name: 'new' });
    expect(parseRoute('#/setup')).toEqual({ name: 'setup' });
    expect(parseRoute('#/play/abc')).toEqual({ name: 'overview', id: 'abc' });
    expect(parseRoute('#/play/abc/')).toEqual({ name: 'overview', id: 'abc' });
    expect(parseRoute('#/play/abc/7')).toEqual({ name: 'panel', id: 'abc', panel: 7 });
  });

  it('falls back to the gallery on junk', () => {
    expect(parseRoute('#/nope')).toEqual({ name: 'gallery' });
    expect(parseRoute('#/play')).toEqual({ name: 'gallery' });
    expect(parseRoute('#/play/abc/x')).toEqual({ name: 'gallery' });
    expect(parseRoute('#/play/abc/1/2')).toEqual({ name: 'gallery' });
  });

  it('round-trips through routeHash', () => {
    for (const h of ['#/', '#/new', '#/setup', '#/play/a%20b', '#/play/id-1/11']) {
      expect(routeHash(parseRoute(h))).toBe(h);
    }
  });
});

describe('paletteLabels', () => {
  it('suffixes duplicate names in palette order', () => {
    const labels = paletteLabels([
      { hex: '#000000', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
      { hex: '#111111', name: 'Black' },
      { hex: '#222222', name: 'Black' },
    ]);
    expect(labels).toEqual(['Black', 'White', 'Black 2', 'Black 3']);
  });
});

describe('cellLine', () => {
  it('includes both endpoints and has no gaps', () => {
    const pts = cellLine(0, 0, 7, 3);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 7, y: 3 });
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i].x - pts[i - 1].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(1);
    }
  });

  it('handles single points and reverse directions', () => {
    expect(cellLine(4, 4, 4, 4)).toEqual([{ x: 4, y: 4 }]);
    const pts = cellLine(5, 9, 5, 6);
    expect(pts.map((p) => p.y)).toEqual([9, 8, 7, 6]);
  });
});

describe('crop math', () => {
  it('fits the largest frame of the aspect at zoom 1', () => {
    expect(cropSize(1000, 500, '1:1', 1)).toEqual({ w: 500, h: 500 });
    expect(cropSize(1000, 500, '4:3', 1)).toEqual({ w: 2000 / 3, h: 500 });
    expect(cropSize(600, 1000, '3:4', 2)).toEqual({ w: 300, h: 400 });
  });

  it('clamps center and zoom so the frame stays inside the image', () => {
    const c = clampCrop(1000, 500, '1:1', { zoom: 20, cx: -50, cy: 9999 });
    expect(c.zoom).toBe(6);
    const r = cropRectFor(1000, 500, '1:1', c);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(500 + 1e-9);
    const r1 = cropRectFor(1000, 500, '1:1', { zoom: 1, cx: 0, cy: 0 });
    expect(r1).toEqual({ x: 0, y: 0, w: 500, h: 500 });
  });
});

describe('misc helpers', () => {
  it('fitWithin never enlarges', () => {
    expect(fitWithin(4000, 3000, 1024)).toEqual({ w: 1024, h: 768 });
    expect(fitWithin(300, 200, 1024)).toEqual({ w: 300, h: 200 });
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_400)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('derives names from filenames', () => {
    expect(nameFromFile('IMG_2041.HEIC')).toBe('IMG 2041');
    expect(nameFromFile('/a/b/my-cat.photo.jpg')).toBe('my cat.photo');
    expect(nameFromFile('.jpg')).toBe('My Picture');
  });

  it('picks the next tray selection', () => {
    expect(nextSelection([1, 3], [1, 2, 3], 2)).toBe(3);
    expect(nextSelection([1], [1, 2, 3], 3)).toBe(1);
    expect(nextSelection([1, 2], [1, 2], 2)).toBe(2);
    expect(nextSelection([], [1], 1)).toBe(-1);
  });
});
