/**
 * Part manifest builders for buying the dots of a mosaic: the BrickLink Wanted List
 * Mass Upload XML and the Rebrickable part-list import CSV. DOM-free so the builders
 * are unit-testable; the Parts sheet wires them to `downloadBlob`.
 *
 * Both formats target the same physical piece: the 1x1 round tile (Dots).
 */

/** BrickLink catalog item no. for Tile, Round 1x1, the piece Dots mosaics are built from. */
export const DOTS_PART_ID = '98138';

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

/** One wanted line: LEGO color name and how many dots of it the mosaic needs. */
export interface ManifestItem {
  colorName: string;
  qty: number;
}

/** Merge per-palette-index counts into one item per color name. */
export function manifestItems(counts: number[], names: string[]): ManifestItem[] {
  const totals = new Map<string, number>();
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0) totals.set(names[i], (totals.get(names[i]) ?? 0) + counts[i]);
  }
  return [...totals].map(([colorName, qty]) => ({ colorName, qty }));
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
        `<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${DOTS_PART_ID}</ITEMID>` +
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
    if (color !== undefined && it.qty > 0) lines.push(`${DOTS_PART_ID},${color},${it.qty}`);
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
