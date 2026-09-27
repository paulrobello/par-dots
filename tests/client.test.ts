import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMosaic } from '../src/engine/quantize';

/** Worker stand-in that records every request and never replies on its own. */
class SilentWorker {
  static instances: SilentWorker[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  posted: Array<{ id: number }> = [];
  terminated = false;
  constructor() {
    SilentWorker.instances.push(this);
  }
  postMessage(msg: { id: number }): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
}

function pixels(seed: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(48 * 48 * 4);
  for (let i = 0; i < px.length; i++) px[i] = i % 4 === 3 ? 255 : (i * seed * 31) & 255;
  return px;
}

async function freshClient(): Promise<typeof import('../src/engine/client')> {
  vi.resetModules();
  return import('../src/engine/client');
}

beforeEach(() => {
  SilentWorker.instances = [];
  vi.stubGlobal('Worker', SilentWorker);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('quantizeInWorker', () => {
  it('replays pending jobs on the main thread when the worker errors', async () => {
    const { quantizeInWorker } = await freshClient();
    const a = quantizeInWorker(pixels(3), 48, 48, 'lego', 12);
    const b = quantizeInWorker(pixels(5), 48, 48, 'free', 8);
    expect(SilentWorker.instances).toHaveLength(1);
    const wk = SilentWorker.instances[0];
    expect(wk.posted).toHaveLength(2);

    wk.onerror?.(new Event('error'));

    await expect(a).resolves.toEqual(buildMosaic(pixels(3), 48, 48, 'lego', 12));
    await expect(b).resolves.toEqual(buildMosaic(pixels(5), 48, 48, 'free', 8));
    expect(wk.terminated).toBe(true);

    // The worker is marked broken: later jobs run on the main thread without a new worker.
    await expect(quantizeInWorker(pixels(7), 48, 48, 'lego')).resolves.toEqual(
      buildMosaic(pixels(7), 48, 48, 'lego'),
    );
    expect(SilentWorker.instances).toHaveLength(1);
  });

  it('resolves from the worker reply', async () => {
    const { quantizeInWorker } = await freshClient();
    const p = quantizeInWorker(pixels(3), 48, 48, 'lego');
    const wk = SilentWorker.instances[0];
    const mosaic = buildMosaic(pixels(3), 48, 48, 'lego');
    wk.onmessage?.(new MessageEvent('message', { data: { id: wk.posted[0].id, mosaic } }));
    await expect(p).resolves.toBe(mosaic);
  });

  it('rejects with the worker error message', async () => {
    const { quantizeInWorker } = await freshClient();
    const p = quantizeInWorker(pixels(3), 48, 48, 'lego');
    const wk = SilentWorker.instances[0];
    wk.onmessage?.(new MessageEvent('message', { data: { id: wk.posted[0].id, error: 'bad' } }));
    await expect(p).rejects.toThrow('bad');
  });

  it('falls back to the main thread when the worker does not answer in time', async () => {
    vi.useFakeTimers();
    const { quantizeInWorker, QUANTIZE_TIMEOUT_MS } = await freshClient();
    const settled = vi.fn();
    const p = quantizeInWorker(pixels(3), 48, 48, 'lego');
    void p.then(settled);
    const wk = SilentWorker.instances[0];
    vi.advanceTimersByTime(QUANTIZE_TIMEOUT_MS - 1);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    const expected = buildMosaic(pixels(3), 48, 48, 'lego');
    await expect(p).resolves.toEqual(expected);

    // A late reply is ignored, and the worker is still used for the next job.
    wk.onmessage?.(
      new MessageEvent('message', { data: { id: wk.posted[0].id, mosaic: { stale: true } } }),
    );
    await Promise.resolve();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0][0]).toEqual(expected);
    expect(wk.terminated).toBe(false);
    void quantizeInWorker(pixels(5), 48, 48, 'lego');
    expect(wk.posted).toHaveLength(2);
  });

  it('clears the timeout once the worker replies', async () => {
    vi.useFakeTimers();
    const { quantizeInWorker } = await freshClient();
    const p = quantizeInWorker(pixels(3), 48, 48, 'lego');
    const wk = SilentWorker.instances[0];
    const mosaic = buildMosaic(pixels(3), 48, 48, 'lego');
    wk.onmessage?.(new MessageEvent('message', { data: { id: wk.posted[0].id, mosaic } }));
    expect(vi.getTimerCount()).toBe(0);
    await expect(p).resolves.toBe(mosaic);
  });

  it('runs on the main thread when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const { quantizeInWorker } = await freshClient();
    await expect(quantizeInWorker(pixels(3), 48, 48, 'free')).resolves.toEqual(
      buildMosaic(pixels(3), 48, 48, 'free'),
    );
  });
});
