/** Source image decoding with a pixel-count guard. */

import { MAX_SOURCE_PIXELS, readImageSize } from './imageHeader';

/** Thrown when a source image declares more than MAX_SOURCE_PIXELS pixels. */
export class ImageTooLargeError extends Error {
  constructor() {
    super('That image has too many pixels. Please pick one under 40 megapixels.');
    this.name = 'ImageTooLargeError';
  }
}

/** Pixel count reported by the browser from the header alone, or null when it cannot tell. */
function probePixels(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const done = (n: number | null): void => {
      URL.revokeObjectURL(url);
      resolve(n);
    };
    // onload fires once dimensions are known; never call img.decode(), which allocates the pixels.
    img.onload = () => done(img.naturalWidth * img.naturalHeight || null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** Decode an image blob with EXIF orientation applied, downscaled to maxEdge. */
export async function decodeImage(blob: Blob, maxEdge = 1024): Promise<ImageData> {
  const head = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  const size = readImageSize(head);
  const pixels = size ? size.width * size.height : await probePixels(blob);
  if (pixels !== null && pixels > MAX_SOURCE_PIXELS) throw new ImageTooLargeError();
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const hgt = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, hgt);
    return ctx.getImageData(0, 0, w, hgt);
  } finally {
    bmp.close();
  }
}
