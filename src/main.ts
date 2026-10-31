/**
 * App entry point: mounts one screen per hash route (unmounting the last and closing open
 * overlays), wires audio and install prompts, locks page zoom, and applies service-worker
 * updates only where no in-progress work can be lost.
 */

import { registerSW } from 'virtual:pwa-register';
import { initAnalytics, trackPageView } from './analytics';
import { initMusic } from './audio/music';
import { initAudio } from './audio/sfx';
import { getSettings } from './storage/settings';
import { applyBackground } from './ui/background';
import { closeAllOverlays, h } from './ui/dom';
import { mountDrawCreate } from './ui/drawCreate';
import { mountDrawEditor } from './ui/drawEditor';
import { mountGallery } from './ui/gallery';
import { initInstall } from './ui/install';
import { mountOverview } from './ui/overview';
import { mountPanelPlay } from './ui/panelPlay';
import { parseRoute, type Route, userMessage } from './ui/pure';
import { whenSaved } from './ui/saves';
import type { Cleanup, Navigate, ScreenContext } from './ui/screen';
import { mountSetup } from './ui/setup';
import { mountSource } from './ui/source';
import { checkBuild, watchForUpdates } from './ui/swUpdate';
import { initTooltips } from './ui/tooltips';
import { createUpdateNotice } from './ui/updateNotice';
import {
  configureUpdateHandler,
  markUpdateAvailable,
  requestUpdate,
  subscribeToUpdates,
} from './updateState';

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
  try {
    cleanup = mountRoute(route, ctx);
  } catch (err) {
    console.error(err);
    // A throw mid-mount leaves a half-built screen; discard it and offer a way out.
    appRoot.replaceChildren();
    appRoot.dataset.screen = 'error';
    cleanup = mountCrashScreen(ctx, err);
  }
  window.scrollTo(0, 0);
  trackPageView();
  void checkLatestBuild();
}

/** Mount one screen per route name. */
function mountRoute(route: Route, ctx: ScreenContext): Cleanup | null {
  switch (route.name) {
    case 'gallery':
      return mountGallery(ctx);
    case 'new':
      return mountSource(ctx);
    case 'setup':
      return mountSetup(ctx);
    case 'drawNew':
      return mountDrawCreate(ctx);
    case 'drawEditor':
      return mountDrawEditor(ctx, route.id);
    case 'overview':
      return mountOverview(ctx, route.id);
    case 'panel':
      return mountPanelPlay(ctx, route.id, route.panel);
  }
}

/** Minimal screen for a route whose mount threw; the gallery is the way back. */
function mountCrashScreen(ctx: ScreenContext, err: unknown): Cleanup {
  ctx.root.append(
    h(
      'div',
      { class: 'screen error-screen' },
      h('header', { class: 'topbar' }, h('h1', { class: 'title' }, 'Something went wrong')),
      h(
        'div',
        { class: 'scroll' },
        h('p', { class: 'muted' }, `This screen could not open: ${userMessage(err)}`),
        h(
          'button',
          { class: 'btn primary big', type: 'button', on: { click: () => ctx.navigate('#/') } },
          'Back to gallery',
        ),
      ),
    ),
  );
  return () => {};
}

/** Set once a new service worker is waiting; calling it activates the worker. */
let applyUpdate: (() => Promise<void>) | null = null;
/** Set once a new worker controls this page (activated here or by another tab); needs a reload. */
let needReload = false;

let activationFinished: (() => void) | null = null;

/** Apply a waiting worker only after the user chooses Reload and saves have completed. */
async function applyRequestedUpdate(): Promise<void> {
  await whenSaved();
  if (!needReload) {
    if (!applyUpdate) throw new Error('Update is not ready');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        activationFinished = null;
        reject(new Error('Update activation timed out'));
      }, 15000);
      activationFinished = () => {
        clearTimeout(timer);
        activationFinished = null;
        resolve();
      };
      void applyUpdate?.().catch((error: unknown) => {
        clearTimeout(timer);
        activationFinished = null;
        reject(error);
      });
    });
  }
  location.reload();
}

const buildFingerprint =
  document.querySelector<HTMLMetaElement>('meta[name="build-fingerprint"]')?.content ?? '';
let registration: ServiceWorkerRegistration | undefined;
async function checkLatestBuild(): Promise<void> {
  await checkBuild(buildFingerprint, () => {
    if (navigator.serviceWorker?.controller) {
      void registration?.update().catch(() => {});
    } else {
      needReload = true;
      markUpdateAvailable();
    }
  });
}

window.addEventListener('hashchange', render);
initAnalytics();
initAudio();
initMusic();
initInstall();
initTooltips();
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
let lastController = navigator.serviceWorker?.controller ?? null;
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  const current = navigator.serviceWorker.controller;
  if (lastController && current !== lastController) {
    needReload = true;
    activationFinished?.();
    markUpdateAvailable();
  }
  lastController = current;
});
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => {
    applyUpdate = () => updateSW(true);
    markUpdateAvailable();
  },
  // Without this the plugin reloads every open tab as soon as any tab activates the update.
  onNeedReload: () => {
    needReload = true;
    activationFinished?.();
    markUpdateAvailable();
  },
  onRegisteredSW: (url, reg) => {
    registration = reg;
    if (reg) {
      if (reg.waiting && navigator.serviceWorker.controller) {
        applyUpdate = () => updateSW(true);
        markUpdateAvailable();
      }
      void navigator.serviceWorker.register(url, { updateViaCache: 'none' }).catch(() => {});
      watchForUpdates(
        {
          update: async () => {
            await checkLatestBuild();
            await reg.update();
          },
        },
        document,
      );
    }
  },
});
configureUpdateHandler(applyRequestedUpdate);
const updateNotice = createUpdateNotice(() => {
  if (
    parseRoute(location.hash).name === 'setup' &&
    !window.confirm('Reloading will discard the current picture setup. Continue?')
  ) {
    updateNotice.setBusy(false);
    return;
  }
  void requestUpdate();
});
subscribeToUpdates((status) => {
  updateNotice.setVisible(status.available);
  updateNotice.setBusy(status.busy);
  updateNotice.setError(status.error);
});
render();
