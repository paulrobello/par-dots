// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY, type PictureSave } from '../src/types';
import { createTrayView } from '../src/ui/playView';

function makeSave(): PictureSave {
  return {
    schemaVersion: 1,
    id: 'tray-view',
    createdAt: 0,
    updatedAt: 0,
    name: 'Tray view',
    sourceImageId: 'library:tray-view',
    aspect: '1:1',
    paletteMode: 'free',
    origin: 'photo',
    palette: [
      { hex: '#111111', name: 'Black' },
      { hex: '#eeeeee', name: 'White' },
      { hex: '#dd3333', name: 'Red' },
    ],
    width: 16,
    height: 16,
    target: new Uint8Array(16 * 16),
    placed: new Uint8Array(16 * 16).fill(EMPTY),
    panelElapsedMs: [0],
  };
}

function setup() {
  const tray = document.createElement('div');
  document.body.append(tray);
  const picked: number[] = [];
  const view = createTrayView(tray, makeSave(), ['Black', 'White', 'Red'], ['A', 'B', 'C'], (c) =>
    picked.push(c),
  );
  return { tray, view, picked };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('createTrayView', () => {
  it('checks a completed positive-count color before it leaves', () => {
    vi.useFakeTimers();
    const { tray, view } = setup();
    view.sync(
      [0, 1],
      new Map([
        [0, 2],
        [1, 1],
      ]),
      false,
    );
    view.sync([1], new Map([[1, 1]]), true);

    const completed = tray.querySelector<HTMLButtonElement>('[data-color="0"]');
    expect(completed?.classList.contains('completing')).toBe(true);
    vi.advanceTimersByTime(150);
    expect(completed?.classList.contains('leaving')).toBe(true);
    vi.advanceTimersByTime(280);
    expect(tray.querySelector('[data-color="0"]')).toBeNull();
  });

  it('keeps an incomplete zero-count color without a completion check', () => {
    const { tray, view } = setup();
    view.sync([0], new Map([[0, 0]]), false);
    view.sync([0], new Map([[0, 0]]), true);

    const dot = tray.querySelector('[data-color="0"]');
    expect(dot?.classList.contains('empty')).toBe(true);
    expect(dot?.classList.contains('completing')).toBe(false);
  });

  it('reuses a color reinserted while its leave is pending', () => {
    vi.useFakeTimers();
    const { tray, view } = setup();
    view.sync([0], new Map([[0, 1]]), false);
    view.sync([], new Map(), true);
    const leaving = tray.querySelector('[data-color="0"]');
    view.sync([0], new Map([[0, 1]]), true);

    expect(tray.querySelectorAll('[data-color="0"]')).toHaveLength(1);
    expect(tray.querySelector('[data-color="0"]')).toBe(leaving);
    vi.advanceTimersByTime(500);
    expect(tray.querySelectorAll('[data-color="0"]')).toHaveLength(1);
    expect(tray.querySelector('[data-color="0"]')?.classList.contains('leaving')).toBe(false);
  });

  it('supports keyboard navigation and removes listeners on dispose', () => {
    const { tray, view, picked } = setup();
    view.sync(
      [0, 1, 2],
      new Map([
        [0, 1],
        [1, 1],
        [2, 1],
      ]),
      false,
    );
    const first = tray.querySelector<HTMLButtonElement>('[data-color="0"]');
    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(picked).toEqual([1]);
    expect(document.activeElement).toBe(tray.querySelector('[data-color="1"]'));
    view.dispose();
    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(picked).toEqual([1]);
  });

  it.each([false, true])('preserves tray focus when a color completes (reduced: %s)', (reduced) => {
    vi.useFakeTimers();
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduced } as MediaQueryList);
    const { tray, view } = setup();
    view.sync(
      [0, 1],
      new Map([
        [0, 1],
        [1, 2],
      ]),
      false,
    );
    view.mark(0, true);
    tray.querySelector<HTMLButtonElement>('[data-color="0"]')?.focus();
    view.sync([1], new Map([[1, 2]]), true);
    view.mark(1, true);
    expect(document.activeElement).toBe(tray.querySelector('[data-color="1"]'));
    vi.advanceTimersByTime(500);
    expect(document.activeElement).toBe(tray.querySelector('[data-color="1"]'));
    view.dispose();
  });

  it('does not steal focus from a toolbar control when the tray changes', () => {
    const { view } = setup();
    const toolbar = document.createElement('button');
    document.body.append(toolbar);
    view.sync(
      [0, 1],
      new Map([
        [0, 1],
        [1, 2],
      ]),
      false,
    );
    toolbar.focus();
    view.sync([1], new Map([[1, 2]]), false);
    view.mark(1, true);
    expect(document.activeElement).toBe(toolbar);
    view.dispose();
  });

  it('applies removals immediately when reduced motion is requested', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    vi.useFakeTimers();
    const { tray, view } = setup();
    view.sync([0], new Map([[0, 1]]), false);
    view.sync([], new Map(), true);
    expect(tray.querySelector('[data-color="0"]')).toBeNull();
    vi.advanceTimersByTime(500);
    expect(tray.querySelectorAll('.tray-dot')).toHaveLength(0);
  });
});
