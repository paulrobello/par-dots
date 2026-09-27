/** DOM for the panel play screen: the static layout and the color tray. No game logic. */

import { panelOrigin } from '../game';
import { luminance } from '../render/color';
import { renderMosaicToCanvas } from '../render/mosaicImage';
import { devicePixelRatioSafe, prefersReducedMotion } from '../render/motion';
import { PANEL_SIZE, type PictureSave } from '../types';
import { h, type IconName, icon, iconButton, openSheet } from './dom';
import { diffTray } from './trayModel';

/** Must outlast the .tray-dot opacity/width transition (0.25s) that .leaving triggers in styles.css. */
const TRAY_LEAVE_MS = 280;

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
}

/** The color tray inside `tray`. `onPick` fires when a dot is clicked. */
export function createTrayView(
  tray: HTMLElement,
  save: PictureSave,
  labels: string[],
  onPick: (c: number) => void,
): TrayView {
  const els = new Map<number, HTMLButtonElement>();
  let order: number[] = [];
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
        style: `--c:${hex};--count-ink:${luminance(hex) > 0.45 ? '#1b1b1b' : '#fff'}`,
      },
      h('span', { class: 'css-dot' }, h('span', { class: 'tray-count' })),
      h('span', { class: 'tray-label' }, labels[c]),
    );
    b.addEventListener('click', () => onPick(c));
    return b;
  };

  return {
    sync(next, counts, animate) {
      const motion = animate && !prefersReducedMotion();
      const { removed, added } = diffTray(order, next);
      for (const c of removed) {
        const el = els.get(c);
        els.delete(c);
        if (!el) continue;
        if (motion) {
          el.classList.add('leaving');
          el.disabled = true;
          setTimeout(() => el.remove(), TRAY_LEAVE_MS);
        } else {
          el.remove();
        }
      }
      for (const { c, before } of added) {
        const el = makeDot(c);
        if (motion) el.classList.add('entering');
        const after = before === null ? undefined : els.get(before);
        els.set(c, el);
        if (after && after.parentNode === tray) tray.insertBefore(el, after);
        else tray.append(el);
      }
      order = next;
      for (const [c, el] of els) {
        const n = counts.get(c) ?? 0;
        const count = el.querySelector('.tray-count');
        if (count && count.textContent !== String(n)) count.textContent = String(n);
        el.setAttribute('aria-label', `${labels[c]}, ${n} left`);
      }
    },
    mark(selected, active) {
      for (const [c, el] of els) {
        const on = c === selected && active;
        el.classList.toggle('selected', on);
        el.setAttribute('aria-checked', String(on));
      }
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
  };
}
