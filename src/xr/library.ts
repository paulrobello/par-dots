/**
 * XR library (XR P5): the in-VR picture picker shown when VR is entered from the gallery.
 * One canvas strip lists the saved pictures (newest first, most recent 8) with overall
 * progress; the trigger picks a row. Row geometry is pure and unit-tested.
 */

import * as THREE from 'three';

export interface LibraryEntryInfo {
  id: string;
  name: string;
  percent: number;
}

/** Visible rows: header + at most MAX_LIBRARY_ROWS saves. */
export const MAX_LIBRARY_ROWS = 8;

export interface LibraryRow {
  id: string;
  /** 'Name — 42%' as painted. */
  label: string;
}

/** Trim to the visible window and render labels; pure and unit-tested. */
export function libraryRows(saves: LibraryEntryInfo[]): LibraryRow[] {
  return saves.slice(0, MAX_LIBRARY_ROWS).map((s) => ({
    id: s.id,
    label: `${truncate(s.name, 24)} — ${Math.round(s.percent)}%`,
  }));
}

const truncate = (name: string, max: number): string =>
  name.length > max ? `${name.slice(0, max - 1)}…` : name;

export interface LibraryDeps {
  rows(): LibraryRow[];
  onPick(id: string): void;
}

export interface LibraryHandle {
  root: THREE.Group;
  /** World-space ray to the picked row index, or null. */
  pickRow(ray: { origin: THREE.Vector3; dir: THREE.Vector3 }): number | null;
  repaint(): void;
  dispose(): void;
}

export const LIBRARY_WIDTH = 0.46;
export const LIBRARY_HEIGHT = 0.6;
const CANVAS_W = 640;
const CANVAS_H = 840;

export function createLibrary(deps: LibraryDeps): LibraryHandle {
  const root = new THREE.Group();
  root.name = 'xr-library';

  const backGeo = new THREE.BoxGeometry(LIBRARY_WIDTH + 0.02, LIBRARY_HEIGHT + 0.02, 0.012);
  const backMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.7 });
  const back = new THREE.Mesh(backGeo, backMat);
  back.position.z = -0.007;
  root.add(back);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  const tex = new THREE.CanvasTexture(canvas);
  const faceGeo = new THREE.PlaneGeometry(LIBRARY_WIDTH, LIBRARY_HEIGHT);
  const face = new THREE.Mesh(
    faceGeo,
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
  );
  face.name = 'xr-library-face';
  root.add(face);

  const repaint = (): void => {
    if (!ctx) return;
    const rows = deps.rows();
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#202329';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 52px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Library', 28, 56);
    ctx.font = '600 40px system-ui, sans-serif';
    const rowH = (CANVAS_H - 110) / MAX_LIBRARY_ROWS;
    rows.forEach((row, i) => {
      const y = 110 + rowH * i + rowH / 2;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(16, 110 + rowH * i + 4, CANVAS_W - 32, rowH - 8);
      ctx.fillStyle = '#e6e6e6';
      ctx.fillText(row.label, 32, y);
    });
    if (rows.length === 0) {
      ctx.fillStyle = 'rgba(230,230,230,0.6)';
      ctx.fillText('No pictures yet', 32, 200);
    }
    tex.needsUpdate = true;
  };

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

  const pickRow = (r: { origin: THREE.Vector3; dir: THREE.Vector3 }): number | null => {
    if (!ctx) return null;
    root.updateWorldMatrix(true, true);
    inv.copy(root.matrixWorld).invert();
    originL.copy(r.origin).applyMatrix4(inv);
    root.matrixWorld.decompose(tmpP, rootQuat, tmpS);
    localDir.copy(r.dir).normalize().applyQuaternion(tmpQ.copy(rootQuat).invert());
    ray.origin.copy(originL);
    ray.direction.copy(localDir);
    const p = hitP;
    if (!ray.intersectPlane(plane, p)) return null;
    if (Math.abs(p.x) > LIBRARY_WIDTH / 2 || Math.abs(p.y) > LIBRARY_HEIGHT / 2) return null;
    const rows = deps.rows();
    if (rows.length === 0) return null;
    const rowH = (LIBRARY_HEIGHT - 110 / (CANVAS_H / LIBRARY_HEIGHT)) / MAX_LIBRARY_ROWS;
    const top = LIBRARY_HEIGHT / 2 - 110 / (CANVAS_H / LIBRARY_HEIGHT);
    const dy = top - p.y;
    if (dy < 0) return null;
    const idx = Math.floor(dy / rowH);
    return idx >= 0 && idx < rows.length ? idx : null;
  };

  const dispose = (): void => {
    tex.dispose();
    (face.material as THREE.MeshBasicMaterial).dispose();
    faceGeo.dispose();
    backGeo.dispose();
    backMat.dispose();
  };

  repaint();
  return { root, pickRow, repaint, dispose };
}
