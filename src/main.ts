/**
 * App entry point: mounts one screen per hash route (unmounting the last and closing open
 * overlays), wires audio and install prompts, locks page zoom, and applies service-worker
 * updates only where no in-progress work can be lost.
 */

import { registerSW } from 'virtual:pwa-register';
import { initAudio } from './audio/sfx';
import { getSettings } from './storage/settings';
import { applyBackground } from './ui/background';
import { closeAllOverlays, isOverlayOpen } from './ui/dom';
import { mountGallery } from './ui/gallery';
import { initInstall } from './ui/install';
import { mountOverview } from './ui/overview';
import { mountPanelPlay } from './ui/panelPlay';
import { parseRoute, shouldApplyUpdate } from './ui/pure';
import { whenSaved } from './ui/saves';
import type { Cleanup, Navigate, ScreenContext } from './ui/screen';
import { mountSetup } from './ui/setup';
import { mountSource } from './ui/source';
import { applyWhenHidden, watchForUpdates } from './ui/swUpdate';

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');
const appRoot: HTMLElement = app;

let cleanup: Cleanup | null = null;

const navigate: Navigate = (hash, opts = {}) => {
  if (location.hash === hash) {
    render();
    return;
  }
  if (opts.replace) {
    history.replaceState(null, '', hash);
    render();
  } else {
    location.hash = hash;
  }
};

function render(): void {
  cleanup?.();
  cleanup = null;
  closeAllOverlays();
  appRoot.replaceChildren();
  const route = parseRoute(location.hash);
  const ctx: ScreenContext = { root: appRoot, navigate };
  appRoot.dataset.screen = route.name;
  switch (route.name) {
    case 'gallery':
      cleanup = mountGallery(ctx);
      break;
    case 'new':
      cleanup = mountSource(ctx);
      break;
    case 'setup':
      cleanup = mountSetup(ctx);
      break;
    case 'overview':
      cleanup = mountOverview(ctx, route.id);
      break;
    case 'panel':
      cleanup = mountPanelPlay(ctx, route.id, route.panel);
      break;
  }
  window.scrollTo(0, 0);
  maybeApplyUpdate();
}

/** Set once a new service worker is waiting; calling it activates the worker. */
let applyUpdate: (() => Promise<void>) | null = null;
/** Set once a new worker controls this page (activated here or by another tab); needs a reload. */
let needReload = false;

/** Activate or reload into a new deploy only where no in-progress work can be lost. */
function maybeApplyUpdate(): void {
  if (!applyUpdate && !needReload) return;
  const hidden = document.visibilityState === 'hidden';
  if (!shouldApplyUpdate(parseRoute(location.hash).name, isOverlayOpen(), hidden)) return;
  if (needReload) {
    needReload = false;
    applyUpdate = null;
    location.reload();
    return;
  }
  const apply = applyUpdate;
  applyUpdate = null;
  void apply?.();
}

window.addEventListener('hashchange', render);
initAudio();
initInstall();
applyBackground(getSettings().background);

// iOS Safari ignores user-scalable=no; cancel its pinch gestures to lock page zoom.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey && !(e.target instanceof HTMLCanvasElement)) e.preventDefault();
  },
  { passive: false },
);
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => {
    applyUpdate = () => updateSW(true);
    maybeApplyUpdate();
  },
  // Without this the plugin reloads every open tab as soon as any tab activates the update.
  onNeedReload: () => {
    needReload = true;
    maybeApplyUpdate();
  },
  onRegisteredSW: (_url, reg) => {
    if (reg) watchForUpdates(reg, document);
  },
});
// Waits for the panel screen's own hide-time IndexedDB save so the reload cannot lose it.
applyWhenHidden(document, whenSaved, maybeApplyUpdate);
render();
