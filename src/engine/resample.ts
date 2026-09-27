/**
 * Crop-and-resample to stud resolution with exact area averaging, so each stud is the
 * coverage-weighted mean of the source pixels under it.
 */

import type { CropRect } from '../types';

export interface ImageLike {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/**
 * Crop `src` to `crop` (source pixel coords, clamped to the image) and resample
 * to outW x outH RGBA using area averaging (exact box-filter coverage weights).
 */
export function cropAndResample(
  src: ImageLike,
  crop: CropRect,
  outW: number,
  outH: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(Math.max(0, outW * outH * 4));
  const cx0 = Math.max(0, Math.min(src.width, crop.x));
  const cy0 = Math.max(0, Math.min(src.height, crop.y));
  const cx1 = Math.max(cx0, Math.min(src.width, crop.x + crop.w));
  const cy1 = Math.max(cy0, Math.min(src.height, crop.y + crop.h));
  if (cx1 <= cx0 || cy1 <= cy0 || outW <= 0 || outH <= 0) return out;
  const sx = (cx1 - cx0) / outW;
  const sy = (cy1 - cy0) / outH;
  const d = src.data;

  for (let oy = 0; oy < outH; oy++) {
    const y0 = cy0 + oy * sy;
    const y1 = y0 + sy;
    const iy0 = Math.floor(y0);
    const iy1 = Math.min(src.height, Math.ceil(y1));
    for (let ox = 0; ox < outW; ox++) {
      const x0 = cx0 + ox * sx;
      const x1 = x0 + sx;
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(src.width, Math.ceil(x1));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (let iy = iy0; iy < iy1; iy++) {
        const wy = Math.min(y1, iy + 1) - Math.max(y0, iy);
        if (wy <= 0) continue;
        for (let ix = ix0; ix < ix1; ix++) {
          const wx = Math.min(x1, ix + 1) - Math.max(x0, ix);
          if (wx <= 0) continue;
          const w = wx * wy;
          const p = (iy * src.width + ix) * 4;
          r += d[p] * w;
          g += d[p + 1] * w;
          b += d[p + 2] * w;
          a += d[p + 3] * w;
          wsum += w;
        }
      }
      if (wsum > 0) {
        const o = (oy * outW + ox) * 4;
        out[o] = r / wsum;
        out[o + 1] = g / wsum;
        out[o + 2] = b / wsum;
        out[o + 3] = a / wsum;
      }
    }
  }
  return out;
}
