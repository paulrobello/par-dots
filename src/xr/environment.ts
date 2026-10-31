import * as THREE from 'three';
import type { XrEnvironment } from '../storage/settings';

/** Lightweight, static VR worlds; lighting stays neutral for judging dot colors. */
export function createVrEnvironment(scene: THREE.Scene): {
  set(preset: XrEnvironment): void;
  dispose(): void;
} {
  const group = new THREE.Group();
  group.name = 'xr-environment';
  scene.add(group);
  const clear = (): void => {
    group.traverse((node) => {
      if (
        node instanceof THREE.Mesh ||
        node instanceof THREE.Points ||
        node instanceof THREE.LineSegments
      ) {
        node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) material.dispose();
        if (node instanceof THREE.InstancedMesh) node.dispose();
      }
    });
    group.clear();
  };
  const set = (preset: XrEnvironment): void => {
    clear();
    const sky: Record<XrEnvironment, number> = {
      studio: 0x202329,
      night: 0x091426,
      sunset: 0x63465a,
      forest: 0x29433e,
    };
    scene.background = new THREE.Color(sky[preset]);
    const grid = new THREE.GridHelper(
      20,
      40,
      preset === 'studio' ? 0x394048 : 0x53635c,
      preset === 'studio' ? 0x2b3037 : 0x344a47,
    );
    group.add(grid);
    if (preset === 'studio') return;
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(20, 48),
      new THREE.MeshBasicMaterial({
        color: preset === 'night' ? 0x142238 : preset === 'sunset' ? 0x493c4c : 0x233a32,
        side: THREE.DoubleSide,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.015;
    group.add(floor);
    if (preset === 'night') {
      const points: number[] = [];
      let seed = 1741;
      for (let i = 0; i < 400; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const angle = (seed / 0x100000000) * Math.PI * 2;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const y = 2 + (seed / 0x100000000) * 13;
        const radius = Math.sqrt(225 - y * y);
        points.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      group.add(
        new THREE.Points(
          geometry,
          new THREE.PointsMaterial({ color: 0xe2ecff, size: 2, sizeAttenuation: false }),
        ),
      );
    }
    if (preset === 'sunset') {
      const sun = new THREE.Mesh(
        new THREE.SphereGeometry(1.1, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0xffc477 }),
      );
      sun.position.set(0, 4, -14);
      group.add(sun);
    }
    if (preset === 'forest' || preset === 'sunset') {
      const forest = preset === 'forest';
      const geometry = new THREE.ConeGeometry(
        forest ? 1.15 : 3.2,
        forest ? 3.6 : 4.8,
        forest ? 7 : 4,
      );
      const material = new THREE.MeshBasicMaterial({ color: forest ? 0x173128 : 0x3a3448 });
      const silhouettes = new THREE.InstancedMesh(geometry, material, 18);
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < 18; i++) {
        const angle = (i / 18) * Math.PI * 2;
        matrix.makeTranslation(Math.sin(angle) * 10, forest ? 1.8 : 1.6, Math.cos(angle) * 10);
        silhouettes.setMatrixAt(i, matrix);
      }
      silhouettes.instanceMatrix.needsUpdate = true;
      group.add(silhouettes);
    }
  };
  return {
    set,
    dispose() {
      clear();
      group.removeFromParent();
      scene.background = null;
    },
  };
}
