import type { Mosaic, PaletteMode } from '../types';
import { buildMosaic } from './quantize';
import type { QuantizeRequest, QuantizeResponse } from './worker';

interface Pending {
  req: QuantizeRequest;
  resolve: (m: Mosaic) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function runOnMainThread(p: Pending): void {
  try {
    p.resolve(buildMosaic(p.req.pixels, p.req.width, p.req.height, p.req.mode, p.req.maxColors));
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
    for (const p of jobs) runOnMainThread(p);
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
): Promise<Mosaic> {
  return new Promise<Mosaic>((resolve, reject) => {
    const req: QuantizeRequest = { id: nextId++, pixels, width: w, height: h, mode, maxColors };
    const p: Pending = { req, resolve, reject };
    const wk = getWorker();
    if (!wk) {
      runOnMainThread(p);
      return;
    }
    pending.set(req.id, p);
    wk.postMessage(req);
  });
}
