// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';

import { panelColorCounts } from '../src/game';
import {
  renderAssemblySheet,
  renderGuideOverview,
  renderPanelSheet,
} from '../src/render/panelSheet';
import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';

// happy-dom has no 2D context; record fillRect/fillText calls instead of pixels.
const rects: Array<{ x: number; y: number; w: number; h: number; fill: string }> = [];
const texts: string[] = [];
// Recorded path segments (points per beginPath..stroke), used to pin seam geometry.
const segs: number[][][] = [];
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
  beginPath(): void {
    segs.push([]);
  },
  moveTo(x: number, y: number): void {
    segs[segs.length - 1]?.push([x, y]);
  },
  lineTo(x: number, y: number): void {
    segs[segs.length - 1]?.push([x, y]);
  },
  stroke(): void {
    segs.push([]);
  },
} as unknown as CanvasRenderingContext2D;
HTMLCanvasElement.prototype.getContext = (() =>
  ctxFake) as unknown as typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  rects.length = 0;
  texts.length = 0;
  segs.length = 0;
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
    width: 48,
    height: 48,
    target: new Uint8Array(48 * 48).fill(EMPTY),
    placed: new Uint8Array(48 * 48).fill(EMPTY),
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
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

function wideSave(): PictureSave {
  // '4:3' = 4x3 panels = 64x48 studs.
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: 'w1',
    createdAt: 1,
    updatedAt: 1,
    name: 'wide',
    sourceImageId: '',
    aspect: '4:3',
    paletteMode: 'lego',
    origin: 'drawn',
    palette: [
      { hex: '#05131d', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
    ],
    width: 64,
    height: 48,
    target: new Uint8Array(64 * 48).fill(EMPTY),
    placed: new Uint8Array(64 * 48).fill(EMPTY),
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

describe('renderGuideOverview', () => {
  it('draws the full picture with internal seams and panel-number labels', () => {
    const save = drawnSave(); // 1:1 = 3x3 panels
    save.placed[0] = 1; // one White cell so the picture renders a real dot
    const canvas = renderGuideOverview(save);
    expect(canvas.width).toBeGreaterThan(0);

    expect(texts).toContain('Overview');
    for (let n = 1; n <= 9; n++) expect(texts).toContain(String(n));

    // Internal seam lines sit at panel boundaries inside the picture; the picture edges
    // are the border (strokeRect, not recorded here) — no stroked line may sit on them.
    // The one placed white cell is the picture's top-left stud, fixing the geometry.
    const cell = rects.find((r) => r.fill === '#ffffff');
    if (!cell) throw new Error('expected the placed white cell to render');
    const PX = cell.x;
    const PY = cell.y;
    const OV = cell.w;
    const vLines = segs.filter((s) => s.length >= 2 && s.every((p) => p[0] === s[0][0]));
    const hLines = segs.filter((s) => s.length >= 2 && s.every((p) => p[1] === s[0][1]));
    const seamXs = vLines.map((s) => s[0][0]);
    expect(seamXs).toContain(PX + 16 * OV);
    expect(seamXs).toContain(PX + 32 * OV);
    for (const s of vLines) {
      expect(s[0][0]).toBeGreaterThan(PX);
      expect(s[0][0]).toBeLessThan(PX + 48 * OV);
    }
    for (const s of hLines) {
      expect(s[0][1]).toBeGreaterThan(PY);
      expect(s[0][1]).toBeLessThan(PY + 48 * OV);
    }
  });
});

describe('renderAssemblySheet', () => {
  it('instructs rows, row joining and hooks with layout-derived counts', () => {
    const save = wideSave(); // 4:3 = 4 cols x 3 rows of panels
    const canvas = renderAssemblySheet(save);
    expect(canvas.width).toBeGreaterThan(0);

    expect(texts).toContain('Assembly');
    expect(texts).toContain('Build 3 rows of 4 panels');
    const has = (s: string): boolean => texts.some((t) => t.includes(s));
    expect(has('9 black connectors in all')).toBe(true);
    expect(has('8 black connectors')).toBe(true);
    expect(has('2 hanging hooks')).toBe(true);
    expect(has('not part of the color palette')).toBe(true);

    // Connector bars are the only ink-filled rects on the schematic (header text is not).
    const bars = rects.filter((r) => r.fill === '#1b1b1b');
    expect(bars.length).toBeGreaterThanOrEqual(4 - 1 + (3 - 1));
  });
});
