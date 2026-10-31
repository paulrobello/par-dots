/**
 * XR tools (XR P2c): floating Place / Remove / Hint / Undo / Redo buttons beside the tray.
 * Trigger presses dispatch actions; Remove toggles the XR remove mode (selection exits it,
 * 2D parity); Hint flashes wrong studs for 3 s with a count label; Undo/Redo go through the
 * bridge so history stays one stack with 2D. The full-but-wrong buzz re-arms on any empty
 * stud, mirroring the 2D feedback. 1 unit = 1 m.
 */

import * as THREE from 'three';

export type ToolId = 'place' | 'remove' | 'hint' | 'undo' | 'redo';

export const TOOL_ORDER: readonly ToolId[] = ['place', 'remove', 'hint', 'undo', 'redo'];

/**
 * Full-but-wrong buzz arming: re-armed whenever the panel is not full-but-wrong; stays
 * disarmed while it is, so the buzz fires once per episode.
 */
export function nextBuzz(filled: boolean, wrong: boolean): boolean {
  return !filled || !wrong;
}

export interface ToolsHandle {
  root: THREE.Group;
  /** World-space ray to the tool id under it, or null. */
  pickTool(ray: { origin: THREE.Vector3; dir: THREE.Vector3 }): ToolId | null;
  /** Highlight the active stroke tool ('place' | 'remove'), or none. */
  setActive(id: 'place' | 'remove' | null): void;
  dispose(): void;
}

const BTN = 0.05;
const BTN_GAP = 0.012;
const LABEL_PX = 128;
const LABELS: Record<ToolId, string> = {
  place: 'Place',
  remove: 'Remove',
  hint: 'Hint',
  undo: 'Undo',
  redo: 'Redo',
};

export function createTools(): ToolsHandle & { flash(id: ToolId): void } {
  const root = new THREE.Group();
  root.name = 'xr-tools';

  interface Btn {
    id: ToolId;
    mesh: THREE.Mesh;
    mat: THREE.MeshStandardMaterial;
    tex: THREE.CanvasTexture;
    ctx: CanvasRenderingContext2D | null;
    base: string;
  }
  const buttons: Btn[] = [];
  const total = TOOL_ORDER.length * BTN + (TOOL_ORDER.length - 1) * BTN_GAP;
  let x = -total / 2 + BTN / 2;

  const paint = (b: Btn, active: boolean): void => {
    const ctx = b.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, LABEL_PX, LABEL_PX);
    ctx.fillStyle = active ? '#4d8dff' : b.base;
    ctx.beginPath();
    ctx.roundRect(6, 6, LABEL_PX - 12, LABEL_PX - 12, 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.floor(LABEL_PX * 0.22)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(LABELS[b.id], LABEL_PX / 2, LABEL_PX / 2);
    b.tex.needsUpdate = true;
  };

  for (const id of TOOL_ORDER) {
    const canvas = document.createElement('canvas');
    canvas.width = LABEL_PX;
    canvas.height = LABEL_PX;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BTN, BTN, 0.006), mat);
    mesh.name = `xr-tool-${id}`;
    mesh.position.set(x, 0, 0);
    root.add(mesh);
    const b: Btn = { id, mesh, mat, tex, ctx, base: '#2a2d31' };
    paint(b, false);
    buttons.push(b);
    x += BTN + BTN_GAP;
  }

  let activeId: 'place' | 'remove' | null = 'place';

  const paintAll = (): void => {
    for (const b of buttons) paint(b, b.id === activeId);
  };

  const ray = new THREE.Raycaster();

  const pickTool = (r: { origin: THREE.Vector3; dir: THREE.Vector3 }): ToolId | null => {
    root.updateWorldMatrix(true, true);
    ray.set(r.origin, r.dir);
    const hits = ray.intersectObjects(
      buttons.map((b) => b.mesh),
      false,
    );
    if (hits.length === 0) return null;
    const name = hits[0].object.name.replace('xr-tool-', '');
    return (TOOL_ORDER as readonly string[]).includes(name) ? (name as ToolId) : null;
  };

  const setActive = (id: 'place' | 'remove' | null): void => {
    activeId = id;
    paintAll();
  };

  const flashTimers = new Set<ReturnType<typeof setTimeout>>();
  const flash = (id: ToolId): void => {
    const b = buttons.find((btn) => btn.id === id);
    if (!b) return;
    paint(b, true);
    const t = setTimeout(() => {
      flashTimers.delete(t);
      paint(b, b.id === activeId);
    }, 180);
    flashTimers.add(t);
  };

  const dispose = (): void => {
    for (const t of flashTimers) clearTimeout(t);
    flashTimers.clear();
    for (const b of buttons) {
      b.tex.dispose();
      b.mat.dispose();
      b.mesh.geometry.dispose();
    }
  };

  return { root, pickTool, setActive, dispose, flash };
}
