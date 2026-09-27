/**
 * Minimal PDF writer: one JPEG image per page, each scaled to fit centered inside a page with
 * a margin. Dependency-free and DOM-free; callers pass JPEG bytes and their pixel size.
 */

/** One page image: baseline JPEG bytes and the image's pixel size. */
export interface PdfImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

/** US Letter in PDF points (1/72 inch). */
export const LETTER = { width: 612, height: 792 };
const MARGIN = 36;

/** Build a PDF with one page per image, each fitted inside the margin and centered. */
export function buildImagePdf(images: PdfImage[], page = LETTER): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array): void => {
    chunks.push(b);
    size += b.length;
  };
  const text = (s: string): void => push(enc.encode(s));
  // Objects: 1 catalog, 2 pages, then per page i: page, image, content.
  const obj = (n: number, body: () => void): void => {
    offsets[n] = size;
    text(`${n} 0 obj\n`);
    body();
    text('\nendobj\n');
  };

  text('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const pageIds = images.map((_, i) => 3 + i * 3);
  obj(1, () => text('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () =>
    text(
      `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${images.length} >>`,
    ),
  );
  images.forEach((img, i) => {
    const p = pageIds[i];
    const scale = Math.min(
      (page.width - 2 * MARGIN) / img.width,
      (page.height - 2 * MARGIN) / img.height,
    );
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (page.width - w) / 2;
    const y = (page.height - h) / 2;
    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
    obj(p, () =>
      text(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
          `/Resources << /XObject << /Im0 ${p + 1} 0 R >> >> /Contents ${p + 2} 0 R >>`,
      ),
    );
    obj(p + 1, () => {
      text(
        `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`,
      );
      push(img.jpeg);
      text('\nendstream');
    });
    obj(p + 2, () => text(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  });

  const count = 3 + images.length * 3;
  const xref = size;
  text(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) text(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
