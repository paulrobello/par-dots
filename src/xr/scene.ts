/**
 * XR studio scene (XR P0): the WebGLRenderer with `xr.enabled` over a studio backdrop — void
 * background, grid floor, neutral lights for color judgment. Everything three.js-related lives
 * here; panel play reaches this module only through a dynamic `import('../xr/scene')`, so a
 * 2D-only session never parses three.js. `session.ts` owns detection and the session request.
 */

import * as THREE from 'three';
import type { XrPanelLayout } from '../types';

/** Any scene-graph node whose GPU resources `disposeTree` can release. */
export interface DisposeNode {
  geometry?: { dispose(): void };
  children?: DisposeNode[];
  material?:
    | {
        dispose(): void;
        map?: { dispose(): void } | null;
      }
    | (DisposeNode & {
        dispose(): void;
        map?: { dispose(): void } | null;
      })[];
}

/** The renderer surface `launchVr` drives; structural so tests can fake it. */
export interface XrRenderer {
  xr: {
    setSession(session: XRSession): unknown;
    getController(index: number): THREE.Object3D;
    getControllerGrip(index: number): THREE.Object3D;
    getCamera(): { matrixWorld: THREE.Matrix4 };
  };
  setAnimationLoop(cb: ((time: number) => void) | null): void;
}

/** What `launchVr` needs from a studio; the real one closes over the three.js graph. */
export interface Studio {
  renderer: XrRenderer;
  scene: DisposeNode & { add(o: unknown): unknown };
  render(): void;
  /** Release the GPU side: dispose every scene-graph resource, then the renderer. */
  dispose(): void;
}

/** A per-session world assembled into the studio scene (plate, input, frame/tray/tools). */
export interface XrWorld {
  update(time: number, frame?: XRFrame): void;
  /** Snapshot the workspace layout for persistence on session end (XR P4). */
  layout(): XrPanelLayout | null;
  dispose(): void;
}

export interface VrLaunchOptions {
  /** Runs once when the session ends (headset off, system exit, or `end()`). */
  onEnd: () => void;
  /** 'ar' builds the passthrough studio (transparent clear, no grid); default 'vr'. */
  mode?: 'vr' | 'ar';
  /** Assemble the panel world into the scene; called once, after the studio is built. */
  buildWorld?: (studio: Studio) => XrWorld;
}

export interface VrLaunch {
  session: XRSession;
  /** End the session; resolves when it has ended (the `end` event then restores 2D). */
  end(): Promise<void>;
}

/** Recursively dispose GPU resources down a scene-graph subtree. */
export function disposeTree(node: DisposeNode): void {
  node.geometry?.dispose();
  if (Array.isArray(node.material)) {
    for (const m of node.material) {
      m.map?.dispose();
      m.dispose();
    }
  } else if (node.material) {
    node.material.map?.dispose();
    node.material.dispose();
  }
  for (const child of node.children ?? []) disposeTree(child);
}

/** Build the VR studio: renderer, void backdrop, grid floor, lighting, camera. */
function createStudio(): Studio {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202329);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404550, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(1.5, 3, 2);
  scene.add(sun);
  scene.add(new THREE.GridHelper(20, 40, 0x394048, 0x2b3037));
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 30);
  camera.position.set(0, 1.6, 2.5);
  return {
    renderer,
    scene,
    render: () => {
      renderer.render(scene, camera);
    },
    dispose: () => {
      disposeTree(scene);
      renderer.dispose();
    },
  };
}

/** Build the passthrough studio: alpha renderer, no backdrop, same neutral lights. */
function createArStudio(): Studio {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearAlpha(0);
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404550, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(1.5, 3, 2);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 30);
  camera.position.set(0, 1.6, 2.5);
  return {
    renderer,
    scene,
    render: () => {
      renderer.render(scene, camera);
    },
    dispose: () => {
      disposeTree(scene);
      renderer.dispose();
    },
  };
}

/**
 * Enter VR/MR with an already-granted session: build the studio, hand the session to the
 * renderer, and start the XR render loop. On session end the loop stops, the studio's GPU
 * resources are disposed, and `onEnd` restores the caller's 2D state. `createStudioImpl` is
 * injectable so tests drive the whole lifecycle without a GL context.
 */
export function launchVr(
  session: XRSession,
  opts: VrLaunchOptions,
  createStudioImpl: () => Studio = opts.mode === 'ar' ? createArStudio : createStudio,
): VrLaunch {
  let studio: Studio;
  try {
    studio = createStudioImpl();
  } catch (err) {
    void session.end().catch(() => undefined);
    throw err;
  }
  let world: XrWorld | undefined;
  if (opts.buildWorld) {
    try {
      world = opts.buildWorld(studio);
    } catch (err) {
      void session.end().catch(() => undefined);
      throw err;
    }
  }
  let done = false;
  const exit = (): void => {
    if (done) return;
    done = true;
    studio.renderer.setAnimationLoop(null);
    world?.dispose();
    studio.dispose();
    opts.onEnd();
  };
  const onSetSession = (): void => {
    if (done) return;
    studio.renderer.setAnimationLoop((time: number, frame?: XRFrame) => {
      world?.update(time, frame);
      studio.render();
    });
  };
  const result = studio.renderer.xr.setSession(session);
  if (result && typeof (result as Promise<unknown>).then === 'function') {
    void (result as Promise<unknown>).then(onSetSession, () => {
      void session.end().catch(() => undefined);
      exit();
    });
  } else {
    onSetSession();
  }
  session.addEventListener('end', exit);
  return {
    session,
    end: () => session.end().catch(() => undefined),
  };
}
