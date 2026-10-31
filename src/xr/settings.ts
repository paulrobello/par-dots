import * as THREE from 'three';
import { syncMusic } from '../audio/music';
import { playPlaceSound } from '../audio/sfx';
import {
  getSettings,
  MUSIC_TRACKS,
  PLACE_SOUNDS,
  setSettings,
  XR_ENVIRONMENTS,
  type XrEnvironment,
} from '../storage/settings';
import { localRay } from './transforms';

const WIDTH = 0.48;
const HEIGHT = 0.36;
const CANVAS_W = 1024;
const CANVAS_H = 768;
const FIRST_ROW = 124;
const ROW_HEIGHT = 72;
const WORLD_LABELS: Record<XrEnvironment, string> = {
  studio: 'Studio',
  night: 'Night sky',
  sunset: 'Sunset',
  forest: 'Woodland',
};

/** A ray-operated settings card sharing the same preferences as the 2D settings sheet. */
export function createXrSettings(
  mode: 'vr' | 'ar',
  onEnvironment: (value: XrEnvironment) => void,
): {
  root: THREE.Group;
  show(anchor: THREE.Object3D, head: THREE.Vector3): void;
  pick(origin: THREE.Vector3, direction: THREE.Vector3): 'close' | 'change' | null;
  dispose(): void;
} {
  const root = new THREE.Group();
  root.name = 'xr-settings';
  root.visible = false;
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(WIDTH, HEIGHT);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  root.add(new THREE.Mesh(geometry, material));
  const ray = new THREE.Ray();
  const inverse = new THREE.Matrix4();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const point = new THREE.Vector3();
  const paint = (): void => {
    if (!ctx) return;
    const s = getSettings();
    const rows = [
      ['World', mode === 'ar' ? 'Passthrough' : WORLD_LABELS[s.xrEnvironment]],
      ['Sound', s.sound ? 'On' : 'Off'],
      ['Effects volume', `${s.sfxVolume}%`],
      ['Haptics', s.haptics ? 'On' : 'Off'],
      ['Music', s.music ? 'On' : 'Off'],
      ['Music volume', `${s.musicVolume}%`],
      ['Music track', s.musicTrack],
      ['Place sound', s.placeSound],
    ];
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#20282d';
    ctx.beginPath();
    ctx.roundRect(8, 8, 1008, 752, 40);
    ctx.fill();
    ctx.fillStyle = '#f2cd37';
    ctx.font = '700 62px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('VR settings', 42, 65);
    ctx.font = '500 25px system-ui, sans-serif';
    ctx.fillStyle = '#bec8cc';
    ctx.fillText('Point at the arrows and press trigger', 42, 105);
    ctx.fillStyle = '#f2cd37';
    ctx.beginPath();
    ctx.roundRect(910, 25, 76, 64, 16);
    ctx.fill();
    ctx.fillStyle = '#252117';
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('×', 948, 57);
    rows.forEach(([label, value], i) => {
      const y = FIRST_ROW + i * ROW_HEIGHT;
      const disabled = i === 0 && mode === 'ar';
      ctx.fillStyle = i % 2 ? '#273238' : '#2e3b40';
      ctx.fillRect(32, y, 960, ROW_HEIGHT - 5);
      ctx.textAlign = 'left';
      ctx.font = '600 35px system-ui, sans-serif';
      ctx.fillStyle = '#f4f5f6';
      ctx.fillText(label, 52, y + 34);
      ctx.textAlign = 'center';
      ctx.fillStyle = disabled ? '#839094' : '#f2cd37';
      ctx.font = '700 38px system-ui, sans-serif';
      if (!disabled) {
        ctx.fillText('‹', 675, y + 34);
        ctx.fillText('›', 950, y + 34);
      }
      ctx.font = '600 32px system-ui, sans-serif';
      ctx.fillStyle = disabled ? '#a4b0b2' : '#f4f5f6';
      ctx.fillText(value, 812, y + 34);
    });
    texture.needsUpdate = true;
  };
  const cycle = <T>(items: readonly T[], current: T, direction: number): T =>
    items[(items.indexOf(current) + direction + items.length) % items.length];
  const change = (row: number, direction: number): void => {
    const s = getSettings();
    if (row === 0 && mode === 'vr') {
      const xrEnvironment = cycle(XR_ENVIRONMENTS, s.xrEnvironment, direction);
      setSettings({ xrEnvironment });
      onEnvironment(xrEnvironment);
    } else if (row === 1) setSettings({ sound: !s.sound });
    else if (row === 2) setSettings({ sfxVolume: s.sfxVolume + direction * 5 });
    else if (row === 3) setSettings({ haptics: !s.haptics });
    else if (row === 4) {
      setSettings({ music: !s.music });
      syncMusic();
    } else if (row === 5) {
      setSettings({ musicVolume: s.musicVolume + direction * 5 });
      syncMusic();
    } else if (row === 6) {
      setSettings({ musicTrack: cycle(MUSIC_TRACKS, s.musicTrack, direction) });
      syncMusic();
    } else if (row === 7) {
      const placeSound = cycle(PLACE_SOUNDS, s.placeSound, direction);
      setSettings({ placeSound });
      playPlaceSound(placeSound);
    }
    paint();
  };
  const show = (anchor: THREE.Object3D, head: THREE.Vector3): void => {
    anchor.getWorldPosition(root.position);
    const towardHead = new THREE.Vector3().subVectors(head, root.position).normalize();
    root.position.addScaledVector(towardHead, 0.18);
    root.position.y += 0.14;
    root.lookAt(head);
    paint();
    root.visible = true;
  };
  const pick = (origin: THREE.Vector3, direction: THREE.Vector3): 'close' | 'change' | null => {
    if (!root.visible) return null;
    localRay(root, origin, direction, ray, inverse);
    if (!ray.intersectPlane(plane, point)) return null;
    const x = (point.x / WIDTH + 0.5) * CANVAS_W;
    const y = (0.5 - point.y / HEIGHT) * CANVAS_H;
    if (x >= 910 && x <= 986 && y >= 25 && y <= 89) {
      root.visible = false;
      return 'close';
    }
    const row = Math.floor((y - FIRST_ROW) / ROW_HEIGHT);
    if (
      row < 0 ||
      row >= 8 ||
      y - FIRST_ROW - row * ROW_HEIGHT >= ROW_HEIGHT - 5 ||
      x < 625 ||
      x > 992
    )
      return null;
    if (row === 0 && mode === 'ar') return null;
    change(row, x < 812 ? -1 : 1);
    return 'change';
  };
  const dispose = (): void => {
    root.removeFromParent();
    texture.dispose();
    material.dispose();
    geometry.dispose();
  };
  return { root, show, pick, dispose };
}
