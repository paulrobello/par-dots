import { describe, expect, it } from 'vitest';
import { libraryRows, MAX_LIBRARY_ROWS } from '../src/xr/library';

describe('libraryRows', () => {
  it('truncates to the visible window and renders name and rounded percent', () => {
    const rows = libraryRows(
      Array.from({ length: 12 }, (_, i) => ({
        id: `id${i}`,
        name: `Picture ${i + 1}`,
        percent: 42.6 + i,
      })),
    );
    expect(rows).toHaveLength(MAX_LIBRARY_ROWS);
    expect(rows[0]).toEqual({ id: 'id0', label: 'Picture 1 — 43%' });
    expect(rows[7]).toEqual({ id: 'id7', label: 'Picture 8 — 50%' });
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
