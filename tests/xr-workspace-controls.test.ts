// @vitest-environment happy-dom

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelSession } from '../src/game/panelSession';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../src/types';
import { getCustomLayouts } from '../src/xr/layout';
import type { Studio } from '../src/xr/scene';
import { TOOL_ORDER } from '../src/xr/tools';
import { createLibraryWorld, createPanelWorld } from '../src/xr/world';

interface Fixture {
  scene: THREE.Scene;
  targets: THREE.Group[];
  grips: THREE.Group[];
  sources: XRInputSource[];
  buttons: Array<Array<{ pressed: boolean }>>;
  connect(index: number): void;
  aim(index: number, position: THREE.Vector3, direction: THREE.Vector3): void;
  studio: Studio;
  session: XRSession;
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy({}, { get: () => () => undefined, set: () => true }) as CanvasRenderingContext2D,
  );
});

afterEach(() => vi.restoreAllMocks());

function fixture(): Fixture {
  const scene = new THREE.Scene();
  const targets = [new THREE.Group(), new THREE.Group()];
  const grips = [new THREE.Group(), new THREE.Group()];
  const buttons = [
    Array.from({ length: 6 }, () => ({ pressed: false })),
    Array.from({ length: 6 }, () => ({ pressed: false })),
  ];
  const sources = [
    { handedness: 'left', gamepad: { buttons: buttons[0], axes: [0, 0, 0, 0] } },
    { handedness: 'right', gamepad: { buttons: buttons[1], axes: [0, 0, 0, 0] } },
  ] as unknown as XRInputSource[];
  const studio = {
    scene,
    renderer: {
      xr: {
        getController: (i: number) => targets[i],
        getControllerGrip: (i: number) => grips[i],
        getCamera: () => ({ matrixWorld: new THREE.Matrix4().makeTranslation(0, 1.6, 0.2) }),
      },
    },
  } as unknown as Studio;
  const session = { inputSources: sources } as unknown as XRSession;
  const connect = (index: number): void => {
    (
      targets[index] as unknown as THREE.EventDispatcher<{
        connected: { data: XRInputSource };
      }>
    ).dispatchEvent({ type: 'connected', data: sources[index] });
  };
  const aim = (index: number, position: THREE.Vector3, direction: THREE.Vector3): void => {
    targets[index].position.copy(position);
    targets[index].quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      direction.clone().normalize(),
    );
    scene.updateMatrixWorld(true);
  };
  return { scene, targets, grips, sources, buttons, connect, aim, studio, session };
}

function save(): PictureSave {
  const size = PANEL_SIZE * PANEL_SIZE;
  return {
    schemaVersion: 2,
    id: 'workspace-controls',
    createdAt: 1,
    updatedAt: 1,
    name: 'Workspace controls',
    sourceImageId: 'image',
    aspect: '1:1',
    width: PANEL_SIZE,
    height: PANEL_SIZE,
    palette: [{ hex: '#f00', name: 'Red' }],
    paletteMode: 'lego',
    origin: 'photo',
    target: new Uint8Array(size),
    placed: new Uint8Array(size).fill(EMPTY),
    panelElapsedMs: [0],
  };
}

function panel(f: Fixture, options: Partial<Parameters<typeof createPanelWorld>[2]> = {}) {
  return createPanelWorld(f.studio, f.session, {
    panel: new PanelSession(save(), 0),
    palette: [{ hex: '#f00', name: 'Red' }],
    symbols: ['A'],
    mode: 'vr',
    selected: () => 0,
    onSelect: vi.fn(),
    persist: vi.fn(),
    onExit: vi.fn(),
    ...options,
  });
}

function pointAtTool(f: Fixture, toolId: (typeof TOOL_ORDER)[number]): void {
  const tools = requiredObject(f, 'xr-tools');
  tools.updateWorldMatrix(true, true);
  const x = (TOOL_ORDER.indexOf(toolId) - (TOOL_ORDER.length - 1) / 2) * 0.062;
  const point = new THREE.Vector3(x, 0, 0).applyMatrix4(tools.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(tools.matrixWorld);
  f.aim(1, point.clone().addScaledVector(normal, 0.15), normal.negate());
}

function requiredObject(f: Fixture, name: string): THREE.Object3D {
  const object = f.scene.getObjectByName(name);
  if (!object) throw new Error(`Missing XR object: ${name}`);
  return object;
}

describe('XR workspace controls', () => {
  it('moves two different objects independently with simultaneous left and right grips', () => {
    const f = fixture();
    const world = panel(f);
    f.connect(0);
    f.connect(1);
    const frame = requiredObject(f, 'xr-frame');
    const tools = requiredObject(f, 'xr-tools');
    f.grips[0].position.copy(frame.position);
    f.grips[1].position.copy(tools.position);
    f.scene.updateMatrixWorld(true);
    world.update(0);
    f.buttons[0][1].pressed = true;
    f.buttons[1][1].pressed = true;
    world.update(16);
    const frameX = frame.position.x;
    const toolsX = tools.position.x;
    f.grips[0].position.x += 0.12;
    f.grips[1].position.x -= 0.08;
    f.scene.updateMatrixWorld(true);
    world.update(32);
    expect(frame.position.x).toBeCloseTo(frameX + 0.12);
    expect(tools.position.x).toBeCloseTo(toolsX - 0.08);
    world.dispose();
  });

  it('allows the left hand to grab and move the frame without changing right-hand input', () => {
    const f = fixture();
    const world = panel(f);
    f.connect(0);
    f.connect(1);
    const frame = requiredObject(f, 'xr-frame');
    f.grips[0].position.copy(frame.position);
    f.scene.updateMatrixWorld(true);
    world.update(0);
    f.buttons[0][1].pressed = true;
    world.update(16);
    const start = frame.position.clone();
    f.grips[0].position.y += 0.1;
    f.scene.updateMatrixWorld(true);
    world.update(32);
    expect(frame.position.y).toBeCloseTo(start.y + 0.1);
    expect(f.buttons[1][0].pressed).toBe(false);
    world.dispose();
  });

  it('grabs the gallery with either hand and preserves its initial facing orientation', () => {
    const f = fixture();
    const world = createLibraryWorld(f.studio, f.session, {
      rows: () => [{ id: 'one', label: 'One' }],
      onPick: vi.fn(),
      onExit: vi.fn(),
    });
    f.connect(0);
    const library = requiredObject(f, 'xr-library');
    expect(library.rotation.y).toBeCloseTo(0);
    f.grips[0].position.copy(library.position);
    f.scene.updateMatrixWorld(true);
    world.update(0);
    f.buttons[0][1].pressed = true;
    world.update(16);
    f.grips[0].position.x += 0.1;
    f.scene.updateMatrixWorld(true);
    world.update(32);
    expect(library.position.x).toBeCloseTo(0.1);
    expect(library.rotation.y).toBeCloseTo(0);
    world.dispose();
  });

  it('opens the picture overview while placing, then permits overview grab movement', () => {
    const f = fixture();
    const state = { layout: undefined, visible: false } as const;
    const onPanelSelect = vi.fn();
    const world = panel(f, {
      save: save(),
      onPanelSelect,
      overviewState: state as unknown as { layout: undefined; visible: boolean },
    });
    f.connect(1);
    pointAtTool(f, 'picture');
    world.update(0);
    f.buttons[1][0].pressed = true;
    world.update(16);
    const overview = requiredObject(f, 'xr-overview');
    expect(overview.visible).toBe(true);
    const start = overview.position.clone();
    f.buttons[1][0].pressed = false;
    f.grips[1].position.copy(overview.position);
    f.scene.updateMatrixWorld(true);
    world.update(32);
    f.buttons[1][1].pressed = true;
    world.update(48);
    f.grips[1].position.x += 0.1;
    f.scene.updateMatrixWorld(true);
    world.update(64);
    expect(overview.position.x).toBeCloseTo(start.x + 0.1);
    world.dispose();
  });

  it('places a dot while the picture overview remains open', () => {
    const f = fixture();
    const panelSave = save();
    const session = new PanelSession(panelSave, 0);
    const world = createPanelWorld(f.studio, f.session, {
      panel: session,
      palette: panelSave.palette,
      symbols: ['A'],
      mode: 'vr',
      selected: () => 0,
      onSelect: vi.fn(),
      persist: vi.fn(),
      onExit: vi.fn(),
      save: panelSave,
      onPanelSelect: vi.fn(),
      overviewState: { layout: undefined, visible: false },
    });
    f.connect(1);
    pointAtTool(f, 'picture');
    world.update(0);
    f.buttons[1][0].pressed = true;
    world.update(16);
    expect(f.scene.getObjectByName('xr-overview')?.visible).toBe(true);
    f.buttons[1][0].pressed = false;
    world.update(32);

    const plate = requiredObject(f, 'xr-plate');
    plate.updateWorldMatrix(true, true);
    const cell = new THREE.Vector3(-0.06, 0.002, -0.06).applyMatrix4(plate.matrixWorld);
    const normal = new THREE.Vector3(0, 1, 0).transformDirection(plate.matrixWorld);
    const overview = requiredObject(f, 'xr-overview');
    overview.position.copy(cell).addScaledVector(normal, -0.05);
    overview.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    overview.updateWorldMatrix(true, true);
    f.aim(1, cell.clone().addScaledVector(normal, 0.15), normal.negate());
    world.update(48);
    f.buttons[1][0].pressed = true;
    world.update(64);
    expect(panelSave.placed[0]).toBe(0);
    expect(f.scene.getObjectByName('xr-overview')?.visible).toBe(true);
    world.dispose();
  });

  it('restores shared overview state when a replacement panel world is constructed', () => {
    const f = fixture();
    const panelSave = save();
    const overviewState: {
      layout:
        | {
            pos: { x: number; y: number; z: number };
            quat: { x: number; y: number; z: number; w: number };
            scale?: number;
          }
        | undefined;
      visible: boolean;
    } = { layout: undefined, visible: false };
    const makeWorld = () =>
      createPanelWorld(f.studio, f.session, {
        panel: new PanelSession(panelSave, 0),
        palette: panelSave.palette,
        symbols: ['A'],
        mode: 'vr',
        selected: () => 0,
        onSelect: vi.fn(),
        persist: vi.fn(),
        onExit: vi.fn(),
        save: panelSave,
        onPanelSelect: vi.fn(),
        overviewState,
      });

    const first = makeWorld();
    f.connect(1);
    pointAtTool(f, 'picture');
    first.update(0);
    f.buttons[1][0].pressed = true;
    first.update(16);
    const overview = requiredObject(f, 'xr-overview');
    f.buttons[1][0].pressed = false;
    first.update(32);
    f.grips[1].position.copy(overview.position);
    f.scene.updateMatrixWorld(true);
    first.update(48);
    f.buttons[1][1].pressed = true;
    first.update(64);
    f.grips[1].position.x += 0.11;
    f.scene.updateMatrixWorld(true);
    first.update(80);
    const snapshot = (first.layout() as { overview?: typeof overviewState.layout }).overview;
    expect(snapshot).toBeDefined();
    overviewState.layout = snapshot;
    overviewState.visible = true;
    first.dispose();

    const replacement = makeWorld();
    const restored = requiredObject(f, 'xr-overview');
    expect(restored.visible).toBe(true);
    if (!snapshot) throw new Error('Missing overview snapshot');
    expect(restored.position.x).toBeCloseTo(snapshot.pos.x);
    expect(restored.position.y).toBeCloseTo(snapshot.pos.y);
    expect(restored.position.z).toBeCloseTo(snapshot.pos.z);
    replacement.dispose();
  });

  it('saves a custom layout through the Save tool and restores it through Layout cycling', () => {
    const f = fixture();
    const world = panel(f);
    f.connect(1);
    const tools = requiredObject(f, 'xr-tools');
    tools.position.x += 0.08;
    tools.updateWorldMatrix(true, true);
    pointAtTool(f, 'save-layout');
    world.update(0);
    f.buttons[1][0].pressed = true;
    world.update(16);
    expect(getCustomLayouts().Custom?.tools?.pos.x).toBeCloseTo(tools.position.x);
    f.buttons[1][0].pressed = false;
    world.update(32);
    for (const [idle, down, up] of [
      [48, 64, 80],
      [96, 112, 128],
      [144, 160, 176],
    ]) {
      pointAtTool(f, 'workspace');
      world.update(idle);
      f.buttons[1][0].pressed = true;
      world.update(down);
      f.buttons[1][0].pressed = false;
      world.update(up);
    }
    expect(tools.position.x).toBeCloseTo(0.08);
    world.dispose();
  });
});
