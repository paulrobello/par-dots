/** Reads image dimensions from PNG, JPEG, WebP and GIF headers without decoding pixels. */

/** Largest source image accepted, in pixels (40 MP); checked before any decode. */
export const MAX_SOURCE_PIXELS = 40_000_000;

export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b: Uint8Array, o: number): number =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

const ascii = (b: Uint8Array, o: number, s: string): boolean => {
  if (o + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false;
  return true;
};

function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function gifSize(b: Uint8Array): ImageSize | null {
  if (b.length < 10) return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (ascii(b, 12, 'VP8 ')) {
    if (b.length < 30) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, 'VP8X')) {
    if (b.length < 30) return null;
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

const isSof = (m: number): boolean =>
  m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    if (i + 3 >= b.length) return null;
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    if (isSof(marker)) {
      if (i + 8 >= b.length) return null;
      return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

/** Width/height read from a PNG, JPEG, WebP or GIF header, or null when unrecognized. */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return pngSize(b);
  }
  if (ascii(b, 0, 'GIF8')) return gifSize(b);
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return webpSize(b);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  return null;
}
