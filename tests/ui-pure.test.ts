import { describe, expect, it } from 'vitest';
import {
  cellLine,
  clampCrop,
  cropRectFor,
  cropSize,
  defaultCrop,
  fitWithin,
  formatDuration,
  formatPercent,
  nameFromFile,
  nameFromUrl,
  nextSelection,
  paletteLabels,
  panelZoomTransform,
  parseImageUrl,
  parseRoute,
  routeHash,
  shouldApplyUpdate,
  userMessage,
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
    expect(parseRoute('#/play/%E0')).toEqual({ name: 'gallery' });
    expect(parseRoute('#/play/%E0/2')).toEqual({ name: 'gallery' });
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

describe('defaultCrop', () => {
  it('centers at zoom 1 without a normalized crop', () => {
    expect(defaultCrop(800, 600)).toEqual({ zoom: 1, cx: 400, cy: 300 });
  });
  it('scales a normalized crop to pixels', () => {
    expect(defaultCrop(800, 600, { zoom: 2, cx: 0.25, cy: 0.75 })).toEqual({
      zoom: 2,
      cx: 200,
      cy: 450,
    });
  });
});

describe('image URL input', () => {
  it('accepts https links and adds https to bare hosts', () => {
    expect(parseImageUrl(' https://a.com/x.jpg ')?.href).toBe('https://a.com/x.jpg');
    expect(parseImageUrl('a.com/x.png')?.href).toBe('https://a.com/x.png');
    expect(parseImageUrl('http://a.com/y')).toBeNull();
  });
  it('rejects empty and non-http schemes', () => {
    expect(parseImageUrl('')).toBeNull();
    expect(parseImageUrl('javascript:alert(1)')).toBeNull();
    expect(parseImageUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(parseImageUrl('file:///etc/passwd')).toBeNull();
  });
  it('names from the file segment, else the host', () => {
    expect(nameFromUrl(new URL('https://x.org/pics/red_barn%20photo.jpg'))).toBe('red barn photo');
    expect(nameFromUrl(new URL('https://www.example.com/'))).toBe('example.com');
  });
});

describe('shouldApplyUpdate', () => {
  it('applies on the gallery and overview with no overlay open', () => {
    expect(shouldApplyUpdate('gallery', false, false)).toBe(true);
    expect(shouldApplyUpdate('overview', false, false)).toBe(true);
  });
  it('waits on panel, setup and source screens', () => {
    expect(shouldApplyUpdate('panel', false, false)).toBe(false);
    expect(shouldApplyUpdate('setup', false, false)).toBe(false);
    expect(shouldApplyUpdate('new', false, false)).toBe(false);
  });
  it('waits while an overlay is open', () => {
    expect(shouldApplyUpdate('gallery', true, false)).toBe(false);
    expect(shouldApplyUpdate('overview', true, false)).toBe(false);
  });
  it('applies whenever the page is hidden', () => {
    expect(shouldApplyUpdate('panel', false, true)).toBe(true);
    expect(shouldApplyUpdate('setup', true, true)).toBe(true);
  });
});

describe('userMessage', () => {
  it('uses an Error message', () => {
    expect(userMessage(new Error('x'))).toBe('x');
  });
  it('uses a non-empty string', () => {
    expect(userMessage('boom')).toBe('boom');
  });
  it('falls back for anything else', () => {
    expect(userMessage(42)).toBe('Something went wrong.');
    expect(userMessage(new Error(''), 'fb')).toBe('fb');
    expect(userMessage(undefined, 'fb')).toBe('fb');
  });
});

describe('formatPercent', () => {
  it('floors so 100% only shows when complete', () => {
    expect(formatPercent(99.96)).toBe('99%');
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('panelZoomTransform', () => {
  it('centers a panel rect and scales it to 92% of the limiting stage side', () => {
    const { s, tx, ty } = panelZoomTransform({ x: 100, y: 50, w: 100, h: 50 }, 400, 300);
    expect(s).toBeCloseTo(3.68);
    expect(tx).toBeCloseTo(200 - 150 * 3.68);
    expect(ty).toBeCloseTo(150 - 75 * 3.68);
  });
});
