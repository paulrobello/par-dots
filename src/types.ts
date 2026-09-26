export type Aspect = '1:1' | '3:4' | '4:3';
export type PaletteMode = 'lego' | 'free';

export const PANEL_SIZE = 16;
export const EMPTY = 255;
export const MAX_COLORS = 32;

/** Panel grid (cols x rows) per aspect. */
export const LAYOUT: Record<Aspect, { cols: number; rows: number }> = {
  '1:1': { cols: 3, rows: 3 },
  '3:4': { cols: 3, rows: 4 },
  '4:3': { cols: 4, rows: 3 },
};

export interface PaletteColor {
  hex: string; // "#rrggbb"
  name: string;
}

export interface Mosaic {
  width: number; // studs
  height: number;
  palette: PaletteColor[]; // length <= 32
  target: Uint8Array; // palette index per stud, row-major, length width*height
}

export interface PictureSave {
  id: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  sourceImageId: string; // key into images store, or "library:<slug>"
  aspect: Aspect;
  paletteMode: PaletteMode;
  palette: PaletteColor[];
  width: number;
  height: number;
  target: Uint8Array;
  placed: Uint8Array; // EMPTY or palette index
  panelElapsedMs: number[];
  completedAt?: number;
}

export interface LibraryEntry {
  slug: string;
  title: string;
  aspect: Aspect;
  src: string; // e.g. "library/lighthouse.webp"
  thumb: string;
}

/** Crop rectangle in source-image pixel coords. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
