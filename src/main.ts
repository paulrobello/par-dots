import { registerSW } from 'virtual:pwa-register';
import { initAudio } from './audio/sfx';
import { mountGallery } from './ui/gallery';
import { initInstall } from './ui/install';
import { mountOverview } from './ui/overview';
import { mountPanelPlay } from './ui/panelPlay';
import { parseRoute } from './ui/pure';
import type { Cleanup, Navigate, ScreenContext } from './ui/screen';
import { mountSetup } from './ui/setup';
import { mountSource } from './ui/source';

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
  document.querySelectorAll('.backdrop, .celebrate').forEach((el) => {
    el.remove();
  });
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
}

window.addEventListener('hashchange', render);
initAudio();
initInstall();

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
registerSW({ immediate: true });
render();
