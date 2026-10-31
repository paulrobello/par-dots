// @vitest-environment happy-dom

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createHelp } from '../src/xr/help';

describe('createHelp', () => {
  it('shows near the plate and closes when its close button is ray-picked', () => {
    const help = createHelp();
    const plate = new THREE.Object3D();
    plate.position.set(0.2, 1, -0.4);
    const head = new THREE.Vector3(0, 1.6, 0.5);
    help.show(plate, head);
    expect(help.root.visible).toBe(true);
    expect(help.root.position.distanceTo(plate.position)).toBeGreaterThan(0.1);

    help.root.updateWorldMatrix(true, true);
    const local = new THREE.Vector3(0.13, 0.1, 0).applyMatrix4(help.root.matrixWorld);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(help.root.matrixWorld);
    expect(help.pick(local.clone().addScaledVector(normal, 0.1), normal.clone().negate())).toBe(
      true,
    );
    expect(help.root.visible).toBe(false);
    help.dispose();
  });

  it('ignores rays outside the card and while hidden', () => {
    const help = createHelp();
    const plate = new THREE.Object3D();
    const head = new THREE.Vector3(0, 0, 1);
    help.show(plate, head);
    help.root.updateWorldMatrix(true, true);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(help.root.matrixWorld);
    const outside = new THREE.Vector3(0.3, 0, 0).applyMatrix4(help.root.matrixWorld);
    expect(help.pick(outside.addScaledVector(normal, 0.1), normal.clone().negate())).toBe(false);
    const outsideCorner = new THREE.Vector3(0.3, 0.3, 0).applyMatrix4(help.root.matrixWorld);
    expect(help.pick(outsideCorner.addScaledVector(normal, 0.1), normal.clone().negate())).toBe(
      false,
    );
    help.dispose();
  });
});
