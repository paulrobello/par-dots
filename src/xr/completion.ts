import * as THREE from 'three';
import { localRay } from './transforms';

const WIDTH = 0.3;
const HEIGHT = 0.15;

/** An in-world completion card with a single ray-selectable continuation button. */
export function createCompletion(): {
  root: THREE.Group;
  show(label: string, plate: THREE.Object3D, head: THREE.Vector3): void;
  pick(origin: THREE.Vector3, dir: THREE.Vector3): boolean;
  update(time: number): void;
  dispose(): void;
} {
  const root = new THREE.Group();
  root.name = 'xr-completion';
  root.visible = false;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const geometry = new THREE.PlaneGeometry(WIDTH, HEIGHT);
  const face = new THREE.Mesh(geometry, material);
  face.name = 'xr-completion-face';
  root.add(face);
  const ray = new THREE.Ray();
  const inverse = new THREE.Matrix4();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const point = new THREE.Vector3();
  const show = (label: string, plate: THREE.Object3D, head: THREE.Vector3): void => {
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#20282d';
      ctx.beginPath();
      ctx.roundRect(8, 8, 1008, 496, 44);
      ctx.fill();
      ctx.fillStyle = '#f2cd37';
      ctx.font = '700 78px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✦  Plate complete  ✦', 512, 140);
      ctx.fillStyle = '#f4f5f6';
      ctx.font = '500 40px system-ui, sans-serif';
      ctx.fillText('Great work!', 512, 225);
      ctx.fillStyle = '#f2cd37';
      ctx.beginPath();
      ctx.roundRect(220, 305, 584, 130, 28);
      ctx.fill();
      ctx.fillStyle = '#252117';
      ctx.font = '700 51px system-ui, sans-serif';
      ctx.fillText(label, 512, 370);
      texture.needsUpdate = true;
    }
    plate.getWorldPosition(root.position);
    root.position.y += 0.19;
    root.lookAt(head);
    root.visible = true;
  };
  const pick = (origin: THREE.Vector3, dir: THREE.Vector3): boolean => {
    if (!root.visible) return false;
    localRay(root, origin, dir, ray, inverse);
    if (!ray.intersectPlane(plane, point)) return false;
    return (
      Math.abs(point.x) <= WIDTH * (292 / 1024) &&
      point.y <= -HEIGHT * (49 / 512) &&
      point.y >= -HEIGHT * (179 / 512)
    );
  };
  const update = (time: number): void => {
    if (root.visible) root.scale.setScalar(1 + 0.025 * Math.sin(time / 240));
  };
  const dispose = (): void => {
    root.removeFromParent();
    texture.dispose();
    material.dispose();
    geometry.dispose();
  };
  return { root, show, pick, update, dispose };
}
