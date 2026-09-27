import { describe, expect, it } from 'vitest';
import {
  luminance,
  mixRgb,
  parseHexLenient,
  plasticTones,
  rgba,
  rgbObjToHex,
  shade,
} from '../src/render/color';
import {
  cellDeviceRect,
  cellToScreen,
  fitGrid,
  IDENTITY_VIEWPORT,
  pressHighlightAlpha,
  pressScale,
  pulseAlpha,
  quantizeSpritePx,
  screenToCell,
  type Viewport,
  zoomViewportAt,
} from '../src/render/layout';
import { mosaicImageSize } from '../src/render/mosaicImage';
import { PANEL_SIZE } from '../src/types';

describe('color math', () => {
  it('parses and formats hex', () => {
    expect(parseHexLenient('#237841')).toEqual({ r: 0x23, g: 0x78, b: 0x41 });
    expect(parseHexLenient('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexLenient('nope')).toEqual({ r: 128, g: 128, b: 128 });
    expect(rgbObjToHex({ r: 35, g: 120, b: 65 })).toBe('#237841');
    expect(rgbObjToHex({ r: -5, g: 300, b: 12.6 })).toBe('#00ff0d');
  });

  it('shades toward white and black', () => {
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#808080', 0)).toBe('#808080');
    expect(luminance(shade('#237841', 0.2))).toBeGreaterThan(luminance('#237841'));
    expect(luminance(shade('#237841', -0.2))).toBeLessThan(luminance('#237841'));
    expect(shade('#808080', 5)).toBe('#ffffff');
  });

  it('mixes and formats rgba', () => {
    expect(mixRgb({ r: 0, g: 0, b: 0 }, { r: 200, g: 100, b: 50 }, 0.5)).toEqual({
      r: 100,
      g: 50,
      b: 25,
    });
    expect(rgba('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
  });

  it('orders plastic tones light >= base > dark >= rim', () => {
    for (const hex of ['#237841', '#ffffff', '#05131d', '#c91a09']) {
      const t = plasticTones(hex);
      expect(luminance(t.light)).toBeGreaterThanOrEqual(luminance(t.base));
      expect(luminance(t.base)).toBeGreaterThan(luminance(t.dark));
      expect(luminance(t.dark)).toBeGreaterThanOrEqual(luminance(t.rim));
    }
  });
});

describe('viewport transform', () => {
  const layout = fitGrid(320, 400, PANEL_SIZE, PANEL_SIZE, 0.25);
  const viewports: Viewport[] = [
    IDENTITY_VIEWPORT,
    { scale: 2, offsetX: -100, offsetY: -50 },
    { scale: 3.3, offsetX: -400, offsetY: -700 },
  ];

  it('fits and centers the grid', () => {
    expect(layout.cell).toBeCloseTo(320 / 16.5);
    expect(layout.originX).toBeCloseTo((320 - layout.cell * 16) / 2);
    expect(layout.originY).toBeCloseTo((400 - layout.cell * 16) / 2);
  });

  it('round-trips cell -> screen -> cell for every cell', () => {
    for (const vp of viewports) {
      for (let y = 0; y < PANEL_SIZE; y++) {
        for (let x = 0; x < PANEL_SIZE; x++) {
          const p = cellToScreen(layout, vp, x + 0.5, y + 0.5);
          expect(screenToCell(layout, vp, p.x, p.y)).toEqual({ x, y });
        }
      }
    }
  });

  it('returns null outside the grid', () => {
    for (const vp of viewports) {
      const tl = cellToScreen(layout, vp, 0, 0);
      const br = cellToScreen(layout, vp, PANEL_SIZE, PANEL_SIZE);
      expect(screenToCell(layout, vp, tl.x - 0.5, tl.y + 5)).toBeNull();
      expect(screenToCell(layout, vp, br.x + 0.5, br.y - 5)).toBeNull();
      expect(screenToCell(layout, vp, br.x - 0.1, br.y + 0.1)).toBeNull();
      expect(screenToCell(layout, vp, tl.x, tl.y)).toEqual({ x: 0, y: 0 });
    }
  });

  it('zooms around a fixed point', () => {
    const vp = zoomViewportAt(IDENTITY_VIEWPORT, 2, 100, 150);
    expect(vp.scale).toBe(2);
    const before = screenToCell(layout, IDENTITY_VIEWPORT, 100, 150);
    expect(screenToCell(layout, vp, 100, 150)).toEqual(before);
    expect(zoomViewportAt(IDENTITY_VIEWPORT, 100, 0, 0).scale).toBe(4);
    expect(zoomViewportAt(IDENTITY_VIEWPORT, 0.1, 0, 0).scale).toBe(1);
  });

  it('produces seamless device rects', () => {
    const vp: Viewport = { scale: 1.37, offsetX: -3.2, offsetY: 7.9 };
    for (let x = 0; x < PANEL_SIZE - 1; x++) {
      const a = cellDeviceRect(layout, vp, 2.625, x, 3);
      const b = cellDeviceRect(layout, vp, 2.625, x + 1, 3);
      expect(a.x + a.w).toBe(b.x);
      expect(a.w).toBeGreaterThan(0);
    }
  });
});

describe('sprite size quantization', () => {
  it('bounds the number of distinct sizes over a zoom sweep', () => {
    const sizes = new Set<number>();
    for (let px = 20; px <= 400; px += 0.25) sizes.add(quantizeSpritePx(px));
    expect(sizes.size).toBeLessThan(40);
    expect(quantizeSpritePx(0)).toBe(4);
    expect(quantizeSpritePx(Number.NaN)).toBe(4);
    for (let px = 5; px < 400; px += 7) {
      expect(Math.abs(quantizeSpritePx(px) - px) / px).toBeLessThan(0.1);
    }
  });
});

describe('animation curves', () => {
  it('press pop starts small, overshoots, settles at 1', () => {
    expect(pressScale(0)).toBeCloseTo(0.94);
    expect(pressScale(0.25)).toBeGreaterThan(0.94);
    expect(pressScale(1)).toBe(1);
    expect(pressScale(2)).toBe(1);
    const peak = Math.max(...[0.5, 0.6, 0.7, 0.8].map(pressScale));
    expect(peak).toBeGreaterThan(1);
  });

  it('placement glint is brief and fades to zero', () => {
    expect(pressHighlightAlpha(0)).toBeCloseTo(0.24);
    expect(pressHighlightAlpha(0.2)).toBeGreaterThan(0);
    expect(pressHighlightAlpha(0.5)).toBe(0);
    expect(pressHighlightAlpha(2)).toBe(0);
  });

  it('hint pulse stays within a visible range', () => {
    for (let t = 0; t < 3000; t += 37) {
      const a = pulseAlpha(t);
      expect(a).toBeGreaterThanOrEqual(0.349);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});

describe('mosaic image size', () => {
  it('scales studs by cell px', () => {
    expect(mosaicImageSize(48, 64, 10)).toEqual({ width: 480, height: 640 });
    expect(mosaicImageSize(16, 16, 0)).toEqual({ width: 16, height: 16 });
  });
});
