// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { celebrate, celebratePanel } from '../src/ui/celebrate';
import { closeAllOverlays, isOverlayOpen } from '../src/ui/dom';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  closeAllOverlays();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('panel celebration', () => {
  it('shows a board-local badge without confetti and cleans up on completion', async () => {
    const board = document.createElement('div');
    document.body.append(board);
    const done = celebratePanel(board);
    expect(board.querySelector('[role="status"]')?.textContent).toBe('Panel complete');
    expect(document.querySelectorAll('.confetti')).toHaveLength(0);
    expect(isOverlayOpen()).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    await done;
    expect(board.children).toHaveLength(0);
    expect(isOverlayOpen()).toBe(false);
  });

  it('resolves when navigation dismisses the badge and clears its timer', async () => {
    const board = document.createElement('div');
    document.body.append(board);
    const done = celebratePanel(board);
    closeAllOverlays();
    await done;
    expect(board.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(isOverlayOpen()).toBe(false);
  });

  it('keeps full-picture confetti separate from the panel badge', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    const done = celebrate([{ hex: '#f2cd37', name: 'Yellow' }], 'Picture complete!');
    expect(document.querySelectorAll('.confetti')).toHaveLength(48);
    expect(document.querySelector('.panel-complete-badge')).toBeNull();
    closeAllOverlays();
    await done;
    expect(vi.getTimerCount()).toBe(0);
  });
});
