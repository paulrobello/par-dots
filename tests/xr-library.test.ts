// @vitest-environment happy-dom

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibrary, LIBRARY_HEIGHT, libraryRows, MAX_LIBRARY_ROWS } from '../src/xr/library';

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

  it('preserves optional previews', () => {
    const preview = document.createElement('canvas');
    expect(libraryRows([{ id: 'x', name: 'Picture', percent: 10, preview }])[0].preview).toBe(
      preview,
    );
  });
});

describe('createLibrary picking', () => {
  let clears = 0;
  let fillStyles: string[] = [];
  let drawImages = 0;

  beforeEach(() => {
    clears = 0;
    fillStyles = [];
    drawImages = 0;
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string,
      options?: ElementCreationOptions,
    ) => {
      const element = original(tag, options);
      if (tag === 'canvas') {
        const ctx = {
          fillStyle: '',
          font: '',
          textAlign: '',
          textBaseline: '',
          clearRect: () => {
            clears++;
          },
          fillRect: () => {
            fillStyles.push(String(ctx.fillStyle));
          },
          fillText: () => undefined,
          drawImage: () => {
            drawImages++;
          },
        } as unknown as CanvasRenderingContext2D;
        (element as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () =>
          ctx;
      }
      return element;
    }) as typeof document.createElement);
  });

  afterEach(() => vi.restoreAllMocks());

  const makeRows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: `id${i}`, label: `Picture ${i}`, percent: 50 }));

  const rayAt = (library: ReturnType<typeof createLibrary>, localX: number, localY: number) => {
    library.root.updateWorldMatrix(true, true);
    const point = new THREE.Vector3(localX, localY, 0.2).applyMatrix4(library.root.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(library.root.matrixWorld);
    return { origin: point, dir };
  };

  it('picks rows through a translated, rotated, non-uniformly scaled root', () => {
    const library = createLibrary({ rows: () => makeRows(3), onPick: () => undefined });
    library.root.position.set(0.4, 1.1, -0.5);
    library.root.rotation.set(0.2, -0.5, 0.15);
    library.root.scale.set(1.7, 0.8, 1.3);
    const rowH = (LIBRARY_HEIGHT - 110 / (840 / LIBRARY_HEIGHT)) / MAX_LIBRARY_ROWS;
    const top = LIBRARY_HEIGHT / 2 - 110 / (840 / LIBRARY_HEIGHT);
    expect(library.pickRow(rayAt(library, 0, top - rowH / 2))).toBe(0);
    expect(library.pickRow(rayAt(library, 0, top - rowH * 2.5))).toBe(2);
    library.dispose();
  });

  it('returns absolute row indexes after paging', () => {
    const library = createLibrary({ rows: () => makeRows(10), onPick: () => undefined });
    const rowH = (LIBRARY_HEIGHT - 110 / (840 / LIBRARY_HEIGHT)) / MAX_LIBRARY_ROWS;
    const top = LIBRARY_HEIGHT / 2 - 110 / (840 / LIBRARY_HEIGHT);
    expect(library.pickRow(rayAt(library, 0, top - rowH / 2))).toBe(0);
    library.pageBy(1);
    expect(library.pickRow(rayAt(library, 0, top - rowH / 2))).toBe(8);
    expect(library.pickRow(rayAt(library, 0, top - rowH * 1.5))).toBe(9);
    library.dispose();
  });

  it('highlights the hovered absolute row and skips unchanged repaints', () => {
    const library = createLibrary({ rows: () => makeRows(10), onPick: () => undefined });
    expect(clears).toBe(1);
    library.setHover(1);
    expect(clears).toBe(2);
    expect(fillStyles).toContain('rgba(111,217,187,0.28)');
    library.setHover(1);
    expect(clears).toBe(2);
    library.setHover(null);
    expect(clears).toBe(3);
    library.dispose();
  });

  it('paints a provided row preview beside its label', () => {
    const preview = document.createElement('canvas');
    const library = createLibrary({
      rows: () => [{ id: 'preview', label: 'Picture', percent: 50, preview }],
      onPick: () => undefined,
    });
    expect(drawImages).toBe(1);
    library.dispose();
  });
});
