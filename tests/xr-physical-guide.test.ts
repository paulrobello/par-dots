// @vitest-environment happy-dom

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPhysicalGuide } from '../src/xr/physicalGuide';

afterEach(() => vi.restoreAllMocks());

describe('createPhysicalGuide', () => {
  it('renders selected color, symbol, count, and physical-build instructions', () => {
    const fillText = vi.fn();
    const ctx = {
      clearRect() {},
      beginPath() {},
      roundRect() {},
      fill() {},
      fillText,
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    const guide = createPhysicalGuide({ colorName: 'Bright Red', symbol: 'R', remaining: 12 });

    guide.update({ remaining: 7 });
    expect(fillText).toHaveBeenCalledWith('R  Bright Red', 36, 126);
    expect(fillText).toHaveBeenCalledWith('7 remaining', 988, 126);
    expect(fillText).toHaveBeenCalledWith('Place this dot on the physical build,', 36, 208);
    expect(fillText).toHaveBeenCalledWith(
      'then tap the matching stud on the digital plate.',
      36,
      250,
    );
    guide.dispose();
  });

  it('supports visibility, complete sync, and disposal without save mutation', () => {
    const ctx = {
      clearRect() {},
      beginPath() {},
      roundRect() {},
      fill() {},
      fillText() {},
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    const guide = createPhysicalGuide();
    const parent = new THREE.Group();
    parent.add(guide.root);
    guide.hide();
    expect(guide.root.visible).toBe(false);
    guide.show();
    expect(guide.root.visible).toBe(true);
    const status = { colorName: 'Blue', symbol: 'B', remaining: 3 };
    guide.sync(status);
    status.remaining = 99;
    guide.dispose();
    expect(parent.getObjectByName('xr-physical-guide')).toBeUndefined();
  });
});
