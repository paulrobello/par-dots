import * as THREE from 'three';
import { localRay } from './transforms';

const WIDTH = 0.34;
const HEIGHT = 0.28;
const CLOSE_WIDTH = 0.07;
const CLOSE_HEIGHT = 0.052;

/** In-world, ray-dismissable reference card for the XR controls. */
export function createHelp(): {
  root: THREE.Group;
  show(plate: THREE.Object3D, head: THREE.Vector3): void;
  pick(origin: THREE.Vector3, dir: THREE.Vector3): boolean;
  dispose(): void;
} {
  const root = new THREE.Group();
  root.name = 'xr-help';
  root.visible = false;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 840;
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
  face.name = 'xr-help-face';
  root.add(face);
  const ray = new THREE.Ray();
  const inverse = new THREE.Matrix4();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const point = new THREE.Vector3();

  if (ctx) {
    ctx.fillStyle = '#20282d';
    ctx.beginPath();
    ctx.roundRect(8, 8, 1008, 824, 42);
    ctx.fill();
    ctx.fillStyle = '#f2cd37';
    ctx.font = '700 70px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('VR controls', 52, 82);
    ctx.fillStyle = '#f4f5f6';
    ctx.font = '500 34px system-ui, sans-serif';
    const rows = [
      'Trigger       Place / select',
      'A + trigger   Sweep across studs',
      'Point + grip  Grab and move objects',
      'Grip + stick  Left / right: rotate',
      'Grip + stick  Up / down: push / pull',
      'Grip + trigger + stick  Up / down: scale',
      'X             Toggle reference frame',
      'B             Exit VR',
      'Ghost         Toggle plate overlay',
      'Picture       Show / hide whole picture',
      'Save / Layout Save and recall workspace',
    ];
    rows.forEach((row, i) => {
      ctx.fillText(row, 52, 160 + i * 58);
    });
    ctx.fillStyle = '#f2cd37';
    ctx.beginPath();
    ctx.roundRect(900, 34, 78, 62, 18);
    ctx.fill();
    ctx.fillStyle = '#252117';
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('×', 939, 65);
    texture.needsUpdate = true;
  }

  const show = (plate: THREE.Object3D, head: THREE.Vector3): void => {
    plate.getWorldPosition(root.position);
    const towardHead = new THREE.Vector3().subVectors(head, root.position).normalize();
    root.position.addScaledVector(towardHead, 0.18);
    root.position.y += 0.14;
    root.lookAt(head);
    root.visible = true;
  };

  const pick = (origin: THREE.Vector3, dir: THREE.Vector3): boolean => {
    if (!root.visible) return false;
    localRay(root, origin, dir, ray, inverse);
    if (!ray.intersectPlane(plane, point)) return false;
    if (
      point.x < WIDTH / 2 - CLOSE_WIDTH ||
      point.x > WIDTH / 2 ||
      point.y < HEIGHT / 2 - CLOSE_HEIGHT ||
      point.y > HEIGHT / 2
    )
      return false;
    root.visible = false;
    return true;
  };

  const dispose = (): void => {
    root.removeFromParent();
    texture.dispose();
    material.dispose();
    geometry.dispose();
  };
  return { root, show, pick, dispose };
}
