import { describe, expect, it } from 'vitest';

import { LEGO_COLORS } from '../src/engine/legoPalette';
import {
  brickLinkColorId,
  DOTS_PART_ID,
  manifestItems,
  manifestStem,
  rebrickableColorId,
  rebrickableCsv,
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
  it('emits one wanted ITEM per known color with the part id and quantity', () => {
    const xml = wantedListXml([
      { colorName: 'Red', qty: 150 },
      { colorName: 'White', qty: 12 },
    ]);
    expect(xml.startsWith('<INVENTORY>')).toBe(true);
    expect(xml.endsWith('</INVENTORY>')).toBe(true);
    expect(xml).toContain('<ITEMTYPE>P</ITEMTYPE>');
    expect(xml).toContain(`<ITEMID>${DOTS_PART_ID}</ITEMID>`);
    expect(xml).toContain('<COLOR>5</COLOR><QTYFILLED>0</QTYFILLED><MINQTY>150</MINQTY>');
    expect(xml).toContain('<COLOR>1</COLOR>');
    expect(xml).not.toContain('<?xml');
  });

  it('skips unknown colors and non-positive quantities', () => {
    const xml = wantedListXml([
      { colorName: 'Not A Lego Color', qty: 10 },
      { colorName: 'Red', qty: 0 },
      { colorName: 'Red', qty: 3 },
    ]);
    expect(xml).toContain('<MINQTY>3</MINQTY>');
    expect((xml.match(/<ITEM>/g) ?? []).length).toBe(1);
  });

  it('escapes nothing but keeps names out of the file', () => {
    const xml = wantedListXml([{ colorName: 'Red', qty: 1 }]);
    expect(xml).not.toContain('Red');
  });
});

describe('rebrickableCsv', () => {
  it('emits the import header and one row per known color', () => {
    const csv = rebrickableCsv([
      { colorName: 'Red', qty: 150 },
      { colorName: 'Dark Turquoise', qty: 9 },
    ]);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('part_num,color_id,quantity');
    expect(lines[1]).toBe(`${DOTS_PART_ID},4,150`);
    expect(lines[2]).toBe(`${DOTS_PART_ID},3,9`);
  });

  it('skips unknown colors and non-positive quantities', () => {
    const csv = rebrickableCsv([
      { colorName: 'Nope', qty: 5 },
      { colorName: 'Blue', qty: 0 },
      { colorName: 'Blue', qty: 7 },
    ]);
    expect(csv.trimEnd().split('\n')).toEqual([
      'part_num,color_id,quantity',
      `${DOTS_PART_ID},1,7`,
    ]);
  });
});

describe('manifestItems', () => {
  it('merges counts into one item per color name', () => {
    expect(manifestItems([3, 0, 5], ['Red', 'Ghost', 'Red'])).toEqual([
      { colorName: 'Red', qty: 8 },
    ]);
  });
});

describe('manifestStem', () => {
  it('slugifies picture names and falls back to mosaic', () => {
    expect(manifestStem('Lighthouse!  at Dusk')).toBe('lighthouse-at-dusk');
    expect(manifestStem('???')).toBe('mosaic');
  });
});
