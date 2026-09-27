/** DOM for the panel play screen: the static layout and the color tray. No game logic. */

import { panelOrigin } from '../game';
import { luminance } from '../render/color';
import { renderMosaicToCanvas } from '../render/mosaicImage';
import { devicePixelRatioSafe, prefersReducedMotion } from '../render/motion';
import { PANEL_SIZE, type PictureSave } from '../types';
import { h, type IconName, icon, iconButton, openSheet } from './dom';
import { diffTray } from './trayModel';
import './tray.css';

/** Must outlast the .tray-dot opacity/width transition (0.25s) that .leaving triggers in styles.css. */
const TRAY_LEAVE_MS = 280;
const TRAY_COMPLETE_MS = 150;

export interface PlayView {
  pctEl: HTMLElement;
  timeEl: HTMLElement;
  overlayBtn: HTMLButtonElement;
  boardCanvas: HTMLCanvasElement;
  boardWrap: HTMLElement;
  removeBtn: HTMLButtonElement;
  moveBtn: HTMLButtonElement;
  hintBtn: HTMLButtonElement;
  undoBtn: HTMLButtonElement;
  redoBtn: HTMLButtonElement;
  tray: HTMLElement;
}

const toolButton = (name: IconName, label: string, text: string, pressable = true) =>
  h(
    'button',
    {
      type: 'button',
      class: 'tool',
      ...(pressable ? { 'aria-pressed': 'false' } : {}),
      'aria-label': label,
    },
    icon(name),
    h('span', {}, text),
  );

/** Build the play screen into `shell` and return the elements the controller drives. */
export function renderPlayView(
  shell: HTMLElement,
  save: PictureSave,
  panel: number,
  total: number,
  locked: boolean,
  actions: { back: () => void; prev: () => void; next: () => void; settings: () => void },
): PlayView {
  const origin = panelOrigin(save, panel);
  const refCanvas = (): HTMLCanvasElement =>
    renderMosaicToCanvas(save, Math.round(20 * devicePixelRatioSafe()), 'dots', {
      region: { x: origin.x, y: origin.y, w: PANEL_SIZE, h: PANEL_SIZE },
    });
  const pctEl = h('span', { class: 'pill', 'aria-label': 'Panel progress' });
  const timeEl = h('span', { class: 'pill mono', 'aria-label': 'Panel time' });
  const refBtn = h(
    'button',
    { type: 'button', class: 'ref-thumb', 'aria-label': 'Reference image. Tap to enlarge.' },
    refCanvas(),
  );
  const overlayBtn = h(
    'button',
    {
      type: 'button',
      class: 'chip overlay-toggle',
      'aria-pressed': 'false',
      'aria-label': 'Show reference on the board',
    },
    icon('eye'),
    h('span', {}, 'Overlay'),
  );
  const boardCanvas = h('canvas', {
    class: 'board-canvas',
    role: 'application',
    'aria-label': `Panel ${panel + 1} board. Drag with one finger to place dots, two fingers to zoom.`,
  });
  const boardWrap = h('div', { class: 'board-wrap' }, boardCanvas);
  const removeBtn = toolButton('eraser', 'Remove tool', 'Remove');
  removeBtn.title = 'Remove dots. Tip: right-click removes a dot without changing tools or colors.';
  const moveBtn = toolButton('move', 'Move tool: drag to pan', 'Move');
  const hintBtn = toolButton('bulb', 'Hint: show wrong dots', 'Hint', false);
  const undoBtn = toolButton('undo', 'Undo', 'Undo', false);
  const redoBtn = toolButton('redo', 'Redo', 'Redo', false);
  const tray = h('div', { class: 'tray', role: 'radiogroup', 'aria-label': 'Dot colors' });
  const prevBtn = iconButton('chevron-left', 'Previous panel', actions.prev, 'icon-btn nav-btn');
  prevBtn.disabled = panel === 0;
  const nextBtn = iconButton('chevron-right', 'Next panel', actions.next, 'icon-btn nav-btn');
  nextBtn.disabled = panel >= total - 1;
  const toolbar = h(
    'div',
    { class: 'toolbar', role: 'toolbar', 'aria-label': 'Tools' },
    removeBtn,
    moveBtn,
    hintBtn,
    undoBtn,
    redoBtn,
  );

  shell.replaceChildren(
    h(
      'header',
      { class: 'topbar' },
      iconButton('back', 'Back to overview', actions.back),
      prevBtn,
      h(
        'h1',
        { class: 'title' },
        h('span', { class: 'visually-hidden' }, 'Panel '),
        `${panel + 1} / ${total}`,
      ),
      nextBtn,
      pctEl,
      timeEl,
      iconButton('gear', 'Settings', actions.settings),
    ),
    h(
      'div',
      { class: 'play-body' },
      h('div', { class: 'play-side' }, refBtn, overlayBtn),
      boardWrap,
    ),
    locked
      ? h('div', { class: 'locked-note' }, icon('check'), 'Panel complete')
      : h('div', { class: 'play-controls' }, toolbar, h('div', { class: 'tray-wrap' }, tray)),
  );

  refBtn.addEventListener('click', () => {
    const big = refCanvas();
    big.classList.add('ref-big');
    big.setAttribute('role', 'img');
    big.setAttribute('aria-label', 'Reference image for this panel');
    openSheet('Reference', h('div', { class: 'ref-sheet' }, big));
  });

  return {
    pctEl,
    timeEl,
    overlayBtn,
    boardCanvas,
    boardWrap,
    removeBtn,
    moveBtn,
    hintBtn,
    undoBtn,
    redoBtn,
    tray,
  };
}

export interface TrayView {
  /** Reconcile the dots to `next` (palette order) and refresh each dot's remaining count. */
  sync(next: number[], counts: Map<number, number>, animate: boolean): void;
  /** Mark `selected` as checked, or none when `active` is false. */
  mark(selected: number, active: boolean): void;
  scrollTo(c: number): void;
  /** Show or hide each dot's palette symbol (shown while the reference overlay is on). */
  setSymbols(on: boolean): void;
  /** Release pending tray animations and event listeners. */
  dispose(): void;
}

/** The color tray inside `tray`. `onPick` fires when a dot is clicked. */
export function createTrayView(
  tray: HTMLElement,
  save: PictureSave,
  labels: string[],
  symbols: string[],
  onPick: (c: number) => void,
): TrayView {
  const els = new Map<number, HTMLButtonElement>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let order: number[] = [];
  let previousCounts = new Map<number, number>();
  let disposed = false;
  let selectedColor = -1;
  let selectionActive = false;
  let restoreFocus = false;
  let ringFrame: number | null = null;
  const ring = h('span', { class: 'tray-selection', 'aria-hidden': 'true', hidden: true });
  tray.append(ring);
  const updateRing = (): void => {
    ringFrame = null;
    if (disposed || !selectionActive || !order.includes(selectedColor)) {
      ring.hidden = true;
      return;
    }
    const el = els.get(selectedColor);
    if (!el) {
      ring.hidden = true;
      return;
    }
    ring.hidden = false;
    ring.style.width = `${el.offsetWidth}px`;
    ring.style.height = `${el.offsetHeight}px`;
    ring.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
    ring.style.transition = prefersReducedMotion()
      ? 'none'
      : 'transform 160ms ease, width 160ms ease, height 160ms ease';
  };
  const scheduleRing = (): void => {
    if (ringFrame !== null || disposed) return;
    ringFrame = requestAnimationFrame(updateRing);
  };
  const resizeObserver =
    typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleRing) : null;
  resizeObserver?.observe(tray);
  const clearTimer = (c: number): void => {
    const timer = timers.get(c);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(c);
  };
  const cancelLeave = (c: number, el: HTMLButtonElement): void => {
    clearTimer(c);
    el.classList.remove('leaving', 'completing');
    el.disabled = false;
    el.setAttribute('role', 'radio');
    el.removeAttribute('aria-hidden');
  };
  const makeDot = (c: number): HTMLButtonElement => {
    const hex = save.palette[c].hex;
    const b = h(
      'button',
      {
        type: 'button',
        class: 'tray-dot',
        role: 'radio',
        'aria-checked': 'false',
        'aria-label': labels[c],
        title: labels[c],
        'data-color': c,
        style: `--c:${hex};--count-ink:${luminance(hex) > 0.45 ? '#1b1b1b' : '#fff'}`,
      },
      h(
        'span',
        { class: 'css-dot' },
        h('span', { class: 'tray-count' }),
        h('span', { class: 'tray-complete', 'aria-hidden': 'true' }, icon('check')),
        h('span', { class: 'tray-symbol', 'aria-hidden': 'true' }, symbols[c]),
      ),
      h('span', { class: 'tray-label' }, labels[c]),
    );
    b.addEventListener('click', () => onPick(c));
    return b;
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (disposed || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const current = Number((event.target as HTMLElement).dataset.color);
    const index = order.indexOf(current);
    if (index < 0) return;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? order.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length;
    const el = els.get(order[next]);
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    el.focus();
    onPick(order[next]);
  };
  tray.addEventListener('keydown', onKeyDown);

  return {
    sync(next, counts, animate) {
      if (disposed) return;
      const motion = animate && !prefersReducedMotion();
      const { removed, added } = diffTray(order, next);
      for (const c of removed) {
        const el = els.get(c);
        if (!el) continue;
        if (document.activeElement === el) restoreFocus = true;
        const completed = (previousCounts.get(c) ?? 0) > 0;
        clearTimer(c);
        if (!motion) {
          els.delete(c);
          el.remove();
        } else {
          el.classList.toggle('completing', completed);
          el.disabled = true;
          el.setAttribute('role', 'presentation');
          el.setAttribute('aria-hidden', 'true');
          el.tabIndex = -1;
          const leave = (): void => {
            el.classList.remove('completing');
            el.classList.add('leaving');
            timers.set(
              c,
              setTimeout(() => {
                if (order.includes(c)) return;
                el.remove();
                els.delete(c);
                timers.delete(c);
              }, TRAY_LEAVE_MS),
            );
          };
          timers.set(c, setTimeout(leave, completed ? TRAY_COMPLETE_MS : 0));
        }
      }
      for (const { c, before } of added) {
        const el = els.get(c) ?? makeDot(c);
        cancelLeave(c, el);
        if (motion) el.classList.add('entering');
        const after = before === null ? undefined : els.get(before);
        els.set(c, el);
        if (after && after.parentNode === tray) tray.insertBefore(el, after);
        else if (el.parentNode !== tray) tray.append(el);
      }
      order = next;
      for (const [c, el] of els) {
        const n = counts.get(c) ?? 0;
        const count = el.querySelector<HTMLElement>('.tray-count');
        if (count && count.textContent !== String(n)) {
          count.textContent = String(n);
          count.classList.remove('changed');
          if (motion) {
            void count.offsetWidth;
            count.classList.add('changed');
          }
        }
        el.classList.toggle('empty', n === 0);
        el.setAttribute(
          'aria-label',
          n === 0 ? `${labels[c]}, none left, some misplaced` : `${labels[c]}, ${n} left`,
        );
        el.tabIndex = c === next[0] ? 0 : -1;
      }
      previousCounts = new Map(counts);
      scheduleRing();
    },
    mark(selected, active) {
      if (disposed) return;
      selectedColor = selected;
      selectionActive = active;
      for (const [c, el] of els) {
        const on = c === selected && active;
        el.classList.toggle('selected', on);
        el.setAttribute('aria-checked', String(on));
        el.tabIndex = c === selected && order.includes(c) ? 0 : -1;
      }
      if (restoreFocus) {
        els.get(selected)?.focus({ preventScroll: true });
        restoreFocus = false;
      }
      scheduleRing();
    },
    setSymbols(on) {
      tray.classList.toggle('show-symbols', on);
    },
    scrollTo(c) {
      const el = els.get(c);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({
          inline: 'nearest',
          block: 'nearest',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      tray.removeEventListener('keydown', onKeyDown);
      resizeObserver?.disconnect();
      if (ringFrame !== null) cancelAnimationFrame(ringFrame);
      for (const c of timers.keys()) clearTimer(c);
      els.clear();
      ring.remove();
    },
  };
}
