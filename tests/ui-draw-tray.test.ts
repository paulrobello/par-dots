// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { DrawSession } from '../src/game';
import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';
import { h } from '../src/ui/dom';
import { createDrawTray } from '../src/ui/drawTray';
import { paletteEntryFor } from '../src/ui/pure';

function drawnSave(): PictureSave {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: 'd1',
    createdAt: 1,
    updatedAt: 1,
    name: 'd',
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
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

describe('paletteEntryFor', () => {
  it('accepts LEGO table colors only in LEGO mode', () => {
    expect(paletteEntryFor('lego', '#c91a09')).toEqual({ hex: '#c91a09', name: 'Red' });
    expect(() => paletteEntryFor('lego', '#123456')).toThrow();
  });

  it('derives free names from the shade', () => {
    const entry = paletteEntryFor('free', '#336699');
    expect(entry.hex).toBe('#336699');
    expect(entry.name).toBe('Blue');
  });
});

describe('createDrawTray', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    el = h('div', {});
    document.body.append(el);
  });

  it('renders swatches with usage counts and forwards picks', () => {
    const session = new DrawSession(drawnSave());
    session.beginStroke('paint');
    session.strokeAt(0, 0);
    session.endStroke();
    const picks: number[] = [];
    const tray = createDrawTray(el, session, 'lego', (c) => picks.push(c));
    const swatches = [...el.querySelectorAll<HTMLButtonElement>('.draw-swatch button')].filter(
      (b) => b.getAttribute('role') === 'radio',
    );
    expect(swatches).toHaveLength(2);
    // The paint stroke used the primary color (index 0), so its swatch shows one dot.
    expect(el.querySelectorAll('.draw-swatch')[0].textContent).toContain('1');
    swatches[0].click();
    expect(picks).toEqual([0]);
    tray.dispose();
  });

  it('the add-color sheet adds a LEGO color and refreshes', () => {
    const session = new DrawSession(drawnSave());
    const tray = createDrawTray(el, session, 'lego', () => undefined);
    (el.querySelector('[aria-label="Add color"]') as HTMLButtonElement).click();
    const sheet = document.querySelector('.sheet') as HTMLElement;
    expect(sheet).toBeTruthy();
    const red = [...sheet.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('title') === 'Red',
    ) as HTMLButtonElement;
    red.click();
    expect(session.save.palette).toHaveLength(3);
    expect(session.save.palette[2].name).toBe('Red');
    expect(document.querySelector('.sheet')).toBeNull(); // closed after apply
    tray.dispose();
  });

  it('the edit sheet blocks removing a used color', () => {
    const session = new DrawSession(drawnSave());
    session.beginStroke('paint');
    session.strokeAt(0, 0);
    session.endStroke();
    const tray = createDrawTray(el, session, 'lego', () => undefined);
    (el.querySelector('[aria-label="Edit Black"]') as HTMLButtonElement).click();
    const remove = [...document.querySelectorAll<HTMLButtonElement>('.sheet button')].find(
      (b) => b.textContent === 'Remove color',
    ) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    tray.dispose();
  });
});
