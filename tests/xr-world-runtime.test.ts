// @vitest-environment happy-dom

import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanelSession } from '../src/game/panelSession';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../src/types';
import { configureUpdateHandler, markUpdateAvailable } from '../src/updateState';
import type { Studio } from '../src/xr/scene';
import { TOOL_ORDER } from '../src/xr/tools';
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
      xr: {
        getController: (i: number) => targets[i],
        getControllerGrip: (i: number) => grips[i],
      },
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
  return { scene, targets, grips, studio, session, buttons, axes, source, connect, aim };
}

function mrSave(): PictureSave {
  const size = PANEL_SIZE * PANEL_SIZE;
  return {
    schemaVersion: 2,
    id: 'mr',
    createdAt: 1,
    updatedAt: 1,
    name: 'MR',
    sourceImageId: 'image',
    aspect: '1:1',
    width: PANEL_SIZE,
    height: PANEL_SIZE,
    palette: [{ hex: '#ff0000', name: 'Red' }],
    paletteMode: 'lego',
    origin: 'photo',
    target: new Uint8Array(size),
    placed: new Uint8Array(size).fill(EMPTY),
    panelElapsedMs: [0],
  } as PictureSave;
}

function mrWorld() {
  const f = fixture();
  (
    f.studio.renderer.xr as unknown as { getCamera: () => { matrixWorld: THREE.Matrix4 } }
  ).getCamera = () => ({ matrixWorld: new THREE.Matrix4().makeTranslation(0, 1.6, 0.2) });
  const targetRaySpace = {} as XRSpace;
  const hitTestSource = { cancel: vi.fn() } as unknown as XRHitTestSource;
  const requestHitTestSource = vi.fn(() => Promise.resolve(hitTestSource));
  const floorSpace = {} as XRReferenceSpace;
  const session = {
    inputSources: [f.source],
    requestReferenceSpace: vi.fn(() => Promise.resolve(floorSpace)),
    requestHitTestSource,
  } as unknown as XRSession;
  Object.assign(f.source, { targetRaySpace });
  const world = createPanelWorld(f.studio, session, {
    panel: new PanelSession(mrSave(), 0),
    palette: [{ hex: '#ff0000' }],
    symbols: ['A'],
    mode: 'ar',
    selected: () => 0,
    onSelect: vi.fn(),
    persist: vi.fn(),
    onExit: vi.fn(),
  });
  f.connect(1);
  return { f, floorSpace, targetRaySpace, hitTestSource, requestHitTestSource, world };
}

it('requests MR hit testing from the connected controller target ray', async () => {
  const mr = mrWorld();
  mr.world.update(0);
  await Promise.resolve();
  expect(mr.requestHitTestSource).toHaveBeenCalledWith({ space: mr.targetRaySpace });
  mr.world.dispose();
});

it('does not place the MR workspace when the controller ray has no surface hit', async () => {
  const mr = mrWorld();
  mr.world.update(0);
  await Promise.resolve();
  mr.world.update(16, { getHitTestResults: () => [] } as unknown as XRFrame);
  mr.f.buttons[0].pressed = true;
  mr.world.update(32, { getHitTestResults: () => [] } as unknown as XRFrame);
  expect(mr.f.scene.getObjectByName('xr-plate')?.visible).toBe(false);
  expect(mr.f.scene.getObjectByName('xr-mr-reticle')?.visible ?? false).toBe(false);
  mr.world.dispose();
});

it('cancels a stale MR hit-test source when the controller changes or disconnects', async () => {
  const mr = mrWorld();
  mr.world.update(0);
  await Promise.resolve();
  await Promise.resolve();
  expect(mr.hitTestSource.cancel).not.toHaveBeenCalled();
  const replacement = {
    handedness: 'right',
    targetRaySpace: {} as XRSpace,
    gamepad: mr.f.source.gamepad,
  } as unknown as XRInputSource;
  (
    mr.f.targets[1] as unknown as THREE.EventDispatcher<{ connected: { data: XRInputSource } }>
  ).dispatchEvent({ type: 'connected', data: replacement });
  mr.world.update(16);
  expect(mr.hitTestSource.cancel).toHaveBeenCalledTimes(1);
  (mr.f.targets[1] as unknown as THREE.EventDispatcher<never>).dispatchEvent({
    type: 'disconnected',
  } as unknown as never);
  mr.world.update(32);
  expect(mr.hitTestSource.cancel).toHaveBeenCalledTimes(1);
  mr.world.dispose();
});

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
  world.update(0);
  f.buttons[0].pressed = true;
  world.update(1);
  expect(onPick).toHaveBeenCalledWith('one');
  f.buttons[5].pressed = true;
  world.update(1);
  world.update(2);
  expect(onExit).toHaveBeenCalledTimes(1);
  world.dispose();
  expect(f.scene.getObjectByName('xr-library')).toBeUndefined();
});

it('opens and closes settings from the VR library without selecting a picture', () => {
  const f = fixture();
  const onPick = vi.fn();
  const world = createLibraryWorld(f.studio, f.session, {
    rows: () => [{ id: 'one', label: 'One' }],
    onPick,
    onExit: vi.fn(),
  });
  f.connect(1);
  const library = f.scene.getObjectByName('xr-library') as THREE.Object3D;
  library.updateWorldMatrix(true, true);
  const button = new THREE.Vector3(
    (539 / 640 - 0.5) * 0.46,
    (0.5 - 51 / 840) * 0.6,
    0,
  ).applyMatrix4(library.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(library.matrixWorld);
  f.aim(button.clone().addScaledVector(normal, 0.2), normal.clone().negate());
  world.update(0);
  f.buttons[0].pressed = true;
  world.update(1);
  const settings = f.scene.getObjectByName('xr-settings') as THREE.Object3D;
  expect(settings.visible).toBe(true);
  expect(onPick).not.toHaveBeenCalled();
  settings.updateWorldMatrix(true, true);
  const close = new THREE.Vector3(
    (948 / 1024 - 0.5) * 0.48,
    (0.5 - 57 / 912) * 0.43,
    0,
  ).applyMatrix4(settings.matrixWorld);
  const settingsNormal = new THREE.Vector3(0, 0, 1).transformDirection(settings.matrixWorld);
  f.aim(close.clone().addScaledVector(settingsNormal, 0.2), settingsNormal.negate());
  f.buttons[0].pressed = false;
  world.update(2);
  f.buttons[0].pressed = true;
  world.update(3);
  expect(settings.visible).toBe(false);
  expect(onPick).not.toHaveBeenCalled();
  world.dispose();
});

it('accepts a left-controller library trigger after it is released', () => {
  const f = fixture();
  Object.defineProperty(f.source, 'handedness', { value: 'left' });
  const onPick = vi.fn();
  const world = createLibraryWorld(f.studio, f.session, {
    rows: () => [{ id: 'one', label: 'One' }],
    onPick,
    onExit: vi.fn(),
  });
  f.connect(1);
  const library = f.scene.getObjectByName('xr-library') as THREE.Object3D;
  library.updateWorldMatrix(true, true);
  const point = new THREE.Vector3(0, 0.19, 0).applyMatrix4(library.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(library.matrixWorld);
  f.aim(point.clone().addScaledVector(normal, 0.2), normal.negate());
  f.buttons[0].pressed = true;
  world.update(0);
  expect(onPick).not.toHaveBeenCalled();
  f.buttons[0].pressed = false;
  world.update(1);
  f.buttons[0].pressed = true;
  world.update(2);
  expect(onPick).toHaveBeenCalledWith('one');
  world.dispose();
});

it('picks at most one library row when both controllers trigger in the same frame', () => {
  const f = fixture();
  const onPick = vi.fn();
  const world = createLibraryWorld(f.studio, f.session, {
    rows: () => [{ id: 'one', label: 'One' }],
    onPick,
    onExit: vi.fn(),
  });
  f.connect(1);
  const leftButtons = Array.from({ length: 6 }, () => ({ pressed: false }));
  const left = {
    handedness: 'left',
    gamepad: { buttons: leftButtons, axes: [] },
  } as unknown as XRInputSource;
  (
    f.targets[0] as unknown as THREE.EventDispatcher<{ connected: { data: XRInputSource } }>
  ).dispatchEvent({ type: 'connected', data: left });
  const library = f.scene.getObjectByName('xr-library') as THREE.Object3D;
  library.updateWorldMatrix(true, true);
  const point = new THREE.Vector3(0, 0.19, 0).applyMatrix4(library.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(library.matrixWorld);
  f.aim(point.clone().addScaledVector(normal, 0.2), normal.negate());
  f.targets[0].position.copy(f.targets[1].position);
  f.targets[0].quaternion.copy(f.targets[1].quaternion);
  f.scene.updateMatrixWorld(true);
  world.update(0);
  leftButtons[0].pressed = true;
  f.buttons[0].pressed = true;
  world.update(1);
  world.update(2);
  expect(onPick).toHaveBeenCalledOnce();
  world.dispose();
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
  const reference = f.scene.getObjectByName('xr-frame') as THREE.Object3D;
  reference.updateWorldMatrix(true, true);
  const referenceCell = new THREE.Vector3(-0.1125, 0.1125, 0).applyMatrix4(reference.matrixWorld);
  const referenceNormal = new THREE.Vector3(0, 0, 1).transformDirection(reference.matrixWorld);
  f.aim(
    referenceCell.clone().addScaledVector(referenceNormal, 0.15),
    referenceNormal.clone().negate(),
  );
  f.buttons[0].pressed = false;
  world.update(3);
  f.buttons[0].pressed = true;
  world.update(4);
  expect(selected).toBe(0);
  reference.rotation.y += 0.4;
  reference.scale.setScalar(1.4);
  reference.updateWorldMatrix(true, true);
  const secondCell = new THREE.Vector3(-0.0975, 0.1125, 0).applyMatrix4(reference.matrixWorld);
  const movedNormal = new THREE.Vector3(0, 0, 1).transformDirection(reference.matrixWorld);
  f.aim(secondCell.clone().addScaledVector(movedNormal, 0.15), movedNormal.clone().negate());
  f.buttons[0].pressed = false;
  world.update(4.5);
  f.buttons[0].pressed = true;
  world.update(4.75);
  expect(selected).toBe(1);
  const tools = f.scene.getObjectByName('xr-tools')!;
  tools.updateWorldMatrix(true, true);
  const ghostX = (TOOL_ORDER.indexOf('ghost') - (TOOL_ORDER.length - 1) / 2) * 0.062;
  const ghostButton = new THREE.Vector3(ghostX, 0, 0).applyMatrix4(tools.matrixWorld);
  const toolsNormal = new THREE.Vector3(0, 0, 1).transformDirection(tools.matrixWorld);
  f.aim(ghostButton.clone().addScaledVector(toolsNormal, 0.15), toolsNormal.clone().negate());
  f.buttons[0].pressed = false;
  world.update(5);
  f.buttons[0].pressed = true;
  world.update(6);
  const studs = f.scene.getObjectByName('xr-plate-studs') as THREE.InstancedMesh;
  const ghostColor = new THREE.Color();
  studs.getColorAt(1, ghostColor);
  expect(ghostColor.getHexString()).toBe(
    new THREE.Color('#0000ff').lerp(new THREE.Color(0x9a968a), 0.5).getHexString(),
  );
  const helpX = (TOOL_ORDER.indexOf('help') - (TOOL_ORDER.length - 1) / 2) * 0.062;
  const helpButton = new THREE.Vector3(helpX, 0, 0).applyMatrix4(tools.matrixWorld);
  f.aim(helpButton.clone().addScaledVector(toolsNormal, 0.15), toolsNormal.clone().negate());
  f.buttons[0].pressed = false;
  world.update(7);
  f.buttons[0].pressed = true;
  world.update(8);
  const help = f.scene.getObjectByName('xr-help') as THREE.Object3D;
  expect(help.visible).toBe(true);
  help.updateWorldMatrix(true, true);
  const close = new THREE.Vector3(0.13, 0.1, 0).applyMatrix4(help.matrixWorld);
  const helpNormal = new THREE.Vector3(0, 0, 1).transformDirection(help.matrixWorld);
  f.aim(close.clone().addScaledVector(helpNormal, 0.15), helpNormal.negate());
  f.buttons[0].pressed = false;
  world.update(9);
  f.buttons[0].pressed = true;
  world.update(10);
  expect(help.visible).toBe(false);
  expect(selected).toBe(1);
  tools.updateWorldMatrix(true, true);
  const settingsX = (TOOL_ORDER.indexOf('settings') - (TOOL_ORDER.length - 1) / 2) * 0.062;
  const settingsButton = new THREE.Vector3(settingsX, 0, 0).applyMatrix4(tools.matrixWorld);
  f.aim(settingsButton.clone().addScaledVector(toolsNormal, 0.15), toolsNormal.clone().negate());
  f.buttons[0].pressed = false;
  world.update(11);
  f.buttons[0].pressed = true;
  world.update(12);
  const settings = f.scene.getObjectByName('xr-settings') as THREE.Object3D;
  expect(settings.visible).toBe(true);
  settings.updateWorldMatrix(true, true);
  const closeSettings = new THREE.Vector3(
    (948 / 1024 - 0.5) * 0.48,
    (0.5 - 57 / 912) * 0.43,
    0,
  ).applyMatrix4(settings.matrixWorld);
  const settingsNormal = new THREE.Vector3(0, 0, 1).transformDirection(settings.matrixWorld);
  f.aim(closeSettings.clone().addScaledVector(settingsNormal, 0.15), settingsNormal.negate());
  f.buttons[0].pressed = false;
  world.update(13);
  f.buttons[0].pressed = true;
  world.update(14);
  expect(settings.visible).toBe(false);
  expect(selected).toBe(1);
  f.buttons[0].pressed = false;
  const initialX = tools.position.x;
  const initialScale = tools.scale.x;
  f.grips[1].position.copy(tools.position);
  f.scene.updateMatrixWorld(true);
  world.update(15);
  const marker = f.grips[1].children[0] as THREE.Mesh<
    THREE.SphereGeometry,
    THREE.MeshStandardMaterial
  >;
  expect(marker.material.color.getHex()).toBe(0x56dbb1);
  f.buttons[1].pressed = true;
  world.update(16);
  f.grips[1].position.x += 0.1;
  f.scene.updateMatrixWorld(true);
  world.update(28);
  expect(tools.position.x).toBeCloseTo(initialX + 0.1);
  const initialZ = tools.position.z;
  f.axes[3] = -1;
  world.update(74);
  expect(tools.position.z).toBeLessThan(initialZ);
  expect(tools.scale.x).toBe(initialScale);
  const movedZ = tools.position.z;
  reference.updateWorldMatrix(true, true);
  const firstCell = new THREE.Vector3(-0.1125, 0.1125, 0).applyMatrix4(reference.matrixWorld);
  const firstNormal = new THREE.Vector3(0, 0, 1).transformDirection(reference.matrixWorld);
  f.aim(firstCell.clone().addScaledVector(firstNormal, 0.15), firstNormal.clone().negate());
  f.buttons[0].pressed = true;
  world.update(124);
  expect(tools.scale.x).toBeGreaterThan(initialScale);
  expect(tools.position.z).toBeCloseTo(movedZ);
  expect(selected).toBe(1);
  f.buttons[1].pressed = false;
  world.update(174);
  expect(selected).toBe(1);
  f.buttons[0].pressed = false;
  world.update(224);
  f.buttons[0].pressed = true;
  world.update(274);
  expect(selected).toBe(0);
  (f.targets[1] as unknown as THREE.EventDispatcher<{ disconnected: object }>).dispatchEvent({
    type: 'disconnected',
  });
  world.update(300);
  f.connect(1);
  f.aim(secondCell.clone().addScaledVector(movedNormal, 0.15), movedNormal.clone().negate());
  world.update(350);
  expect(selected).toBe(0);
  f.buttons[0].pressed = false;
  world.update(400);
  f.buttons[0].pressed = true;
  world.update(450);
  expect(selected).toBe(1);
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

it('advances finished colors and waits for the completion button before continuing', () => {
  const f = fixture();
  const size = PANEL_SIZE * PANEL_SIZE;
  const target = new Uint8Array(size).fill(1);
  target[0] = 0;
  const placed = new Uint8Array(size).fill(1);
  placed[0] = EMPTY;
  placed[1] = EMPTY;
  const save = {
    schemaVersion: 2,
    id: 'complete',
    createdAt: 1,
    updatedAt: 1,
    name: 'Complete',
    sourceImageId: 'image',
    aspect: '1:1',
    width: PANEL_SIZE,
    height: PANEL_SIZE,
    palette: [
      { hex: '#ff0000', name: 'Red' },
      { hex: '#0000ff', name: 'Blue' },
    ],
    paletteMode: 'lego',
    origin: 'photo',
    target,
    placed,
    panelElapsedMs: [0],
  } as PictureSave;
  const session = new PanelSession(save, 0);
  let selected = 0;
  const onContinue = vi.fn();
  const world = createPanelWorld(f.studio, f.session, {
    panel: session,
    palette: save.palette,
    symbols: ['A', 'B'],
    mode: 'vr',
    selected: () => selected,
    onSelect: (c) => {
      selected = c;
    },
    persist: vi.fn(),
    onExit: vi.fn(),
    onContinue,
    continueLabel: () => 'Next plate',
  });
  f.connect(1);
  session.beginStroke('paint', 0);
  session.applyAt(0, 0);
  session.endStroke();
  expect(selected).toBe(1);
  session.beginStroke('paint', 1);
  session.applyAt(1, 0);
  session.endStroke();
  const completion = f.scene.getObjectByName('xr-completion') as THREE.Object3D;
  expect(completion.visible).toBe(true);
  expect(onContinue).not.toHaveBeenCalled();
  completion.updateWorldMatrix(true, true);
  const targetPoint = new THREE.Vector3(0, -0.0334, 0).applyMatrix4(completion.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(completion.matrixWorld);
  f.aim(targetPoint.clone().addScaledVector(normal, 0.2), normal.negate());
  world.update(0);
  f.buttons[0].pressed = true;
  world.update(16);
  world.update(32);
  expect(onContinue).toHaveBeenCalledOnce();
  world.dispose();

  const reopenedComplete = vi.fn();
  const reopened = createPanelWorld(f.studio, f.session, {
    panel: new PanelSession(save, 0),
    palette: save.palette,
    symbols: ['A', 'B'],
    mode: 'vr',
    selected: () => -1,
    onSelect: vi.fn(),
    persist: vi.fn(),
    onExit: vi.fn(),
    onContinue: vi.fn(),
    onComplete: reopenedComplete,
    continueLabel: () => 'Next plate',
  });
  reopened.update(100);
  reopened.update(116);
  expect(f.scene.getObjectByName('xr-completion')?.visible).toBe(true);
  expect(reopenedComplete).toHaveBeenCalledOnce();
  reopened.dispose();
});

it('shows the update notice in both XR worlds and reloads without selecting a library row', async () => {
  const f = fixture();
  const size = PANEL_SIZE * PANEL_SIZE;
  const save = {
    schemaVersion: 2,
    id: 'update',
    createdAt: 1,
    updatedAt: 1,
    name: 'Update',
    sourceImageId: 'image',
    aspect: '1:1',
    width: PANEL_SIZE,
    height: PANEL_SIZE,
    palette: [{ hex: '#ff0000', name: 'Red' }],
    paletteMode: 'lego',
    origin: 'photo',
    target: new Uint8Array(size),
    placed: new Uint8Array(size).fill(EMPTY),
    panelElapsedMs: [0],
  } as PictureSave;
  const reload = vi.fn(async () => undefined);
  configureUpdateHandler(reload);
  markUpdateAvailable();
  const panel = createPanelWorld(f.studio, f.session, {
    panel: new PanelSession(save, 0),
    palette: save.palette,
    symbols: ['A'],
    mode: 'vr',
    selected: () => 0,
    onSelect: vi.fn(),
    persist: vi.fn(),
    onExit: vi.fn(),
  });
  f.connect(1);
  panel.update(0);
  expect(f.scene.getObjectByName('xr-update-notice')?.visible).toBe(true);
  panel.dispose();

  const onPick = vi.fn();
  const library = createLibraryWorld(f.studio, f.session, {
    rows: () => [{ id: 'one', label: 'One' }],
    onPick,
    onExit: vi.fn(),
  });
  f.connect(1);
  f.buttons[0].pressed = false;
  library.update(0);
  const notice = f.scene.getObjectByName('xr-update-notice') as THREE.Object3D;
  expect(notice.visible).toBe(true);
  notice.updateWorldMatrix(true, true);
  const target = new THREE.Vector3(0.12, -0.05, 0).applyMatrix4(notice.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(notice.matrixWorld);
  f.aim(target.clone().addScaledVector(normal, 0.2), normal.negate());
  f.buttons[0].pressed = true;
  library.update(16);
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(onPick).not.toHaveBeenCalled();
  library.dispose();
});
