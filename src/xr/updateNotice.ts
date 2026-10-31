import * as THREE from 'three';
import { localRay } from './transforms';

const WIDTH = 0.42;
const HEIGHT = 0.2;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 488;
const BUTTON = { left: 650, top: 300, right: 972, bottom: 430 };

/** A one-shot in-world notice for an available application update. */
export function createXrUpdateNotice(): {
  root: THREE.Group;
  setVisible(
    visible: boolean,
    headMatrix: THREE.Matrix4,
    busy?: boolean,
    error?: string | null,
  ): void;
  hit(origin: THREE.Vector3, dir: THREE.Vector3): boolean;
  pick(origin: THREE.Vector3, dir: THREE.Vector3): boolean;
  dispose(): void;
} {
  const root = new THREE.Group();
  root.name = 'xr-update-notice';
  root.visible = false;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  let messageKey = '';
  let disabled = false;
  const paint = (busy: boolean, error: string | null): void => {
    const key = `${busy}:${error ?? ''}`;
    if (key === messageKey) return;
    messageKey = key;
    disabled = busy;
    if (!context) return;
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.fillStyle = '#20282d';
    context.beginPath();
    context.roundRect(8, 8, CANVAS_WIDTH - 16, CANVAS_HEIGHT - 16, 42);
    context.fill();
    context.fillStyle = '#f2cd37';
    context.font = '700 66px system-ui, sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText('Update available', 48, 105);
    context.fillStyle = '#f4f5f6';
    context.font = '500 34px system-ui, sans-serif';
    context.fillText(error ?? 'Reload to use the latest version.', 48, 190);
    context.fillStyle = busy ? '#8a7834' : '#f2cd37';
    context.beginPath();
    context.roundRect(
      BUTTON.left,
      BUTTON.top,
      BUTTON.right - BUTTON.left,
      BUTTON.bottom - BUTTON.top,
      24,
    );
    context.fill();
    context.fillStyle = '#252117';
    context.font = '700 42px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(
      busy ? 'Reloading…' : 'Reload',
      (BUTTON.left + BUTTON.right) / 2,
      (BUTTON.top + BUTTON.bottom) / 2,
    );
    texture.needsUpdate = true;
  };
  paint(false, null);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const geometry = new THREE.PlaneGeometry(WIDTH, HEIGHT);
  const face = new THREE.Mesh(geometry, material);
  face.name = 'xr-update-notice-face';
  root.add(face);

  const ray = new THREE.Ray();
  const inverse = new THREE.Matrix4();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const point = new THREE.Vector3();
  let positioned = false;

  const setVisible = (
    visible: boolean,
    headMatrix: THREE.Matrix4,
    busy = false,
    error: string | null = null,
  ): void => {
    paint(busy, error);
    if (!visible) {
      root.visible = false;
      positioned = false;
      return;
    }
    if (!positioned) {
      root.position.set(0.34, 0.14, -0.62).applyMatrix4(headMatrix);
      root.quaternion.setFromRotationMatrix(headMatrix);
      positioned = true;
    }
    root.visible = true;
  };

  const hit = (origin: THREE.Vector3, dir: THREE.Vector3): boolean => {
    if (!root.visible) return false;
    localRay(root, origin, dir, ray, inverse);
    if (!ray.intersectPlane(plane, point)) return false;
    return Math.abs(point.x) <= WIDTH / 2 && Math.abs(point.y) <= HEIGHT / 2;
  };
  const pick = (origin: THREE.Vector3, dir: THREE.Vector3): boolean => {
    if (disabled || !hit(origin, dir)) return false;
    const x = (point.x / WIDTH + 0.5) * CANVAS_WIDTH;
    const y = (0.5 - point.y / HEIGHT) * CANVAS_HEIGHT;
    if (x < BUTTON.left || x > BUTTON.right || y < BUTTON.top || y > BUTTON.bottom) return false;
    root.visible = false;
    return true;
  };

  const dispose = (): void => {
    root.removeFromParent();
    texture.dispose();
    material.dispose();
    geometry.dispose();
  };

  return { root, setVisible, hit, pick, dispose };
}
