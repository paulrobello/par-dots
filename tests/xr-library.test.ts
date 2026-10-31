import { describe, expect, it } from 'vitest';
import { libraryRows } from '../src/xr/library';

describe('libraryRows', () => {
  it('retains all rows and renders names and rounded percentages', () => {
    const rows = libraryRows(
      Array.from({ length: 12 }, (_, i) => ({
        id: `id${i}`,
        name: `Picture ${i + 1}`,
        percent: 42.6 + i,
      })),
    );
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ id: 'id0', label: 'Picture 1 — 43%', percent: 42.6 });
    expect(rows[7]).toEqual({ id: 'id7', label: 'Picture 8 — 50%', percent: 49.6 });
  });

  it('truncates long names', () => {
    const rows = libraryRows([
      { id: 'x', name: 'A very long vacation photo name that keeps going', percent: 10 },
    ]);
    expect(rows[0].label.startsWith('A very long vacation ph…')).toBe(true);
  });

  it('passes through an empty list', () => {
    expect(libraryRows([])).toEqual([]);
  });
});
