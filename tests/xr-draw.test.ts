// @vitest-environment happy-dom

import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';
import { createDrawWorld } from '../src/xr/draw';
import type { Studio } from '../src/xr/scene';

const save = (): PictureSave => ({
  id: 'draw-xr',
  schemaVersion: SAVE_SCHEMA_VERSION,
  name: 'XR sketch',
  createdAt: 1,
  updatedAt: 1,
  width: 4,
  height: 4,
  sourceImageId: '',
  aspect: '1:1',
  paletteMode: 'lego',
  target: new Uint8Array(16).fill(EMPTY),
  placed: new Uint8Array(16).fill(EMPTY),
  palette: [{ hex: '#ff0000', name: 'Red' }],
  panelElapsedMs: [],
  origin: 'drawn',
});
let clearCalls = 0;

beforeEach(() => {
  clearCalls = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy(
      {},
      {
        get: (_target, property) =>
          property === 'clearRect'
            ? () => {
                clearCalls++;
              }
            : () => undefined,
        set: () => true,
      },
    ) as CanvasRenderingContext2D,
  );
});

it('does not repaint while an idle frame has no visual changes', () => {
  const scene = new THREE.Scene();
  const controllers = [new THREE.Group(), new THREE.Group()];
  const studio = {
    scene,
    renderer: { xr: { getController: (i: number) => controllers[i] } },
  } as unknown as Studio;
  const world = createDrawWorld({
    studio,
    xrSession: {} as XRSession,
    save: save(),
    persist: vi.fn(),
    onExit: vi.fn(),
  });
  const first = clearCalls;
  world.update(0);
  world.update(1);
  expect(clearCalls).toBe(first);
  world.dispose();
});
afterEach(() => vi.restoreAllMocks());

it('paints through the controller ray and persists the shared save', () => {
  const scene = new THREE.Scene();
  const controllers = [new THREE.Group(), new THREE.Group()];
  const buttons = Array.from({ length: 2 }, () => ({ pressed: false }));
  const source = { gamepad: { buttons } } as unknown as XRInputSource;
  controllers[1].userData.xrSource = source;
  const otherButtons = Array.from({ length: 2 }, () => ({ pressed: false }));
  controllers[0].userData.xrSource = {
    gamepad: { buttons: otherButtons },
  } as unknown as XRInputSource;
  const studio = {
    scene,
    renderer: { xr: { getController: (i: number) => controllers[i] } },
  } as unknown as Studio;
  const current = save();
  const persist = vi.fn();
  const world = createDrawWorld({
    studio,
    xrSession: {} as XRSession,
    save: current,
    persist,
    onExit: vi.fn(),
  });
  scene.updateMatrixWorld(true);
  const board = scene.getObjectByName('xr-draw-world');
  if (!board) throw new Error('draw world missing from scene');
  const point = new THREE.Vector3(0, 0, 0.1).applyMatrix4(board.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(board.matrixWorld);
  controllers[1].position.copy(point).addScaledVector(normal, 0.2);
  controllers[1].quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), normal.negate());
  scene.updateMatrixWorld(true);
  world.update(0);
  buttons[0].pressed = true;
  world.update(1);
  otherButtons[0].pressed = true;
  controllers[0].dispatchEvent({ type: 'disconnected' } as never);
  world.update(2);
  expect(persist).not.toHaveBeenCalled();
  buttons[0].pressed = false;
  world.update(3);
  expect(current.placed.some((v) => v === 0)).toBe(true);
  expect(persist).toHaveBeenCalled();
  world.dispose();
});

it('shows a tooltip when a connected controller points at a drawing tool', () => {
  const scene = new THREE.Scene();
  const controllers = [new THREE.Group(), new THREE.Group()];
  controllers[0].userData.xrSource = { gamepad: { buttons: [{ pressed: false }] } };
  const studio = {
    scene,
    renderer: { xr: { getController: (i: number) => controllers[i] } },
  } as unknown as Studio;
  const world = createDrawWorld({
    studio,
    xrSession: {} as XRSession,
    save: save(),
    persist: vi.fn(),
    onExit: vi.fn(),
  });
  scene.updateMatrixWorld(true);
  const board = scene.getObjectByName('xr-draw-world');
  if (!board) throw new Error('draw world missing');
  const point = new THREE.Vector3(-0.34, 0.35, 0).applyMatrix4(board.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(board.matrixWorld);
  controllers[0].position.copy(point).addScaledVector(normal, 0.2);
  controllers[0].quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    normal.clone().negate(),
  );
  scene.updateMatrixWorld(true);
  world.update(0);
  const tooltip = board.getObjectByName('xr-hover-tooltip');
  expect(tooltip?.visible).toBe(true);
  controllers[0].userData.xrSource = undefined;
  world.update(1);
  expect(tooltip?.visible).toBe(false);
  world.dispose();
});
