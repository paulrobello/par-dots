/**
 * Binds a board canvas's pointer and wheel events to the gesture model, and applies pan,
 * zoom and pinch intents to the renderer's viewport. Stroke intents go to `onStroke`.
 */

import type { BoardRenderer } from '../render/boardRenderer';
import { zoomViewportAt } from '../render/layout';
import {
  type BoardGesturesOptions,
  createBoardGestures,
  type GestureIntent,
  type GesturePointer,
} from './gestures';

const MAX_ZOOM = 4;

export type StrokeIntent = Extract<
  GestureIntent,
  { type: 'strokeStart' | 'strokeMove' | 'strokeEnd' | 'strokeCancel' }
>;

export interface BoardInputOptions {
  canPaint: BoardGesturesOptions['canPaint'];
  panMode: BoardGesturesOptions['panMode'];
  onStroke: (intent: StrokeIntent) => void;
  onPinch: (down: boolean) => void;
}

/** Returns a cleanup that detaches listeners and drops any pending touch. */
export function bindBoardInput(
  canvas: HTMLCanvasElement,
  board: BoardRenderer,
  opts: BoardInputOptions,
): () => void {
  const gestures = createBoardGestures({
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    canPaint: opts.canPaint,
    panMode: opts.panMode,
  });
  const canvasPoint = (x: number, y: number): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: x - r.left, y: y - r.top };
  };
  const clampVp = (s: number, ox: number, oy: number): void => {
    const { width, height } = board.getSize();
    const cx = Math.min(0, Math.max(width - width * s, ox));
    const cy = Math.min(0, Math.max(height - height * s, oy));
    board.setViewport(s, cx, cy);
    board.draw();
  };
  const zoomAt = (factor: number, mx: number, my: number, dmx = 0, dmy = 0): void => {
    const z = zoomViewportAt(board.getViewport(), factor, mx, my, 1, MAX_ZOOM);
    clampVp(z.scale, z.offsetX + dmx, z.offsetY + dmy);
  };

  const offIntent = gestures.onIntent((i) => {
    switch (i.type) {
      case 'pan': {
        const vp = board.getViewport();
        clampVp(vp.scale, vp.offsetX + i.dx, vp.offsetY + i.dy);
        break;
      }
      case 'zoom': {
        const m = canvasPoint(i.mx, i.my);
        zoomAt(i.factor, m.x, m.y, i.dmx, i.dmy);
        break;
      }
      case 'pinchStart':
      case 'pinchEnd':
        opts.onPinch(i.type === 'pinchStart');
        break;
      default:
        opts.onStroke(i);
    }
  });

  const toPointer = (e: PointerEvent): GesturePointer => ({
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    type: e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse',
    erase: e.pointerType === 'mouse' && e.button === 2,
  });
  const onDown = (e: PointerEvent): void => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers may not be capturable.
    }
    gestures.down(toPointer(e));
  };
  const onMove = (e: PointerEvent): void => {
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    gestures.move(toPointer(e), coalesced.map(toPointer));
  };
  const onUp = (e: PointerEvent): void => gestures.up(toPointer(e), e.type !== 'pointerup');
  const onContextMenu = (e: MouseEvent): void => e.preventDefault();
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = canvasPoint(e.clientX, e.clientY);
    zoomAt(Math.exp(-e.deltaY * 0.002), p.x, p.y);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  return () => {
    gestures.dispose();
    offIntent();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
}
