import { prefersReducedMotion } from '../render/motion';
import type { PaletteColor } from '../types';
import { h } from './dom';

/** Burst of CSS dot confetti over the screen. Resolves after the animation (short under reduced motion). */
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
  return new Promise((resolve) =>
    setTimeout(
      () => {
        layer.classList.add('fade');
        setTimeout(() => {
          layer.remove();
          resolve();
        }, 250);
      },
      reduced ? 900 : ms,
    ),
  );
}
