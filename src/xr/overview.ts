/** XR whole-picture overview: a canvas-backed mosaic with panel progress and ray picking. */

import * as THREE from 'three';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../types';

export const OVERVIEW_WIDTH = 0.72;
export const OVERVIEW_MAX_HEIGHT = 0.72;
const CANVAS_SIZE = 768;

export interface OverviewHandle {
  root: THREE.Group;
  /** Return the row-major panel index under a world-space ray, or null outside the picture. */
  pickPanel(ray: { origin: THREE.Vector3; dir: THREE.Vector3 }): number | null;
  /** Set the panel hover highlight and repaint the overview. */
  setHover(panel: number | null): void;
  repaint(): void;
  dispose(): void;
}

/** Completion percentage for one panel, based on the dots currently placed in it. */
export function panelProgress(save: PictureSave, panel: number): number {
  const cols = save.width / PANEL_SIZE;
  const panelX = panel % cols;
  const panelY = Math.floor(panel / cols);
  if (panel < 0 || panel >= cols * (save.height / PANEL_SIZE)) return 0;
  let filled = 0;
  const startX = panelX * PANEL_SIZE;
  const startY = panelY * PANEL_SIZE;
  for (let y = 0; y < PANEL_SIZE; y++) {
    for (let x = 0; x < PANEL_SIZE; x++) {
      const i = (startY + y) * save.width + startX + x;
      if (save.target[i] === EMPTY ? save.placed[i] !== EMPTY : save.placed[i] === save.target[i]) {
        filled++;
      }
    }
  }
  return (filled / (PANEL_SIZE * PANEL_SIZE)) * 100;
}

function color(save: PictureSave, index: number): string {
  return save.palette[index]?.hex ?? '#667078';
}

export function createOverview(save: PictureSave): OverviewHandle {
  const root = new THREE.Group();
  root.name = 'xr-overview';
  const aspect = save.width / save.height;
  const height = Math.min(OVERVIEW_MAX_HEIGHT, OVERVIEW_WIDTH / aspect);
  const width = height * aspect;
  const backGeo = new THREE.BoxGeometry(width + 0.02, height + 0.02, 0.012);
  const backMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.7 });
  const back = new THREE.Mesh(backGeo, backMat);
  back.position.z = -0.007;
  root.add(back);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = Math.max(1, Math.round(CANVAS_SIZE / aspect));
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const faceGeo = new THREE.PlaneGeometry(width, height);
  const face = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ map: tex }));
  face.name = 'xr-overview-face';
  root.add(face);
  let hovered: number | null = null;

  const repaint = (): void => {
    if (!ctx) return;
    const panelCols = save.width / PANEL_SIZE;
    const panelRows = save.height / PANEL_SIZE;
    const cellW = canvas.width / save.width;
    const cellH = canvas.height / save.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#202329';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < save.height; y++) {
      for (let x = 0; x < save.width; x++) {
        const i = y * save.width + x;
        const placed = save.placed[i];
        ctx.fillStyle = placed === EMPTY ? color(save, save.target[i]) : color(save, placed);
        ctx.globalAlpha = placed === EMPTY ? 0.38 : 1;
        ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(2, canvas.width / 384);
    for (let panel = 0; panel < panelCols * panelRows; panel++) {
      const px = (panel % panelCols) * PANEL_SIZE * cellW;
      const py = Math.floor(panel / panelCols) * PANEL_SIZE * cellH;
      const pw = PANEL_SIZE * cellW;
      const ph = PANEL_SIZE * cellH;
      ctx.strokeStyle = hovered === panel ? '#6fd9bb' : 'rgba(255,255,255,0.45)';
      ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
      ctx.fillStyle = '#6fd9bb';
      ctx.fillRect(px + 4, py + ph - 8, (pw - 8) * (panelProgress(save, panel) / 100), 4);
    }
    tex.needsUpdate = true;
  };

  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const localOrigin = new THREE.Vector3();
  const localDir = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const pickPanel = (r: { origin: THREE.Vector3; dir: THREE.Vector3 }): number | null => {
    root.updateWorldMatrix(true, true);
    inv.copy(root.matrixWorld).invert();
    localOrigin.copy(r.origin).applyMatrix4(inv);
    localDir.copy(r.dir).transformDirection(inv);
    ray.origin.copy(localOrigin);
    ray.direction.copy(localDir);
    if (!ray.intersectPlane(plane, hit)) return null;
    if (Math.abs(hit.x) > width / 2 || Math.abs(hit.y) > height / 2) return null;
    const x = Math.min(save.width - 1, Math.floor((hit.x / width + 0.5) * save.width));
    const y = Math.min(save.height - 1, Math.floor((0.5 - hit.y / height) * save.height));
    return Math.floor(y / PANEL_SIZE) * (save.width / PANEL_SIZE) + Math.floor(x / PANEL_SIZE);
  };
  const setHover = (panel: number | null): void => {
    if (hovered === panel) return;
    hovered = panel;
    repaint();
  };
  repaint();
  return {
    root,
    pickPanel,
    setHover,
    repaint,
    dispose: () => {
      tex.dispose();
      (face.material as THREE.MeshBasicMaterial).dispose();
      faceGeo.dispose();
      backGeo.dispose();
      backMat.dispose();
    },
  };
}
