/**
 * Draw editor screen (`#/draw/:id`): the whole mosaic with pan/zoom, draw tools, palette
 * tray, undo/redo (50) and Clear all. Sessions are saved through a 500 ms debounced persist
 * flushed on cleanup, hide, and pagehide, so no stroke is lost to navigation or reload.
 */

import { haptic, play } from '../audio/sfx';
import {
  brushCells,
  type DrawCellChange,
  type DrawEvent,
  DrawSession,
  type DrawTool,
  type GridCell,
  lineCells,
} from '../game';
import { DrawBoard } from '../render/drawBoard';
import { zoomViewportAt } from '../render/layout';
import type { PictureSave } from '../types';
import { confirmDialog, h, iconButton, openSheet, toast } from './dom';
import { bindDrawInput, type StrokeIntent } from './drawInput';
import { createDrawTray, type DrawTrayHandle } from './drawTray';
import { openGuideSheet, openPartsSheet } from './partsSheet';
import { routeHash, userMessage } from './pure';
import { loadSave, persistSave } from './saves';
import type { Cleanup, ScreenContext } from './screen';
import { settingsButton } from './settingsSheet';

const PERSIST_MS = 500;
const SOUND_GAP_MS = 45;

type EditorTool = DrawTool | 'pan' | 'eraser';

const TOOLS: Array<{ id: DrawTool; icon: Parameters<typeof iconButton>[0]; label: string }> = [
  { id: 'brush', icon: 'brush', label: 'Brush' },
  { id: 'line', icon: 'line', label: 'Line' },
  { id: 'rect', icon: 'box', label: 'Box' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse' },
  { id: 'poly', icon: 'polygon', label: 'Polygon' },
  { id: 'fill', icon: 'fill', label: 'Fill' },
  { id: 'pick', icon: 'pipette', label: 'Eyedropper' },
];

/**
 * Mounts the draw editor (route `#/draw/:id`). Unknown ids toast and return to the gallery;
 * photo saves redirect to their overview. The Cleanup unbinds input, flushes the save,
 * and tears down the renderer and tray.
 */
export function mountDrawEditor({ root, navigate }: ScreenContext, id: string): Cleanup {
  let alive = true;
  let teardown: Cleanup = () => undefined;
  const shell = h(
    'div',
    { class: 'screen draw-editor' },
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
      if (save.origin !== 'drawn') {
        navigate(routeHash({ name: 'overview', id: save.id }), { replace: true });
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
    const session = new DrawSession(save);
    let tool: EditorTool = 'brush';

    // ---- persistence --------------------------------------------------------
    let dirty = false;
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPersist = (): void => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      if (!dirty) return;
      dirty = false;
      persistSave(save).catch((err: unknown) => {
        console.error(err);
        toast(`Save failed: ${userMessage(err)}`, 4000);
      });
    };
    const schedulePersist = (): void => {
      dirty = true;
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(flushPersist, PERSIST_MS);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flushPersist();
    };
    const onPageHide = (): void => flushPersist();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    // ---- DOM ----------------------------------------------------------------
    const countEl = h('span', { class: 'pill draw-count', 'aria-label': 'Dots placed' });
    const canvas = h('canvas', {
      class: 'draw-canvas',
      role: 'application',
      'aria-label': 'Drawing board. Drag to draw, two fingers to zoom, double-tap to zoom.',
    });
    const stage = h('div', { class: 'draw-stage' }, canvas);
    const trayEl = h('div', { class: 'draw-tray', role: 'group', 'aria-label': 'Palette' });
    const toolbar = h('div', {
      class: 'draw-toolbar',
      role: 'toolbar',
      'aria-label': 'Draw tools',
    });
    shell.replaceChildren(
      h(
        'header',
        { class: 'topbar' },
        iconButton('back', 'Back to gallery', () => navigate('#/')),
        h('h1', { class: 'title' }, save.name),
        countEl,
        h('span', { class: 'spacer' }),
        h(
          'button',
          { type: 'button', class: 'chip', on: { click: () => openPartsSheet(save) } },
          'Parts',
        ),
        h(
          'button',
          { type: 'button', class: 'chip', on: { click: () => openGuideSheet(save) } },
          'Guide',
        ),
        settingsButton(),
      ),
      h('div', { class: 'draw-body' }, stage),
      toolbar,
      trayEl,
    );

    // ---- board, tray, session events ----------------------------------------
    const board = new DrawBoard(canvas);
    board.setData(save, session.primary);
    board.resize();
    const ro =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => board.resize()) : null;
    ro?.observe(stage);

    const tray: DrawTrayHandle = createDrawTray(trayEl, session, save.paletteMode, (c) => {
      selectColor(c);
    });
    const selectColor = (c: number): void => {
      session.setPrimary(c);
      board.setPreviewValue(c);
      tray.refresh();
    };

    const syncCount = (): void => {
      const dots = session.usageCounts().reduce((a, b) => a + b, 0);
      countEl.textContent = `${dots} dots`;
    };
    const undoBtn = iconButton('undo', 'Undo', () => historyStep(() => session.undo()));
    const redoBtn = iconButton('redo', 'Redo', () => historyStep(() => session.redo()));
    const syncHistoryButtons = (): void => {
      undoBtn.disabled = !session.canUndo;
      redoBtn.disabled = !session.canRedo;
    };
    const historyStep = (step: () => boolean): void => {
      if (!step()) return;
      syncCount();
      syncHistoryButtons();
      schedulePersist();
    };

    let lastSound = 0;
    const placeFeedback = (): void => {
      const t = performance.now();
      if (t - lastSound < SOUND_GAP_MS) return;
      lastSound = t;
      play('place');
      haptic('place');
    };
    const onEvent = (e: DrawEvent): void => {
      if (e.type === 'cells') {
        board.drawCells(e.changes);
        if (e.cause === 'draw') placeFeedback();
      }
      tray.refresh();
      syncCount();
      syncHistoryButtons();
      schedulePersist();
    };
    const offEvent = session.onChange(onEvent);

    // ---- toolbar ------------------------------------------------------------
    const toolBtns = new Map<EditorTool, HTMLButtonElement>();
    const addToggle = (
      t: EditorTool,
      label: string,
      icon: Parameters<typeof iconButton>[0],
    ): void => {
      const b = iconButton(icon, label, () => setTool(t), 'icon-btn tool');
      b.setAttribute('aria-pressed', 'false');
      toolBtns.set(t, b);
      toolbar.append(b);
    };
    for (const t of TOOLS) addToggle(t.id, t.label, t.icon);
    addToggle('pan', 'Pan', 'move');
    addToggle('eraser', 'Eraser', 'eraser');
    toolbar.append(undoBtn, redoBtn);
    const clearBtn = iconButton('trash', 'Clear all', async () => {
      const ok = await confirmDialog(
        'Clear all?',
        'Every dot will be removed. You can undo this.',
        'Clear',
      );
      if (!ok) return;
      if (session.clearAll()) schedulePersist();
      syncCount();
      syncHistoryButtons();
    });
    const helpBtn = iconButton('bulb', 'Draw help', () => {
      openSheet(
        'Draw help',
        h(
          'div',
          { class: 'confirm' },
          h(
            'p',
            { class: 'muted small' },
            'Brush draws freehand; Line, Box, Ellipse and Polygon drag or tap out shapes. Fill floods a region with the selected color. The eyedropper picks a placed color. The eraser paints the background (or removes dots when the background is None). Right-click always erases.',
          ),
          h(
            'p',
            { class: 'muted small' },
            'One finger draws, two fingers pan and pinch-zoom, and a double-tap switches between fit-to-screen and full size. Mirror buttons paint the opposite side as you draw. With a mouse, shift-drag pans and hovering shows what the tool will paint.',
          ),
        ),
      );
    });
    const closeBtn = h('button', { type: 'button', class: 'chip', hidden: true }, 'Close shape');
    closeBtn.addEventListener('click', () => {
      board.setPreview(null);
      board.requestDraw();
      if (session.commitShape()) schedulePersist();
      syncCount();
      syncHistoryButtons();
      syncToolButtons();
    });
    toolbar.append(closeBtn, clearBtn, helpBtn);

    // Contextual controls: size, tip, fill/stroke, mirror.
    const ctxRow = h('div', { class: 'draw-toolbar' });
    const chipBtn = (label: string, onClick: () => void): HTMLButtonElement => {
      const b = h('button', { type: 'button', class: 'chip' }, label);
      b.addEventListener('click', onClick);
      return b;
    };
    for (const size of [1, 3, 5, 7, 9]) {
      const b = chipBtn(String(size), () => {
        session.setBrushSize(size);
        syncContextRow();
      });
      b.dataset.size = String(size);
      ctxRow.append(b);
    }
    const tipBtn = chipBtn(session.brushTip === 'round' ? 'Round' : 'Square', () => {
      session.setBrushTip(session.brushTip === 'round' ? 'square' : 'round');
      syncContextRow();
    });
    ctxRow.append(tipBtn);
    const fillBtn = chipBtn(session.filled ? 'Fill' : 'Outline', () => {
      session.setFilled(!session.filled);
      syncContextRow();
    });
    ctxRow.append(fillBtn);
    const mirrorV = chipBtn('Mirror ↔', () => {
      session.setSymmetry(session.symmetry === 'vertical' ? 'none' : 'vertical');
      syncContextRow();
    });
    const mirrorH = chipBtn('Mirror ↕', () => {
      session.setSymmetry(session.symmetry === 'horizontal' ? 'none' : 'horizontal');
      syncContextRow();
    });
    ctxRow.append(mirrorV, mirrorH);
    toolbar.after(ctxRow);

    const syncContextRow = (): void => {
      for (const b of ctxRow.querySelectorAll<HTMLButtonElement>('[data-size]')) {
        const on = Number(b.dataset.size) === session.brushSize;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      tipBtn.textContent = session.brushTip === 'round' ? 'Round' : 'Square';
      fillBtn.textContent = session.filled ? 'Fill' : 'Outline';
      mirrorV.classList.toggle('on', session.symmetry === 'vertical');
      mirrorV.setAttribute('aria-pressed', String(session.symmetry === 'vertical'));
      mirrorH.classList.toggle('on', session.symmetry === 'horizontal');
      mirrorH.setAttribute('aria-pressed', String(session.symmetry === 'horizontal'));
      const shapes = tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'poly';
      const brushy = tool === 'brush' || tool === 'eraser';
      for (const b of ctxRow.querySelectorAll<HTMLButtonElement>('[data-size]')) {
        b.hidden = !brushy;
      }
      tipBtn.hidden = !brushy;
      fillBtn.hidden = !shapes;
      mirrorV.hidden = mirrorH.hidden = tool === 'pan';
    };
    const syncToolButtons = (): void => {
      for (const [t, b] of toolBtns) {
        b.setAttribute('aria-pressed', String(t === tool));
        b.classList.toggle('on', t === tool);
      }
      closeBtn.hidden = !(session.shapeActive && session.shapePointCount >= 3);
      canvas.classList.toggle('panning', tool === 'pan');
      syncContextRow();
    };
    const setTool = (t: EditorTool): void => {
      tool = t;
      if (session.shapeActive && t !== 'poly') {
        session.cancelShape();
        board.setPreview(null);
        board.requestDraw();
      }
      syncToolButtons();
    };

    // ---- pointer input ------------------------------------------------------
    let lastCell: { x: number; y: number } | null = null;
    let lastOpAt = 0;
    const strokeTo = (clientX: number, clientY: number): boolean => {
      const cell = board.hitTest(clientX, clientY);
      if (!cell) {
        lastCell = null;
        return false;
      }
      const path = lastCell ? lineCells(lastCell.x, lastCell.y, cell.x, cell.y) : [cell];
      const applied: DrawCellChange[] = [];
      for (const c of lastCell ? path.slice(1) : path) {
        if (session.strokeAt(c.x, c.y)) applied.push(...session.lastStrokeChanges);
      }
      if (applied.length > 0) board.drawCells(applied);
      lastCell = cell;
      return applied.length > 0;
    };
    const hit = (x: number, y: number): { x: number; y: number } | null => board.hitTest(x, y);
    const onStroke = (i: StrokeIntent): void => {
      if (i.type === 'strokeStart') {
        lastCell = null;
        const erase = tool === 'eraser' || i.erase;
        if (tool === 'fill' && !erase) {
          const c = hit(i.x, i.y);
          if (c && session.flood(c.x, c.y)) schedulePersist();
          syncCount();
          syncHistoryButtons();
        } else if (tool === 'pick' && !erase) {
          const c = hit(i.x, i.y);
          if (c) {
            const idx = session.pick(c.x, c.y);
            if (idx !== null) selectColor(idx);
          }
        } else if (tool === 'poly' && !erase) {
          const c = hit(i.x, i.y);
          if (c) {
            if (!session.shapeActive) session.beginShape('poly', c.x, c.y);
            else session.addPolyPoint(c.x, c.y);
            board.setPreview(session.shapePreview());
            board.requestDraw();
            syncToolButtons();
          }
        } else if ((tool === 'line' || tool === 'rect' || tool === 'ellipse') && !erase) {
          const c = hit(i.x, i.y);
          if (c) {
            session.beginShape(tool, c.x, c.y);
            board.setPreview([c]);
            board.requestDraw();
          }
        } else {
          session.beginStroke(erase ? 'erase' : 'paint');
          strokeTo(i.x, i.y);
        }
      } else if (i.type === 'strokeMove') {
        const dragging = tool === 'line' || tool === 'rect' || tool === 'ellipse';
        if (dragging && session.shapeActive) {
          for (const p of i.points) {
            const c = hit(p.x, p.y);
            if (c) {
              board.setPreview(session.updateShape(c.x, c.y));
              board.requestDraw();
            }
          }
        } else if (tool === 'poly' && session.shapeActive) {
          for (const p of i.points) {
            const c = hit(p.x, p.y);
            if (c) {
              board.setPreview(session.shapePreview());
              board.requestDraw();
            }
          }
        } else if (session.strokeActive) {
          let changed = false;
          for (const p of i.points) {
            if (strokeTo(p.x, p.y)) changed = true;
          }
          if (changed) {
            syncCount();
            schedulePersist();
          }
        }
      } else if (i.type === 'strokeEnd') {
        if (session.strokeActive) {
          session.endStroke();
          if (tool === 'brush' || tool === 'eraser') lastOpAt = Date.now();
          schedulePersist();
        } else if (session.shapeActive && tool !== 'poly') {
          board.setPreview(null);
          board.requestDraw();
          if (session.commitShape()) schedulePersist();
        }
        lastCell = null;
        syncCount();
        syncHistoryButtons();
        syncToolButtons();
      } else {
        // strokeCancel: a second finger, a pointercancel — never commit a shape.
        if (session.strokeActive) session.cancelStroke();
        if (session.shapeActive) {
          session.cancelShape();
          board.setPreview(null);
          board.requestDraw();
        }
        lastCell = null;
        syncCount();
        syncHistoryButtons();
        syncToolButtons();
      }
    };
    const onDoubleTap = (): void => {
      if (
        (tool === 'brush' || tool === 'eraser') &&
        Date.now() - lastOpAt < 450 &&
        session.canUndo
      ) {
        session.undo(); // the first tap's dot goes with the zoom gesture
        syncCount();
        syncHistoryButtons();
        schedulePersist();
      }
      const vp = board.getViewport();
      const target = vp.scale > 1.01 ? 1 : Math.min(4, board.oneToOneScale());
      const { width, height } = board.getSize();
      const z = zoomViewportAt(vp, target / vp.scale, width / 2, height / 2);
      board.setViewport(z.scale, z.offsetX, z.offsetY);
      board.draw();
    };
    const unbindInput = bindDrawInput(canvas, board, {
      canPaint: (erase) => erase || tool !== 'pan',
      panMode: () => tool === 'pan',
      onStroke,
      onDoubleTap,
      onHover: (x, y) => {
        if (session.strokeActive || session.shapeActive) return;
        const c = hit(x, y);
        let cells: GridCell[] | null = null;
        if (c) {
          if (tool === 'brush' || tool === 'eraser') {
            cells = brushCells(c.x, c.y, session.brushSize, session.brushTip);
          } else if (tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'poly') {
            cells = [c];
          }
        }
        board.setPreview(cells);
        board.requestDraw();
      },
      onHoverEnd: () => {
        if (session.strokeActive || session.shapeActive) return;
        board.setPreview(null);
        board.requestDraw();
      },
    });

    // ---- keyboard -----------------------------------------------------------
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        (e.shiftKey ? redoBtn : undoBtn).click();
      } else if (e.key === 'Escape' && !session.shapeActive) {
        navigate('#/');
      } else if (e.key === 'Escape' && session.shapeActive) {
        session.cancelShape();
        board.setPreview(null);
        board.requestDraw();
        syncToolButtons();
      }
    };
    document.addEventListener('keydown', onKey);

    // ---- go -----------------------------------------------------------------
    syncCount();
    syncHistoryButtons();
    syncToolButtons();
    tray.refresh();

    return () => {
      unbindInput();
      flushPersist();
      offEvent();
      tray.dispose();
      ro?.disconnect();
      board.destroy();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  };

  return () => {
    alive = false;
    teardown();
  };
}
