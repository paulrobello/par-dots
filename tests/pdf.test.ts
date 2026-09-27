import { describe, expect, it } from 'vitest';
import { buildImagePdf, LETTER } from '../src/render/pdf';

const latin1 = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('buildImagePdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = latin1(
    buildImagePdf([
      { jpeg, width: 400, height: 800 },
      { jpeg, width: 800, height: 400 },
    ]),
  );

  it('has one page per image', () => {
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 2');
    expect(pdf.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(pdf.match(/\/Filter \/DCTDecode \/Length 4 /g)).toHaveLength(2);
  });

  it('writes an xref whose offsets point at each object', () => {
    const xref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const rows = pdf
      .slice(xref)
      .split('\n')
      .slice(3, 3 + 7);
    rows.forEach((row, i) => {
      const at = Number(row.slice(0, 10));
      expect(pdf.slice(at, at + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('fits each image inside the page margin, centered', () => {
    const [tall] = [...pdf.matchAll(/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/g)];
    const [w, h, x, y] = tall.slice(1).map(Number);
    expect(h).toBeCloseTo(LETTER.height - 72);
    expect(w).toBeCloseTo(h / 2);
    expect(x).toBeCloseTo((LETTER.width - w) / 2);
    expect(y).toBeCloseTo(36);
  });
});
