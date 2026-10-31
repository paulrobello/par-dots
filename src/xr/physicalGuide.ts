/** XR companion card for building the physical mosaic while tracking the digital plate. */

import * as THREE from 'three';

const WIDTH = 0.38;
const HEIGHT = 0.16;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 432;

export interface PhysicalGuideState {
  colorName: string;
  symbol: string;
  remaining: number;
}

export interface PhysicalGuideHandle {
  root: THREE.Group;
  /** Apply a partial status update without mutating the save or any caller-owned object. */
  update(status: Partial<PhysicalGuideState>): void;
  /** Replace the complete status shown on the card. */
  sync(status: PhysicalGuideState): void;
  show(): void;
  hide(): void;
  dispose(): void;
}

export function createPhysicalGuide(
  initial: Partial<PhysicalGuideState> = {},
): PhysicalGuideHandle {
  const root = new THREE.Group();
  root.name = 'xr-physical-guide';
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const geometry = new THREE.PlaneGeometry(WIDTH, HEIGHT);
  const face = new THREE.Mesh(geometry, material);
  face.name = 'xr-physical-guide-face';
  root.add(face);
  let state: PhysicalGuideState = {
    colorName: initial.colorName ?? 'Choose a color',
    symbol: initial.symbol ?? '—',
    remaining: initial.remaining ?? 0,
  };

  const repaint = (): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = 'rgba(32,40,45,0.96)';
    ctx.beginPath();
    ctx.roundRect(8, 8, CANVAS_WIDTH - 16, CANVAS_HEIGHT - 16, 32);
    ctx.fill();
    ctx.fillStyle = '#f2cd37';
    ctx.font = '700 34px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Build the real mosaic', 36, 52);
    ctx.fillStyle = '#f4f5f6';
    ctx.font = '600 42px system-ui, sans-serif';
    ctx.fillText(`${state.symbol}  ${state.colorName}`, 36, 126);
    ctx.fillStyle = '#6fd9bb';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.max(0, Math.round(state.remaining))} remaining`, CANVAS_WIDTH - 36, 126);
    ctx.fillStyle = 'rgba(244,245,246,0.82)';
    ctx.font = '500 29px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Place this dot on the physical build,', 36, 208);
    ctx.fillText('then tap the matching stud on the digital plate.', 36, 250);
    ctx.fillStyle = 'rgba(244,245,246,0.58)';
    ctx.font = '500 24px system-ui, sans-serif';
    ctx.fillText('The digital plate marks what you have built.', 36, 322);
    texture.needsUpdate = true;
  };

  const update = (status: Partial<PhysicalGuideState>): void => {
    state = { ...state, ...status };
    repaint();
  };
  const sync = (status: PhysicalGuideState): void => {
    state = { ...status };
    repaint();
  };
  repaint();
  return {
    root,
    update,
    sync,
    show: () => {
      root.visible = true;
    },
    hide: () => {
      root.visible = false;
    },
    dispose: () => {
      root.removeFromParent();
      texture.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
