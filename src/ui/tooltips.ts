/**
 * Custom tooltips: a single styled chip shown quickly on hover or keyboard focus for any
 * element carrying a `data-tip` attribute. Replaces native `title` tooltips, which are
 * unstyled and appear after about a second.
 */

import { h } from './dom';

/** Delay before the chip appears in response to hover or focus. */
const SHOW_MS = 120;
/** Delay on leave before hiding, so pointer wobble does not flicker it. */
const HIDE_MS = 60;
/** Viewport-edge clamp in px. */
const EDGE = 8;
/** Gap between the chip and its target. */
const OFFSET = 6;

let remove: (() => void) | null = null;

/** Installs the delegated tooltip listeners once. Returns a function that removes them. */
export function initTooltips(): () => void {
  if (remove) return remove;

  const tip = h('div', { class: 'tooltip', role: 'tooltip' });
  document.body.append(tip);
  let current: Element | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = (): void => {
    if (showTimer) clearTimeout(showTimer);
    if (hideTimer) clearTimeout(hideTimer);
    showTimer = null;
    hideTimer = null;
  };

  const hide = (): void => {
    clearTimers();
    current = null;
    tip.classList.remove('show');
  };

  const place = (target: Element): void => {
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth;
    const hgt = tip.offsetHeight;
    const maxLeft = Math.max(EDGE, window.innerWidth - w - EDGE);
    const left = Math.min(maxLeft, Math.max(EDGE, r.left + r.width / 2 - w / 2));
    let top = r.top - hgt - OFFSET;
    if (top < EDGE) top = r.bottom + OFFSET;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };

  const show = (target: Element): void => {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    tip.textContent = text;
    place(target);
    current = target;
    tip.classList.add('show');
  };

  const schedule = (target: Element): void => {
    clearTimers();
    if (current === target) return;
    showTimer = setTimeout(() => {
      showTimer = null;
      if (target.isConnected) show(target);
    }, SHOW_MS);
  };

  const leave = (): void => {
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_MS);
  };

  const tipTarget = (ev: Event): Element | null =>
    ev.target instanceof Element ? ev.target.closest('[data-tip]') : null;

  const onOver = (ev: Event): void => {
    const t = tipTarget(ev);
    if (t) schedule(t);
  };
  const onOut = (ev: Event): void => {
    if (tipTarget(ev)) leave();
  };

  document.addEventListener('pointerover', onOver);
  document.addEventListener('pointerout', onOut);
  document.addEventListener('focusin', onOver);
  document.addEventListener('focusout', onOut);
  document.addEventListener('pointerdown', hide);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);

  remove = () => {
    hide();
    document.removeEventListener('pointerover', onOver);
    document.removeEventListener('pointerout', onOut);
    document.removeEventListener('focusin', onOver);
    document.removeEventListener('focusout', onOut);
    document.removeEventListener('pointerdown', hide);
    document.removeEventListener('scroll', hide, true);
    window.removeEventListener('blur', hide);
    tip.remove();
    remove = null;
  };
  return remove;
}
