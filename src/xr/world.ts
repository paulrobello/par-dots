/**
 * XR panel world (XR P1-P4): assembles the bridge, plate, frame, tray, tools and input model
 * into the studio scene — spawn placement (VR) or reticle drop (MR), per-frame controller/
 * gamepad glue, event-driven syncs, controller haptics, layout snapshot/restore. Runs only
 * inside the XR render loop; creates its own canvas-backed labels like render/ does.
 */

import * as THREE from 'three';
import { play } from '../audio/sfx';
import type { PanelSession } from '../game/panelSession';
import { getSettings, setSettings } from '../storage/settings';
import type { PictureSave, XrPanelLayout } from '../types';
import { getUpdateStatus, requestUpdate } from '../updateState';
import { createBridge } from './bridge';
import { createCompletion } from './completion';
import { createFrame } from './frame';
import { createHelp } from './help';
import { createInputModel, type PadState, readGamepad } from './input';
import { getCustomLayouts, type ReusableXrLayout, saveCustomLayout } from './layout';
import { createLibrary, type LibraryRow } from './library';
import { createMagnifier } from './magnifier';
import { createOverview } from './overview';
import { createPhysicalGuide } from './physicalGuide';
import { createPlacer, type HitPose, offsetsFrom } from './place';
import { type Cell, createPlate } from './plate';
import { createProgressLabel } from './progress';
import type { Studio, XrWorld } from './scene';
import { createXrSettings } from './settings';
import { createTools, nextBuzz, type ToolId } from './tools';
import { createGrab, faceTray, localRay } from './transforms';
import { createTray } from './tray';
import { createXrUpdateNotice } from './updateNotice';

/** Panel-play-provided handles; injected so world.ts stays free of ui/ imports. */
export interface PanelWorldDeps {
  /** The panel session the 2D screen is playing with; XR mutates the same save. */
  panel: PanelSession;
  palette: ReadonlyArray<{ hex: string; name?: string }>;
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
  /** Continue from a completed plate without leaving the immersive session. */
  onContinue?(): void;
  onComplete?(): void;
  continueLabel?(): string;
  save?: PictureSave;
  onPanelSelect?(panel: number): void;
  overviewState?: { layout: ReusableXrLayout['overview']; visible: boolean };
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
  if (!getSettings().haptics) return;
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
  lines: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>[];
  dispose(): void;
} {
  const visuals: THREE.Object3D[] = [];
  const listeners: Array<() => void> = [];
  const markers: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>[] = [];
  const lines: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>[] = [];
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
    lines.push(line);
  }
  return {
    markers,
    lines,
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
  const plate = createPlate(bridge, deps.palette, deps.symbols);
  studio.scene.add(plate.root);
  const magnifier = createMagnifier(plate.root, bridge, deps.palette, deps.symbols);

  const frame = createFrame(bridge, deps.palette, deps.symbols);
  studio.scene.add(frame.root);
  const progress = createProgressLabel(frame.root);
  const physicalGuide = createPhysicalGuide();
  physicalGuide.hide();
  studio.scene.add(physicalGuide.root);
  const syncPhysicalGuide = (): void => {
    const color = deps.selected();
    physicalGuide.sync({
      colorName: deps.palette[color]?.name ?? 'Choose a color',
      symbol: deps.symbols[color] ?? '—',
      remaining: color >= 0 ? bridge.remainingFor(color) : 0,
    });
  };
  syncPhysicalGuide();
  progress.sync(bridge.progress());
  const tray = createTray({
    bridge,
    palette: deps.palette,
    selected: deps.selected,
  });
  studio.scene.add(tray.root);

  const tools = createTools();
  studio.scene.add(tools.root);
  const completion = createCompletion();
  studio.scene.add(completion.root);
  const help = createHelp();
  studio.scene.add(help.root);
  const settings = createXrSettings(deps.mode, (preset) => studio.setEnvironment?.(preset));
  studio.scene.add(settings.root);
  const updateNotice = createXrUpdateNotice();
  studio.scene.add(updateNotice.root);
  const overview = deps.save && deps.onPanelSelect ? createOverview(deps.save) : null;
  if (overview) {
    overview.root.visible = false;
    studio.scene.add(overview.root);
    const state = deps.overviewState;
    if (state?.layout) {
      const { pos, quat, scale } = state.layout;
      overview.root.position.set(pos.x, pos.y, pos.z);
      overview.root.quaternion.set(quat.x, quat.y, quat.z, quat.w);
      overview.root.scale.setScalar(scale ?? 1);
      overview.root.userData.positioned = true;
      overview.root.visible = state.visible;
    }
  }
  const fallbackHead = new THREE.Matrix4().makeTranslation(0, 1.6, 0.2);
  const viewerPosition = (): THREE.Vector3 => {
    const camera = studio.renderer.xr.getCamera?.();
    return camera
      ? new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
      : new THREE.Vector3(0, 1.6, 0.2);
  };

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
  let hitTestSourceInput: XRInputSource | null = null;
  let hitTestSourceRequest: XRInputSource | null = null;
  let hitTestSourceGeneration = 0;
  let floorSpace: XRReferenceSpace | null = null;
  if (isAr) {
    void xrSession
      .requestReferenceSpace('local-floor')
      .then((s) => {
        floorSpace = s;
      })
      .catch(() => undefined);
  }
  const applyLayout = (l: ReusableXrLayout): void => {
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
    for (const [object, transform] of [
      [tools.root, l.tools],
      [overview?.root, l.overview],
    ] as const) {
      if (!object || !transform) continue;
      object.position.set(transform.pos.x, transform.pos.y, transform.pos.z);
      object.quaternion.set(transform.quat.x, transform.quat.y, transform.quat.z, transform.quat.w);
      object.scale.setScalar(transform.scale ?? 1);
      if (object === overview?.root) object.userData.positioned = true;
    }
    plate.sync();
    frame.sync();
    tray.sync();
  };
  if (!isAr && deps.layout) {
    applyLayout(deps.layout);
    if (overview && deps.overviewState?.layout) {
      const { pos, quat, scale } = deps.overviewState.layout;
      overview.root.position.set(pos.x, pos.y, pos.z);
      overview.root.quaternion.set(quat.x, quat.y, quat.z, quat.w);
      overview.root.scale.setScalar(scale ?? 1);
    }
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
      if (overview?.root.visible) overview.repaint();
      progress.sync(bridge.progress());
      syncPhysicalGuide();
    }, 120);
  });

  const unsub = bridge.onChange((event) => {
    plate.sync();
    if (event.type === 'placed' || event.type === 'removed') {
      pulse(xrSession, 0.6, 18);
    } else if (event.type === 'colorDone' && deps.selected() === event.colorIndex) {
      const colors = bridge.trayColors();
      const next = colors.find((c) => c > event.colorIndex) ?? colors.at(-1) ?? -1;
      deps.onSelect(next);
      syncPhysicalGuide();
      if (focus) plate.setFocusColor(next >= 0 ? next : null);
      tray.sync();
    } else if (event.type === 'complete') {
      deps.onComplete?.();
      help.root.visible = false;
      settings.root.visible = false;
      completion.show(deps.continueLabel?.() ?? 'Exit VR', plate.root, viewerPosition());
      play('panelComplete');
      pulse(xrSession, 0.8, 100);
    }
  });

  let removeMode = false;
  let referenceOverlay = false;
  let focus = false;
  const savedWorkspacePreset = getSettings().xrWorkspacePreset;
  let workspacePreset = savedWorkspacePreset ?? 0;
  if (workspacePreset === 3 && !getCustomLayouts().Custom) workspacePreset = 0;
  const applyWorkspacePreset = (): void => {
    const custom = getCustomLayouts().Custom;
    if (workspacePreset === 3 && custom) {
      applyLayout(custom);
    } else {
      const p = plate.root.position.clone();
      const yaw = plate.root.rotation.y;
      placeWorld({ x: p.x, y: p.y, z: p.z }, yaw);
      plate.root.rotation.x = workspacePreset === 1 ? Math.PI / 3 : 0;
      plate.root.scale.setScalar(workspacePreset === 2 ? 1.8 : 1);
    }
  };
  if (workspacePreset !== 0) applyWorkspacePreset();
  else if (savedWorkspacePreset !== null && deps.layout) {
    plate.root.rotation.x = 0;
    plate.root.scale.setScalar(1);
  }
  let initialCompletionPending = bridge.isComplete();
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
    } else if (id === 'settings') {
      settings.show(plate.root, viewerPosition());
    } else if (id === 'help') {
      help.show(plate.root, viewerPosition());
    } else if (id === 'ghost') {
      referenceOverlay = !referenceOverlay;
      plate.setReferenceOverlay(referenceOverlay);
      tools.setGhostActive(referenceOverlay);
    } else if (id === 'focus') {
      focus = !focus;
      plate.setFocusColor(focus && deps.selected() >= 0 ? deps.selected() : null);
      tools.setFocusActive(focus);
    } else if (id === 'workspace') {
      const custom = getCustomLayouts().Custom;
      workspacePreset = (workspacePreset + 1) % (custom ? 4 : 3);
      setSettings({ xrWorkspacePreset: workspacePreset });
      applyWorkspacePreset();
      hintLabel.show(['Desk', 'Easel', 'Close-up', 'Custom layout'][workspacePreset]);
      if (hintTimer !== null) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        hintTimer = null;
        hintLabel.hide();
      }, 2000);
    } else if (id === 'save-layout') {
      hintLabel.show(saveCustomLayout('Custom', layout()) ? 'Layout saved' : 'Save failed');
      if (hintTimer !== null) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        hintTimer = null;
        hintLabel.hide();
      }, 2000);
    } else if (id === 'picture' && overview) {
      if (!overview.root.visible) {
        if (!overview.root.userData.positioned) {
          overview.root.position.copy(plate.root.position);
          overview.root.position.y += 0.3;
          overview.root.lookAt(viewerPosition());
          overview.root.userData.positioned = true;
        }
        overview.repaint();
      }
      overview.root.visible = !overview.root.visible;
    } else if (id === 'guide') {
      if (physicalGuide.root.visible) physicalGuide.hide();
      else {
        syncPhysicalGuide();
        physicalGuide.show();
      }
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
      plate.setFlash(null);
      hintLabel.show('No mistakes');
      if (hintTimer !== null) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        hintTimer = null;
        hintLabel.hide();
      }, 3000);
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
  const grabs: Array<ReturnType<typeof createGrab> | null> = [null, null];
  const raycaster = new THREE.Raycaster();
  const grabbed: Array<THREE.Object3D | null> = [null, null];
  const prevGrip = [false, false];
  let prevOverlayX = false;
  let prevSelectTrig = false;
  let dragging = false;
  let awaitTriggerRelease = true;
  let suppressTriggerUntilRelease = false;
  let suppressBUntilRelease = false;
  let placed = !isAr;

  const grabBounds = new THREE.Box3();
  const gripPosition = new THREE.Vector3();
  const grabRoots: THREE.Object3D[] = [
    plate.root,
    frame.root,
    tray.root,
    tools.root,
    ...(overview ? [overview.root] : []),
  ];
  let lastTime: number | null = null;
  const update = (time: number, xrFrame?: XRFrame): void => {
    if (physicalGuide.root.visible) {
      frame.root.updateWorldMatrix(true, false);
      physicalGuide.root.position.set(0, -0.26, 0.005).applyMatrix4(frame.root.matrixWorld);
      frame.root.getWorldQuaternion(physicalGuide.root.quaternion);
      physicalGuide.root.scale.copy(frame.root.scale);
    }
    const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
    lastTime = time;
    if (initialCompletionPending && placed) {
      initialCompletionPending = false;
      deps.onComplete?.();
      completion.show(deps.continueLabel?.() ?? 'Exit VR', plate.root, viewerPosition());
    }
    const updateStatus = getUpdateStatus();
    updateNotice.setVisible(
      updateStatus.available,
      studio.renderer.xr.getCamera?.().matrixWorld ?? fallbackHead,
      updateStatus.busy,
      updateStatus.error,
    );
    const { pad: rawPad, index } = readPad(studio);
    if (!rawPad?.b) suppressBUntilRelease = false;
    if (!rawPad) awaitTriggerRelease = true;
    else if (!rawPad.trigger) awaitTriggerRelease = false;
    const pad = rawPad && awaitTriggerRelease ? { ...rawPad, trigger: false } : rawPad;
    if (!pad?.trigger) suppressTriggerUntilRelease = false;
    else if (pad.grip) suppressTriggerUntilRelease = true;
    const actionPad =
      pad && (pad.grip || suppressTriggerUntilRelease) ? { ...pad, trigger: false } : pad;
    if (!actionPad?.trigger) dragging = false;
    else if (!prevSelectTrig) dragging = actionPad.a;
    let snap: Cell | null = null;
    let chip: number | null = null;
    let referenceColor: number | null = null;
    let tool: ToolId | null = null;
    if (index >= 0) {
      const ctl = studio.renderer.xr.getController(index);
      pos.setFromMatrixPosition(ctl.matrixWorld);
      dir.set(0, 0, -1).transformDirection(ctl.matrixWorld);
      if (!isAr || placed) {
        chip = tray.pickChip({ origin: pos, dir });
        referenceColor = chip === null ? frame.pickColor({ origin: pos, dir }) : null;
        tool =
          chip === null && referenceColor === null ? tools.pickTool({ origin: pos, dir }) : null;
        if (chip === null && referenceColor === null && tool === null) {
          localRay(plate.root, pos, dir, plateRay, inv);
          snap = plate.pickCell(
            { origin: plateRay.origin, dir: plateRay.direction },
            mode(),
            dragging ? 0 : getSettings().xrSnapRadius,
          );
        }
      }
    }
    const down = actionPad?.trigger === true && !prevSelectTrig;
    const noticeHit =
      !settings.root.visible && index >= 0 && !pad?.grip && updateNotice.hit(pos, dir);
    const overviewHit =
      !settings.root.visible &&
      overview?.root.visible &&
      index >= 0 &&
      !pad?.grip &&
      snap === null &&
      chip === null &&
      referenceColor === null &&
      tool === null
        ? overview.pickPanel({ origin: pos, dir })
        : null;
    overview?.setHover(overviewHit);
    const modalAtStart =
      completion.root.visible ||
      help.root.visible ||
      settings.root.visible ||
      overviewHit !== null ||
      noticeHit;
    tools.setHover(!modalAtStart && !pad?.grip && (!isAr || placed) ? tool : null);
    if (noticeHit) {
      if (down) {
        suppressTriggerUntilRelease = true;
        if (updateNotice.pick(pos, dir)) void requestUpdate();
      }
    } else if (overviewHit !== null) {
      if (down) {
        if (overview && deps.overviewState) {
          deps.overviewState.layout = snapshotTransform(overview.root);
          deps.overviewState.visible = true;
        }
        suppressTriggerUntilRelease = true;
        deps.onPanelSelect?.(overviewHit);
      }
    } else if (completion.root.visible) {
      completion.update(time);
      if (down && index >= 0 && completion.pick(pos, dir)) (deps.onContinue ?? deps.onExit)();
    } else if (help.root.visible) {
      if (down && index >= 0 && help.pick(pos, dir)) suppressTriggerUntilRelease = true;
    } else if (settings.root.visible) {
      if (down && index >= 0 && settings.pick(pos, dir) === 'close')
        suppressTriggerUntilRelease = true;
    } else if (isAr && !placed) {
      const source =
        index >= 0
          ? (studio.renderer.xr.getController(index).userData.xrSource as XRInputSource | undefined)
          : undefined;
      updatePlacement(xrFrame, down, source ?? null);
    } else {
      if (down && chip !== null) traySelect(chip);
      else if (down && referenceColor !== null && bridge.trayColors().includes(referenceColor))
        traySelect(referenceColor);
      else if (down && tool !== null) handleTool(tool);
    }
    prevSelectTrig = actionPad?.trigger === true;
    const modal =
      modalAtStart || completion.root.visible || help.root.visible || settings.root.visible;
    const inputPad =
      actionPad && (modal || suppressBUntilRelease)
        ? { ...actionPad, trigger: modal ? false : actionPad.trigger, b: false }
        : actionPad;
    magnifier.update(getSettings().xrMagnifier && !modal && !inputPad?.grip ? snap : null);
    model.update(modal || inputPad?.grip ? null : snap, inputPad);
    for (let i = 0; i < 2; i++) {
      const ctl = studio.renderer.xr.getController(i);
      const source = ctl.userData.xrSource as XRInputSource | undefined;
      const grabPad = source?.gamepad ? readGamepad(source.gamepad) : null;
      const origin = new THREE.Vector3().setFromMatrixPosition(ctl.matrixWorld);
      const direction = new THREE.Vector3(0, 0, -1).transformDirection(ctl.matrixWorld);
      const grabBlocked = completion.root.visible || help.root.visible || settings.root.visible;
      updateGrab(grabBlocked ? null : grabPad, i, origin, direction, dt);
      const marker = controllers.markers[i];
      marker.getWorldPosition(gripPosition);
      const roots = grabRoots.filter(
        (root) => root.visible && !grabbed.some((held, j) => j !== i && held === root),
      );
      const near =
        !!grabPad &&
        !grabBlocked &&
        placed &&
        roots.some((root) => grabBounds.setFromObject(root).distanceToPoint(gripPosition) <= 0.015);
      raycaster.set(origin, direction);
      const aimedHit =
        grabPad && !grabBlocked && placed
          ? raycaster.intersectObjects(roots, true).find((hit) => {
              let node: THREE.Object3D | null = hit.object;
              while (node && !roots.includes(node)) {
                if (!node.visible) return false;
                node = node.parent;
              }
              return node !== null;
            })
          : undefined;
      const targetable = near || !!aimedHit || grabbed[i] !== null;
      marker.material.color.setHex(targetable ? 0x56dbb1 : 0xd6d8dc);
      marker.material.emissive.setHex(targetable ? 0x195a48 : 0x000000);
      controllers.lines[i].material.color.setHex(targetable ? 0x56dbb1 : 0x8fd0ff);
      const settingsHit = settings.root.visible
        ? raycaster.intersectObject(settings.root, true)[0]
        : undefined;
      controllers.lines[i].scale.z = (settingsHit?.distance ?? aimedHit?.distance ?? 1.2) / 1.2;
    }
    if (overview && deps.overviewState) {
      deps.overviewState.visible = overview.root.visible;
      if (overview.root.userData.positioned)
        deps.overviewState.layout = snapshotTransform(overview.root);
    }
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
  const ensureHitTestSource = (input: XRInputSource | null): void => {
    const requestHitTestSource = xrSession.requestHitTestSource;
    const targetRaySpace = input?.targetRaySpace;
    if (input && !requestHitTestSource) {
      placeWorld(SPAWN, 0);
      revealAr();
      placed = true;
      return;
    }
    if (!input || !targetRaySpace || !requestHitTestSource) {
      if (hitTestSourceInput !== null || hitTestSourceRequest !== null) {
        hitTestSource?.cancel();
        hitTestSource = null;
        hitTestSourceInput = null;
        hitTestSourceRequest = null;
        hitTestSourceGeneration++;
      }
      return;
    }
    if (input === hitTestSourceInput || input === hitTestSourceRequest) return;
    hitTestSource?.cancel();
    hitTestSource = null;
    hitTestSourceInput = null;
    hitTestSourceRequest = input;
    const generation = ++hitTestSourceGeneration;
    const request = requestHitTestSource as NonNullable<XRSession['requestHitTestSource']>;
    const pending = request.call(xrSession, { space: targetRaySpace });
    if (!pending) {
      hitTestSourceRequest = null;
      placeWorld(SPAWN, 0);
      revealAr();
      placed = true;
      return;
    }
    void pending
      .then((source) => {
        if (generation !== hitTestSourceGeneration || input !== hitTestSourceRequest) {
          source?.cancel();
          return;
        }
        hitTestSourceRequest = null;
        hitTestSourceInput = source ? input : null;
        hitTestSource = source ?? null;
        if (!source) {
          placeWorld(SPAWN, 0);
          revealAr();
          placed = true;
        }
      })
      .catch(() => {
        if (generation !== hitTestSourceGeneration || input !== hitTestSourceRequest) return;
        hitTestSourceRequest = null;
        placeWorld(SPAWN, 0);
        revealAr();
        placed = true;
      });
  };
  const headPos = new THREE.Vector3();
  const updatePlacement = (
    frame: XRFrame | undefined,
    triggerDown: boolean,
    input: XRInputSource | null,
  ): void => {
    ensureHitTestSource(input);
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
    syncPhysicalGuide();
    if (focus) plate.setFocusColor(c);
    tray.sync();
    pulse(xrSession, 0.4, 12);
  };

  /** Grip follows controller position/orientation; thumbstick adjusts yaw and distance or scale. */
  const updateGrab = (
    pad: PadState | null,
    index: number,
    o: THREE.Vector3,
    d: THREE.Vector3,
    dt: number,
  ): void => {
    const grip = pad?.grip === true;
    const down = grip && !prevGrip[index];
    const up = !grip && prevGrip[index];
    if (down && index >= 0 && placed) {
      const roots = grabRoots.filter((r) => r.visible && !grabbed.includes(r));
      studio.renderer.xr.getControllerGrip(index).getWorldPosition(gripPosition);
      grabbed[index] =
        roots.find(
          (root) => grabBounds.setFromObject(root).distanceToPoint(gripPosition) <= 0.015,
        ) ?? null;
      if (!grabbed[index]) {
        raycaster.set(o, d);
        const hits = raycaster.intersectObjects(roots, true).filter((hit) => {
          let node: THREE.Object3D | null = hit.object;
          while (node && !roots.includes(node)) {
            if (!node.visible) return false;
            node = node.parent;
          }
          return node !== null;
        });
        if (hits.length > 0) {
          let cur: THREE.Object3D = hits[0].object;
          while (cur.parent && cur.parent !== studio.scene) cur = cur.parent;
          grabbed[index] = cur;
        }
      }
      if (grabbed[index])
        grabs[index] = createGrab(grabbed[index], studio.renderer.xr.getControllerGrip(index));
    }
    if (grip && grabbed[index] && grabs[index] && pad) {
      grabs[index].update(pad.stickX, pad.stickY, pad.trigger, dt, d);
      if (grabbed[index] === frame.root) frame.setScale(frame.root.scale.x);
    }
    if (up || index < 0) {
      grabs[index] = null;
      grabbed[index] = null;
    }
    prevGrip[index] = grip;
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
    hitTestSourceGeneration++;
    unsub();
    unsubFrame();
    unsubBuzz();
    if (frameTimer !== null) clearTimeout(frameTimer);
    if (hintTimer !== null) clearTimeout(hintTimer);
    hitTestSource?.cancel();
    reticle.geometry.dispose();
    (reticle.material as THREE.MeshBasicMaterial).dispose();
    controllers.dispose();
    completion.dispose();
    help.dispose();
    settings.dispose();
    updateNotice.dispose();
    magnifier.dispose();
    physicalGuide.dispose();
    if (overview) {
      overview.root.removeFromParent();
      overview.dispose();
    }
    for (const root of [plate.root, frame.root, tray.root, tools.root, reticle])
      root.removeFromParent();
    plate.dispose();
    progress.dispose();
    frame.dispose();
    tray.dispose();
    tools.dispose();
    hintLabel.dispose();
  };

  const snapshotTransform = (object: THREE.Object3D): NonNullable<ReusableXrLayout['tools']> => ({
    pos: { x: object.position.x, y: object.position.y, z: object.position.z },
    quat: {
      x: object.quaternion.x,
      y: object.quaternion.y,
      z: object.quaternion.z,
      w: object.quaternion.w,
    },
    scale: object.scale.x,
  });
  const layout = (): ReusableXrLayout => ({
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
    tools: snapshotTransform(tools.root),
    ...(overview?.root.userData.positioned ? { overview: snapshotTransform(overview.root) } : {}),
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
  mode?: 'vr' | 'ar';
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
  library.root.position.set(0, 1.15, -0.5);
  library.root.lookAt(0, 1.15, 0.2);
  studio.scene.add(library.root);
  const settings = createXrSettings(deps.mode ?? 'vr', (preset) => studio.setEnvironment?.(preset));
  studio.scene.add(settings.root);
  const updateNotice = createXrUpdateNotice();
  studio.scene.add(updateNotice.root);
  const fallbackHead = new THREE.Matrix4().makeTranslation(0, 1.6, 0.2);

  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const prevTrigger = [false, false];
  const ready = [false, false];
  const prevB = [false, false];
  const stickHeld = [false, false];
  const prevGrip = [false, false];
  let heldBy = -1;
  let grab: ReturnType<typeof createGrab> | null = null;
  let lastTime: number | null = null;
  const raycaster = new THREE.Raycaster();
  const bounds = new THREE.Box3();
  const gripPosition = new THREE.Vector3();
  const update = (time: number, _frame?: XRFrame): void => {
    const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
    lastTime = time;
    const updateStatus = getUpdateStatus();
    updateNotice.setVisible(
      updateStatus.available,
      studio.renderer.xr.getCamera?.().matrixWorld ?? fallbackHead,
      updateStatus.busy,
      updateStatus.error,
    );
    let hovered: number | null = null;
    let pickedThisFrame = false;
    for (let index = 0; index < 2; index++) {
      const ctl = studio.renderer.xr.getController(index);
      const source = ctl.userData.xrSource as XRInputSource | undefined;
      if (!source?.gamepad) {
        controllers.markers[index].material.color.setHex(0xd6d8dc);
        controllers.markers[index].material.emissive.setHex(0x000000);
        controllers.lines[index].material.color.setHex(0x8fd0ff);
        controllers.lines[index].scale.z = 1;
        ready[index] = false;
        prevTrigger[index] = false;
        prevB[index] = false;
        stickHeld[index] = false;
        prevGrip[index] = false;
        if (heldBy === index) {
          heldBy = -1;
          grab = null;
        }
        continue;
      }
      const pad = readGamepad(source.gamepad);
      if (!pad.trigger && !pad.grip) ready[index] = true;
      if (pad.grip) ready[index] = false;
      if (pad.b && !prevB[index]) {
        if (settings.root.visible) settings.root.visible = false;
        else deps.onExit();
      }
      prevB[index] = pad.b;
      if (!pad.grip && !settings.root.visible && Math.abs(pad.stickX) > 0.6 && !stickHeld[index])
        library.pageBy(pad.stickX > 0 ? 1 : -1);
      stickHeld[index] = Math.abs(pad.stickX) > 0.3;
      pos.setFromMatrixPosition(ctl.matrixWorld);
      dir.set(0, 0, -1).transformDirection(ctl.matrixWorld);
      bounds.setFromObject(library.root);
      studio.renderer.xr.getControllerGrip(index).getWorldPosition(gripPosition);
      raycaster.set(pos, dir);
      const libraryHit = raycaster.intersectObject(library.root, true)[0];
      const targetable =
        !settings.root.visible &&
        (heldBy < 0 || heldBy === index) &&
        (heldBy === index || bounds.distanceToPoint(gripPosition) <= 0.015 || !!libraryHit);
      controllers.markers[index].material.color.setHex(targetable ? 0x56dbb1 : 0xd6d8dc);
      controllers.markers[index].material.emissive.setHex(targetable ? 0x195a48 : 0x000000);
      controllers.lines[index].material.color.setHex(targetable ? 0x56dbb1 : 0x8fd0ff);
      const settingsHit = settings.root.visible
        ? raycaster.intersectObject(settings.root, true)[0]
        : undefined;
      controllers.lines[index].scale.z =
        (settingsHit?.distance ??
          (!settings.root.visible ? libraryHit?.distance : undefined) ??
          1.2) / 1.2;
      if (pad.grip && !prevGrip[index] && heldBy < 0 && !settings.root.visible) {
        studio.renderer.xr.getControllerGrip(index).getWorldPosition(gripPosition);
        bounds.setFromObject(library.root);
        raycaster.set(pos, dir);
        if (bounds.distanceToPoint(gripPosition) <= 0.015 || libraryHit) {
          heldBy = index;
          grab = createGrab(library.root, studio.renderer.xr.getControllerGrip(index));
        }
      }
      if (!pad.grip && heldBy === index) {
        heldBy = -1;
        grab = null;
      }
      if (heldBy === index && pad.grip) grab?.update(pad.stickX, pad.stickY, pad.trigger, dt, dir);
      prevGrip[index] = pad.grip;
      if (pad.grip) {
        prevTrigger[index] = pad.trigger;
        continue;
      }
      const down = ready[index] && pad.trigger && !prevTrigger[index];
      if (!settings.root.visible && updateNotice.hit(pos, dir)) {
        if (down && !pickedThisFrame) {
          pickedThisFrame = true;
          ready[index] = false;
          if (updateNotice.pick(pos, dir)) void requestUpdate();
        }
      } else if (settings.root.visible) {
        if (down && !pickedThisFrame) {
          const action = settings.pick(pos, dir);
          if (action) {
            pickedThisFrame = true;
            if (action === 'close') ready[index] = false;
          }
        }
      } else if (down && !pickedThisFrame && library.pickSettings({ origin: pos, dir })) {
        const camera = studio.renderer.xr.getCamera?.();
        const head = camera
          ? new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
          : new THREE.Vector3(0, 1.6, 0.2);
        settings.show(library.root, head);
        pickedThisFrame = true;
      } else {
        const row = library.pickRow({ origin: pos, dir });
        if (hovered === null && row !== null) hovered = row;
        if (down && row !== null && !pickedThisFrame) {
          const id = deps.rows()[row]?.id;
          if (id) {
            pulse(xrSession, 0.5, 12);
            pickedThisFrame = true;
            deps.onPick(id);
          }
        }
      }
      prevTrigger[index] = pad.trigger;
    }
    library.setHover(hovered);
  };

  const dispose = (): void => {
    controllers.dispose();
    library.root.removeFromParent();
    library.dispose();
    settings.dispose();
    updateNotice.dispose();
  };

  return { update, layout: () => null, repaint: library.repaint, dispose };
}
