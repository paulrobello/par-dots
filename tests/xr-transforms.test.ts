// @vitest-environment happy-dom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY } from '../src/types';
import { readGamepad } from '../src/xr/input';
import { createPlate } from '../src/xr/plate';
import { createGrab, faceTray, localRay } from '../src/xr/transforms';
import { createTray } from '../src/xr/tray';

afterEach(() => vi.restoreAllMocks());

const context = (): void => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
};

describe('runtime workspace transforms', () => {
  it('faces the tray +Y normal toward the head and selects every oblique scaled chip', () => {
    context();
    const tray = createTray({
      bridge: { trayColors: () => [0, 1, 2, 3], availableFor: () => 10 },
      palette: Array.from({ length: 4 }, () => ({ hex: '#eeeeee' })),
      selected: () => 0,
    });
    tray.root.position.set(0.24, 1.05, -0.4);
    const head = new THREE.Vector3(0, 1.6, 0.2);
    faceTray(tray.root, head);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(tray.root.quaternion);
    expect(normal.dot(head.clone().sub(tray.root.position).normalize())).toBeCloseTo(1);
    for (const scale of [0.4, 1, 3]) {
      tray.root.scale.setScalar(scale);
      tray.root.updateMatrixWorld(true);
      for (let i = 0; i < 4; i++) {
        const target = new THREE.Vector3(((i % 2) - 0.5) * 0.036, 0.004, Math.floor(i / 2) * 0.036);
        const origin = target.clone().add(new THREE.Vector3(0.3, 0.6, -0.2));
        target.applyMatrix4(tray.root.matrixWorld);
        origin.applyMatrix4(tray.root.matrixWorld);
        expect(tray.pickChip({ origin, dir: target.sub(origin).normalize() })).toBe(i);
      }
    }
    tray.dispose();
  });

  it('picks plate cells after translation, full rotation and nonuniform scale', () => {
    const plate = createPlate({ cellAt: () => ({ target: 0, placed: EMPTY }) }, [{ hex: '#eee' }]);
    plate.root.position.set(-0.4, 1.3, -0.6);
    plate.root.rotation.set(0.8, -0.5, 0.4);
    plate.root.scale.set(2, 0.6, 1.3);
    plate.root.updateMatrixWorld(true);
    const target = new THREE.Vector3(0.004, 0.0032 / 2 + 0.0018, 0.004);
    const origin = target.clone().add(new THREE.Vector3(0.2, 0.4, -0.3));
    target.applyMatrix4(plate.root.matrixWorld);
    origin.applyMatrix4(plate.root.matrixWorld);
    const ray = localRay(
      plate.root,
      origin,
      target.sub(origin).normalize(),
      new THREE.Ray(),
      new THREE.Matrix4(),
    );
    expect(plate.pickCell({ origin: ray.origin, dir: ray.direction }, 'paint')).toEqual({
      x: 8,
      y: 8,
    });
    plate.dispose();
  });

  it('uses Quest reserved axes 2/3, not touchpad axes 0/1', () => {
    expect(readGamepad({ buttons: [], axes: [0.9, -0.9, -0.4, 0.7] })).toMatchObject({
      stickX: -0.4,
      stickY: 0.7,
    });
    expect(readGamepad({ buttons: [], axes: [] })).toMatchObject({ stickX: 0, stickY: 0 });
  });

  it('keeps the local grab offset while following pitch, roll, yaw and translation', () => {
    const object = new THREE.Group();
    const grip = new THREE.Group();
    object.position.set(0, 0, -0.5);
    const grab = createGrab(object, grip);
    grip.position.set(1, 2, 3);
    grip.rotation.set(0.5, 0.6, 0.7);
    grab.update(0, 0, false, 1 / 72);
    expect(object.quaternion.angleTo(grip.quaternion)).toBeCloseTo(0);
    const expected = new THREE.Vector3(0, 0, -0.5)
      .applyQuaternion(grip.quaternion)
      .add(grip.position);
    expect(object.position.distanceTo(expected)).toBeCloseTo(0);
  });

  it('pushes and pulls along the laser ray, even when grip orientation differs', () => {
    const object = new THREE.Group();
    const grip = new THREE.Group();
    object.position.set(0, 0, -0.5);
    const grab = createGrab(object, grip);
    grip.rotation.y = Math.PI / 2;
    const ray = new THREE.Vector3(0, 0, -1);
    for (let i = 0; i < 20; i++) grab.update(0, -1, false, 0.05, ray);
    expect(object.position.x).toBeCloseTo(-0.5);
    expect(object.position.z).toBeCloseTo(-0.5);
    expect(object.scale.x).toBe(1);
    ray.set(1, 0, 0);
    for (let i = 0; i < 20; i++) grab.update(0, 1, false, 0.05, ray);
    expect(object.position.x).toBeCloseTo(-1);
    expect(object.position.z).toBeCloseTo(-0.5);
    for (let i = 0; i < 20; i++) grab.update(0, -1, true, 0.05, ray);
    expect(object.position.x).toBeCloseTo(-1);
    expect(object.position.z).toBeCloseTo(-0.5);
    expect(object.scale.x).toBeCloseTo(Math.E);
  });

  it('rotates a prior push with the controller pose while held', () => {
    const object = new THREE.Group();
    const grip = new THREE.Group();
    object.position.set(0, 0, -0.5);
    const grab = createGrab(object, grip);
    const ray = new THREE.Vector3(0, 0, -1);
    for (let i = 0; i < 20; i++) grab.update(0, -1, false, 0.05, ray);
    expect(object.position.x).toBeCloseTo(0);
    expect(object.position.z).toBeCloseTo(-1);

    grip.rotation.y = Math.PI / 2;
    grab.update(0, 0, false, 0.05, ray);
    expect(object.position.x).toBeCloseTo(-1);
    expect(object.position.z).toBeCloseTo(0);
  });

  it('stick yaw and trigger-modified resize are time-based, up enlarges, and scale is clamped', () => {
    const simulate = (hz: number): THREE.Group => {
      const object = new THREE.Group();
      const grab = createGrab(object, new THREE.Group());
      for (let i = 0; i < hz; i++) grab.update(0.5, -0.5, true, 1 / hz);
      return object;
    };
    const a = simulate(72);
    const b = simulate(90);
    expect(a.scale.x).toBeCloseTo(Math.exp(0.5));
    expect(a.scale.x).toBeCloseTo(b.scale.x);
    expect(a.quaternion.angleTo(b.quaternion)).toBeCloseTo(0);
    const grab = createGrab(a, new THREE.Group());
    for (let i = 0; i < 1000; i++) grab.update(0, -1, true, 0.05);
    expect(a.scale.x).toBe(3);
    for (let i = 0; i < 1000; i++) grab.update(0, 1, true, 0.05);
    expect(a.scale.x).toBe(0.4);
  });
});
