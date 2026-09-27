/**
 * Quantize Web Worker: runs buildMosaic for each request and posts the mosaic back,
 * transferring its target buffer. The request/response protocol is typed here and used by
 * engine/client.ts.
 */

import type { Mosaic, PaletteMode } from '../types';
import { buildMosaic } from './quantize';

/**
 * Main thread to worker. `pixels` is structured-cloned (copied, not transferred), so the
 * caller keeps its buffer. Arguments match buildMosaic.
 */
export interface QuantizeRequest {
  /** Caller-chosen id echoed in the response, so replies can arrive out of order. */
  id: number;
  /** RGBA bytes at stud resolution, length width * height * 4. */
  pixels: Uint8ClampedArray;
  /** Mosaic width in studs. */
  width: number;
  /** Mosaic height in studs. */
  height: number;
  mode: PaletteMode;
  /** Color cap, clamped to MIN_COLORS..MAX_COLORS by buildMosaic. Defaults to MAX_COLORS. */
  maxColors?: number;
}

/**
 * Worker to main thread, with the request's id: the mosaic (its target buffer transferred),
 * or the message of the error buildMosaic threw.
 */
export type QuantizeResponse = { id: number; mosaic: Mosaic } | { id: number; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<QuantizeRequest>): void => {
  const { id, pixels, width, height, mode, maxColors } = ev.data;
  try {
    const mosaic = buildMosaic(pixels, width, height, mode, maxColors);
    const msg: QuantizeResponse = { id, mosaic };
    ctx.postMessage(msg, [mosaic.target.buffer]);
  } catch (err) {
    const msg: QuantizeResponse = { id, error: err instanceof Error ? err.message : String(err) };
    ctx.postMessage(msg);
  }
};
