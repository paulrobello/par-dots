// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/saves', () => ({ createSave: vi.fn(async () => undefined) }));

const { createSave } = await import('../src/ui/saves');
const { mountDrawCreate } = await import('../src/ui/drawCreate');

import { resetSettingsCache } from '../src/storage/settings';
import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';

function makeCtx(): { ctx: import('../src/ui/screen').ScreenContext; calls: string[] } {
  const calls: string[] = [];
  return {
    ctx: { root: document.body, navigate: (hash: string) => void calls.push(hash) },
    calls,
  };
}

/** Narrows a query result the verbatim fixture cannot: strict TS rejects the bare values. */
function must<T>(el: T | null | undefined): T {
  if (el === null || el === undefined) throw new Error('Expected element to exist');
  return el;
}

beforeEach(() => {
  document.body.replaceChildren();
  resetSettingsCache();
  localStorage.clear();
  vi.mocked(createSave).mockClear();
});

describe('mountDrawCreate', () => {
  it('creates a drawn save with the defaults and opens the editor', async () => {
    const { ctx, calls } = makeCtx();
    mountDrawCreate(ctx);
    const name = document.querySelector<HTMLInputElement>('input[aria-label="Drawing name"]');
    expect(name?.value).toBe('My drawing');
    (
      document.querySelector<HTMLButtonElement>('button.btn.primary.big') as HTMLButtonElement
    ).click();
    await vi.waitFor(() => expect(createSave).toHaveBeenCalledTimes(1));
    const save = vi.mocked(createSave).mock.calls[0][0] as PictureSave;
    expect(save.origin).toBe('drawn');
    expect(save.sourceImageId).toBe('');
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(save.drawBackground).toBeUndefined();
    expect(save.target.every((v) => v === EMPTY)).toBe(true);
    expect(save.placed.every((v) => v === EMPTY)).toBe(true);
    expect(save.palette.map((c) => c.name)).toEqual(['Black', 'White']);
    expect(save.panelElapsedMs.every((ms) => ms === 0)).toBe(true);
    expect(calls[0]).toMatch(/^#\/draw\/[^/]+$/);
  });

  it('pre-fills a free-mode custom background and stores drawBackground', async () => {
    const { ctx } = makeCtx();
    mountDrawCreate(ctx);
    const freeBtn = must(
      [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (b) => b.textContent === 'Free colors',
      ),
    );
    freeBtn.click();
    const input = must(
      document.querySelector<HTMLInputElement>('input[aria-label="Custom background color"]'),
    );
    input.value = '#336699';
    input.dispatchEvent(new Event('input'));
    (
      document.querySelector<HTMLButtonElement>('button.btn.primary.big') as HTMLButtonElement
    ).click();
    await vi.waitFor(() => expect(createSave).toHaveBeenCalledTimes(1));
    const save = vi.mocked(createSave).mock.calls[0][0] as PictureSave;
    expect(save.paletteMode).toBe('free');
    expect(save.drawBackground).toBe('#336699');
    expect(save.palette).toHaveLength(3);
    expect(save.placed.every((v) => v === 2)).toBe(true);
  });

  it('creates a bigger grid when a larger size is chosen', async () => {
    const { ctx } = makeCtx();
    mountDrawCreate(ctx);
    const medium = must(
      [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (b) => b.textContent === 'Medium',
      ),
    );
    medium.click();
    const hint = must(document.querySelector<HTMLParagraphElement>('p.muted.small'));
    expect(hint.textContent).toBe('36 panels · 96×96 studs');
    (
      document.querySelector<HTMLButtonElement>('button.btn.primary.big') as HTMLButtonElement
    ).click();
    await vi.waitFor(() => expect(createSave).toHaveBeenCalledTimes(1));
    const save = vi.mocked(createSave).mock.calls[0][0] as PictureSave;
    expect(save.width).toBe(96);
    expect(save.height).toBe(96);
    expect(save.panelElapsedMs).toHaveLength(36);
  });

  it('keeps the LEGO background choices to seeded LEGO colors', () => {
    const { ctx } = makeCtx();
    mountDrawCreate(ctx);
    expect(document.querySelector('input[aria-label="Custom background color"]')).toBeNull();
    const hexes = [...document.querySelectorAll<HTMLElement>('[role="radio"]')]
      .filter((b) => b.style.background !== '')
      .map((b) => b.style.background);
    expect(hexes).toContain('#05131d'); // LEGO Black; happy-dom keeps style.background raw
  });

  it('does not navigate when the screen is unmounted before the save resolves', async () => {
    let resolveSave: (() => void) | undefined;
    vi.mocked(createSave).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveSave = r;
        }),
    );
    const { ctx, calls } = makeCtx();
    const cleanup = mountDrawCreate(ctx);
    (
      document.querySelector<HTMLButtonElement>('button.btn.primary.big') as HTMLButtonElement
    ).click();
    expect(createSave).toHaveBeenCalledTimes(1);
    cleanup();
    must(resolveSave)();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
  });
});
