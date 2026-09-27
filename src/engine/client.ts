/**
 * Main-thread client for the quantize worker. Correlates requests by id, and finishes a job
 * with buildMosaic on the main thread when workers are unavailable, the worker crashes, or a
 * job outlives QUANTIZE_TIMEOUT_MS.
 */

import type { Mosaic, PaletteMode } from '../types';
import { buildMosaic } from './quantize';
import type { QuantizeRequest, QuantizeResponse } from './worker';

interface Pending {
  req: QuantizeRequest;
  resolve: (m: Mosaic) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** A job the worker has not answered by then is finished on the main thread instead. */
export const QUANTIZE_TIMEOUT_MS = 20_000;

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function runOnMainThread(p: Pending): void {
  try {
    const { pixels, width, height, mode, maxColors, dither } = p.req;
    p.resolve(buildMosaic(pixels, width, height, mode, maxColors, dither));
  } catch (err) {
    p.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  if (typeof Worker === 'undefined') {
    workerBroken = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (ev: MessageEvent<QuantizeResponse>): void => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    clearTimeout(p.timer);
    if ('mosaic' in ev.data) p.resolve(ev.data.mosaic);
    else p.reject(new Error(ev.data.error));
  };
  worker.onerror = (): void => {
    // Worker failed to load or crashed: finish outstanding jobs on the main thread.
    workerBroken = true;
    worker?.terminate();
    worker = null;
    const jobs = [...pending.values()];
    pending.clear();
    for (const p of jobs) {
      clearTimeout(p.timer);
      runOnMainThread(p);
    }
  };
  return worker;
}

/**
 * Quantize in a Web Worker, falling back to the main thread when workers are
 * unavailable. `pixels` is copied, not transferred, so the caller keeps it.
 */
export function quantizeInWorker(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  mode: PaletteMode,
  maxColors?: number,
  dither?: boolean,
): Promise<Mosaic> {
  return new Promise<Mosaic>((resolve, reject) => {
    const req: QuantizeRequest = {
      id: nextId++,
      pixels,
      width: w,
      height: h,
      mode,
      maxColors,
      dither,
    };
    const p: Pending = { req, resolve, reject };
    const wk = getWorker();
    if (!wk) {
      runOnMainThread(p);
      return;
    }
    pending.set(req.id, p);
    wk.postMessage(req);
    // A single slow job is not a crash, so the worker stays in use for later jobs.
    p.timer = setTimeout(() => {
      if (pending.delete(req.id)) runOnMainThread(p);
    }, QUANTIZE_TIMEOUT_MS);
  });
}
