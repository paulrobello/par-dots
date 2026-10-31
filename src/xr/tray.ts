/**
 * XR color tray (XR P2b, draw-call batched in P4): a floating chip grid mirroring the 2D
 * tray's semantics — one chip per color still needed, remaining counts on the chip tops, the
 * current-color ring, and 2D parity: zero-count chips with wrong dots out stay listed but
 * dimmed, correctly-complete chips vanish, trigger selects. Membership and counts derive from
 * the shared PanelSession through the bridge, so XR and 2D cannot diverge. All chips render
 * as one InstancedMesh and the count labels share one canvas strip, so the tray costs a
 * constant three draw calls regardless of color count. 1 unit = 1 m.
 */

import * as THREE from 'three';
import { MAX_COLORS } from '../types';
import type { XrBridge } from './bridge';
import { localRay } from './transforms';

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
const STRIP_PX = 512;

export function createTray(deps: TrayDeps): TrayHandle {
  const root = new THREE.Group();
  root.name = 'xr-tray';

  const chipGeo = new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT, 20);
  const chipMat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
  const chips = new THREE.InstancedMesh(chipGeo, chipMat, MAX_COLORS);
  chips.name = 'xr-tray-chips';
  chips.count = 0;
  root.add(chips);

  /** Chip slots in tray order: the square grid the labels, picking and ring all share. */
  let states: ChipState[] = [];
  const slots: Array<{ x: number; z: number }> = [];
  /** Side of the label quad, grown with the grid; the strip canvas maps onto it 1:1. */
  let stripExtent = CHIP_GAP;
  const stripCanvas = document.createElement('canvas');
  stripCanvas.width = STRIP_PX;
  stripCanvas.height = STRIP_PX;
  const stripCtx = stripCanvas.getContext('2d') as CanvasRenderingContext2D | null;
  const stripTex = new THREE.CanvasTexture(stripCanvas);
  const labelMat = new THREE.MeshBasicMaterial({ map: stripTex, transparent: true });
  const labelQuad = new THREE.Mesh(new THREE.PlaneGeometry(stripExtent, stripExtent), labelMat);
  labelQuad.rotation.x = -Math.PI / 2;
  labelQuad.position.y = CHIP_HEIGHT / 2 + 0.001;
  root.add(labelQuad);
  const layout = (n: number): void => {
    slots.length = 0;
    const cols = Math.ceil(Math.sqrt(n || 1));
    const rows = Math.max(1, Math.ceil(n / cols));
    for (let i = 0; i < n; i++) {
      slots.push({
        x: ((i % cols) - (cols - 1) / 2) * CHIP_GAP,
        z: Math.floor(i / cols) * CHIP_GAP,
      });
    }
    const extent = Math.max(cols, rows) * CHIP_GAP;
    if (extent !== stripExtent) {
      stripExtent = extent;
      labelQuad.geometry.dispose();
      labelQuad.geometry = new THREE.PlaneGeometry(extent, extent);
    }
    labelQuad.position.z = ((rows - 1) / 2) * CHIP_GAP;
  };

  /** Canvas pixel coords for a slot, mapping the strip quad onto the label plane. */
  const slotPx = (s: { x: number; z: number }): { px: number; py: number } => ({
    px: STRIP_PX / 2 + (s.x / stripExtent) * STRIP_PX,
    py: STRIP_PX / 2 + ((s.z - labelQuad.position.z) / stripExtent) * STRIP_PX,
  });

  const countLabel = (n: number): string => (n > 99 ? '99+' : n < 0 ? '0' : String(n));

  const paintStrip = (): void => {
    const ctx = stripCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, STRIP_PX, STRIP_PX);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pixelsPerMeter = STRIP_PX / stripExtent;
    const labelRadius = CHIP_RADIUS * 0.7 * pixelsPerMeter;
    const fontSize = CHIP_RADIUS * 0.85 * pixelsPerMeter;
    for (let i = 0; i < states.length; i++) {
      const { px, py } = slotPx(slots[i]);
      ctx.fillStyle = 'rgba(15,16,18,0.85)';
      ctx.beginPath();
      ctx.arc(px, py, labelRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
      ctx.fillText(countLabel(states[i].count), px, py, labelRadius * 1.75);
    }
    stripTex.needsUpdate = true;
  };

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CHIP_RADIUS * 1.15, CHIP_RADIUS * 1.45, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = CHIP_HEIGHT / 2 + 0.002;
  root.add(ring);

  const dimColor = new THREE.Color(0x555555);
  const tmpColor = new THREE.Color();
  const tmpMatrix = new THREE.Matrix4();
  const sync = (): void => {
    states = chipStates(deps.bridge, deps.selected());
    layout(states.length);
    for (let i = 0; i < states.length; i++) {
      const s = slots[i];
      tmpMatrix.makeTranslation(s.x, 0, s.z);
      chips.setMatrixAt(i, tmpMatrix);
      tmpColor.set(deps.palette[states[i].c]?.hex ?? '#888888');
      if (states[i].dimmed) tmpColor.lerp(dimColor, 0.7);
      chips.setColorAt(i, tmpColor);
    }
    chips.count = states.length;
    chips.instanceMatrix.needsUpdate = true;
    if (chips.instanceColor) chips.instanceColor.needsUpdate = true;
    paintStrip();
    const sel = states.findIndex((s) => s.selected);
    if (sel >= 0) {
      ring.position.x = slots[sel].x;
      ring.position.z = slots[sel].z;
      ring.visible = true;
    } else {
      ring.visible = false;
    }
  };

  const ray = new THREE.Ray();
  const hitP = new THREE.Vector3();
  // Chip tops sit at +CHIP_HEIGHT/2; a THREE.Plane satisfies normal*p + constant = 0, so the
  // constant is the negated height. Oblique controller rays miss when it is off by this much.
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CHIP_HEIGHT / 2);
  const inv = new THREE.Matrix4();
  const pickChip = (r: { origin: THREE.Vector3; dir: THREE.Vector3 }): number | null => {
    if (states.length === 0) return null;
    localRay(root, r.origin, r.dir, ray, inv);
    const p = hitP;
    if (!ray.intersectPlane(plane, p)) return null;
    const reach = CHIP_RADIUS * 1.4;
    for (let i = 0; i < slots.length; i++) {
      const dx = p.x - slots[i].x;
      const dz = p.z - slots[i].z;
      if (dx * dx + dz * dz <= reach * reach) return states[i].c;
    }
    return null;
  };

  const dispose = (): void => {
    chipGeo.dispose();
    chipMat.dispose();
    chips.dispose();
    stripTex.dispose();
    labelMat.dispose();
    labelQuad.geometry.dispose();
    ring.geometry.dispose();
    (ring.material as THREE.MeshBasicMaterial).dispose();
  };

  sync();
  return { root, sync, pickChip, dispose };
}
