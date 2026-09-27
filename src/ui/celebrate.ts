/**
 * Panel completion badge and full-picture confetti. Both register as overlays so
 * routing away ends them early.
 */

import { prefersReducedMotion } from '../render/motion';
import type { PaletteColor } from '../types';
import { h, icon, registerOverlay } from './dom';

/** Show a short completion badge over the board after its light sweep settles. */
export function celebratePanel(container: HTMLElement): Promise<void> {
  const badge = h(
    'div',
    { class: 'panel-complete-badge', role: 'status', 'aria-live': 'polite' },
    icon('check'),
    'Panel complete',
  );
  container.append(badge);
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unregister();
      badge.remove();
      resolve();
    };
    const unregister = registerOverlay(finish);
    const timer = setTimeout(finish, 800);
  });
}

/** Burst of CSS dot confetti over the screen. Resolves after the animation (short under reduced motion), or early when overlays are closed. */
export function celebrate(palette: PaletteColor[], title: string, ms = 1600): Promise<void> {
  const reduced = prefersReducedMotion();
  const layer = h('div', { class: 'celebrate', role: 'status', 'aria-live': 'assertive' });
  layer.append(h('div', { class: 'celebrate-title' }, title));
  if (!reduced) {
    const colors = palette.length > 0 ? palette : [{ hex: '#f2cd37', name: '' }];
    for (let i = 0; i < 48; i++) {
      const c = colors[i % colors.length].hex;
      const dx = (Math.random() * 2 - 1) * 45;
      const dy = -(35 + Math.random() * 45);
      const d = h('span', {
        class: 'confetti',
        style: `--c:${c};--dx:${dx.toFixed(1)}vw;--dy:${dy.toFixed(1)}vh;--r:${Math.round(Math.random() * 720 - 360)}deg;--delay:${Math.round(Math.random() * 180)}ms;--s:${(0.6 + Math.random() * 0.8).toFixed(2)}`,
      });
      layer.append(d);
    }
  }
  document.body.append(layer);
  return new Promise((resolve) => {
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(showTimer);
      clearTimeout(fadeTimer);
      unregister();
      layer.remove();
      resolve();
    };
    const unregister = registerOverlay(finish);
    const showTimer = setTimeout(
      () => {
        layer.classList.add('fade');
        fadeTimer = setTimeout(finish, 250);
      },
      reduced ? 900 : ms,
    );
  });
}
