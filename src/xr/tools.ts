/**
 * XR tools (XR P2c): floating Place / Remove / Hint / Undo / Redo buttons beside the tray.
 * Trigger presses dispatch actions; Remove toggles the XR remove mode (selection exits it,
 * 2D parity); Hint flashes wrong studs for 3 s with a count label; Undo/Redo go through the
 * bridge so history stays one stack with 2D. The full-but-wrong buzz re-arms on any empty
 * stud, mirroring the 2D feedback. 1 unit = 1 m.
 */

import * as THREE from 'three';

export type ToolId = 'place' | 'remove' | 'hint' | 'undo' | 'redo' | 'ghost';

export const TOOL_ORDER: readonly ToolId[] = ['place', 'remove', 'hint', 'undo', 'redo', 'ghost'];

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
  setGhostActive(on: boolean): void;
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
  ghost: 'Ghost',
};

function drawToolIcon(ctx: CanvasRenderingContext2D, id: ToolId, x: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (id === 'place') {
    ctx.arc(x, 48, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = color === '#252117' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.5)';
    ctx.arc(x - 5, 42, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'remove') {
    ctx.moveTo(x - 20, 55);
    ctx.lineTo(x + 1, 33);
    ctx.lineTo(x + 20, 51);
    ctx.lineTo(x + 3, 68);
    ctx.lineTo(x - 7, 68);
    ctx.closePath();
    ctx.moveTo(x - 7, 42);
    ctx.lineTo(x + 11, 60);
    ctx.stroke();
  } else if (id === 'hint') {
    ctx.arc(x, 45, 16, Math.PI * 0.2, Math.PI * 0.8, true);
    ctx.lineTo(x - 8, 65);
    ctx.lineTo(x + 8, 65);
    ctx.closePath();
    ctx.moveTo(x - 6, 71);
    ctx.lineTo(x + 6, 71);
    ctx.stroke();
  } else if (id === 'ghost') {
    ctx.moveTo(x - 19, 34);
    ctx.lineTo(x + 19, 34);
    ctx.lineTo(x + 19, 70);
    ctx.lineTo(x - 19, 70);
    ctx.closePath();
    ctx.moveTo(x - 19, 52);
    ctx.lineTo(x + 19, 52);
    ctx.moveTo(x, 34);
    ctx.lineTo(x, 70);
    ctx.stroke();
  } else {
    const sign = id === 'undo' ? 1 : -1;
    ctx.moveTo(x - sign * 18, 45);
    ctx.lineTo(x - sign * 9, 36);
    ctx.moveTo(x - sign * 18, 45);
    ctx.lineTo(x - sign * 9, 54);
    ctx.moveTo(x - sign * 18, 45);
    ctx.lineTo(x + sign * 5, 45);
    ctx.quadraticCurveTo(x + sign * 19, 45, x + sign * 19, 58);
    ctx.quadraticCurveTo(x + sign * 19, 71, x + sign * 5, 71);
    ctx.stroke();
  }
}

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
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(total, BTN), mat);
  strip.name = 'xr-tools-strip';
  root.add(strip);

  let activeId: 'place' | 'remove' | null = 'place';
  let ghostActive = false;
  const flashing = new Set<ToolId>();

  /** Repaint the whole strip (state changes are rare; five 128px slots are cheap). */
  const paint = (): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, stripCanvas.width, LABEL_PX);
    for (let i = 0; i < TOOL_ORDER.length; i++) {
      const id = TOOL_ORDER[i];
      const x0 = i * LABEL_PX;
      const active = id === activeId || (id === 'ghost' && ghostActive) || flashing.has(id);
      const width = (BTN / (BTN + BTN_GAP)) * LABEL_PX;
      ctx.fillStyle = active ? '#f2cd37' : '#20282d';
      ctx.beginPath();
      ctx.roundRect(x0 + (LABEL_PX - width) / 2, 4, width, LABEL_PX - 8, 19);
      ctx.fill();
      ctx.strokeStyle = active ? '#fff0a6' : '#52616a';
      ctx.lineWidth = 2;
      ctx.stroke();
      const ink = active ? '#252117' : '#f4f5f6';
      drawToolIcon(ctx, id, x0 + LABEL_PX / 2, ink);
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.floor(LABEL_PX * 0.16)}px system-ui, sans-serif`;
      ctx.fillText(LABELS[id], x0 + LABEL_PX / 2, LABEL_PX * 0.76);
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

  const setGhostActive = (on: boolean): void => {
    ghostActive = on;
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
  };

  paint();
  return { root, pickTool, setActive, setGhostActive, dispose, flash };
}
