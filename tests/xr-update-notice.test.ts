// @vitest-environment happy-dom

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createXrUpdateNotice } from '../src/xr/updateNotice';

describe('createXrUpdateNotice', () => {
  it('places once from the head matrix and picks only Reload', () => {
    const notice = createXrUpdateNotice();
    const head = new THREE.Matrix4().makeTranslation(0, 1.6, 0);
    notice.setVisible(true, head);
    expect(notice.root.visible).toBe(true);
    expect(notice.root.position.x).toBeCloseTo(0.34);
    expect(notice.root.position.y).toBeCloseTo(1.74);
    expect(notice.root.position.z).toBeCloseTo(-0.62);
    const placed = notice.root.position.clone();
    notice.setVisible(true, new THREE.Matrix4().makeTranslation(4, 4, 4));
    expect(notice.root.position).toEqual(placed);

    notice.root.updateWorldMatrix(true, true);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(notice.root.matrixWorld);
    const outside = new THREE.Vector3(-0.18, 0, 0).applyMatrix4(notice.root.matrixWorld);
    expect(notice.pick(outside.addScaledVector(normal, 0.1), normal.clone().negate())).toBe(false);
    const reload = new THREE.Vector3(0.17, -0.03, 0).applyMatrix4(notice.root.matrixWorld);
    expect(notice.pick(reload.addScaledVector(normal, 0.1), normal.clone().negate())).toBe(true);
    expect(notice.root.visible).toBe(false);
    notice.dispose();
  });

  it('hides and can be shown again at a new head pose', () => {
    const notice = createXrUpdateNotice();
    notice.setVisible(true, new THREE.Matrix4().makeTranslation(0, 1, 0));
    notice.setVisible(false, new THREE.Matrix4());
    expect(notice.root.visible).toBe(false);
    notice.setVisible(true, new THREE.Matrix4().makeTranslation(1, 2, 3));
    expect(notice.root.position.x).toBeCloseTo(1.34);
    expect(notice.root.position.y).toBeCloseTo(2.14);
    expect(notice.root.position.z).toBeCloseTo(2.38);
    notice.dispose();
  });
});
