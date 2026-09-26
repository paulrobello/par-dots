/** Pure color math for sprite shading. DOM-free so it runs under Vitest's node environment. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

/** Parse "#rrggbb" or "#rgb" (case-insensitive). Invalid input yields mid gray. */
export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 128, g: 128, b: 128 };
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Linear mix of a toward b by t in [0,1]. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: clamp255(a.r + (b.r - a.r) * k),
    g: clamp255(a.g + (b.g - a.g) * k),
    b: clamp255(a.b + (b.b - a.b) * k),
  };
}

/**
 * Shade a color: positive amount mixes toward white, negative toward black.
 * amount is clamped to [-1, 1].
 */
export function shade(hex: string, amount: number): string {
  const c = hexToRgb(hex);
  const a = Math.max(-1, Math.min(1, amount));
  const target: Rgb = a >= 0 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  return rgbToHex(mixRgb(c, target, Math.abs(a)));
}

/** CSS rgba() string for a hex color at the given alpha. */
export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r},${g},${b},${a})`;
}

/** WCAG relative luminance in [0,1]. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Highlight/rim strengths tuned per color so very light plastics still show a rim
 * and very dark plastics still show a specular glint.
 */
export function plasticTones(hex: string): {
  light: string;
  base: string;
  dark: string;
  rim: string;
  specularAlpha: number;
} {
  const lum = luminance(hex);
  const darkAmt = lum > 0.7 ? -0.32 : -0.26;
  const lightAmt = lum < 0.05 ? 0.3 : 0.2;
  return {
    light: shade(hex, lightAmt),
    base: hex,
    dark: shade(hex, darkAmt),
    rim: shade(hex, lum > 0.7 ? -0.45 : -0.4),
    specularAlpha: lum > 0.8 ? 0.6 : 0.85,
  };
}
