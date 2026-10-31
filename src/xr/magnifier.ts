import * as THREE from 'three';
import { EMPTY, PANEL_SIZE } from '../types';
import type { Cell, PlateSource } from './plate';

/** A plate-attached preview of the cells surrounding the current target. */
export function createMagnifier(
  parent: THREE.Object3D,
  source: PlateSource,
  palette: ReadonlyArray<{ hex: string }>,
  symbols: readonly string[],
): { update(cell: Cell | null): void; dispose(): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(0.1, 0.1);
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'xr-magnifier';
  mesh.visible = false;
  parent.parent?.add(mesh);
  const rotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -Math.PI / 2,
  );
  let lastKey = '';
  const update = (cell: Cell | null): void => {
    mesh.visible = cell !== null;
    if (!cell || !ctx) return;
    parent.updateWorldMatrix(true, false);
    mesh.position.set(0.13, 0.025, 0).applyMatrix4(parent.matrixWorld);
    parent.getWorldQuaternion(mesh.quaternion);
    mesh.quaternion.multiply(rotation);
    parent.getWorldScale(mesh.scale);
    const values: string[] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 0 || y < 0 || x >= PANEL_SIZE || y >= PANEL_SIZE) values.push('-');
        else {
          const { target, placed } = source.cellAt(x, y);
          values.push(`${target}:${placed}`);
        }
      }
    }
    const key = `${cell.x},${cell.y}:${values.join(',')}`;
    if (key === lastKey) return;
    lastKey = key;
    ctx.fillStyle = '#20282d';
    ctx.fillRect(0, 0, 320, 320);
    ctx.font = 'bold 25px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 0 || y < 0 || x >= PANEL_SIZE || y >= PANEL_SIZE) continue;
        const { target, placed } = source.cellAt(x, y);
        const px = (dx + 2) * 64;
        const py = (dy + 2) * 64;
        ctx.fillStyle = palette[placed === EMPTY ? target : placed]?.hex ?? '#777777';
        ctx.fillRect(px + 2, py + 2, 60, 60);
        ctx.fillStyle = '#000000';
        ctx.fillText(symbols[target] ?? '', px + 32, py + 32);
      }
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.strokeRect(130, 130, 60, 60);
    texture.needsUpdate = true;
  };
  return {
    update,
    dispose() {
      mesh.removeFromParent();
      texture.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
