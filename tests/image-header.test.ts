import { describe, expect, it } from 'vitest';
import { MAX_SOURCE_PIXELS, readImageSize } from '../src/ui/imageHeader';

const be32 = (n: number): number[] => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const le16 = (n: number): number[] => [n & 255, (n >>> 8) & 255];
const le24 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const le32 = (n: number): number[] => [...le16(n & 0xffff), ...le16(n >>> 16)];
const str = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

function png(w: number, h: number): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...str('IHDR'),
    ...be32(w),
    ...be32(h),
    8,
    6,
    0,
    0,
    0,
  ]);
}

function riff(chunk: string, payload: number[]): Uint8Array {
  return new Uint8Array([...str('RIFF'), ...le32(100), ...str('WEBP'), ...str(chunk), ...payload]);
}

describe('readImageSize', () => {
  it('reads PNG IHDR', () => {
    expect(readImageSize(png(4000, 3000))).toEqual({ width: 4000, height: 3000 });
  });

  it('reads GIF logical screen size', () => {
    const gif = new Uint8Array([...str('GIF89a'), ...le16(20), ...le16(10), 0, 0, 0]);
    expect(readImageSize(gif)).toEqual({ width: 20, height: 10 });
  });

  it('walks JPEG segments to SOF0', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...str('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const sof0 = [0xff, 0xc0, 0x00, 0x11, 8, 0x02, 0x58, 0x03, 0x20, 3, 1, 0x22, 0, 2, 0x11, 1];
    const jpeg = new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0, 0]);
    expect(readImageSize(jpeg)).toEqual({ width: 800, height: 600 });
  });

  it('reads WebP VP8X', () => {
    const payload = [...le32(10), 0, 0, 0, 0, ...le24(1919), ...le24(1079)];
    expect(readImageSize(riff('VP8X', payload))).toEqual({ width: 1920, height: 1080 });
  });

  it('reads WebP VP8 (lossy)', () => {
    const payload = [...le32(10), 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(640), ...le16(480)];
    expect(readImageSize(riff('VP8 ', payload))).toEqual({ width: 640, height: 480 });
  });

  it('reads WebP VP8L (lossless)', () => {
    const bits = (300 - 1) | ((200 - 1) << 14);
    const payload = [...le32(10), 0x2f, ...le32(bits)];
    expect(readImageSize(riff('VP8L', payload))).toEqual({ width: 300, height: 200 });
  });

  it('returns null for unknown or truncated data', () => {
    expect(readImageSize(new Uint8Array([7, 3, 9, 1, 250, 42, 17, 88, 0, 5]))).toBeNull();
    expect(readImageSize(png(10, 10).slice(0, 20))).toBeNull();
    expect(readImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeNull();
    expect(readImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 1, 2]))).toBeNull();
  });

  it('flags a PNG bomb above the pixel cap', () => {
    const size = readImageSize(png(20000, 20000));
    expect(size).not.toBeNull();
    expect((size?.width ?? 0) * (size?.height ?? 0)).toBeGreaterThan(MAX_SOURCE_PIXELS);
  });
});
