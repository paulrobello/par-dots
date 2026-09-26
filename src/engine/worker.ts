import type { Mosaic, PaletteMode } from '../types';
import { buildMosaic } from './quantize';

export interface QuantizeRequest {
  id: number;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  mode: PaletteMode;
}

export type QuantizeResponse = { id: number; mosaic: Mosaic } | { id: number; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<QuantizeRequest>): void => {
  const { id, pixels, width, height, mode } = ev.data;
  try {
    const mosaic = buildMosaic(pixels, width, height, mode);
    const msg: QuantizeResponse = { id, mosaic };
    ctx.postMessage(msg, [mosaic.target.buffer]);
  } catch (err) {
    const msg: QuantizeResponse = { id, error: err instanceof Error ? err.message : String(err) };
    ctx.postMessage(msg);
  }
};
