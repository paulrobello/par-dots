import { describe, expect, it } from 'vitest';
import { PANEL_SIZE, type PictureSave, type XrPanelLayout } from '../src/types';
import { getLayout, setLayout, validateLayout } from '../src/xr/layout';

const IDENT = { x: 0, y: 0, z: 0, w: 1 };
const layout = (): XrPanelLayout => ({
  plate: { pos: { x: 0, y: 0.95, z: -0.35 }, quat: IDENT },
  frame: {
    pos: { x: -0.24, y: 1.12, z: -0.42 },
    quat: { x: 0.1, y: 0.3, z: 0, w: 0.95 },
    scale: 1.4,
  },
  tray: { pos: { x: 0.24, y: 1.05, z: -0.4 }, quat: { x: 0, y: -0.2, z: 0, w: 0.98 } },
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
});
