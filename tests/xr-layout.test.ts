// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { PANEL_SIZE, type PictureSave, type XrPanelLayout } from '../src/types';
import {
  getCustomLayouts,
  getLayout,
  saveCustomLayout,
  setLayout,
  validateLayout,
} from '../src/xr/layout';

const IDENT = { x: 0, y: 0, z: 0, w: 1 };
const layout = (): XrPanelLayout => ({
  plate: { pos: { x: 0, y: 0.95, z: -0.35 }, quat: IDENT, scale: 1 },
  frame: {
    pos: { x: -0.24, y: 1.12, z: -0.42 },
    quat: { x: 0.1, y: 0.3, z: 0, w: 0.95 },
    scale: 1.4,
  },
  tray: { pos: { x: 0.24, y: 1.05, z: -0.4 }, quat: { x: 0, y: -0.2, z: 0, w: 0.98 }, scale: 1.1 },
  overlay: true,
});

const makeSave = (): PictureSave => {
  const n = PANEL_SIZE * PANEL_SIZE;
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
    palette: [{ hex: '#101010', name: 'Dark' }],
    paletteMode: 'lego',
    origin: 'photo',
    target: new Uint8Array(n),
    placed: new Uint8Array(n),
    panelElapsedMs: [0],
  };
};

describe('validateLayout', () => {
  it('accepts a well-formed record', () => {
    expect(validateLayout(layout())).toEqual(layout());
  });

  it('accepts optional overview and tools transforms and clamps their scales', () => {
    const value = {
      ...layout(),
      overview: { pos: { x: 1, y: 2, z: 3 }, quat: IDENT, scale: 20 },
      tools: { pos: { x: 4, y: 5, z: 6 }, quat: IDENT },
    };
    expect(validateLayout(value)).toMatchObject({
      overview: { ...value.overview, scale: 3 },
      tools: { ...value.tools, scale: 1 },
    });
    expect(validateLayout({ ...value, tools: { broken: true } })).toBeNull();
  });

  it('preserves legacy transforms when plate and tray scales are absent', () => {
    const old = layout();
    const { scale: _plate, ...plate } = old.plate;
    const { scale: _tray, ...tray } = old.tray;
    expect(validateLayout({ ...old, plate, tray })).toEqual({
      ...old,
      plate: { ...plate, scale: 1 },
      tray: { ...tray, scale: 1 },
    });
  });

  it('clamps positive scales and rejects invalid scales', () => {
    const value = layout();
    value.plate.scale = 100;
    value.frame.scale = 0.01;
    expect(validateLayout(value)?.plate.scale).toBe(3);
    expect(validateLayout(value)?.frame.scale).toBe(0.4);
    for (const scale of [NaN, Infinity, 0, -1, 'big']) {
      expect(validateLayout({ ...value, tray: { ...value.tray, scale } })).toBeNull();
    }
  });

  it('rejects malformed records', () => {
    expect(validateLayout(null)).toBeNull();
    expect(validateLayout({})).toBeNull();
    expect(validateLayout({ ...layout(), overlay: 'yes' })).toBeNull();
    expect(
      validateLayout({
        ...layout(),
        plate: { pos: { x: NaN, y: 0, z: 0 }, quat: IDENT },
      }),
    ).toBeNull();
    expect(
      validateLayout({
        ...layout(),
        tray: undefined,
      }),
    ).toBeNull();
  });
});

describe('getLayout / setLayout', () => {
  it('round-trips through the save record per panel', () => {
    const save = makeSave();
    expect(getLayout(save, 2)).toBeNull();
    setLayout(save, 2, layout());
    expect(getLayout(save, 2)).toEqual(layout());
    expect(getLayout(save, 3)).toBeNull();
    expect(save.xrLayouts?.['2']).toBeDefined();
  });

  it('falls back to defaults on a malformed stored record', () => {
    const save = makeSave();
    save.xrLayouts = { '1': { garbage: true } as unknown as XrPanelLayout };
    expect(getLayout(save, 1)).toBeNull();
  });

  it('setLayout ignores invalid layouts', () => {
    const save = makeSave();
    setLayout(save, 0, { broken: 1 } as unknown as XrPanelLayout);
    expect(save.xrLayouts).toBeUndefined();
  });

  it('keeps reusable-only objects out of the per-panel save schema', () => {
    const save = makeSave();
    const extended = { ...layout(), tools: { pos: { x: 1, y: 2, z: 3 }, quat: IDENT } };
    setLayout(save, 0, extended);
    expect(save.xrLayouts?.['0']).toEqual(layout());
  });
});

describe('reusable local layouts', () => {
  it('round-trips validated layouts through localStorage', () => {
    localStorage.clear();
    expect(saveCustomLayout(' Desk ', layout())).toBe(true);
    expect(getCustomLayouts().Desk).toEqual(layout());
    expect(saveCustomLayout('bad', { broken: true })).toBe(false);
    expect(getCustomLayouts().Desk).toEqual(layout());
  });
});
