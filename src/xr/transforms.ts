import * as THREE from 'three';
import { clampFrameScale } from './frame';

/** Tray geometry has a +Y face, unlike the reference frame's +Z face. */
export function faceTray(root: THREE.Object3D, head: THREE.Vector3): void {
  const toward = head.clone().sub(root.position).normalize();
  const yaw = Math.atan2(toward.x, toward.z);
  const tilt = Math.atan2(Math.hypot(toward.x, toward.z), toward.y);
  root.quaternion.setFromEuler(new THREE.Euler(tilt, yaw, 0, 'YXZ'));
}

/** Inverse-transform the whole ray, including scale, not just its origin. */
export function localRay(
  root: THREE.Object3D,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  target: THREE.Ray,
  inverse: THREE.Matrix4,
): THREE.Ray {
  root.updateWorldMatrix(true, false);
  inverse.copy(root.matrixWorld).invert();
  target.set(origin, direction).applyMatrix4(inverse);
  return target;
}

/** Objects are direct scene children; the offset stays in the grip's rotating frame. */
export function createGrab(
  object: THREE.Object3D,
  grip: THREE.Object3D,
): {
  update(stickX: number, stickY: number, scaling: boolean, seconds: number): void;
} {
  const gripPos = new THREE.Vector3();
  const gripQuat = new THREE.Quaternion();
  grip.getWorldPosition(gripPos);
  grip.getWorldQuaternion(gripQuat);
  const inverse = gripQuat.clone().invert();
  const offset = object.position.clone().sub(gripPos).applyQuaternion(inverse);
  const relative = inverse.multiply(object.quaternion);
  const turn = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  return {
    update(stickX, stickY, scaling, seconds) {
      const dt = Math.max(0, Math.min(0.05, seconds));
      if (Math.abs(stickX) > 0.15) {
        turn.setFromAxisAngle(up, -stickX * dt * 1.8);
        relative.premultiply(turn);
      }
      if (Math.abs(stickY) > 0.15) {
        if (scaling)
          object.scale.setScalar(clampFrameScale(object.scale.x * Math.exp(-stickY * dt)));
        else offset.z += stickY * dt * 0.5;
      }
      grip.getWorldPosition(gripPos);
      grip.getWorldQuaternion(gripQuat);
      object.position.copy(offset).applyQuaternion(gripQuat).add(gripPos);
      object.quaternion.copy(gripQuat).multiply(relative);
    },
  };
}
