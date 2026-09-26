import { describe, expect, it } from 'vitest';
import { quantizeInWorker } from '../src/engine/client';
import { deltaE, hexToRgb, rgbToHex, rgbToLab } from '../src/engine/color';
import { LEGO_COLORS } from '../src/engine/legoPalette';
import { panelColors, panelCount, panelIndexOf, panelOrigin, studDims } from '../src/engine/panels';
import { buildMosaic, MIN_DELTA_E } from '../src/engine/quantize';
import { cropAndResample } from '../src/engine/resample';
import { type Aspect, MAX_COLORS, PANEL_SIZE } from '../src/types';

const ASPECTS: Aspect[] = ['1:1', '3:4', '4:3'];

/** Deterministic noisy gradient image with many distinct colors. */
function noisyImage(w: number, h: number, seed = 1): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = (x / w) * 255 + rnd() * 40;
      px[i + 1] = (y / h) * 255 + rnd() * 40;
      px[i + 2] = ((x + y) / (w + h)) * 255 + rnd() * 40;
      px[i + 3] = 255;
    }
  }
  return px;
}

function solidImage(w: number, h: number, colors: [number, number, number][]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = colors[i % colors.length];
    px.set([r, g, b, 255], i * 4);
  }
  return px;
}

describe('color', () => {
  it('round-trips hex and rgb', () => {
    expect(hexToRgb('#c91a09')).toEqual([201, 26, 9]);
    expect(rgbToHex(201, 26, 9)).toBe('#c91a09');
    expect(rgbToHex(300, -5, 12.4)).toBe('#ff000c');
    expect(() => hexToRgb('#12')).toThrow();
  });

  it('converts known colors to Lab', () => {
    const white = rgbToLab(255, 255, 255);
    expect(white[0]).toBeCloseTo(100, 1);
    expect(Math.abs(white[1])).toBeLessThan(0.5);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 5);
    const red = rgbToLab(255, 0, 0);
    expect(red[0]).toBeCloseTo(53.24, 0);
    expect(red[1]).toBeCloseTo(80.09, 0);
  });

  it('deltaE is zero for identical and positive otherwise', () => {
    const a = rgbToLab(10, 20, 30);
    expect(deltaE(a, a)).toBe(0);
    expect(deltaE(a, rgbToLab(200, 20, 30))).toBeGreaterThan(10);
  });
});

describe('LEGO palette', () => {
  it('has valid, unique entries', () => {
    expect(LEGO_COLORS.length).toBeGreaterThanOrEqual(35);
    const hexes = new Set(LEGO_COLORS.map((c) => c.hex));
    expect(hexes.size).toBe(LEGO_COLORS.length);
    for (const c of LEGO_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('buildMosaic', () => {
  const legoHexes = new Set(LEGO_COLORS.map((c) => c.hex));

  for (const mode of ['lego', 'free'] as const) {
    it(`${mode}: never exceeds ${MAX_COLORS} colors and every index is valid and used`, () => {
      const m = buildMosaic(noisyImage(64, 48), 64, 48, mode);
      expect(m.width).toBe(64);
      expect(m.height).toBe(48);
      expect(m.target.length).toBe(64 * 48);
      expect(m.palette.length).toBeLessThanOrEqual(MAX_COLORS);
      expect(m.palette.length).toBeGreaterThan(1);
      const used = new Set(m.target);
      expect(used.size).toBe(m.palette.length);
      for (const i of used) expect(i).toBeLessThan(m.palette.length);
    });

    it(`${mode}: is deterministic`, () => {
      const px = noisyImage(48, 64, 7);
      const a = buildMosaic(px, 48, 64, mode);
      const b = buildMosaic(px, 48, 64, mode);
      expect(b.palette).toEqual(a.palette);
      expect(Array.from(b.target)).toEqual(Array.from(a.target));
    });

    it(`${mode}: palette sorted by luminance`, () => {
      const m = buildMosaic(noisyImage(48, 48, 3), 48, 48, mode);
      const L = m.palette.map((c) => rgbToLab(...hexToRgb(c.hex))[0]);
      for (let i = 1; i < L.length; i++) expect(L[i]).toBeGreaterThanOrEqual(L[i - 1]);
    });
  }

  it('lego mode only uses LEGO_COLORS hex values', () => {
    for (const seed of [1, 2, 3]) {
      const m = buildMosaic(noisyImage(48, 48, seed), 48, 48, 'lego');
      for (const c of m.palette) expect(legoHexes.has(c.hex)).toBe(true);
    }
  });

  it('lego mode maps an exact LEGO color to itself', () => {
    const m = buildMosaic(solidImage(4, 4, [[201, 26, 9]]), 4, 4, 'lego');
    expect(m.palette).toEqual([{ hex: '#c91a09', name: 'Red' }]);
    expect(Array.from(m.target)).toEqual(new Array(16).fill(0));
  });

  it('free mode keeps exact colors when the image has few distinct colors', () => {
    const cols: [number, number, number][] = [
      [255, 255, 255],
      [0, 0, 0],
      [10, 200, 30],
    ];
    const m = buildMosaic(solidImage(16, 16, cols), 16, 16, 'free');
    expect(m.palette.map((c) => c.hex)).toEqual(['#000000', '#0ac81e', '#ffffff']);
    expect(m.target[0]).toBe(2);
    expect(m.target[1]).toBe(0);
    expect(m.target[2]).toBe(1);
  });

  it('treats transparent pixels as white', () => {
    const px = new Uint8ClampedArray(4 * 4);
    const m = buildMosaic(px, 2, 2, 'free');
    expect(m.palette.map((c) => c.hex)).toEqual(['#ffffff']);
  });

  it('rejects mismatched buffer sizes', () => {
    expect(() => buildMosaic(new Uint8ClampedArray(8), 2, 2, 'lego')).toThrow(RangeError);
  });
});

describe('quantizeInWorker', () => {
  it('falls back to the main thread when Worker is unavailable', async () => {
    const px = noisyImage(48, 48, 5);
    const viaClient = await quantizeInWorker(px, 48, 48, 'lego');
    const direct = buildMosaic(px, 48, 48, 'lego');
    expect(viaClient.palette).toEqual(direct.palette);
    expect(Array.from(viaClient.target)).toEqual(Array.from(direct.target));
  });
});

describe('cropAndResample', () => {
  it('area-averages a 2x2 block into one pixel', () => {
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 100, 0, 0, 255, 0, 200, 0, 255, 0, 0, 40, 255,
    ]);
    const out = cropAndResample({ data, width: 2, height: 2 }, { x: 0, y: 0, w: 2, h: 2 }, 1, 1);
    expect(Array.from(out)).toEqual([25, 50, 10, 255]);
  });

  it('respects the crop rectangle', () => {
    const w = 4;
    const h = 2;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([i % w < 2 ? 0 : 200, 0, 0, 255], i * 4);
    const out = cropAndResample({ data, width: w, height: h }, { x: 2, y: 0, w: 2, h: 2 }, 2, 2);
    for (let i = 0; i < 4; i++) expect(out[i * 4]).toBe(200);
  });

  it('handles fractional scale factors with weighted coverage', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 90, 0, 0, 255, 180, 0, 0, 255]);
    const out = cropAndResample({ data, width: 3, height: 1 }, { x: 0, y: 0, w: 3, h: 1 }, 2, 1);
    // pixel 0 covers [0,1.5): (0*1 + 90*0.5)/1.5 = 30; pixel 1 covers [1.5,3): (90*0.5+180)/1.5 = 150
    expect(out[0]).toBe(30);
    expect(out[4]).toBe(150);
  });

  it('upsamples by replication', () => {
    const data = new Uint8ClampedArray([7, 8, 9, 255]);
    const out = cropAndResample({ data, width: 1, height: 1 }, { x: 0, y: 0, w: 1, h: 1 }, 3, 3);
    expect(out.length).toBe(36);
    for (let i = 0; i < 9; i++)
      expect(Array.from(out.slice(i * 4, i * 4 + 4))).toEqual([7, 8, 9, 255]);
  });
});

describe('panels', () => {
  it('counts panels and stud dims per aspect', () => {
    expect(panelCount('1:1')).toBe(9);
    expect(panelCount('3:4')).toBe(12);
    expect(panelCount('4:3')).toBe(12);
    expect(studDims('1:1')).toEqual({ width: 48, height: 48 });
    expect(studDims('3:4')).toEqual({ width: 48, height: 64 });
    expect(studDims('4:3')).toEqual({ width: 64, height: 48 });
  });

  for (const aspect of ASPECTS) {
    it(`${aspect}: origin and index are inverse and tile the picture`, () => {
      const { width, height } = studDims(aspect);
      const counts = new Array(panelCount(aspect)).fill(0);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = panelIndexOf(aspect, x, y);
          counts[p]++;
          const o = panelOrigin(aspect, p);
          expect(x - o.x).toBeGreaterThanOrEqual(0);
          expect(x - o.x).toBeLessThan(PANEL_SIZE);
          expect(y - o.y).toBeGreaterThanOrEqual(0);
          expect(y - o.y).toBeLessThan(PANEL_SIZE);
        }
      }
      for (const c of counts) expect(c).toBe(PANEL_SIZE * PANEL_SIZE);
      for (let p = 0; p < panelCount(aspect); p++) {
        const o = panelOrigin(aspect, p);
        expect(panelIndexOf(aspect, o.x, o.y)).toBe(p);
      }
      expect(panelIndexOf(aspect, -1, 0)).toBe(-1);
      expect(panelIndexOf(aspect, width, 0)).toBe(-1);
      expect(panelIndexOf(aspect, 0, height)).toBe(-1);
      expect(() => panelOrigin(aspect, panelCount(aspect))).toThrow(RangeError);
    });
  }

  it('panels are numbered row-major', () => {
    expect(panelOrigin('4:3', 5)).toEqual({ x: 16, y: 16 });
    expect(panelOrigin('3:4', 11)).toEqual({ x: 32, y: 48 });
  });

  it('panelColors lists distinct indices in a panel', () => {
    const { width, height } = studDims('4:3');
    const target = new Uint8Array(width * height);
    // Panel 1 (x 16..31, y 0..15) gets colors 3 and 7; everything else 0.
    for (let y = 0; y < 16; y++)
      for (let x = 16; x < 32; x++) target[y * width + x] = (x + y) % 2 ? 3 : 7;
    const mosaic = {
      width,
      height,
      palette: new Array(8).fill({ hex: '#000000', name: 'x' }),
      target,
    };
    expect(panelColors(mosaic, '4:3', 1)).toEqual([3, 7]);
    expect(panelColors(mosaic, '4:3', 0)).toEqual([0]);
    expect(panelColors(mosaic, '4:3', 11)).toEqual([0]);
  });
});

describe('buildMosaic maxColors', () => {
  const noise = (w: number, hgt: number): Uint8ClampedArray => {
    const px = new Uint8ClampedArray(w * hgt * 4);
    let seed = 7;
    for (let i = 0; i < px.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      px[i] = i % 4 === 3 ? 255 : seed & 255;
    }
    return px;
  };
  it('respects the limit in both modes', () => {
    for (const mode of ['lego', 'free'] as const) {
      for (const max of [4, 12, 32]) {
        expect(buildMosaic(noise(48, 48), 48, 48, mode, max).palette.length).toBeLessThanOrEqual(
          max,
        );
      }
    }
  });
  it('clamps out-of-range limits to 2..32', () => {
    expect(buildMosaic(noise(48, 48), 48, 48, 'free', 1).palette.length).toBeLessThanOrEqual(2);
    expect(buildMosaic(noise(48, 48), 48, 48, 'free', 99).palette.length).toBeLessThanOrEqual(32);
  });
});

describe('buildMosaic contrast', () => {
  it('keeps every palette pair at least MIN_DELTA_E apart', () => {
    const w = 48;
    const px = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < w * w; i++) {
      // A smooth gray-blue ramp: many near-identical shades.
      px[i * 4] = 60 + (i % w);
      px[i * 4 + 1] = 70 + (i % w);
      px[i * 4 + 2] = 120 + Math.floor(i / w);
      px[i * 4 + 3] = 255;
    }
    for (const mode of ['lego', 'free'] as const) {
      const pal = buildMosaic(px, w, w, mode, 32).palette.map((c) => {
        const [r, g, b] = hexToRgb(c.hex);
        return rgbToLab(r, g, b);
      });
      for (let i = 0; i < pal.length; i++)
        for (let j = i + 1; j < pal.length; j++)
          expect(deltaE(pal[i], pal[j])).toBeGreaterThanOrEqual(MIN_DELTA_E);
    }
  });
});
