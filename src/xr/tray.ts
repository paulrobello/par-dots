/**
 * XR color tray (XR P2b): a floating chip grid mirroring the 2D tray's semantics — one chip
 * per color still needed, remaining counts on the chip tops, the current-color ring, and
 * 2D parity: zero-count chips with wrong dots out stay listed but dimmed, correctly-complete
 * chips vanish, trigger selects. Chip membership/counts derive from the shared PanelSession
 * through the bridge, so XR and 2D cannot diverge. 1 unit = 1 m.
 */

import * as THREE from 'three';
import type { XrBridge } from './bridge';

/** One chip's parity-relevant state; pure and unit-tested against the 2D tray fixtures. */
export interface ChipState {
  c: number;
  /** Dots in hand: availableFor (0 with wrong dots out = dimmed, still listed). */
  count: number;
  dimmed: boolean;
  selected: boolean;
}

/** Chip states for the current bridge state, in tray order. */
export function chipStates(
  bridge: { trayColors(): number[]; availableFor(c: number): number },
  selected: number,
): ChipState[] {
  return bridge.trayColors().map((c) => {
    const count = bridge.availableFor(c);
    return { c, count, dimmed: count <= 0, selected: c === selected };
  });
}

/** What the tray needs; structural so tests can pass the real bridge. */
export interface TrayDeps {
  bridge: Pick<XrBridge, 'trayColors' | 'availableFor'>;
  palette: ReadonlyArray<{ hex: string }>;
  selected(): number;
}

export interface TrayHandle {
  root: THREE.Group;
  /** Reconcile chips to the current tray state (membership, counts, dim, ring). */
  sync(): void;
  /** World-space ray to the chip color index under it, or null. */
  pickChip(ray: { origin: THREE.Vector3; dir: THREE.Vector3 }): number | null;
  dispose(): void;
}

const CHIP_RADIUS = 0.014;
const CHIP_HEIGHT = 0.008;
const CHIP_GAP = 0.036;
const LABEL_PX = 96;

export function createTray(deps: TrayDeps): TrayHandle {
  const root = new THREE.Group();
  root.name = 'xr-tray';

  interface Chip {
    c: number;
    mesh: THREE.Mesh;
    mat: THREE.MeshStandardMaterial;
    labelCanvas: HTMLCanvasElement;
    labelTex: THREE.CanvasTexture;
    labelCtx: CanvasRenderingContext2D;
    labelMesh: THREE.Mesh;
  }
  const chips = new Map<number, Chip>();
  const chipGeo = new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT, 20);
  const labelGeo = new THREE.PlaneGeometry(CHIP_RADIUS * 2.2, CHIP_RADIUS * 2.2);

  const countLabel = (n: number): string => (n > 99 ? '99+' : String(n));

  const makeChip = (c: number): Chip => {
    const mat = new THREE.MeshStandardMaterial({
      color: deps.palette[c]?.hex ?? '#888888',
      roughness: 0.5,
    });
    const mesh = new THREE.Mesh(chipGeo, mat);
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = LABEL_PX;
    labelCanvas.height = LABEL_PX;
    const labelCtx = labelCanvas.getContext('2d') as CanvasRenderingContext2D;
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true });
    const labelMesh = new THREE.Mesh(labelGeo, labelMat);
    labelMesh.position.set(0, CHIP_HEIGHT / 2 + 0.001, 0);
    labelMesh.rotation.x = -Math.PI / 2;
    mesh.add(labelMesh);
    return { c, mesh, mat, labelCanvas, labelTex, labelCtx, labelMesh };
  };

  const layout = (): void => {
    const list = [...chips.values()];
    const cols = Math.ceil(Math.sqrt(list.length || 1));
    list.forEach((chip, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      chip.mesh.position.set((col - (cols - 1) / 2) * CHIP_GAP, 0, row * CHIP_GAP);
    });
  };

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CHIP_RADIUS * 1.15, CHIP_RADIUS * 1.45, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = CHIP_HEIGHT / 2 + 0.002;
  root.add(ring);

  const paintLabel = (chip: Chip, n: number): void => {
    chip.labelCtx.clearRect(0, 0, LABEL_PX, LABEL_PX);
    chip.labelCtx.fillStyle = 'rgba(15,16,18,0.85)';
    chip.labelCtx.beginPath();
    chip.labelCtx.arc(LABEL_PX / 2, LABEL_PX / 2, LABEL_PX * 0.42, 0, Math.PI * 2);
    chip.labelCtx.fill();
    chip.labelCtx.fillStyle = '#ffffff';
    chip.labelCtx.font = `700 ${Math.floor(LABEL_PX * 0.4)}px system-ui, sans-serif`;
    chip.labelCtx.textAlign = 'center';
    chip.labelCtx.textBaseline = 'middle';
    chip.labelCtx.fillText(countLabel(n), LABEL_PX / 2, LABEL_PX / 2);
    chip.labelTex.needsUpdate = true;
  };

  const sync = (): void => {
    const states = chipStates(deps.bridge, deps.selected());
    const next = new Set(states.map((s) => s.c));
    for (const [c, chip] of chips) {
      if (!next.has(c)) {
        root.remove(chip.mesh);
        chip.mat.dispose();
        chip.labelTex.dispose();
        (chip.labelMesh.material as THREE.MeshBasicMaterial).dispose();
        chips.delete(c);
      }
    }
    for (const s of states) {
      let chip = chips.get(s.c);
      if (!chip) {
        chip = makeChip(s.c);
        chips.set(s.c, chip);
        root.add(chip.mesh);
        layout();
      }
      chip.mat.opacity = s.dimmed ? 0.35 : 1;
      chip.mat.transparent = s.dimmed;
      paintLabel(chip, s.count);
    }
    const sel = states.find((s) => s.selected);
    if (sel) {
      const chip = chips.get(sel.c);
      if (chip) {
        ring.position.x = chip.mesh.position.x;
        ring.position.z = chip.mesh.position.z;
        ring.visible = true;
      }
    } else {
      ring.visible = false;
    }
  };

  const ray = new THREE.Ray();
  const hitP = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), CHIP_HEIGHT / 2);
  const inv = new THREE.Matrix4();
  const originL = new THREE.Vector3();
  const rootQuat = new THREE.Quaternion();
  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const localDir = new THREE.Vector3();
  const pickChip = (r: { origin: THREE.Vector3; dir: THREE.Vector3 }): number | null => {
    root.updateWorldMatrix(true, true);
    inv.copy(root.matrixWorld).invert();
    originL.copy(r.origin).applyMatrix4(inv);
    root.matrixWorld.decompose(tmpP, rootQuat, tmpS);
    localDir.copy(r.dir).normalize().applyQuaternion(tmpQ.copy(rootQuat).invert());
    ray.origin.copy(originL);
    ray.direction.copy(localDir);
    const p = hitP;
    if (!ray.intersectPlane(plane, p)) return null;
    for (const chip of chips.values()) {
      const dx = p.x - chip.mesh.position.x;
      const dz = p.z - chip.mesh.position.z;
      if (dx * dx + dz * dz <= CHIP_RADIUS * 1.4 * (CHIP_RADIUS * 1.4)) return chip.c;
    }
    return null;
  };

  const dispose = (): void => {
    for (const chip of chips.values()) {
      chip.mat.dispose();
      chip.labelTex.dispose();
      (chip.labelMesh.material as THREE.MeshBasicMaterial).dispose();
    }
    chips.clear();
    chipGeo.dispose();
    labelGeo.dispose();
    ring.geometry.dispose();
    (ring.material as THREE.MeshBasicMaterial).dispose();
  };

  sync();
  return { root, sync, pickChip, dispose };
}
