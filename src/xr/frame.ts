/**
 * XR reference frame (XR P2a): a floating frame with a 512x512 CanvasTexture face rendered
 * from panel state — target colors plus the same A/B/C symbols as the building sheets, with
 * the 2D Overlay feature behind a toggle. Draw-list generation is pure and unit-tested; the
 * canvas painter maps its entries 1:1. Grip moves the frame at a fixed grab offset, and the
 * thumbstick scales it while gripped (clamped 0.4x-3x). 1 unit = 1 m.
 */

import * as THREE from 'three';
import { EMPTY, PANEL_SIZE } from '../types';

/** Frame face texture resolution in px. */
export const FRAME_FACE_PX = 512;
/** Frame face physical width/height in meters at scale 1. */
export const FRAME_SIZE = 0.24;
export const FRAME_SCALE_MIN = 0.4;
export const FRAME_SCALE_MAX = 3;

export interface FrameCell {
  x: number;
  y: number;
  /** Fill color of the stud square; null draws nothing. */
  hex: string | null;
  /** Overlay/progress symbol, same alphabet as the building sheets. */
  symbol: string | null;
  /** 1 for placed dots, faint for overlay empties. */
  alpha: number;
}

/**
 * The face's visible studs for one panel state: placed dots at full alpha with their symbol;
 * empty studs only when the overlay is on, faint, with their target symbol.
 */
export function frameDrawList(
  source: { cellAt(x: number, y: number): { target: number; placed: number } },
  palette: ReadonlyArray<{ hex: string }>,
  symbols: readonly string[],
  overlay: boolean,
): FrameCell[] {
  const out: FrameCell[] = [];
  for (let y = 0; y < PANEL_SIZE; y++) {
    for (let x = 0; x < PANEL_SIZE; x++) {
      const { target, placed } = source.cellAt(x, y);
      const symbol = symbols[target] ?? null;
      if (placed !== EMPTY) {
        out.push({ x, y, hex: palette[placed]?.hex ?? null, symbol, alpha: 1 });
      } else if (overlay) {
        out.push({ x, y, hex: palette[target]?.hex ?? null, symbol, alpha: 0.45 });
      }
    }
  }
  return out;
}

export const clampFrameScale = (s: number): number =>
  Math.min(FRAME_SCALE_MAX, Math.max(FRAME_SCALE_MIN, s));

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Fixed-grab-offset positioning: the frame keeps its grab-time offset from the grip. */
export const grabbedPosition = (grip: Vec3, offset: Vec3): Vec3 => ({
  x: grip.x + offset.x,
  y: grip.y + offset.y,
  z: grip.z + offset.z,
});

/** Local luminance (0..1); duplicated from render/color.ts because xr/ never imports render/. */
const luminance = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

/** What the frame needs from the panel rules; structural so tests can pass a PanelSession. */
export interface FrameSource {
  cellAt(x: number, y: number): { target: number; placed: number };
}

export interface FrameHandle {
  root: THREE.Group;
  /** The face plane, for world-space ray picking (grip grab). */
  face: THREE.Mesh;
  /** Repaint the face texture from the current panel state. */
  sync(): void;
  toggleOverlay(): void;
  setOverlay(on: boolean): void;
  isOverlayOn(): boolean;
  setScale(s: number): void;
  getScale(): number;
  dispose(): void;
}

const BORDER = 0.018;

export function createFrame(
  source: FrameSource,
  palette: ReadonlyArray<{ hex: string }>,
  symbols: readonly string[],
): FrameHandle {
  const root = new THREE.Group();
  root.name = 'xr-frame';

  const canvas = document.createElement('canvas');
  canvas.width = FRAME_FACE_PX;
  canvas.height = FRAME_FACE_PX;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const backGeo = new THREE.BoxGeometry(FRAME_SIZE + BORDER, FRAME_SIZE + BORDER, 0.012);
  const backMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.7 });
  const back = new THREE.Mesh(backGeo, backMat);
  back.position.z = -0.007;
  root.add(back);

  const faceGeo = new THREE.PlaneGeometry(FRAME_SIZE, FRAME_SIZE);
  const faceMat = new THREE.MeshBasicMaterial({ map: texture });
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.name = 'xr-frame-face';
  root.add(face);

  let overlay = true;
  let scale = 1;

  const paint = (): void => {
    if (!ctx) return;
    const list = frameDrawList(source, palette, symbols, overlay);
    ctx.clearRect(0, 0, FRAME_FACE_PX, FRAME_FACE_PX);
    ctx.fillStyle = '#202329';
    ctx.fillRect(0, 0, FRAME_FACE_PX, FRAME_FACE_PX);
    const cellPx = FRAME_FACE_PX / PANEL_SIZE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.floor(cellPx * 0.62)}px system-ui, sans-serif`;
    for (const e of list) {
      const px = (e.x * FRAME_FACE_PX) / PANEL_SIZE;
      const py = (e.y * FRAME_FACE_PX) / PANEL_SIZE;
      if (e.hex) {
        ctx.globalAlpha = e.alpha;
        ctx.fillStyle = e.hex;
        ctx.fillRect(px, py, cellPx, cellPx);
      }
      if (e.symbol) {
        ctx.globalAlpha = Math.min(1, e.alpha + 0.25);
        ctx.fillStyle = e.hex && luminance(e.hex) > 0.45 ? '#1b1b1b' : '#ffffff';
        ctx.fillText(e.symbol, px + cellPx / 2, py + cellPx / 2);
      }
    }
    ctx.globalAlpha = 1;
    texture.needsUpdate = true;
  };

  const sync = (): void => {
    paint();
  };

  const toggleOverlay = (): void => {
    overlay = !overlay;
    paint();
  };

  const setOverlay = (on: boolean): void => {
    overlay = on;
    paint();
  };

  const setScale = (s: number): void => {
    scale = clampFrameScale(s);
    root.scale.setScalar(scale);
  };

  const dispose = (): void => {
    texture.dispose();
    faceGeo.dispose();
    faceMat.dispose();
    backGeo.dispose();
    backMat.dispose();
  };

  sync();
  return {
    root,
    face,
    sync,
    toggleOverlay,
    setOverlay,
    isOverlayOn: () => overlay,
    setScale,
    getScale: () => scale,
    dispose,
  };
}
