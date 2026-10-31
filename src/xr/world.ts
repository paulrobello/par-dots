/**
 * XR panel world (XR P1-P4): assembles the bridge, plate, frame, tray, tools and input model
 * into the studio scene — spawn placement (VR) or reticle drop (MR), per-frame controller/
 * gamepad glue, event-driven syncs, controller haptics, layout snapshot/restore. Runs only
 * inside the XR render loop; creates its own canvas-backed labels like render/ does.
 */

import * as THREE from 'three';
import { play } from '../audio/sfx';
import type { PanelSession } from '../game/panelSession';
import type { XrPanelLayout } from '../types';
import { createBridge } from './bridge';
import { createFrame } from './frame';
import { createInputModel, type PadState, readGamepad } from './input';
import { createLibrary, type LibraryRow } from './library';
import { createPlacer, type HitPose, offsetsFrom } from './place';
import { type Cell, createPlate } from './plate';
import type { Studio, XrWorld } from './scene';
import { createTools, nextBuzz, type ToolId } from './tools';
import { createGrab, faceTray, localRay } from './transforms';
import { createTray } from './tray';

/** Panel-play-provided handles; injected so world.ts stays free of ui/ imports. */
export interface PanelWorldDeps {
  /** The panel session the 2D screen is playing with; XR mutates the same save. */
  panel: PanelSession;
  palette: ReadonlyArray<{ hex: string }>;
  /** Per-color symbols (the 2D building-sheet alphabet) for the reference frame. */
  symbols: readonly string[];
  /** 'vr' spawns in arm reach; 'ar' drops via the hit-test reticle on a real surface. */
  mode: 'vr' | 'ar';
  /** Saved workspace layout for this panel (VR entry restores it; MR re-places via reticle). */
  layout?: XrPanelLayout | null;
  /** Current color selection from the 2D tray until the XR tray exists (P2b). */
  selected(): number;
  /** The 2D screen's select: XR tray selection mirrors into it so both stay one store. */
  onSelect(c: number): void;
  /** The 2D screen's saveNow; XR saves at the same points a 2D stroke would. */
  persist(): void;
  /** B button: leave XR (ends the session). */
  onExit(): void;
}

const SPAWN: HitPose = { x: 0, y: 0.95, z: -0.35 };

/** Resolve the right-hand source by three.js controller slot, not inputSources order. */
const readPad = (studio: Studio): { pad: PadState | null; index: number } => {
  for (let i = 0; i < 2; i++) {
    const source = studio.renderer.xr.getController(i).userData.xrSource as
      | XRInputSource
      | undefined;
    if (source?.handedness === 'right' && source.gamepad) {
      return { pad: readGamepad(source.gamepad), index: i };
    }
  }
  return { pad: null, index: -1 };
};

/** Pulse every controller's haptic actuator (Quest: the hand holding the tool feels it). */
const pulse = (xrSession: XRSession, intensity: number, ms: number): void => {
  for (let i = 0; i < xrSession.inputSources.length; i++) {
    const h = xrSession.inputSources[i].gamepad?.hapticActuators?.[0];
    h?.pulse?.(intensity, ms);
  }
};

/** Floating count label above the plate (hint's "N wrong"); canvas-backed, hidden by default. */
const createHintLabel = (
  plateRoot: THREE.Object3D,
): {
  show(text: string): void;
  hide(): void;
  dispose(): void;
} => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.09, 0.0225),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
  );
  mesh.position.set(0, 0.02, 0);
  mesh.visible = false;
  plateRoot.add(mesh);
  const show = (text: string): void => {
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(15,16,18,0.88)';
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 56, 14);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 34);
    tex.needsUpdate = true;
    mesh.visible = true;
  };
  const hide = (): void => {
    mesh.visible = false;
  };
  const dispose = (): void => {
    tex.dispose();
    (mesh.material as THREE.MeshBasicMaterial).dispose();
    mesh.geometry.dispose();
  };
  return { show, hide, dispose };
};

/** Attach tracked controller poses in every world and remove only this world's visuals. */
function attachControllers(studio: Studio): {
  markers: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>[];
  dispose(): void;
} {
  const visuals: THREE.Object3D[] = [];
  const listeners: Array<() => void> = [];
  const markers: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>[] = [];
  for (let i = 0; i < 2; i++) {
    const target = studio.renderer.xr.getController(i);
    const grip = studio.renderer.xr.getControllerGrip(i);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(0, 0, -1.2),
      ]),
      new THREE.LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.65 }),
    );
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xd6d8dc, roughness: 0.35 }),
    );
    const connected = (event: { data: XRInputSource }): void => {
      target.userData.xrSource = event.data;
    };
    const disconnected = (): void => {
      delete target.userData.xrSource;
    };
    const events = target as unknown as THREE.EventDispatcher<{
      connected: { data: XRInputSource };
      disconnected: Record<string, never>;
    }>;
    events.addEventListener('connected', connected);
    events.addEventListener('disconnected', disconnected);
    listeners.push(() => {
      events.removeEventListener('connected', connected);
      events.removeEventListener('disconnected', disconnected);
    });
    target.add(line);
    grip.add(marker);
    studio.scene.add(target);
    studio.scene.add(grip);
    visuals.push(line, marker);
    markers.push(marker);
  }
  return {
    markers,
    dispose() {
      for (const remove of listeners) remove();
      for (const visual of visuals) {
        visual.removeFromParent();
        if (visual instanceof THREE.Mesh || visual instanceof THREE.Line) {
          visual.geometry.dispose();
          visual.material.dispose();
        }
      }
    },
  };
}

/** Build the XR world: bridge + plate + input model wired to the studio. */
export function createPanelWorld(
  studio: Studio,
  xrSession: XRSession,
  deps: PanelWorldDeps,
): XrWorld {
  const controllers = attachControllers(studio);
  const bridge = createBridge({
    session: deps.panel,
    selected: deps.selected,
    persist: deps.persist,
  });
  const plate = createPlate(bridge, deps.palette);
  studio.scene.add(plate.root);

  const frame = createFrame(bridge, deps.palette, deps.symbols);
  studio.scene.add(frame.root);
  const tray = createTray({
    bridge,
    palette: deps.palette,
    selected: deps.selected,
  });
  studio.scene.add(tray.root);

  const tools = createTools();
  studio.scene.add(tools.root);

  /** Spawn everything around the plate at pos/yaw (VR spawn or MR reticle drop). */
  const placeWorld = (p: HitPose, yaw: number): void => {
    plate.root.position.set(p.x, p.y, p.z);
    plate.root.rotation.y = yaw;
    const off = offsetsFrom({ pos: p, yaw });
    frame.root.position.set(off.frame.x, off.frame.y, off.frame.z);
    frame.root.rotation.y = yaw;
    frame.root.lookAt(0, 1.6, 0.2);
    tray.root.position.set(off.tray.x, off.tray.y, off.tray.z);
    faceTray(tray.root, new THREE.Vector3(0, 1.6, 0.2));
    tools.root.position.set(off.tools.x, off.tools.y, off.tools.z);
    tools.root.lookAt(0, 1.6, 0.2);
    plate.sync();
    frame.sync();
    tray.sync();
  };
  placeWorld(SPAWN, 0);

  /** Amber reticle ring for MR desk placement; visible until the drop. */
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.085, 32),
    new THREE.MeshBasicMaterial({ color: 0xffb347, side: THREE.DoubleSide }),
  );
  reticle.rotation.x = -Math.PI / 2;
  reticle.visible = false;
  studio.scene.add(reticle);

  const isAr = deps.mode === 'ar';
  if (isAr) {
    plate.root.visible = false;
    frame.root.visible = false;
    tray.root.visible = false;
    tools.root.visible = false;
  }
  let hitTestSource: XRHitTestSource | null = null;
  let floorSpace: XRReferenceSpace | null = null;
  if (isAr) {
    void xrSession
      .requestReferenceSpace('viewer')
      .then((vs) => xrSession.requestHitTestSource?.({ space: vs as XRReferenceSpace }))
      .then((src) => {
        hitTestSource = src ?? null;
        // No hit-test (or denied): spawn at the default arm-reach spot instead of stranding
        // the user in an empty room with no way to drop the workspace.
        if (!hitTestSource) {
          placeWorld(SPAWN, 0);
          revealAr();
          placed = true;
        }
      })
      .catch(() => {
        placeWorld(SPAWN, 0);
        revealAr();
        placed = true;
      });
    void xrSession
      .requestReferenceSpace('local-floor')
      .then((s) => {
        floorSpace = s;
      })
      .catch(() => undefined);
  }
  if (!isAr && deps.layout) {
    const l = deps.layout;
    plate.root.position.set(l.plate.pos.x, l.plate.pos.y, l.plate.pos.z);
    plate.root.quaternion.set(l.plate.quat.x, l.plate.quat.y, l.plate.quat.z, l.plate.quat.w);
    plate.root.scale.setScalar(l.plate.scale);
    frame.root.position.set(l.frame.pos.x, l.frame.pos.y, l.frame.pos.z);
    frame.root.quaternion.set(l.frame.quat.x, l.frame.quat.y, l.frame.quat.z, l.frame.quat.w);
    frame.setScale(l.frame.scale);
    frame.setOverlay(l.overlay);
    tray.root.position.set(l.tray.pos.x, l.tray.pos.y, l.tray.pos.z);
    tray.root.quaternion.set(l.tray.quat.x, l.tray.quat.y, l.tray.quat.z, l.tray.quat.w);
    tray.root.scale.setScalar(l.tray.scale);
    plate.sync();
    frame.sync();
    tray.sync();
  }

  const model = createInputModel({
    onPlace: (cell: Cell): void => {
      if (mode() === 'paint' && bridge.selected() < 0) return;
      bridge.beginStroke(mode(), mode() === 'paint' ? bridge.selected() : undefined);
      bridge.applyCell(cell.x, cell.y);
      bridge.endStroke();
    },
    onStrokeStart: (cell: Cell | null): void => {
      if (mode() === 'paint' && bridge.selected() < 0) return;
      bridge.beginStroke(mode(), mode() === 'paint' ? bridge.selected() : undefined);
      if (cell) bridge.applyCell(cell.x, cell.y);
    },
    onStrokeMove: (from: Cell, to: Cell): void => {
      bridge.applyLine(from.x, from.y, to.x, to.y);
    },
    onStrokeEnd: () => bridge.endStroke(),
    onHover: (cell: Cell | null) => plate.setGhost(cell),
    onExit: () => deps.onExit(),
  });

  let frameTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubFrame = bridge.onChange(() => {
    if (frameTimer !== null) return;
    frameTimer = setTimeout(() => {
      frameTimer = null;
      frame.sync();
      tray.sync();
    }, 120);
  });

  const unsub = bridge.onChange((event) => {
    plate.sync();
    if (event.type === 'placed' || event.type === 'removed') {
      pulse(xrSession, 0.6, 18);
    }
  });

  let removeMode = false;
  const mode = (): 'paint' | 'remove' => (removeMode ? 'remove' : 'paint');
  const syncToolsActive = (): void => tools.setActive(removeMode ? 'remove' : 'place');

  const handleTool = (id: ToolId): void => {
    pulse(xrSession, 0.5, 12);
    play('place');
    if (id === 'place') {
      removeMode = false;
      syncToolsActive();
    } else if (id === 'remove') {
      removeMode = !removeMode;
      syncToolsActive();
    } else if (id === 'hint') {
      doHint();
    } else if (id === 'undo') {
      bridge.undo();
    } else {
      bridge.redo();
    }
  };

  /** Hint: flash the wrong studs 3 s with a floating count. */
  const hintLabel = createHintLabel(plate.root);
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  const doHint = (): void => {
    const wrong = bridge.wrongCells();
    if (wrong.length === 0) {
      pulse(xrSession, 0.3, 30);
      return;
    }
    plate.setFlash(wrong);
    hintLabel.show(`${wrong.length} wrong`);
    tools.flash('hint');
    if (hintTimer !== null) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintTimer = null;
      plate.setFlash(null);
      hintLabel.hide();
    }, 3000);
  };

  /** Full-but-wrong buzz: haptic once per arming; the 2D feedback plays the sound. */
  let buzzArmed = true;
  const unsubBuzz = bridge.onChange(() => {
    const filled = bridge.emptyCount() === 0;
    const wrong = bridge.wrongCells().length > 0;
    if (buzzArmed && filled && wrong) {
      pulse(xrSession, 0.9, 160);
      tools.flash('remove');
    }
    buzzArmed = nextBuzz(filled, wrong);
  });

  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const plateRay = new THREE.Ray();
  let grab: ReturnType<typeof createGrab> | null = null;
  const raycaster = new THREE.Raycaster();
  let grabbed: THREE.Object3D | null = null;
  let prevGrip = false;
  let prevOverlayX = false;
  let prevSelectTrig = false;
  let awaitTriggerRelease = true;
  let placed = !isAr;

  const grabBounds = new THREE.Box3();
  const gripPosition = new THREE.Vector3();
  const grabRoots = [plate.root, frame.root, tray.root, tools.root];
  let lastTime: number | null = null;
  const update = (time: number, frame?: XRFrame): void => {
    const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
    lastTime = time;
    const { pad: rawPad, index } = readPad(studio);
    if (rawPad && !rawPad.trigger) awaitTriggerRelease = false;
    const pad = rawPad && awaitTriggerRelease ? { ...rawPad, trigger: false } : rawPad;
    let snap: Cell | null = null;
    let chip: number | null = null;
    let tool: ToolId | null = null;
    if (index >= 0) {
      const ctl = studio.renderer.xr.getController(index);
      pos.setFromMatrixPosition(ctl.matrixWorld);
      dir.set(0, 0, -1).transformDirection(ctl.matrixWorld);
      if (!isAr || placed) {
        chip = tray.pickChip({ origin: pos, dir });
        tool = chip === null ? tools.pickTool({ origin: pos, dir }) : null;
        if (chip === null && tool === null) {
          localRay(plate.root, pos, dir, plateRay, inv);
          snap = plate.pickCell({ origin: plateRay.origin, dir: plateRay.direction }, mode());
        }
      }
    }
    const down = pad?.trigger === true && !prevSelectTrig;
    if (isAr && !placed) {
      updatePlacement(frame, down);
    } else {
      if (down && chip !== null) traySelect(chip);
      else if (down && tool !== null) handleTool(tool);
    }
    prevSelectTrig = pad?.trigger === true;
    model.update(pad?.grip ? null : snap, pad);
    for (let i = 0; i < controllers.markers.length; i++) {
      const marker = controllers.markers[i];
      marker.getWorldPosition(gripPosition);
      const near =
        i === index &&
        placed &&
        grabRoots.some((root) => {
          if (!root.visible) return false;
          grabBounds.setFromObject(root);
          return grabBounds.distanceToPoint(gripPosition) <= 0.015;
        });
      marker.material.color.setHex(near || (grabbed !== null && i === index) ? 0x56dbb1 : 0xd6d8dc);
      marker.material.emissive.setHex(near ? 0x195a48 : 0x000000);
    }
    updateGrab(pad, index, pos, dir, dt);
    updateOverlayToggle();
  };

  /** MR desk placement: amber reticle follows real-surface hits; trigger drops the set. */
  const placer = createPlacer({
    onDrop: ({ pos: p, yaw }) => {
      placed = true;
      placeWorld(p, yaw);
      revealAr();
      pulse(xrSession, 0.7, 30);
    },
  });
  const revealAr = (): void => {
    plate.root.visible = true;
    frame.root.visible = true;
    tray.root.visible = true;
    tools.root.visible = true;
    reticle.visible = false;
  };
  const headPos = new THREE.Vector3();
  const updatePlacement = (frame: XRFrame | undefined, triggerDown: boolean): void => {
    let hit: HitPose | null = null;
    if (frame && hitTestSource && floorSpace) {
      const results = frame.getHitTestResults(hitTestSource);
      if (results.length > 0) {
        const pose = results[0].getPose(floorSpace);
        if (pose) {
          hit = {
            x: pose.transform.position.x,
            y: pose.transform.position.y,
            z: pose.transform.position.z,
          };
        }
      }
    }
    if (hit) {
      reticle.visible = true;
      reticle.position.set(hit.x, hit.y + 0.004, hit.z);
    } else {
      reticle.visible = false;
    }
    headPos.setFromMatrixPosition(studio.renderer.xr.getCamera().matrixWorld);
    placer.update(hit, { x: headPos.x, y: headPos.y, z: headPos.z }, triggerDown);
  };

  /** Trigger select on a chip: mirrors into the 2D select, exits Remove (2D parity). */
  const traySelect = (c: number): void => {
    removeMode = false;
    syncToolsActive();
    deps.onSelect(c);
    tray.sync();
    pulse(xrSession, 0.4, 12);
  };

  /** Grip follows controller position/orientation; thumbstick adjusts yaw and scale. */
  const updateGrab = (
    pad: PadState | null,
    index: number,
    o: THREE.Vector3,
    d: THREE.Vector3,
    dt: number,
  ): void => {
    const grip = pad?.grip === true;
    const down = grip && !prevGrip;
    const up = !grip && prevGrip;
    if (down && index >= 0 && placed) {
      const roots = grabRoots.filter((r) => r.visible);
      studio.renderer.xr.getControllerGrip(index).getWorldPosition(gripPosition);
      grabbed =
        roots.find(
          (root) => grabBounds.setFromObject(root).distanceToPoint(gripPosition) <= 0.015,
        ) ?? null;
      if (!grabbed) {
        raycaster.set(o, d);
        const hits = raycaster.intersectObjects(roots, true);
        if (hits.length > 0) {
          let cur: THREE.Object3D = hits[0].object;
          while (cur.parent && cur.parent !== studio.scene) cur = cur.parent;
          grabbed = cur;
        }
      }
      if (grabbed) grab = createGrab(grabbed, studio.renderer.xr.getControllerGrip(index));
    }
    if (grip && index >= 0 && grabbed && grab && pad) {
      grab.update(pad.stickX, pad.stickY, dt);
      if (grabbed === frame.root) frame.setScale(grabbed.scale.x);
    }
    if (up || index < 0) {
      grab = null;
      grabbed = null;
    }
    prevGrip = grip;
  };

  /** Left-controller X edge toggles the reference overlay (mirrors the 2D Overlay button). */
  const updateOverlayToggle = (): void => {
    let x = false;
    for (let i = 0; i < xrSession.inputSources.length; i++) {
      const src = xrSession.inputSources[i];
      if (src.handedness === 'left' && src.gamepad) x = !!src.gamepad.buttons[4]?.pressed;
    }
    if (x && !prevOverlayX) frame.toggleOverlay();
    prevOverlayX = x;
  };

  const dispose = (): void => {
    unsub();
    unsubFrame();
    unsubBuzz();
    if (frameTimer !== null) clearTimeout(frameTimer);
    if (hintTimer !== null) clearTimeout(hintTimer);
    hitTestSource?.cancel();
    reticle.geometry.dispose();
    (reticle.material as THREE.MeshBasicMaterial).dispose();
    controllers.dispose();
    for (const root of [plate.root, frame.root, tray.root, tools.root, reticle])
      root.removeFromParent();
    plate.dispose();
    frame.dispose();
    tray.dispose();
    tools.dispose();
    hintLabel.dispose();
  };

  const layout = (): XrPanelLayout | null => ({
    plate: {
      pos: { x: plate.root.position.x, y: plate.root.position.y, z: plate.root.position.z },
      quat: {
        x: plate.root.quaternion.x,
        y: plate.root.quaternion.y,
        z: plate.root.quaternion.z,
        w: plate.root.quaternion.w,
      },
      scale: plate.root.scale.x,
    },
    frame: {
      pos: { x: frame.root.position.x, y: frame.root.position.y, z: frame.root.position.z },
      quat: {
        x: frame.root.quaternion.x,
        y: frame.root.quaternion.y,
        z: frame.root.quaternion.z,
        w: frame.root.quaternion.w,
      },
      scale: frame.getScale(),
    },
    tray: {
      pos: { x: tray.root.position.x, y: tray.root.position.y, z: tray.root.position.z },
      quat: {
        x: tray.root.quaternion.x,
        y: tray.root.quaternion.y,
        z: tray.root.quaternion.z,
        w: tray.root.quaternion.w,
      },
      scale: tray.root.scale.x,
    },
    overlay: frame.isOverlayOn(),
  });

  return { update, layout, dispose };
}

/**
 * A world that can replace its contents mid-session (XR P5): the gallery launcher swaps the
 * library picker for a panel world when a picture is chosen and back when it finishes.
 */
export function createSwapWorld(initial: XrWorld): XrWorld & {
  swap(next: XrWorld): void;
  current(): XrWorld;
  repaint(): void;
} {
  let current: XrWorld = initial;
  return {
    update(time, frame) {
      current.update(time, frame);
    },
    layout: () => null,
    repaint() {
      current.repaint?.();
    },
    dispose() {
      current.dispose();
    },
    swap(next) {
      current.dispose();
      current = next;
    },
    current: () => current,
  };
}

/** The library world's deps: fixed rows at construction, pick and exit callbacks. */
export interface LibraryWorldDeps {
  rows: () => LibraryRow[];
  onPick(id: string): void;
  onExit(): void;
}

/** The in-VR picture picker as a world: ray + trigger selects a row. */
export function createLibraryWorld(
  studio: Studio,
  xrSession: XRSession,
  deps: LibraryWorldDeps,
): XrWorld {
  const controllers = attachControllers(studio);
  const library = createLibrary({ rows: deps.rows, onPick: deps.onPick });
  library.root.position.set(0, 1.35, -0.5);
  library.root.lookAt(0, 1.6, 0.2);
  studio.scene.add(library.root);

  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let prevTrigger = false;
  let prevB = false;
  let stickHeld = false;
  const update = (_time: number, _frame?: XRFrame): void => {
    const { pad, index } = readPad(studio);
    if (index < 0) return;
    if (pad?.b && !prevB) deps.onExit();
    prevB = pad?.b === true;
    const stick = pad?.stickX ?? 0;
    if (Math.abs(stick) > 0.6 && !stickHeld) library.pageBy(stick > 0 ? 1 : -1);
    stickHeld = Math.abs(stick) > 0.3;
    const ctl = studio.renderer.xr.getController(index);
    pos.setFromMatrixPosition(ctl.matrixWorld);
    dir.set(0, 0, -1).transformDirection(ctl.matrixWorld);
    const row = library.pickRow({ origin: pos, dir });
    const down = pad?.trigger === true && !prevTrigger;
    if (down && row !== null) {
      const id = deps.rows()[row]?.id;
      if (id) {
        pulse(xrSession, 0.5, 12);
        deps.onPick(id);
      }
    }
    prevTrigger = pad?.trigger === true;
  };

  const dispose = (): void => {
    controllers.dispose();
    library.root.removeFromParent();
    library.dispose();
  };

  return { update, layout: () => null, repaint: library.repaint, dispose };
}
