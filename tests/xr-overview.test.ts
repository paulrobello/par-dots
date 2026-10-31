// @vitest-environment happy-dom

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../src/types';
import { createOverview, panelProgress } from '../src/xr/overview';

function save(): PictureSave {
  const width = 32;
  const height = 16;
  const target = new Uint8Array(width * height).fill(0);
  const placed = new Uint8Array(width * height).fill(EMPTY);
  for (let i = 0; i < PANEL_SIZE * PANEL_SIZE; i++) placed[i] = 0;
  for (let i = PANEL_SIZE * PANEL_SIZE; i < width * height; i++) target[i] = 1;
  return {
    schemaVersion: 2,
    id: 'overview',
    createdAt: 1,
    updatedAt: 1,
    name: 'Overview',
    sourceImageId: 'library:test',
    aspect: '4:3',
    paletteMode: 'lego',
    origin: 'photo',
    width,
    height,
    palette: [
      { hex: '#ff0000', name: 'Red' },
      { hex: '#0000ff', name: 'Blue' },
    ],
    target,
    placed,
    panelElapsedMs: [0, 0],
  };
}

describe('XR overview', () => {
  const original = document.createElement.bind(document);

  beforeEach(() => {
    vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string,
      options?: ElementCreationOptions,
    ) => {
      const element = original(tag, options);
      if (tag === 'canvas') {
        const ctx = {
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          strokeRect: vi.fn(),
          fillStyle: '',
          strokeStyle: '',
          globalAlpha: 1,
          lineWidth: 1,
        } as unknown as CanvasRenderingContext2D;
        (element as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () =>
          ctx;
      }
      return element;
    }) as typeof document.createElement);
  });

  afterEach(() => vi.restoreAllMocks());

  it('computes per-panel progress from target and placed cells', () => {
    const picture = save();
    expect(panelProgress(picture, 0)).toBe(50);
    expect(panelProgress(picture, 1)).toBe(50);
    expect(panelProgress(picture, 2)).toBe(0);
  });

  it('picks panel indices through transformed roots', () => {
    const overview = createOverview(save());
    overview.root.position.set(0.4, 1.1, -0.5);
    overview.root.rotation.set(0.2, -0.5, 0.15);
    overview.root.scale.set(1.7, 0.8, 1.3);
    overview.root.updateWorldMatrix(true, true);
    const point = new THREE.Vector3(-0.18, 0.18, 0.2).applyMatrix4(overview.root.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(overview.root.matrixWorld);
    expect(overview.pickPanel({ origin: point, dir })).toBe(0);
    const right = new THREE.Vector3(0.18, 0.18, 0.2).applyMatrix4(overview.root.matrixWorld);
    expect(overview.pickPanel({ origin: right, dir })).toBe(1);
    overview.dispose();
  });

  it('returns null outside the mosaic and supports hover repaint lifecycle', () => {
    const overview = createOverview(save());
    const point = new THREE.Vector3(0.8, 0.8, 0.2);
    expect(overview.pickPanel({ origin: point, dir: new THREE.Vector3(0, 0, -1) })).toBeNull();
    overview.setHover(1);
    overview.setHover(1);
    overview.repaint();
    overview.dispose();
  });
});
