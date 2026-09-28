import { describe, expect, it } from 'vitest';
import { LEGO_COLORS } from '../src/engine/legoPalette';
import { LAYOUT } from '../src/types';
import {
  brickLinkColorId,
  CANVAS_PART_ID,
  DOTS_PART_ID,
  FRAME_PART_ID,
  HANGER_PART_ID,
  manifestItems,
  manifestStem,
  mountingItems,
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
  it('budgets canvases, pins, hangers and frame bricks for the grid', () => {
    const items = mountingItems('1:1', 'Black');
    const grid = LAYOUT['1:1'];
    expect(items).toEqual([
      { partId: CANVAS_PART_ID, colorName: 'Black', qty: grid.cols * grid.rows },
      { partId: PIN_PART_ID, colorName: 'Black', qty: PINS_PER_EDGE * sharedEdges('1:1') },
      { partId: HANGER_PART_ID, colorName: 'Black', qty: 2 },
      { partId: FRAME_PART_ID, colorName: 'Black', qty: 2 * (grid.cols + grid.rows) },
    ]);
  });

  it('colors the frame bricks with the chosen frame color', () => {
    const white = mountingItems('1:1', 'White').find((it) => it.partId === FRAME_PART_ID);
    expect(white?.colorName).toBe('White');
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
