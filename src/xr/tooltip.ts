import * as THREE from 'three';

export function createXrTooltip(
  parent: THREE.Object3D,
  width: number,
): {
  set(text: string | null, x?: number): void;
  dispose(): void;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, (width * 96) / 512), material);
  mesh.name = 'xr-hover-tooltip';
  mesh.visible = false;
  mesh.renderOrder = 10;
  parent.add(mesh);
  let current: string | null = null;
  return {
    set(text, x = 0) {
      mesh.position.x = x;
      mesh.visible = text !== null;
      if (!text || text === current || !ctx) return;
      current = text;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(15, 20, 24, 0.96)';
      ctx.beginPath();
      ctx.roundRect(2, 2, 508, 92, 18);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 34px system-ui, sans-serif';
      ctx.fillText(text, 256, 48, 480);
      texture.needsUpdate = true;
    },
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
