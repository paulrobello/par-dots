import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyWhenHidden,
  checkBuild,
  isImmersiveActive,
  setImmersiveActive,
  UPDATE_CHECK_MS,
  watchForUpdates,
} from '../src/ui/swUpdate';

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

describe('build fingerprints', () => {
  it('bypasses HTTP cache and detects a changed content hash', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ fingerprint: 'b'.repeat(64) })));
    const changed = vi.fn();
    await checkBuild('a'.repeat(64), changed, fetcher);
    expect(fetcher).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
    expect(changed).toHaveBeenCalledOnce();
  });

  it('does not request a reload for unchanged, invalid or offline builds', async () => {
    const changed = vi.fn();
    const fetcher = vi.fn<typeof fetch>();
    for (const fingerprint of ['a'.repeat(64), '', 'invalid']) {
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ fingerprint })));
      await checkBuild('a'.repeat(64), changed, fetcher);
    }
    fetcher.mockRejectedValueOnce(new Error('offline'));
    await checkBuild('a'.repeat(64), changed, fetcher);
    expect(changed).not.toHaveBeenCalled();
  });

  it('tracks immersive activity independently of page visibility', () => {
    setImmersiveActive(true);
    expect(isImmersiveActive()).toBe(true);
    setImmersiveActive(false);
    expect(isImmersiveActive()).toBe(false);
  });
});

describe('watchForUpdates', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('checks immediately and then every 5 minutes', () => {
    const reg = { update: vi.fn(() => Promise.resolve()) };
    const { doc } = fakeDoc();
    watchForUpdates(reg, doc);
    expect(UPDATE_CHECK_MS).toBe(5 * 60 * 1000);
    expect(reg.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UPDATE_CHECK_MS - 1);
    expect(reg.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(reg.update).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(reg.update).toHaveBeenCalledTimes(3);
  });

  it('checks when the page becomes visible, not when it hides', () => {
    const reg = { update: vi.fn(() => Promise.resolve()) };
    const f = fakeDoc();
    watchForUpdates(reg, f.doc);
    expect(reg.update).toHaveBeenCalledTimes(1);
    f.setVisibility('hidden');
    expect(reg.update).toHaveBeenCalledTimes(1);
    f.setVisibility('visible');
    expect(reg.update).toHaveBeenCalledTimes(2);
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
    expect(reg.update).toHaveBeenCalledTimes(2);
  });
});

describe('applyWhenHidden', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies only after a slow hide-time save resolves', async () => {
    const f = fakeDoc();
    let finishSave: () => void = () => {};
    const slowSave = new Promise<void>((r) => {
      finishSave = r;
    });
    const apply = vi.fn();
    applyWhenHidden(f.doc, () => slowSave, apply);
    f.setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(apply).not.toHaveBeenCalled();
    finishSave();
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('applies even when the save fails, ignores becoming visible, and stops on dispose', async () => {
    const f = fakeDoc();
    const apply = vi.fn();
    const stop = applyWhenHidden(f.doc, () => Promise.reject(new Error('quota')), apply);
    f.setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).not.toHaveBeenCalled();
    f.setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledTimes(1);
    stop();
    expect(f.listeners()).toBe(0);
  });
});
