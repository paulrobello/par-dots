// @vitest-environment happy-dom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings, resetSettingsCache, setSettings } from '../src/storage/settings';
import { createXrSettings } from '../src/xr/settings';

beforeEach(() => {
  localStorage.clear();
  resetSettingsCache();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy({}, { get: () => () => undefined, set: () => true }) as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetSettingsCache();
});

describe('VR settings', () => {
  it('persists environment choices and changes shared 2D sound settings', () => {
    const changed = vi.fn();
    const settings = createXrSettings('vr', changed);
    settings.show(new THREE.Object3D(), new THREE.Vector3(0, 0, 1));
    settings.root.updateWorldMatrix(true, true);
    const at = (x: number, y: number): 'close' | 'change' | null => {
      const local = new THREE.Vector3(
        (x / 1024 - 0.5) * 0.48,
        (0.5 - y / 768) * 0.36,
        0,
      ).applyMatrix4(settings.root.matrixWorld);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(settings.root.matrixWorld);
      return settings.pick(local.addScaledVector(normal, 0.2), normal.negate());
    };
    expect(at(950, 158)).toBe('change');
    expect(changed).toHaveBeenCalledWith('night');
    resetSettingsCache();
    expect(getSettings().xrEnvironment).toBe('night');
    expect(at(950, 230)).toBe('change');
    expect(getSettings().sound).toBe(false);
    expect(at(950, 302)).toBe('change');
    expect(getSettings().sfxVolume).toBe(85);
    expect(at(950, 57)).toBe('close');
    expect(settings.root.visible).toBe(false);
    settings.dispose();
  });
  it('keeps MR passthrough and does not change the saved VR world', () => {
    setSettings({ xrEnvironment: 'forest' });
    const changed = vi.fn();
    const settings = createXrSettings('ar', changed);
    settings.show(new THREE.Object3D(), new THREE.Vector3(0, 0, 1));
    settings.root.updateWorldMatrix(true, true);
    const p = new THREE.Vector3(
      (950 / 1024 - 0.5) * 0.48,
      (0.5 - 158 / 768) * 0.36,
      0,
    ).applyMatrix4(settings.root.matrixWorld);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(settings.root.matrixWorld);
    expect(settings.pick(p.addScaledVector(normal, 0.2), normal.negate())).toBeNull();
    expect(getSettings().xrEnvironment).toBe('forest');
    expect(changed).not.toHaveBeenCalled();
    settings.dispose();
  });
});
