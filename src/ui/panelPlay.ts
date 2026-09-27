/**
 * Panel play screen (`#/play/:id/:panel`): wiring over PanelSession, BoardRenderer and the
 * play-screen modules. Gesture model (ui/gestures.ts): one pointer paints or removes with
 * the selected tool, or pans in Move mode or on a completed panel; two pointers pinch-zoom
 * and show the reference overlay; the wheel zooms. A touch waits TOUCH_HOLD_MS before
 * painting, and a second finger within PINCH_GRACE_MS cancels the stroke. Each stroke is one
 * undoable move and is saved when it ends.
 */

import { haptic, play } from '../audio/sfx';
import { nextUnfinishedPanel, PanelSession, panelCount, pictureComplete } from '../game';
import { BoardRenderer } from '../render/boardRenderer';
import type { PictureSave } from '../types';
import { bindBoardInput, type StrokeIntent } from './boardInput';
import { celebrate } from './celebrate';
import { h, isOverlayOpen, openSheet, toast } from './dom';
import { maybePromptInstall } from './install';
import { createPanelTimer } from './panelTimer';
import { bindPlayFeedback } from './playFeedback';
import { createTrayView, renderPlayView } from './playView';
import {
  cellLine,
  formatDuration,
  formatPercent,
  nextSelection,
  paletteLabels,
  routeHash,
  userMessage,
} from './pure';
import { loadSave, persistSave } from './saves';
import type { Cleanup, ScreenContext } from './screen';
import { openSettingsSheet } from './settingsSheet';
import { setTransitionHint } from './state';
import { trayCounts } from './trayModel';

/**
 * Mounts panel play (route `#/play/:id/:panel`); an invalid panel redirects to the overview.
 * The returned Cleanup detaches input, stops the timer and saves the panel (unless it was
 * complete when opened), clears the HUD interval, and destroys the board renderer.
 */
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

  void loadSave(id)
    .then((save) => {
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
    })
    .catch((err: unknown) => {
      console.error(err);
      if (!alive) return;
      toast(`Could not open picture: ${userMessage(err)}`, 4000);
      navigate('#/', { replace: true });
    });

  const build = (save: PictureSave): Cleanup => {
    const session = new PanelSession(save, panel);
    const labels = paletteLabels(save.palette);
    const lockedAtOpen = session.isComplete();
    let selected = -1;
    let removeMode = false;
    let panMode = false;
    let finished = false;

    // ---- timer --------------------------------------------------------------
    const timer = createPanelTimer({
      now: () => performance.now(),
      initialMs: save.panelElapsedMs[panel] ?? 0,
      visible: document.visibilityState === 'visible',
      locked: lockedAtOpen,
    });
    const recordTime = (ms: number): void => {
      if (!lockedAtOpen) save.panelElapsedMs[panel] = ms;
    };
    const elapsed = (): number => timer.elapsed(finished);
    const saveNow = (): void => {
      recordTime(timer.flush());
      persistSave(save).catch((err: unknown) => {
        console.error(err);
        toast(`Save failed: ${userMessage(err)}`, 4000);
      });
    };
    const onVisibility = (): void => {
      const visible = document.visibilityState === 'visible';
      timer.setVisible(visible);
      if (!visible) saveNow();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ---- DOM ----------------------------------------------------------------
    const total = panelCount(save);
    const goBack = (completed = false): void => {
      setTransitionHint({ fromPanel: panel, justCompleted: completed || finished });
      navigate(routeHash({ name: 'overview', id: save.id }));
    };
    // Replace keeps Back returning to the overview; the hint is cleared so no stale zoom fires.
    const goToPanel = (i: number): void => {
      if (i < 0 || i >= total || i === panel) return;
      setTransitionHint({});
      navigate(routeHash({ name: 'panel', id: save.id, panel: i }), { replace: true });
    };
    const view = renderPlayView(shell, save, panel, total, lockedAtOpen, {
      back: () => goBack(),
      prev: () => goToPanel(panel - 1),
      next: () => goToPanel(panel + 1),
      settings: () => openSettingsSheet(),
    });
    const { boardCanvas, hintBtn, undoBtn, redoBtn, removeBtn, moveBtn, overlayBtn } = view;
    const trayView = createTrayView(view.tray, save, labels, (c) => select(c));

    // ---- board --------------------------------------------------------------
    const board = new BoardRenderer(boardCanvas);
    board.setData((x, y) => session.cellAt(x, y), save.palette);
    board.resize();
    const ro = new ResizeObserver(() => {
      board.setViewport(1, 0, 0);
      board.resize();
    });
    ro.observe(view.boardWrap);

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

    // ---- HUD and tray -------------------------------------------------------
    const updateHud = (): void => {
      const p = session.progress();
      view.pctEl.textContent = formatPercent((p.correct / p.total) * 100);
      view.timeEl.textContent = formatDuration(elapsed());
      undoBtn.disabled = !session.canUndo;
      redoBtn.disabled = !session.canRedo;
      removeBtn.setAttribute('aria-pressed', String(removeMode));
      removeBtn.classList.toggle('on', removeMode);
      moveBtn.setAttribute('aria-pressed', String(panMode));
      moveBtn.classList.toggle('on', panMode);
      boardCanvas.classList.toggle('panning', panMode);
    };
    const tick = setInterval(() => {
      view.timeEl.textContent = formatDuration(elapsed());
    }, 500);

    let trayOrder: number[] = [];
    const markSelected = (): void => trayView.mark(selected, !removeMode && !panMode);
    const selectRaw = (c: number): void => {
      selected = c;
      markSelected();
      trayView.scrollTo(c);
    };
    const select = (c: number): void => {
      removeMode = false;
      panMode = false;
      selectRaw(c);
      updateHud();
    };
    const syncTray = (animate: boolean): void => {
      const next = session.trayColors();
      const prev = trayOrder;
      trayView.sync(next, trayCounts(session), animate);
      trayOrder = next;
      const sel = nextSelection(next, prev, selected);
      if (sel !== selected || !next.includes(selected)) selectRaw(sel);
      else markSelected();
    };

    // ---- session events -----------------------------------------------------
    const feedback = bindPlayFeedback(session, board);

    const finishIfComplete = async (): Promise<void> => {
      if (!session.isComplete() || finished || lockedAtOpen) return;
      finished = true;
      recordTime(timer.stop());
      board.clearHighlight();
      if (pictureComplete(save)) save.completedAt ??= Date.now();
      saveNow();
      play('panelComplete');
      haptic('panelComplete');
      await celebrate(save.palette, 'Panel complete!');
      if (!alive) return;
      const next = nextUnfinishedPanel(save, panel);
      if (next === null) {
        goBack(true);
        return;
      }
      const nextBtn = h(
        'button',
        { type: 'button', class: 'btn primary' },
        `Next panel (${next + 1})`,
      );
      const overviewBtn = h('button', { type: 'button', class: 'btn ghost' }, 'Overview');
      const sheet = openSheet(
        'Panel complete',
        h('div', { class: 'confirm' }, h('div', { class: 'row' }, overviewBtn, nextBtn)),
      );
      nextBtn.addEventListener('click', () => {
        sheet.close();
        goToPanel(next);
      });
      overviewBtn.addEventListener('click', () => {
        sheet.close();
        goBack(true);
      });
      nextBtn.focus();
    };

    const afterChange = (): void => {
      syncTray(true);
      updateHud();
      hintBtn.classList.toggle('attention', feedback.checkFullButWrong());
      void finishIfComplete();
    };

    // ---- tools --------------------------------------------------------------
    const toggleTool = (tool: 'remove' | 'move'): void => {
      if (tool === 'remove') {
        removeMode = !removeMode;
        panMode = false;
      } else {
        panMode = !panMode;
        if (panMode) removeMode = false;
      }
      markSelected();
      updateHud();
    };
    removeBtn.addEventListener('click', () => toggleTool('remove'));
    moveBtn.addEventListener('click', () => toggleTool('move'));
    hintBtn.addEventListener('click', () => {
      hintBtn.classList.remove('attention');
      const wrong = session.wrongCells();
      if (wrong.length === 0) {
        board.clearHighlight();
        toast('No mistakes');
      } else {
        board.highlight(wrong, 3000);
        toast(`${wrong.length} wrong ${wrong.length === 1 ? 'dot' : 'dots'}`);
      }
    });
    const history = (step: () => boolean): void => {
      if (!step()) return;
      board.clearHighlight();
      saveNow();
      afterChange();
    };
    undoBtn.addEventListener('click', () => history(() => session.undo()));
    redoBtn.addEventListener('click', () => history(() => session.redo()));

    // ---- pointer input ------------------------------------------------------
    let lastCell: { x: number; y: number } | null = null;
    /** Paint or erase toward a pointer position; true when at least one cell changed. */
    const strokeTo = (clientX: number, clientY: number): boolean => {
      const cell = board.hitTest(clientX, clientY);
      if (!cell) {
        lastCell = null;
        return false;
      }
      const path = lastCell ? cellLine(lastCell.x, lastCell.y, cell.x, cell.y) : [cell];
      let changed = false;
      for (const c of lastCell ? path.slice(1) : path) {
        if (session.applyAt(c.x, c.y)) changed = true;
      }
      lastCell = cell;
      return changed;
    };
    const onStroke = (i: StrokeIntent): void => {
      if (i.type === 'strokeStart') {
        board.clearHighlight();
        const remove = removeMode || i.erase;
        session.beginStroke(remove ? 'remove' : 'paint', remove ? undefined : selected);
        if (strokeTo(i.x, i.y)) syncTray(true);
        updateHud();
      } else if (i.type === 'strokeMove') {
        let changed = false;
        for (const p of i.points) {
          if (strokeTo(p.x, p.y)) changed = true;
        }
        if (changed) {
          syncTray(true);
          updateHud();
        }
      } else if (i.type === 'strokeEnd') {
        lastCell = null;
        if (!session.strokeActive) return;
        session.endStroke();
        saveNow();
        afterChange();
      } else {
        session.cancelStroke();
        lastCell = null;
        feedback.resyncCompleting();
        syncTray(false);
        updateHud();
      }
    };
    const unbindInput = bindBoardInput(boardCanvas, board, {
      canPaint: (erase) => !lockedAtOpen && !finished && (erase || removeMode || selected >= 0),
      panMode: () => panMode || lockedAtOpen,
      onStroke,
      onPinch: (down) => {
        pinchDown = down;
        syncOverlay();
      },
    });

    // ---- keyboard shortcuts -------------------------------------------------
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        (e.shiftKey ? redoBtn : undoBtn).click();
      } else if (e.key === 'Escape' && !isOverlayOpen()) {
        goBack();
      } else if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !isOverlayOpen() &&
        !session.strokeActive
      ) {
        e.preventDefault();
        goToPanel(e.key === 'ArrowLeft' ? panel - 1 : panel + 1);
      }
    };
    document.addEventListener('keydown', onKey);

    if (!lockedAtOpen) syncTray(false);
    maybePromptInstall();
    updateHud();

    return () => {
      unbindInput();
      recordTime(timer.stop());
      if (!lockedAtOpen) saveNow();
      clearInterval(tick);
      feedback.dispose();
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
