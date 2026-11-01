/**
 * WebXR session detection and request (XR P0): capability checks and the immersive-vr session
 * request. No three.js here, so the support detection never pulls the GL bundle in; `launchVr()`
 * in scene.ts owns rendering. Both modules are dynamically imported from panel play and the gallery;
 * session detection itself does not load them. Every function takes the `XRSystem` so the
 * logic is testable without a browser.
 */

export type XrMode = 'immersive-vr' | 'immersive-ar';

export interface XrSupport {
  vr: boolean;
  ar: boolean;
}

/** Ask one XRSystem implementation for one mode's support; may reject on unknown modes. */
const modeSupported = async (xr: XRSystem, mode: XrMode): Promise<boolean> => {
  try {
    return await xr.isSessionSupported(mode);
  } catch {
    return false;
  }
};

/** Detect VR and AR session support. An absent XRSystem (desktop, iOS) supports neither. */
export async function xrSupport(xr: XRSystem | undefined): Promise<XrSupport> {
  if (!xr) return { vr: false, ar: false };
  const [vr, ar] = await Promise.all([
    modeSupported(xr, 'immersive-vr'),
    modeSupported(xr, 'immersive-ar'),
  ]);
  return { vr, ar };
}

/** Request an immersive-vr session; `local-floor` is the reference space when granted. */
export function requestVrSession(xr: XRSystem): Promise<XRSession> {
  return xr.requestSession('immersive-vr', {
    optionalFeatures: ['local-floor', 'bounded-floor'],
  });
}

/** Request an immersive-ar (passthrough) session with hit-test for desk placement. */
export function requestArSession(xr: XRSystem): Promise<XRSession> {
  return xr.requestSession('immersive-ar', {
    optionalFeatures: ['local-floor', 'hit-test'],
  });
}
