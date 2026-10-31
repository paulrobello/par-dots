/**
 * XR library (XR P5): the in-VR picture picker shown when VR is entered from the gallery.
 * One canvas panel pages through saved pictures with previews and overall progress;
 * the trigger picks a row.
 */

import * as THREE from 'three';

export interface LibraryEntryInfo {
  id: string;
  name: string;
  percent: number;
  preview?: HTMLCanvasElement;
}

/** Visible rows: header + at most MAX_LIBRARY_ROWS saves. */
export const MAX_LIBRARY_ROWS = 8;

export interface LibraryRow {
  id: string;
  /** 'Name — 42%' as painted. */
  label: string;
  percent?: number;
  preview?: HTMLCanvasElement;
}

/** Render library row labels; the panel pages the resulting list. */
export function libraryRows(saves: LibraryEntryInfo[]): LibraryRow[] {
  return saves.map((s) => ({
    id: s.id,
    label: `${truncate(s.name, 24)} — ${Math.round(s.percent)}%`,
    percent: Math.max(0, Math.min(100, s.percent)),
    preview: s.preview,
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
  pickSettings(ray: { origin: THREE.Vector3; dir: THREE.Vector3 }): boolean;
  /** Set the absolute row currently under the controller, or clear the hover. */
  setHover(row: number | null): void;
  repaint(): void;
  pageBy(delta: number): void;
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
  tex.colorSpace = THREE.SRGBColorSpace;
  const faceGeo = new THREE.PlaneGeometry(LIBRARY_WIDTH, LIBRARY_HEIGHT);
  const face = new THREE.Mesh(
    faceGeo,
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
  );
  face.name = 'xr-library-face';
  root.add(face);

  let page = 0;
  let hoveredRow: number | null = null;
  const repaint = (): void => {
    if (!ctx) return;
    const allRows = deps.rows();
    page = Math.min(page, Math.max(0, Math.ceil(allRows.length / MAX_LIBRARY_ROWS) - 1));
    const rows = allRows.slice(page * MAX_LIBRARY_ROWS, (page + 1) * MAX_LIBRARY_ROWS);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#202329';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 52px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Library', 28, 56);
    ctx.fillStyle = '#f2cd37';
    ctx.fillRect(466, 24, 146, 54);
    ctx.fillStyle = '#252117';
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Settings', 539, 51);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(230,230,230,0.65)';
    ctx.font = '500 21px system-ui, sans-serif';
    ctx.fillText(
      `Trigger: open  •  Stick: page ${page + 1}/${Math.max(1, Math.ceil(allRows.length / MAX_LIBRARY_ROWS))}  •  B: exit`,
      28,
      92,
    );
    ctx.font = '600 34px system-ui, sans-serif';
    const rowH = (CANVAS_H - 110) / MAX_LIBRARY_ROWS;
    rows.forEach((row, i) => {
      const y = 110 + rowH * i + rowH / 2;
      const rowTop = 110 + rowH * i + 4;
      const absoluteRow = page * MAX_LIBRARY_ROWS + i;
      const hovered = hoveredRow === absoluteRow;
      const textX = row.preview ? 112 : 32;
      ctx.fillStyle = hovered
        ? 'rgba(111,217,187,0.28)'
        : i % 2 === 0
          ? 'rgba(255,255,255,0.10)'
          : 'rgba(255,255,255,0.05)';
      ctx.fillRect(16, rowTop, CANVAS_W - 32, rowH - 8);
      ctx.fillStyle = hovered ? '#6fd9bb' : 'rgba(111,217,187,0.7)';
      ctx.fillRect(16, rowTop, 6, rowH - 8);
      if (row.preview) {
        const scale = Math.min(64 / row.preview.width, 64 / row.preview.height);
        const w = row.preview.width * scale;
        const h = row.preview.height * scale;
        ctx.drawImage(row.preview, 32 + (64 - w) / 2, y - h / 2, w, h);
      }
      ctx.fillStyle = '#e6e6e6';
      ctx.fillText(row.label, textX, y - 6);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(textX, y + rowH / 2 - 16, CANVAS_W - textX - 32, 5);
      ctx.fillStyle = '#6fd9bb';
      ctx.fillRect(
        textX,
        y + rowH / 2 - 16,
        (CANVAS_W - textX - 32) * ((row.percent ?? 0) / 100),
        5,
      );
    });
    if (rows.length === 0) {
      ctx.fillStyle = 'rgba(230,230,230,0.6)';
      ctx.fillText('No unfinished pictures', 32, 200);
      ctx.font = '500 26px system-ui, sans-serif';
      ctx.fillText('Create a picture in 2D to begin.', 32, 250);
    }
    tex.needsUpdate = true;
  };

  const ray = new THREE.Ray();
  const hitP = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const originL = new THREE.Vector3();
  const localDir = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  const hitPanel = (r: { origin: THREE.Vector3; dir: THREE.Vector3 }): boolean => {
    root.updateWorldMatrix(true, true);
    inv.copy(root.matrixWorld).invert();
    originL.copy(r.origin).applyMatrix4(inv);
    localDir.copy(r.dir).transformDirection(inv);
    ray.origin.copy(originL);
    ray.direction.copy(localDir);
    return ray.intersectPlane(plane, hitP) !== null;
  };
  const pickSettings = (r: { origin: THREE.Vector3; dir: THREE.Vector3 }): boolean => {
    if (!hitPanel(r)) return false;
    const x = (hitP.x / LIBRARY_WIDTH + 0.5) * CANVAS_W;
    const y = (0.5 - hitP.y / LIBRARY_HEIGHT) * CANVAS_H;
    return x >= 466 && x <= 612 && y >= 24 && y <= 78;
  };
  const pickRow = (r: { origin: THREE.Vector3; dir: THREE.Vector3 }): number | null => {
    if (!ctx || !hitPanel(r)) return null;
    const p = hitP;
    if (Math.abs(p.x) > LIBRARY_WIDTH / 2 || Math.abs(p.y) > LIBRARY_HEIGHT / 2) return null;
    const rows = deps.rows();
    if (rows.length === 0) return null;
    const rowH = (LIBRARY_HEIGHT - 110 / (CANVAS_H / LIBRARY_HEIGHT)) / MAX_LIBRARY_ROWS;
    const top = LIBRARY_HEIGHT / 2 - 110 / (CANVAS_H / LIBRARY_HEIGHT);
    const dy = top - p.y;
    if (dy < 0) return null;
    const idx = Math.floor(dy / rowH);
    const absolute = page * MAX_LIBRARY_ROWS + idx;
    return idx >= 0 && idx < MAX_LIBRARY_ROWS && absolute < rows.length ? absolute : null;
  };

  const dispose = (): void => {
    tex.dispose();
    (face.material as THREE.MeshBasicMaterial).dispose();
    faceGeo.dispose();
    backGeo.dispose();
    backMat.dispose();
  };

  const pageBy = (delta: number): void => {
    const last = Math.max(0, Math.ceil(deps.rows().length / MAX_LIBRARY_ROWS) - 1);
    page = Math.max(0, Math.min(last, page + delta));
    repaint();
  };
  const setHover = (row: number | null): void => {
    if (hoveredRow === row) return;
    hoveredRow = row;
    repaint();
  };
  repaint();
  return { root, pickRow, pickSettings, setHover, repaint, pageBy, dispose };
}
