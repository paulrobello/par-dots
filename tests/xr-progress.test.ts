// @vitest-environment happy-dom
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { createProgressLabel } from '../src/xr/progress';

afterEach(() => vi.restoreAllMocks());

it('renders the current correct count and removes its mesh on disposal', () => {
  const text = vi.fn();
  const ctx = {
    clearRect() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    fillText: text,
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  const parent = new THREE.Group();
  const label = createProgressLabel(parent);
  label.sync({ correct: 42, total: 256 });
  expect(text).toHaveBeenCalledWith('42 / 256 correct', 256, 48);
  expect(parent.getObjectByName('xr-progress')).toBeDefined();
  label.dispose();
  expect(parent.getObjectByName('xr-progress')).toBeUndefined();
});
