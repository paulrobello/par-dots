/**
 * Color math for quantization: hex/RGB parsing, sRGB to CIE L*a*b* (D65), and CIE76 color
 * difference. DOM-free and shared with render/color.ts.
 */

export type RGB = [number, number, number];
export type Lab = [number, number, number];

/** Parse "#rrggbb" (or "rrggbb") into an RGB triple. */
export function hexToRgb(hex: string): RGB {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Invalid hex color: ${hex}`);
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Format RGB (0-255, clamped and rounded) as lowercase "#rrggbb". */
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** sRGB channel (0-255) to linear light in [0,1]. */
export function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
}

// D65 reference white.
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

/** sRGB (0-255) to CIE L*a*b* (D65). */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / XN;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) / YN;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / ZN;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Squared CIE76 distance; cheaper for nearest-color searches. */
export function deltaE76Sq(a: Lab, b: Lab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

/** CIE76 color difference (Euclidean distance in Lab). */
export function deltaE(a: Lab, b: Lab): number {
  return Math.sqrt(deltaE76Sq(a, b));
}
