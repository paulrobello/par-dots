import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createVrEnvironment } from '../src/xr/environment';

describe('VR environments', () => {
  it('switches distinct worlds, disposes old geometry, and cleans up', () => {
    const scene = new THREE.Scene();
    const environment = createVrEnvironment(scene);
    environment.set('studio');
    const group = scene.getObjectByName('xr-environment') as THREE.Group;
    const grid = group.children[0] as THREE.GridHelper;
    const disposed = vi.spyOn(grid.geometry, 'dispose');
    const studioColor = (scene.background as THREE.Color).getHex();
    environment.set('night');
    expect(disposed).toHaveBeenCalledOnce();
    expect((scene.background as THREE.Color).getHex()).not.toBe(studioColor);
    expect(group.children.some((child) => child instanceof THREE.Points)).toBe(true);
    environment.set('sunset');
    const mountains = group.children.find(
      (child) => child instanceof THREE.InstancedMesh,
    ) as THREE.InstancedMesh;
    const geometryDispose = vi.spyOn(mountains.geometry, 'dispose');
    const materialDispose = vi.spyOn(mountains.material as THREE.Material, 'dispose');
    const meshDispose = vi.spyOn(mountains, 'dispose');
    environment.set('forest');
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(meshDispose).toHaveBeenCalledOnce();
    expect(group.children.some((child) => child instanceof THREE.InstancedMesh)).toBe(true);
    environment.dispose();
    expect(scene.getObjectByName('xr-environment')).toBeUndefined();
    expect(scene.background).toBeNull();
  });
});
