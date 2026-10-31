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

  // The strip plane is exactly TOOL_ORDER.length texture slots wide, so each LABEL_PX slot of
  // the canvas maps to one physical BTN+BTN_GAP pitch and painted buttons coincide with pick
  // zones (a width of BTN+gap*(n-1) stretches the texture pitch and drifts the outer buttons).
  const total = TOOL_ORDER.length * (BTN + BTN_GAP);
  const stripCanvas = document.createElement('canvas');
  stripCanvas.width = LABEL_PX * TOOL_ORDER.length;
  stripCanvas.height = LABEL_PX;
  const ctx = stripCanvas.getContext('2d');
  const tex = new THREE.CanvasTexture(stripCanvas);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, transparent: true });
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(total, BTN), mat);
  strip.name = 'xr-tools-strip';
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(total + 0.018, BTN + 0.018, 0.006),
    new THREE.MeshStandardMaterial({ color: 0x161f2a, roughness: 0.8 }),
  );
  backing.position.z = -0.004;
  root.add(backing);
  root.add(strip);

  let activeId: 'place' | 'remove' | null = 'place';
  const flashing = new Set<ToolId>();

  /** Repaint the whole strip (state changes are rare; five 128px slots are cheap). */
  const paint = (): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, stripCanvas.width, LABEL_PX);
    for (let i = 0; i < TOOL_ORDER.length; i++) {
      const id = TOOL_ORDER[i];
      const x0 = i * LABEL_PX;
      ctx.fillStyle = id === activeId || flashing.has(id) ? '#4d8dff' : '#354657';
      ctx.beginPath();
      const width = (BTN / (BTN + BTN_GAP)) * LABEL_PX;
      ctx.roundRect(x0 + (LABEL_PX - width) / 2, 6, width, LABEL_PX - 12, 18);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.floor(LABEL_PX * 0.22)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(LABELS[id], x0 + LABEL_PX / 2, LABEL_PX / 2);
    }
    tex.needsUpdate = true;
  };

  /** Local-space slot center for a tool id (strip plane spans -total/2..total/2 on x). */
  const slotCenter = (id: ToolId): number =>
    (TOOL_ORDER.indexOf(id) - (TOOL_ORDER.length - 1) / 2) * (BTN + BTN_GAP);

  const ray = new THREE.Ray();
  const hitP = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const originL = new THREE.Vector3();
  const rootQuat = new THREE.Quaternion();
  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const localDir = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  const pickTool = (r: { origin: THREE.Vector3; dir: THREE.Vector3 }): ToolId | null => {
    root.updateWorldMatrix(true, true);
    inv.copy(root.matrixWorld).invert();
    originL.copy(r.origin).applyMatrix4(inv);
    root.matrixWorld.decompose(tmpP, rootQuat, tmpS);
    localDir.copy(r.dir).normalize().applyQuaternion(tmpQ.copy(rootQuat).invert());
    ray.origin.copy(originL);
    ray.direction.copy(localDir);
    const p = hitP;
    if (!ray.intersectPlane(plane, p)) return null;
    if (Math.abs(p.x) > total / 2 || Math.abs(p.y) > BTN / 2) return null;
    const slot = Math.floor((p.x + total / 2) / (BTN + BTN_GAP));
    const id = TOOL_ORDER[Math.min(slot, TOOL_ORDER.length - 1)];
    const cx = slotCenter(id);
    return Math.abs(p.x - cx) <= BTN / 2 + BTN_GAP / 2 ? id : null;
  };

  const setActive = (id: 'place' | 'remove' | null): void => {
    activeId = id;
    paint();
  };

  const flashTimers = new Map<ToolId, ReturnType<typeof setTimeout>>();
  const flash = (id: ToolId): void => {
    clearTimeout(flashTimers.get(id));
    flashing.add(id);
    paint();
    flashTimers.set(
      id,
      setTimeout(() => {
        flashTimers.delete(id);
        flashing.delete(id);
        paint();
      }, 180),
    );
  };

  const dispose = (): void => {
    for (const t of flashTimers.values()) clearTimeout(t);
    flashTimers.clear();
    flashing.clear();
    tex.dispose();
    mat.dispose();
    strip.geometry.dispose();
    backing.geometry.dispose();
    backing.material.dispose();
  };

  paint();
  return { root, pickTool, setActive, dispose, flash };
}
