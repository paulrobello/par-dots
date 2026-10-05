import { describe, expect, it } from 'vitest';
import { LEGO_COLORS } from '../src/engine/legoPalette';
import { LAYOUT } from '../src/types';
import {
  brickLinkColorId,
  CANVAS_PART_ID,
  DOTS_PART_ID,
  frameItems,
  HANGER_PART_ID,
  manifestItems,
  manifestStem,
  mountingItems,
  PIN_BRICKLINK_PART_ID,
  PIN_PART_ID,
  PINS_PER_EDGE,
  rebrickableColorId,
  rebrickableCsv,
  sharedEdges,
  wantedListXml,
} from '../src/ui/manifests';

describe('manifest color tables', () => {
  it('covers every LEGO palette color in both tables', () => {
    for (const c of LEGO_COLORS) {
      expect(brickLinkColorId(c.name), `BrickLink id for ${c.name}`).toBeDefined();
      expect(rebrickableColorId(c.name), `Rebrickable id for ${c.name}`).toBeDefined();
    }
  });
});

describe('wantedListXml', () => {
  it('emits one wanted ITEM per item with its part id and quantity', () => {
    const xml = wantedListXml([
      { partId: DOTS_PART_ID, colorName: 'Red', qty: 150 },
      { partId: DOTS_PART_ID, colorName: 'White', qty: 12 },
    ]);
    expect(xml.startsWith('<INVENTORY>')).toBe(true);
    expect(xml.endsWith('</INVENTORY>')).toBe(true);
    expect(xml).toContain('<ITEMTYPE>P</ITEMTYPE>');
    expect(xml).toContain(`<ITEMID>${DOTS_PART_ID}</ITEMID>`);
    expect(xml).toContain('<COLOR>5</COLOR><QTYFILLED>0</QTYFILLED><MINQTY>150</MINQTY>');
    expect(xml).toContain('<COLOR>1</COLOR>');
    expect(xml).not.toContain('<?xml');
  });

  it('emits the part id per item, not just dots', () => {
    const xml = wantedListXml([{ partId: PIN_PART_ID, colorName: 'Black', qty: 60 }]);
    expect(xml).toContain(`<ITEMID>${PIN_PART_ID}</ITEMID>`);
  });

  it('uses the BrickLink item number when the catalog diverges', () => {
    const xml = wantedListXml([
      { partId: PIN_PART_ID, brickLinkPartId: PIN_BRICKLINK_PART_ID, colorName: 'Black', qty: 60 },
    ]);
    expect(xml).toContain(`<ITEMID>${PIN_BRICKLINK_PART_ID}</ITEMID>`);
    expect(xml).not.toContain(PIN_PART_ID);
    // Rebrickable keeps its own design id
    const csv = rebrickableCsv([
      { partId: PIN_PART_ID, brickLinkPartId: PIN_BRICKLINK_PART_ID, colorName: 'Black', qty: 60 },
    ]);
    expect(csv).toContain(`${PIN_PART_ID},0,60`);
  });

  it('skips unknown colors and non-positive quantities', () => {
    const xml = wantedListXml([
      { partId: DOTS_PART_ID, colorName: 'Not A Lego Color', qty: 10 },
      { partId: DOTS_PART_ID, colorName: 'Red', qty: 0 },
      { partId: DOTS_PART_ID, colorName: 'Red', qty: 3 },
    ]);
    expect(xml).toContain('<MINQTY>3</MINQTY>');
    expect((xml.match(/<ITEM>/g) ?? []).length).toBe(1);
  });
});

describe('rebrickableCsv', () => {
  it('emits the import header and one row per item', () => {
    const csv = rebrickableCsv([
      { partId: DOTS_PART_ID, colorName: 'Red', qty: 150 },
      { partId: PIN_PART_ID, colorName: 'Black', qty: 60 },
    ]);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('part_num,color_id,quantity');
    expect(lines[1]).toBe(`${DOTS_PART_ID},4,150`);
    expect(lines[2]).toBe(`${PIN_PART_ID},0,60`);
  });

  it('skips unknown colors and non-positive quantities', () => {
    const csv = rebrickableCsv([
      { partId: DOTS_PART_ID, colorName: 'Nope', qty: 5 },
      { partId: DOTS_PART_ID, colorName: 'Blue', qty: 0 },
      { partId: DOTS_PART_ID, colorName: 'Blue', qty: 7 },
    ]);
    expect(csv.trimEnd().split('\n')).toEqual([
      'part_num,color_id,quantity',
      `${DOTS_PART_ID},1,7`,
    ]);
  });
});

describe('mountingItems', () => {
  it('budgets canvases, pins, hangers and the raised frame for the grid', () => {
    const items = mountingItems('1:1', 'Black');
    const grid = LAYOUT['1:1'];
    expect(items.slice(0, 3)).toEqual([
      { partId: CANVAS_PART_ID, colorName: 'Black', qty: grid.cols * grid.rows },
      {
        partId: PIN_PART_ID,
        brickLinkPartId: PIN_BRICKLINK_PART_ID,
        colorName: 'Black',
        qty: PINS_PER_EDGE * sharedEdges('1:1'),
      },
      { partId: HANGER_PART_ID, colorName: 'Black', qty: 2 },
    ]);
    expect(items.slice(3)).toEqual(frameItems('1:1', 'Black'));
  });

  it('colors the frame parts with the chosen frame color', () => {
    for (const it of mountingItems('1:1', 'White').slice(3)) {
      expect(it.colorName).toBe('White');
    }
  });

  it('omits the whole frame when no frame is wanted', () => {
    const items = mountingItems('1:1', null);
    expect(items).toHaveLength(3);
  });
});

describe('frameItems', () => {
  const byPart = (items: ReturnType<typeof frameItems>): Record<string, number> =>
    Object.fromEntries(items.map((it) => [it.partId, it.qty]));

  it('lists the raised-frame recipe for the square grid', () => {
    // W = D = 50: ring runs 50/50/46/46, cap runs 46/46/46/46. The plate layer is two
    // passes because the backing's border ring is plates too.
    expect(byPart(frameItems('1:1', 'Black'))).toEqual({
      '91405': 9, // Plate 16x16 backing, one per panel
      '3460': 44, // Plate 1x8: backing border + dot-height layer
      '3666': 4, // Plate 1x6
      '3023': 4, // Plate 1x2
      '2465': 10, // Brick 1x16, up to panel-top height
      '3008': 2, // Brick 1x8
      '3010': 2, // Brick 1x4
      '3004': 4, // Brick 1x2
      '4162': 20, // Tile 1x8 cap, one plate above the dots
      '6636': 4, // Tile 1x6
      '3022': 4, // Plate 2x2 studded corner caps
    });
  });

  it('colors every frame line with the chosen frame color', () => {
    for (const it of frameItems('1:1', 'White')) {
      expect(it.colorName).toBe('White');
    }
  });
});

describe('manifestItems', () => {
  it('merges counts into one dot item per color name', () => {
    expect(manifestItems([3, 0, 5], ['Red', 'Ghost', 'Red'])).toEqual([
      { partId: DOTS_PART_ID, colorName: 'Red', qty: 8 },
    ]);
  });
});

describe('manifestStem', () => {
  it('slugifies picture names and falls back to mosaic', () => {
    expect(manifestStem('Lighthouse!  at Dusk')).toBe('lighthouse-at-dusk');
    expect(manifestStem('???')).toBe('mosaic');
  });
});
