import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_CHECK_MS, watchForUpdates } from '../src/ui/swUpdate';

function fakeDoc(): {
  doc: Parameters<typeof watchForUpdates>[1];
  setVisibility: (v: DocumentVisibilityState) => void;
  listeners: () => number;
} {
  const target = new EventTarget();
  let state: DocumentVisibilityState = 'visible';
  let count = 0;
  const doc = {
    get visibilityState() {
      return state;
    },
    addEventListener: (type: string, fn: EventListener) => {
      count++;
      target.addEventListener(type, fn);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      count--;
      target.removeEventListener(type, fn);
    },
  } as unknown as Parameters<typeof watchForUpdates>[1];
  return {
    doc,
    setVisibility: (v) => {
      state = v;
      target.dispatchEvent(new Event('visibilitychange'));
    },
    listeners: () => count,
  };
}

describe('watchForUpdates', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('checks every 60 minutes', () => {
    const reg = { update: vi.fn(() => Promise.resolve()) };
    const { doc } = fakeDoc();
    watchForUpdates(reg, doc);
    expect(UPDATE_CHECK_MS).toBe(60 * 60 * 1000);
    vi.advanceTimersByTime(UPDATE_CHECK_MS - 1);
    expect(reg.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reg.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  it('checks when the page becomes visible, not when it hides', () => {
    const reg = { update: vi.fn(() => Promise.resolve()) };
    const f = fakeDoc();
    watchForUpdates(reg, f.doc);
    f.setVisibility('hidden');
    expect(reg.update).not.toHaveBeenCalled();
    f.setVisibility('visible');
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it('swallows a failed check and stops on dispose', async () => {
    const reg = { update: vi.fn(() => Promise.reject(new Error('offline'))) };
    const f = fakeDoc();
    const stop = watchForUpdates(reg, f.doc);
    f.setVisibility('visible');
    await Promise.resolve();
    stop();
    expect(f.listeners()).toBe(0);
    vi.advanceTimersByTime(UPDATE_CHECK_MS * 3);
    f.setVisibility('visible');
    expect(reg.update).toHaveBeenCalledTimes(1);
  });
});
