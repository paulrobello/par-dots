import { haptic, play } from '../audio/sfx';
import { PanelSession, panelCount, panelOrigin, pictureComplete } from '../game';
import { BoardRenderer } from '../render/boardRenderer';
import { luminance } from '../render/color';
import { zoomViewportAt } from '../render/layout';
import { renderMosaicToCanvas } from '../render/mosaicImage';
import { devicePixelRatioSafe, prefersReducedMotion } from '../render/motion';
import { StorageFullError } from '../storage/db';
import { PANEL_SIZE, type PictureSave } from '../types';
import { celebrate } from './celebrate';
import { h, icon, iconButton, openSheet, toast } from './dom';
import { cellLine, formatDuration, nextSelection, paletteLabels, routeHash } from './pure';
import type { Cleanup, ScreenContext } from './screen';
import { openSettingsSheet } from './settingsSheet';
import { loadSave, persist, setTransitionHint } from './state';

const MAX_ZOOM = 4;
const SOUND_GAP_MS = 45;
const TOUCH_HOLD_MS = 70;
/** Touch drift (CSS px) tolerated while a first touch is held, before it counts as a drag. */
const TOUCH_SLOP_PX = 10;
/** A second finger this soon after the first turns the touch into a pinch and discards its stroke. */
const PINCH_GRACE_MS = 300;

export function mountPanelPlay(
  { root, navigate }: ScreenContext,
  id: string,
  panel: number,
): Cleanup {
  let alive = true;
  let teardown: Cleanup = () => undefined;
  const shell = h(
    'div',
    { class: 'screen play' },
    h('p', { class: 'muted center pad' }, 'Loading…'),
  );
  root.append(shell);

  void loadSave(id).then((save) => {
    if (!alive) return;
    if (!save) {
      toast('Picture not found');
      navigate('#/', { replace: true });
      return;
    }
    if (!Number.isInteger(panel) || panel < 0 || panel >= panelCount(save)) {
      navigate(routeHash({ name: 'overview', id }), { replace: true });
      return;
    }
    teardown = build(save);
  });

  const build = (save: PictureSave): Cleanup => {
    const session = new PanelSession(save, panel);
    const total = panelCount(save);
    const labels = paletteLabels(save.palette);
    const origin = panelOrigin(save, panel);
    const lockedAtOpen = session.isComplete();
    let selected = -1;
    let removeMode = false;
    let panMode = false;
    let finished = false;
    let completing = false;
    let lastSound = 0;

    // ---- timer --------------------------------------------------------------
    let visibleSince: number | null =
      document.visibilityState === 'visible' ? performance.now() : null;
    const flushTimer = (): void => {
      if (visibleSince === null || lockedAtOpen) return;
      const t = performance.now();
      save.panelElapsedMs[panel] = (save.panelElapsedMs[panel] ?? 0) + (t - visibleSince);
      visibleSince = t;
    };
    const elapsed = (): number =>
      (save.panelElapsedMs[panel] ?? 0) +
      (visibleSince !== null && !lockedAtOpen && !finished ? performance.now() - visibleSince : 0);
    const saveNow = (): void => {
      flushTimer();
      persist(save).catch((err: unknown) => {
        toast(err instanceof StorageFullError ? err.message : `Save failed: ${String(err)}`, 4000);
      });
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        visibleSince = performance.now();
      } else {
        flushTimer();
        visibleSince = null;
        saveNow();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ---- DOM ----------------------------------------------------------------
    const pctEl = h('span', { class: 'pill', 'aria-label': 'Panel progress' });
    const timeEl = h('span', { class: 'pill mono', 'aria-label': 'Panel time' });
    const refCanvas = renderMosaicToCanvas(save, Math.round(20 * devicePixelRatioSafe()), 'dots', {
      region: { x: origin.x, y: origin.y, w: PANEL_SIZE, h: PANEL_SIZE },
    });
    const refBtn = h(
      'button',
      { type: 'button', class: 'ref-thumb', 'aria-label': 'Reference image. Tap to enlarge.' },
      refCanvas,
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
      h('span', {}, 'Reference'),
    );
    const boardCanvas = h('canvas', {
      class: 'board-canvas',
      role: 'application',
      'aria-label': `Panel ${panel + 1} board. Drag with one finger to place dots, two fingers to zoom.`,
    });
    const boardWrap = h('div', { class: 'board-wrap' }, boardCanvas);
    const removeBtn = h(
      'button',
      { type: 'button', class: 'tool', 'aria-pressed': 'false', 'aria-label': 'Remove tool' },
      icon('eraser'),
      h('span', {}, 'Remove'),
    );
    const moveBtn = h(
      'button',
      {
        type: 'button',
        class: 'tool',
        'aria-pressed': 'false',
        'aria-label': 'Move tool: drag to pan',
      },
      icon('move'),
      h('span', {}, 'Move'),
    );
    const hintBtn = h(
      'button',
      { type: 'button', class: 'tool', 'aria-label': 'Hint: show wrong dots' },
      icon('bulb'),
      h('span', {}, 'Hint'),
    );
    const undoBtn = h(
      'button',
      { type: 'button', class: 'tool', 'aria-label': 'Undo' },
      icon('undo'),
      h('span', {}, 'Undo'),
    );
    const redoBtn = h(
      'button',
      { type: 'button', class: 'tool', 'aria-label': 'Redo' },
      icon('redo'),
      h('span', {}, 'Redo'),
    );
    const tray = h('div', { class: 'tray', role: 'radiogroup', 'aria-label': 'Dot colors' });
    const trayWrap = h('div', { class: 'tray-wrap' }, tray);
    const toolbar = h(
      'div',
      { class: 'toolbar', role: 'toolbar', 'aria-label': 'Tools' },
      removeBtn,
      moveBtn,
      hintBtn,
      undoBtn,
      redoBtn,
    );

    const goBack = (completed = false): void => {
      setTransitionHint({ fromPanel: panel, justCompleted: completed || finished });
      navigate(routeHash({ name: 'overview', id: save.id }));
    };

    shell.replaceChildren(
      h(
        'header',
        { class: 'topbar' },
        iconButton('back', 'Back to overview', () => goBack()),
        h('h1', { class: 'title' }, `Panel ${panel + 1} / ${total}`),
        pctEl,
        timeEl,
        iconButton('gear', 'Settings', () => openSettingsSheet()),
      ),
      h(
        'div',
        { class: 'play-body' },
        h('div', { class: 'play-side' }, refBtn, overlayBtn),
        boardWrap,
      ),
      lockedAtOpen
        ? h('div', { class: 'locked-note' }, icon('check'), 'Panel complete')
        : h('div', { class: 'play-controls' }, toolbar, trayWrap),
    );

    refBtn.addEventListener('click', () => {
      const big = renderMosaicToCanvas(save, Math.round(20 * devicePixelRatioSafe()), 'dots', {
        region: { x: origin.x, y: origin.y, w: PANEL_SIZE, h: PANEL_SIZE },
      });
      big.classList.add('ref-big');
      big.setAttribute('role', 'img');
      big.setAttribute('aria-label', 'Reference image for this panel');
      openSheet('Reference', h('div', { class: 'ref-sheet' }, big));
    });

    // ---- board --------------------------------------------------------------
    const board = new BoardRenderer(boardCanvas);
    board.setData((x, y) => session.cellAt(x, y), save.palette);
    board.resize();
    const ro = new ResizeObserver(() => {
      board.setViewport(1, 0, 0);
      board.resize();
    });
    ro.observe(boardWrap);

    // Reference overlay: toggled by the button, and shown while a two-finger pinch is down.
    let overlayOn = false;
    let pinchDown = false;
    const syncOverlay = (): void => {
      board.setOverlay(overlayOn || pinchDown);
      overlayBtn.setAttribute('aria-pressed', String(overlayOn));
      overlayBtn.classList.toggle('on', overlayOn);
    };
    overlayBtn.addEventListener('click', () => {
      overlayOn = !overlayOn;
      syncOverlay();
    });

    // ---- HUD ----------------------------------------------------------------
    const updateHud = (): void => {
      const p = session.progress();
      pctEl.textContent = `${Math.floor((p.correct / p.total) * 100)}%`;
      timeEl.textContent = formatDuration(elapsed());
      undoBtn.disabled = !session.canUndo;
      redoBtn.disabled = !session.canRedo;
      removeBtn.setAttribute('aria-pressed', String(removeMode));
      removeBtn.classList.toggle('on', removeMode);
      moveBtn.setAttribute('aria-pressed', String(panMode));
      moveBtn.classList.toggle('on', panMode);
      boardCanvas.classList.toggle('panning', panMode);
    };
    const tick = setInterval(() => {
      timeEl.textContent = formatDuration(elapsed());
    }, 500);

    // ---- tray ---------------------------------------------------------------
    const trayEls = new Map<number, HTMLButtonElement>();
    let trayOrder: number[] = [];
    const makeTrayDot = (c: number): HTMLButtonElement => {
      const b = h(
        'button',
        {
          type: 'button',
          class: 'tray-dot',
          role: 'radio',
          'aria-checked': 'false',
          'aria-label': labels[c],
          title: labels[c],
          style: `--c:${save.palette[c].hex};--count-ink:${luminance(save.palette[c].hex) > 0.45 ? '#1b1b1b' : '#fff'}`,
        },
        h('span', { class: 'css-dot' }, h('span', { class: 'tray-count' })),
        h('span', { class: 'tray-label' }, labels[c]),
      );
      b.addEventListener('click', () => select(c));
      return b;
    };
    const syncTray = (animate: boolean): void => {
      const next = session.trayColors();
      const prev = trayOrder;
      for (const c of prev) {
        if (next.includes(c)) continue;
        const el = trayEls.get(c);
        trayEls.delete(c);
        if (!el) continue;
        if (animate && !prefersReducedMotion()) {
          el.classList.add('leaving');
          el.disabled = true;
          setTimeout(() => el.remove(), 280);
        } else {
          el.remove();
        }
      }
      for (let i = 0; i < next.length; i++) {
        const c = next[i];
        if (trayEls.has(c)) continue;
        const el = makeTrayDot(c);
        if (animate && !prefersReducedMotion()) el.classList.add('entering');
        trayEls.set(c, el);
        const after = next
          .slice(i + 1)
          .map((n) => trayEls.get(n))
          .find((e) => e && e.parentNode === tray);
        if (after) tray.insertBefore(el, after);
        else tray.append(el);
      }
      trayOrder = next;
      const remaining = new Map<number, number>();
      for (let y = 0; y < PANEL_SIZE; y++) {
        for (let x = 0; x < PANEL_SIZE; x++) {
          const cell = session.cellAt(x, y);
          if (cell.placed !== cell.target) {
            remaining.set(cell.target, (remaining.get(cell.target) ?? 0) + 1);
          }
        }
      }
      for (const [c, el] of trayEls) {
        const n = remaining.get(c) ?? 0;
        const count = el.querySelector('.tray-count');
        if (count && count.textContent !== String(n)) count.textContent = String(n);
        el.setAttribute('aria-label', `${labels[c]}, ${n} left`);
      }
      const sel = nextSelection(next, prev, selected);
      if (sel !== selected || !next.includes(selected)) selectRaw(sel);
      else markSelected();
    };
    const markSelected = (): void => {
      for (const [c, el] of trayEls) {
        const on = c === selected && !removeMode && !panMode;
        el.classList.toggle('selected', on);
        el.setAttribute('aria-checked', String(on));
      }
    };
    const selectRaw = (c: number): void => {
      selected = c;
      markSelected();
      const el = trayEls.get(c);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({
          inline: 'nearest',
          block: 'nearest',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
      }
    };
    const select = (c: number): void => {
      removeMode = false;
      panMode = false;
      selectRaw(c);
      updateHud();
    };

    // ---- session events -----------------------------------------------------
    const sfx = (name: 'place' | 'remove'): void => {
      const t = performance.now();
      if (t - lastSound < SOUND_GAP_MS) return;
      lastSound = t;
      play(name);
      haptic(name);
    };
    const offSession = session.onChange((ev) => {
      switch (ev.type) {
        case 'placed':
          if (ev.cause === 'stroke') {
            board.pressAnim(ev.x, ev.y);
            sfx('place');
          } else {
            board.drawCells([{ x: ev.x, y: ev.y }]);
          }
          break;
        case 'removed':
          board.drawCells([{ x: ev.x, y: ev.y }]);
          if (ev.cause === 'stroke') sfx('remove');
          break;
        case 'colorDone':
          if (!completing) {
            play('colorDone');
            haptic('colorDone');
          }
          break;
        case 'colorReturned':
          break;
        case 'complete':
          completing = true;
          break;
      }
    });

    const finishIfComplete = async (): Promise<void> => {
      if (!session.isComplete() || finished || lockedAtOpen) return;
      finished = true;
      flushTimer();
      visibleSince = null;
      board.clearHighlight();
      if (pictureComplete(save)) save.completedAt ??= Date.now();
      saveNow();
      play('panelComplete');
      haptic('panelComplete');
      await celebrate(save.palette, 'Panel complete!');
      if (!alive) return;
      goBack(true);
    };

    const afterChange = (): void => {
      syncTray(true);
      updateHud();
      void finishIfComplete();
    };

    // ---- tools --------------------------------------------------------------
    removeBtn.addEventListener('click', () => {
      removeMode = !removeMode;
      panMode = false;
      markSelected();
      updateHud();
    });
    moveBtn.addEventListener('click', () => {
      panMode = !panMode;
      if (panMode) removeMode = false;
      markSelected();
      updateHud();
    });
    hintBtn.addEventListener('click', () => {
      const wrong = session.wrongCells();
      if (wrong.length === 0) {
        board.clearHighlight();
        toast('No mistakes');
      } else {
        board.highlight(wrong, 3000);
        toast(`${wrong.length} wrong ${wrong.length === 1 ? 'dot' : 'dots'}`);
      }
    });
    undoBtn.addEventListener('click', () => {
      if (session.undo()) {
        board.clearHighlight();
        saveNow();
        afterChange();
      }
    });
    redoBtn.addEventListener('click', () => {
      if (session.redo()) {
        board.clearHighlight();
        saveNow();
        afterChange();
      }
    });

    // ---- pointer input ------------------------------------------------------
    const pointers = new Map<number, { x: number; y: number }>();
    let strokePointer: number | null = null;
    let strokeTouchDownAt: number | null = null;
    let lastCell: { x: number; y: number } | null = null;
    let pinch: { dist: number; mx: number; my: number } | null = null;
    let drag: { id: number; x: number; y: number } | null = null;

    const canvasPoint = (x: number, y: number): { x: number; y: number } => {
      const r = boardCanvas.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };
    const clampVp = (s: number, ox: number, oy: number): void => {
      const { width, height } = board.getSize();
      const cx = Math.min(0, Math.max(width - width * s, ox));
      const cy = Math.min(0, Math.max(height - height * s, oy));
      board.setViewport(s, cx, cy);
      board.draw();
    };
    const pinchState = (): { dist: number; mx: number; my: number } | null => {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return null;
      const m = canvasPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: m.x, my: m.y };
    };
    const strokeTo = (clientX: number, clientY: number): void => {
      const cell = board.hitTest(clientX, clientY);
      if (!cell) {
        lastCell = null;
        return;
      }
      const path = lastCell ? cellLine(lastCell.x, lastCell.y, cell.x, cell.y) : [cell];
      for (const c of lastCell ? path.slice(1) : path) session.applyAt(c.x, c.y);
      lastCell = cell;
    };
    const endStroke = (): void => {
      cancelPending();
      if (strokePointer === null) return;
      strokePointer = null;
      strokeTouchDownAt = null;
      lastCell = null;
      if (!session.strokeActive) return;
      session.endStroke();
      saveNow();
      afterChange();
    };

    // A first touch is held briefly before painting, so the first finger of a pinch
    // never places or removes a dot.
    let pending: {
      id: number;
      x: number;
      y: number;
      downAt: number;
      timer: ReturnType<typeof setTimeout>;
    } | null = null;
    const cancelPending = (): void => {
      if (pending) clearTimeout(pending.timer);
      pending = null;
    };
    const startStroke = (id: number, x: number, y: number, touchDownAt: number | null): void => {
      cancelPending();
      if (lockedAtOpen || finished || (!removeMode && selected < 0)) return;
      board.clearHighlight();
      strokePointer = id;
      strokeTouchDownAt = touchDownAt;
      session.beginStroke(removeMode ? 'remove' : 'paint', removeMode ? undefined : selected);
      strokeTo(x, y);
      syncTray(true);
      updateHud();
    };

    const onDown = (e: PointerEvent): void => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        boardCanvas.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointers may not be capturable.
      }
      if (pointers.size >= 2) {
        cancelPending();
        if (
          strokePointer !== null &&
          strokeTouchDownAt !== null &&
          performance.now() - strokeTouchDownAt < PINCH_GRACE_MS
        ) {
          session.cancelStroke();
          strokePointer = null;
          strokeTouchDownAt = null;
          lastCell = null;
          completing = session.isComplete();
          syncTray(false);
          updateHud();
        } else {
          endStroke();
        }
        drag = null;
        pinch = pinchState();
        pinchDown = true;
        syncOverlay();
        return;
      }
      if (panMode || lockedAtOpen) {
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        return;
      }
      if (finished) return;
      if (e.pointerType !== 'touch') {
        startStroke(e.pointerId, e.clientX, e.clientY, null);
        return;
      }
      const id = e.pointerId;
      const x = e.clientX;
      const y = e.clientY;
      const downAt = performance.now();
      cancelPending();
      pending = {
        id,
        x,
        y,
        downAt,
        timer: setTimeout(() => startStroke(id, x, y, downAt), TOUCH_HOLD_MS),
      };
    };
    const onMove = (e: PointerEvent): void => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2 && pinch) {
        const next = pinchState();
        if (!next) return;
        const vp = board.getViewport();
        const factor = pinch.dist > 0 ? next.dist / pinch.dist : 1;
        const z = zoomViewportAt(vp, factor, pinch.mx, pinch.my, 1, MAX_ZOOM);
        clampVp(z.scale, z.offsetX + (next.mx - pinch.mx), z.offsetY + (next.my - pinch.my));
        pinch = next;
        return;
      }
      if (drag && e.pointerId === drag.id) {
        const vp = board.getViewport();
        clampVp(vp.scale, vp.offsetX + (e.clientX - drag.x), vp.offsetY + (e.clientY - drag.y));
        drag = { id: drag.id, x: e.clientX, y: e.clientY };
        return;
      }
      if (pending && e.pointerId === pending.id) {
        if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < TOUCH_SLOP_PX) return;
        startStroke(pending.id, pending.x, pending.y, pending.downAt);
      }
      if (e.pointerId !== strokePointer) return;
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      if (events.length > 0) for (const ce of events) strokeTo(ce.clientX, ce.clientY);
      else strokeTo(e.clientX, e.clientY);
      syncTray(true);
      updateHud();
    };
    const onUp = (e: PointerEvent): void => {
      const wasPending = pending && pending.id === e.pointerId && e.type === 'pointerup';
      if (wasPending && pending) startStroke(pending.id, pending.x, pending.y, pending.downAt);
      pointers.delete(e.pointerId);
      if (drag && drag.id === e.pointerId) drag = null;
      if (e.pointerId === strokePointer) endStroke();
      else if (pending && pending.id === e.pointerId) cancelPending();
      pinch = pointers.size >= 2 ? pinchState() : null;
      if (pinchDown && pointers.size < 2) {
        pinchDown = false;
        syncOverlay();
      }
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const p = canvasPoint(e.clientX, e.clientY);
      const z = zoomViewportAt(
        board.getViewport(),
        Math.exp(-e.deltaY * 0.002),
        p.x,
        p.y,
        1,
        MAX_ZOOM,
      );
      clampVp(z.scale, z.offsetX, z.offsetY);
    };
    boardCanvas.addEventListener('pointerdown', onDown);
    boardCanvas.addEventListener('pointermove', onMove);
    boardCanvas.addEventListener('pointerup', onUp);
    boardCanvas.addEventListener('pointercancel', onUp);
    boardCanvas.addEventListener('wheel', onWheel, { passive: false });

    // ---- keyboard shortcuts -------------------------------------------------
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        (e.shiftKey ? redoBtn : undoBtn).click();
      } else if (e.key === 'Escape' && !document.querySelector('.backdrop')) {
        goBack();
      }
    };
    document.addEventListener('keydown', onKey);

    if (!lockedAtOpen) syncTray(false);
    updateHud();

    return () => {
      endStroke();
      flushTimer();
      visibleSince = null;
      if (!lockedAtOpen) saveNow();
      clearInterval(tick);
      offSession();
      ro.disconnect();
      board.destroy();
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('keydown', onKey);
    };
  };

  return () => {
    alive = false;
    teardown();
  };
}
