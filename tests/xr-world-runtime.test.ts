// @vitest-environment happy-dom

import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanelSession } from '../src/game/panelSession';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../src/types';
import type { Studio } from '../src/xr/scene';
import { createLibraryWorld, createPanelWorld } from '../src/xr/world';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy({}, { get: () => () => undefined, set: () => true }) as CanvasRenderingContext2D,
  );
});
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const scene = new THREE.Scene();
  const targets = [new THREE.Group(), new THREE.Group()];
  const grips = [new THREE.Group(), new THREE.Group()];
  const studio = {
    scene,
    renderer: {
      xr: { getController: (i: number) => targets[i], getControllerGrip: (i: number) => grips[i] },
    },
  } as unknown as Studio;
  const buttons = Array.from({ length: 6 }, () => ({ pressed: false }));
  const axes = [0, 0, 0, 0];
  const source = {
    handedness: 'right',
    gamepad: { buttons, axes },
  } as unknown as XRInputSource;
  const session = { inputSources: [source] } as unknown as XRSession;
  const connect = (i: number): void => {
    (
      targets[i] as unknown as THREE.EventDispatcher<{ connected: { data: XRInputSource } }>
    ).dispatchEvent({ type: 'connected', data: source });
  };
  const aim = (position: THREE.Vector3, direction: THREE.Vector3): void => {
    targets[1].position.copy(position);
    targets[1].quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction.normalize());
    scene.updateMatrixWorld(true);
  };
  return { scene, targets, grips, studio, session, buttons, axes, connect, aim };
}

it('uses the connected controller slot for library selection and B exit', () => {
  const f = fixture();
  const onPick = vi.fn();
  const onExit = vi.fn();
  const world = createLibraryWorld(f.studio, f.session, {
    rows: () => [{ id: 'one', label: 'One' }],
    onPick,
    onExit,
  });
  f.connect(1);
  const library = f.scene.getObjectByName('xr-library')!;
  library.updateWorldMatrix(true, true);
  const local = new THREE.Vector3(0, 0.19, 0).applyMatrix4(library.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(library.matrixWorld);
  f.aim(local.clone().addScaledVector(normal, 0.2), normal.clone().negate());
  f.buttons[0].pressed = true;
  world.update(0);
  expect(onPick).toHaveBeenCalledWith('one');
  f.buttons[5].pressed = true;
  world.update(1);
  world.update(2);
  expect(onExit).toHaveBeenCalledTimes(1);
  world.dispose();
  expect(f.scene.getObjectByName('xr-library')).toBeUndefined();
});

it('selects a tray chip, updates its ring, and grabs the tool panel on contact', () => {
  const f = fixture();
  const size = PANEL_SIZE * PANEL_SIZE;
  const save = {
    schemaVersion: 2,
    id: 'x',
    createdAt: 1,
    updatedAt: 1,
    name: 'x',
    sourceImageId: 'x',
    aspect: '1:1',
    width: PANEL_SIZE,
    height: PANEL_SIZE,
    palette: [
      { hex: '#ff0000', name: 'Red' },
      { hex: '#0000ff', name: 'Blue' },
    ],
    paletteMode: 'lego',
    origin: 'photo',
    target: Uint8Array.from({ length: size }, (_, i) => i % 2),
    placed: new Uint8Array(size).fill(EMPTY),
    panelElapsedMs: [0],
  } as PictureSave;
  let selected = 0;
  const world = createPanelWorld(f.studio, f.session, {
    panel: new PanelSession(save, 0),
    palette: save.palette,
    symbols: ['A', 'B'],
    mode: 'vr',
    selected: () => selected,
    onSelect: (c) => {
      selected = c;
    },
    persist: vi.fn(),
    onExit: vi.fn(),
  });
  f.connect(1);
  const tray = f.scene.getObjectByName('xr-tray')!;
  tray.updateWorldMatrix(true, true);
  const chip = new THREE.Vector3(0.018, 0.004, 0).applyMatrix4(tray.matrixWorld);
  const normal = new THREE.Vector3(0, 1, 0).transformDirection(tray.matrixWorld);
  f.aim(chip.clone().addScaledVector(normal, 0.2), normal.clone().negate());
  f.buttons[0].pressed = true;
  world.update(0);
  expect(selected).toBe(0);
  f.buttons[0].pressed = false;
  world.update(1);
  f.buttons[0].pressed = true;
  world.update(2);
  expect(selected).toBe(1);
  const ring = tray.children.find(
    (o) => o instanceof THREE.Mesh && o.geometry instanceof THREE.RingGeometry,
  )!;
  expect(ring.position.x).toBeCloseTo(0.018);
  const tools = f.scene.getObjectByName('xr-tools')!;
  f.buttons[0].pressed = false;
  const initialX = tools.position.x;
  f.grips[1].position.copy(tools.position);
  f.scene.updateMatrixWorld(true);
  world.update(1);
  const marker = f.grips[1].children[0] as THREE.Mesh<
    THREE.SphereGeometry,
    THREE.MeshStandardMaterial
  >;
  expect(marker.material.color.getHex()).toBe(0x56dbb1);
  f.buttons[1].pressed = true;
  world.update(2);
  f.grips[1].position.x += 0.1;
  f.scene.updateMatrixWorld(true);
  world.update(18);
  expect(tools.position.x).toBeCloseTo(initialX + 0.1);
  world.dispose();
});

it('pages the library with the thumbstick and selects a row beyond the first eight', () => {
  const f = fixture();
  const onPick = vi.fn();
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `id${i}`, label: `Picture ${i}` }));
  const world = createLibraryWorld(f.studio, f.session, {
    rows: () => rows,
    onPick,
    onExit: vi.fn(),
  });
  f.connect(1);
  const library = f.scene.getObjectByName('xr-library') as THREE.Object3D;
  library.updateWorldMatrix(true, true);
  const target = new THREE.Vector3(0, 0.19, 0).applyMatrix4(library.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(library.matrixWorld);
  f.aim(target.clone().addScaledVector(normal, 0.2), normal.clone().negate());
  f.axes[2] = 1;
  world.update(0);
  world.update(1);
  f.buttons[0].pressed = true;
  world.update(2);
  expect(onPick).toHaveBeenCalledWith('id8');
  world.dispose();
});

it('starts the tool panel clear of the tray and reference frame from the default view', () => {
  const f = fixture();
  const size = PANEL_SIZE * PANEL_SIZE;
  const save = {
    schemaVersion: 2,
    id: 'x',
    createdAt: 1,
    updatedAt: 1,
    name: 'x',
    sourceImageId: 'x',
    aspect: '1:1',
    width: PANEL_SIZE,
    height: PANEL_SIZE,
    palette: [
      { hex: '#ff0000', name: 'Red' },
      { hex: '#0000ff', name: 'Blue' },
    ],
    paletteMode: 'lego',
    origin: 'photo',
    target: Uint8Array.from({ length: size }, (_, i) => i % 2),
    placed: new Uint8Array(size).fill(EMPTY),
    panelElapsedMs: [0],
  } as PictureSave;
  const world = createPanelWorld(f.studio, f.session, {
    panel: new PanelSession(save, 0),
    palette: save.palette,
    symbols: ['A', 'B'],
    mode: 'vr',
    selected: () => 0,
    onSelect: vi.fn(),
    persist: vi.fn(),
    onExit: vi.fn(),
  });
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 30);
  camera.position.set(0, 1.6, 0.2);
  camera.lookAt(0, 0.95, -0.35);
  camera.updateMatrixWorld(true);
  f.scene.updateMatrixWorld(true);
  const bounds = (name: string): { left: number; right: number; top: number; bottom: number } => {
    const box = new THREE.Box3().setFromObject(f.scene.getObjectByName(name) as THREE.Object3D);
    const projected: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z])
          projected.push(new THREE.Vector3(x, y, z).project(camera));
    return {
      left: Math.min(...projected.map((p) => p.x)),
      right: Math.max(...projected.map((p) => p.x)),
      top: Math.max(...projected.map((p) => p.y)),
      bottom: Math.min(...projected.map((p) => p.y)),
    };
  };
  const tools = bounds('xr-tools');
  for (const name of ['xr-tray', 'xr-frame']) {
    const other = bounds(name);
    expect(
      tools.right < other.left ||
        tools.left > other.right ||
        tools.top < other.bottom ||
        tools.bottom > other.top,
      name,
    ).toBe(true);
  }
  world.dispose();
});
