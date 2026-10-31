import * as THREE from 'three';

/** Small status label attached to the reference frame. */
export function createProgressLabel(parent: THREE.Object3D): {
  sync(progress: { correct: number; total: number }): void;
  dispose(): void;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(0.2, 0.0375);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'xr-progress';
  mesh.position.set(0, -0.145, 0.002);
  parent.add(mesh);
  const sync = ({ correct, total }: { correct: number; total: number }): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#20282d';
    ctx.beginPath();
    ctx.roundRect(4, 4, 504, 88, 20);
    ctx.fill();
    ctx.fillStyle = '#f4f5f6';
    ctx.font = '700 42px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${correct} / ${total} correct`, 256, 48);
    texture.needsUpdate = true;
  };
  const dispose = (): void => {
    mesh.removeFromParent();
    texture.dispose();
    material.dispose();
    geometry.dispose();
  };
  return { sync, dispose };
}
