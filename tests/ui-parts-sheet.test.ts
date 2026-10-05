// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';
import { openPartsSheet } from '../src/ui/partsSheet';

beforeEach(() => {
  document.body.replaceChildren();
});

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
    panelElapsedMs: new Array<number>(9).fill(0),
  };
}

describe('openPartsSheet for drawn saves', () => {
  it('reports every placed dot as done in the per-color rows', () => {
    const save = drawnSave();
    save.placed[0] = 1; // White
    save.placed[1] = 1; // White
    save.placed[2] = 0; // Black
    openPartsSheet(save);
    const done = [...document.querySelectorAll<HTMLTableCellElement>('tbody .parts-done')].map(
      (td) => td.textContent,
    );
    // Rows sort by count desc: White (2) first, then Black (1); drawn saves count their
    // placed dots as both the need and the done amount.
    expect(done).toEqual(['2 done', '1 done']);
  });

  it('reports zero done for a drawn save with nothing placed', () => {
    openPartsSheet(drawnSave());
    expect(document.querySelector('.parts-total')?.textContent).toBe('0');
    const done = [...document.querySelectorAll<HTMLTableCellElement>('tbody .parts-done')].map(
      (td) => td.textContent,
    );
    expect(done).toEqual([]);
  });
});
