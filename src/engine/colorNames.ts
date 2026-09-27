import { hexToRgb } from './color';

/** Return a short, deterministic descriptive name for an RGB color. */
export function describeColor(hex: string): string {
  // Imported palettes use the renderer's lenient hex contract, including #rgb.
  let normalized = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(normalized)) {
    normalized = [...normalized].map((c) => c + c).join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return 'Gray';
  const [r, g, b] = hexToRgb(normalized);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 510;
  const chroma = (max - min) / 255;

  // Keep genuinely neutral colors out of the hue buckets first.
  if (chroma < 0.05) {
    if (lightness < 0.12) return 'Black';
    if (lightness > 0.92) return 'White';
    if (lightness < 0.3) return 'Dark Gray';
    if (lightness > 0.75) return 'Light Gray';
    return 'Gray';
  }
  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === r) hue = 60 * (((g - b) / (max - min) + 6) % 6);
  else if (max === g) hue = 60 * ((b - r) / (max - min) + 2);
  else hue = 60 * ((r - g) / (max - min) + 4);

  if (hue < 8 || hue >= 330) {
    if (lightness < 0.28) return 'Burgundy';
    if (lightness > 0.68 && saturation > 0.45) return 'Pink';
    return 'Red';
  }
  if (hue < 45) {
    if (lightness < 0.33) return 'Brown';
    if (lightness < 0.48) return 'Rust';
    if (saturation < 0.6 && lightness > 0.6) return 'Tan';
    if (lightness > 0.65) return 'Peach';
    return 'Orange';
  }
  if (hue < 70) {
    if (lightness > 0.86 && chroma < 0.18) return 'Beige';
    if (lightness < 0.45 && saturation > 0.4) return 'Olive';
    return 'Yellow';
  }
  if (hue < 105) return 'Lime';
  if (hue < 165) {
    if (lightness < 0.3) return 'Dark Green';
    if (lightness > 0.7) return 'Light Green';
    return 'Green';
  }
  if (hue < 190) {
    if (hue <= 183 && lightness > 0.45 && saturation > 0.8) return 'Cyan';
    return 'Teal';
  }
  if (hue < 210) return lightness > 0.7 ? 'Light Blue' : 'Cyan';
  if (hue < 260) {
    if (lightness < 0.35) return 'Navy';
    if (hue >= 235 && lightness > 0.72 && chroma < 0.12) return 'Lavender';
    if (lightness > 0.72) return 'Light Blue';
    return 'Blue';
  }
  if (hue < 300) return lightness > 0.68 ? 'Lavender' : 'Purple';
  return 'Magenta';
}
