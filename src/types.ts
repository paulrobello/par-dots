/** Picture aspect: square, portrait or landscape. Picks the panel grid in LAYOUT. */
export type Aspect = '1:1' | '3:4' | '4:3';
/** 'lego' picks colors from LEGO_COLORS; 'free' derives colors from the image with k-means. */
export type PaletteMode = 'lego' | 'free';

/** Where a picture came from: quantized from a photo, or drawn freehand in the app. */
export type SaveOrigin = 'photo' | 'drawn';

/** Panel edge in studs; every panel is PANEL_SIZE x PANEL_SIZE. */
export const PANEL_SIZE = 16;
/** `placed` value for a stud with no dot. Palette indices are always below it. */
export const EMPTY = 255;
/** Most colors a mosaic may use (the setup slider's maximum and the default). */
export const MAX_COLORS = 32;
/** Fewest colors a mosaic may use (the setup slider's minimum). */
export const MIN_COLORS = 2;
/** Current PictureSave record shape; bump with a migration in storage/migrate.ts. */
export const SAVE_SCHEMA_VERSION = 2;

/** Panel grid (cols x rows) per aspect. */
export const LAYOUT: Record<Aspect, { cols: number; rows: number }> = {
  '1:1': { cols: 3, rows: 3 },
  '3:4': { cols: 3, rows: 4 },
  '4:3': { cols: 4, rows: 3 },
};

/** Picture size choices offered at creation time: grid scale multiplier and display label. */
export const SIZE_OPTIONS: ReadonlyArray<{ scale: number; label: string }> = [
  { scale: 1, label: 'Small' },
  { scale: 2, label: 'Medium' },
  { scale: 3, label: 'Large' },
];

/** Bounds of the custom panel-grid inputs on the creation screens. */
export const PANEL_GRID_MIN = 1;
export const PANEL_GRID_MAX = 10;

/** One palette entry. */
export interface PaletteColor {
  /** Lowercase "#rrggbb". */
  hex: string;
  /** LEGO name or descriptive Free color name. Older Free saves may contain approximate LEGO names. Not unique. */
  name: string;
}

/** A quantized picture: its size, palette and target color per stud. */
export interface Mosaic {
  /** Width in studs (LAYOUT cols * PANEL_SIZE). */
  width: number;
  /** Height in studs (LAYOUT rows * PANEL_SIZE). */
  height: number;
  /** Colors used by the picture, sorted dark to light; 1..MAX_COLORS entries. */
  palette: PaletteColor[];
  /** Palette index per stud, row-major (index = y * width + x), length width*height. */
  target: Uint8Array;
}

/** A saved picture and its progress, as stored in the IndexedDB `saves` store. */
export interface PictureSave extends Mosaic {
  /** Record shape version; SAVE_SCHEMA_VERSION when written, upgraded on read by migrateSave. */
  schemaVersion: number;
  /** Unique id; the store's key and the id in `#/play/:id`. */
  id: string;
  /** Creation time, epoch milliseconds. */
  createdAt: number;
  /** Last write time, epoch milliseconds; the gallery sorts by it, newest first. */
  updatedAt: number;
  /** Display name, from the library title or the upload filename or URL. */
  name: string;
  /** Key of the uploaded image in the `images` store, or "library:<slug>" for a bundled picture. */
  sourceImageId: string;
  /** Aspect the picture was cropped to; fixes width, height and the panel grid. */
  aspect: Aspect;
  /** Palette mode the picture was quantized with. */
  paletteMode: PaletteMode;
  /** How the picture was made: 'photo' quantized, or 'drawn' freehand (target stays all EMPTY). */
  origin: SaveOrigin;
  /** Drawn saves: background hex the eraser paints, absent when the background is None. */
  drawBackground?: string;
  /** Per stud, row-major like `target`: EMPTY, or the palette index of the dot placed there. */
  placed: Uint8Array;
  /** Visible play time per panel in milliseconds, indexed by row-major panel number. */
  panelElapsedMs: number[];
  /** Epoch milliseconds when the last panel was completed; absent until then. */
  completedAt?: number;
}

/** Crop framing independent of image size: zoom >= 1, center as a 0..1 fraction of each edge. */
export interface NormalizedCrop {
  zoom: number;
  cx: number;
  cy: number;
}

/** One bundled picture in `public/library/manifest.json`, written by scripts/build-library.ts. */
export interface LibraryEntry {
  /** File stem from `images/`, e.g. "lighthouse"; saves reference it as "library:<slug>". */
  slug: string;
  title: string;
  /** Default aspect offered in the crop editor. */
  aspect: Aspect;
  /** Default framing in the crop editor. */
  crop: NormalizedCrop;
  /** Full image URL relative to the site root. */
  src: string;
  /** Thumbnail URL relative to the site root. */
  thumb: string;
}

/** Crop rectangle in source-image pixel coords. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
