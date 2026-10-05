/**
 * Part manifest builders for buying a mosaic as a physical build: the 1x1 round tiles
 * by color, plus the black Dots/Art canvases, the Technic pins that join them, two
 * wall-mount panels and a raised frame on a backing plate. Builders emit the BrickLink Wanted
 * List Mass Upload XML and the Rebrickable part-list import CSV; DOM-free so they are
 * unit-testable, with the Parts sheet wiring them to `downloadBlob`.
 */

import { panelGridOf } from '../game';
import type { Aspect } from '../types';

/** BrickLink catalog item no. for Tile, Round 1x1, the piece Dots mosaics are built from. */
export const DOTS_PART_ID = '98138';
/** Brick Special 16x16 x 1 1/3 with Pin Holes, black: the mosaic canvas, one per panel. */
export const CANVAS_PART_ID = '65803';
/**
 * Technic Pin with friction ridges, black: joins two adjacent canvases. Rebrickable
 * catalogs the current mold as design 61332; BrickLink catalogs it as item 2780 and
 * has no 61332 entry, and BrickLink's own 2780 is a different (slotted) pin.
 */
export const PIN_PART_ID = '61332';
/** Same pin's item number in the BrickLink catalog. */
export const PIN_BRICKLINK_PART_ID = '2780';
/** Technic Panel 3x5 with Wall Mount Hole, black: picture hanger, two per picture. */
export const HANGER_PART_ID = '67139';
/**
 * BrickLink catalog item numbers for the frame ring's 1-wide pieces, keyed by stud
 * length: bricks up to panel-top height, plates to dot height, smooth tiles as the cap.
 */
const FRAME_BRICK_IDS: Record<number, string> = { 16: '2465', 8: '3008', 4: '3010', 2: '3004' };
const FRAME_PLATE_IDS: Record<number, string> = { 8: '3460', 6: '3666', 4: '3710', 2: '3023' };
const FRAME_TILE_IDS: Record<number, string> = { 8: '4162', 6: '6636', 4: '2431', 2: '3069b' };
/** Greedy piece lengths per layer; every ring run is even, so these always sum exactly. */
const FRAME_BRICK_LENGTHS = [16, 8, 4, 2];
const FRAME_PLATE_LENGTHS = [8, 6, 4, 2];
const FRAME_TILE_LENGTHS = [8, 6, 4, 2];
/** Plate 16x16 under each canvas (92690 is a Bar 1L, not this plate). */
const BACKING_PART_ID = '91405';
/** Plate 2x2 over the four frame corners, left studded for bonding and hangers. */
const FRAME_CORNER_PART_ID = '3022';
/** Frame color choices for the raised frame. */
export const FRAME_COLORS = ['Black', 'White'] as const;
export type FrameColor = (typeof FRAME_COLORS)[number];
/** Technic pins budgeted per shared edge between two canvases; matches the assembly guide. */
export const PINS_PER_EDGE = 3;

/**
 * BrickLink Color Guide ID per LEGO color name. Names must match `legoPalette.ts`
 * exactly. IDs cross-checked against the BrickLink catalog (Rebrickable color table
 * names match BrickLink for the current production set).
 */
const BL_COLOR_IDS: Record<string, number> = {
  Black: 11,
  White: 1,
  'Light Bluish Gray': 86,
  'Dark Bluish Gray': 85,
  Red: 5,
  'Dark Red': 59,
  Orange: 4,
  'Dark Orange': 68,
  'Bright Light Orange': 110,
  Yellow: 3,
  'Bright Light Yellow': 103,
  Lime: 34,
  'Yellowish Green': 158,
  'Bright Green': 36,
  Green: 6,
  'Dark Green': 80,
  'Medium Green': 37,
  'Sand Green': 48,
  'Olive Green': 155,
  Aqua: 41,
  'Dark Turquoise': 39,
  'Medium Azure': 156,
  'Dark Azure': 153,
  'Bright Light Blue': 105,
  'Medium Blue': 42,
  Blue: 7,
  'Dark Blue': 63,
  'Sand Blue': 55,
  Lavender: 154,
  'Medium Lavender': 157,
  Purple: 24,
  Magenta: 71,
  'Dark Pink': 47,
  'Bright Pink': 104,
  Coral: 220,
  'Light Pink': 56,
  Tan: 2,
  'Dark Tan': 69,
  'Light Nougat': 90,
  Nougat: 28,
  'Medium Nougat': 150,
  'Reddish Brown': 88,
  'Dark Brown': 120,
};

/**
 * Rebrickable color ID per LEGO color name, from the Rebrickable color table
 * (https://rebrickable.com/colors/). Same names, matched by RGB.
 */
const REBRICKABLE_COLOR_IDS: Record<string, number> = {
  Black: 0,
  White: 15,
  'Light Bluish Gray': 71,
  'Dark Bluish Gray': 72,
  Red: 4,
  'Dark Red': 320,
  Orange: 25,
  'Dark Orange': 484,
  'Bright Light Orange': 191,
  Yellow: 14,
  'Bright Light Yellow': 226,
  Lime: 27,
  'Yellowish Green': 158,
  'Bright Green': 10,
  Green: 2,
  'Dark Green': 288,
  'Medium Green': 74,
  'Sand Green': 378,
  'Olive Green': 326,
  Aqua: 118,
  'Dark Turquoise': 3,
  'Medium Azure': 322,
  'Dark Azure': 321,
  'Bright Light Blue': 212,
  'Medium Blue': 73,
  Blue: 1,
  'Dark Blue': 272,
  'Sand Blue': 379,
  Lavender: 31,
  'Medium Lavender': 30,
  Purple: 22,
  Magenta: 26,
  'Dark Pink': 5,
  'Bright Pink': 29,
  Coral: 1050,
  'Light Pink': 77,
  Tan: 19,
  'Dark Tan': 28,
  'Light Nougat': 78,
  Nougat: 92,
  'Medium Nougat': 84,
  'Reddish Brown': 70,
  'Dark Brown': 308,
};

/** BrickLink Color Guide ID for a LEGO color name, or undefined if it has none. */
export function brickLinkColorId(name: string): number | undefined {
  return BL_COLOR_IDS[name];
}

/** Rebrickable color ID for a LEGO color name, or undefined if it has none. */
export function rebrickableColorId(name: string): number | undefined {
  return REBRICKABLE_COLOR_IDS[name];
}

/** One wanted line: a part id, a LEGO color name, and the wanted quantity. */
export interface ManifestItem {
  partId: string;
  /** Item number BrickLink catalogs this part under, when it differs from partId. */
  brickLinkPartId?: string;
  colorName: string;
  qty: number;
}

/** Merge per-palette-index counts into dot items, one per color name. */
export function manifestItems(counts: number[], names: string[]): ManifestItem[] {
  const totals = new Map<string, number>();
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0) totals.set(names[i], (totals.get(names[i]) ?? 0) + counts[i]);
  }
  return [...totals].map(([colorName, qty]) => ({ partId: DOTS_PART_ID, colorName, qty }));
}

/** Shared canvas edges in a cols x rows panel grid. */
export function sharedEdges(aspect: Aspect, scale = 1): number {
  const { cols, rows } = panelGridOf(aspect, scale);
  return cols * (rows - 1) + rows * (cols - 1);
}

/** Cover one even stud run greedily with the longest piece first. */
function runPieces(run: number, lengths: readonly number[]): number[] {
  const pieces: number[] = [];
  for (const len of lengths) {
    while (run >= len) {
      pieces.push(len);
      run -= len;
    }
  }
  if (run !== 0) throw new RangeError(`piece lengths cannot cover a ${run}-stud leftover`);
  return pieces;
}

/**
 * The raised frame's parts, all in the frame color. A backing plate one stud larger
 * than the panel grid all around — a 16x16 plate per panel plus a 1-stud border ring —
 * then a ring raised on that border: bricks up to panel-top height, a plate layer to
 * dot height (the backing border is plates too, so the plate runs are bought twice),
 * and a smooth tile cap one plate above the dots, inset 2 studs so exactly four 2x2
 * plate corners stay studded for bonding and hangers. Ring runs are [W, W, D-4, D-4]
 * for W = 16*cols+2, D = 16*rows+2, so the greedy pieces always sum exactly.
 */
export function frameItems(aspect: Aspect, colorName: FrameColor, scale = 1): ManifestItem[] {
  const { cols, rows } = panelGridOf(aspect, scale);
  const width = 16 * cols + 2;
  const depth = 16 * rows + 2;
  const runs = [width, width, depth - 4, depth - 4];
  const qty = new Map<string, number>();
  const add = (partId: string, n: number): void => {
    qty.set(partId, (qty.get(partId) ?? 0) + n);
  };
  const addRun = (run: number, ids: Record<number, string>, lengths: readonly number[]): void => {
    for (const len of runPieces(run, lengths)) add(ids[len], 1);
  };
  add(BACKING_PART_ID, cols * rows);
  for (const run of runs) addRun(run, FRAME_PLATE_IDS, FRAME_PLATE_LENGTHS); // backing border ring
  for (const run of runs) addRun(run, FRAME_BRICK_IDS, FRAME_BRICK_LENGTHS);
  for (const run of runs) addRun(run, FRAME_PLATE_IDS, FRAME_PLATE_LENGTHS); // layer over the bricks
  for (const run of [width - 4, width - 4, depth - 4, depth - 4]) {
    addRun(run, FRAME_TILE_IDS, FRAME_TILE_LENGTHS);
  }
  add(FRAME_CORNER_PART_ID, 4);
  return [...qty].map(([partId, n]) => ({ partId, colorName, qty: n }));
}

/**
 * Everything the mosaic needs besides the colored dots: one black canvas per panel,
 * Technic pins (3 per shared edge), two wall-mount hangers, and — unless frameColor is
 * null — the raised frame's parts in the chosen color. Black items only exist in the
 * LEGO catalog, so this block is only offered in LEGO palette mode.
 */
export function mountingItems(
  aspect: Aspect,
  frameColor: FrameColor | null,
  scale = 1,
): ManifestItem[] {
  const { cols, rows } = panelGridOf(aspect, scale);
  const items: ManifestItem[] = [
    { partId: CANVAS_PART_ID, colorName: 'Black', qty: cols * rows },
    {
      partId: PIN_PART_ID,
      brickLinkPartId: PIN_BRICKLINK_PART_ID,
      colorName: 'Black',
      qty: PINS_PER_EDGE * sharedEdges(aspect, scale),
    },
    { partId: HANGER_PART_ID, colorName: 'Black', qty: 2 },
  ];
  if (frameColor) {
    items.push(...frameItems(aspect, frameColor, scale));
  }
  return items;
}

/**
 * BrickLink Wanted List Mass Upload XML (helpID 207): an INVENTORY of ITEM elements,
 * no XML declaration, MINQTY is the wanted quantity. Free palette shades have no LEGO
 * color ID, so every colorName must be in the table; unknown names are skipped.
 */
export function wantedListXml(items: ManifestItem[]): string {
  const body = items
    .filter((it) => it.colorName in BL_COLOR_IDS && it.qty > 0)
    .map(
      (it) =>
        `<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${it.brickLinkPartId ?? it.partId}</ITEMID>` +
        `<COLOR>${BL_COLOR_IDS[it.colorName]}</COLOR><QTYFILLED>0</QTYFILLED>` +
        `<MINQTY>${it.qty}</MINQTY><NOTIFY>N</NOTIFY></ITEM>`,
    );
  return `<INVENTORY>${body.join('')}</INVENTORY>`;
}

/** Rebrickable part-list import CSV, Rebrickable column names. Unknown names are skipped. */
export function rebrickableCsv(items: ManifestItem[]): string {
  const lines = ['part_num,color_id,quantity'];
  for (const it of items) {
    const color = REBRICKABLE_COLOR_IDS[it.colorName];
    if (color !== undefined && it.qty > 0) lines.push(`${it.partId},${color},${it.qty}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Filesystem-safe stem from a picture name, for manifest filenames. */
export function manifestStem(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'mosaic'
  );
}
