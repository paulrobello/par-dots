// @vitest-environment happy-dom
import type * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { EMPTY, PANEL_SIZE } from '../src/types';
import { createPlate } from '../src/xr/plate';

afterEach(() => vi.restoreAllMocks());

it('shows target letters only on empty pegs and does not repaint them on hover', () => {
  const labels: string[] = [];
  const context = {
    clearRect: vi.fn(),
    fillText: (text: string) => labels.push(text),
    textAlign: '',
    textBaseline: '',
    font: '',
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const placed = new Uint8Array(PANEL_SIZE * PANEL_SIZE).fill(EMPTY);
  placed[0] = 1;
  const plate = createPlate(
    { cellAt: (x, y) => ({ target: x % 2, placed: placed[y * PANEL_SIZE + x] }) },
    [{ hex: '#ff0000' }, { hex: '#ffffff' }],
    ['A', 'B'],
  );
  const symbols = plate.root.getObjectByName('xr-plate-symbols') as THREE.Object3D;
  expect(symbols.visible).toBe(false);
  expect(labels).toHaveLength(0);
  plate.setReferenceOverlay(true);
  expect(symbols.visible).toBe(true);
  expect(labels).toHaveLength(PANEL_SIZE * PANEL_SIZE - 1);
  expect(labels[0]).toBe('B');
  const count = labels.length;
  plate.setGhost({ x: 1, y: 0 });
  expect(plate.root.getObjectByName('xr-plate-hover-ring')?.visible).toBe(true);
  expect(labels).toHaveLength(count);
  placed[1] = 1;
  plate.sync();
  expect(labels.length - count).toBe(PANEL_SIZE * PANEL_SIZE - 2);
  plate.setReferenceOverlay(false);
  expect(symbols.visible).toBe(false);
  plate.dispose();
});
