// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { DrawBoard } from '../src/render/drawBoard';
import { bindDrawInput, type DrawInputOptions } from '../src/ui/drawInput';

function setup() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const board = {
    getSize: () => ({ width: 500, height: 500 }),
    getViewport: () => ({ scale: 2, offsetX: -100, offsetY: -100 }),
    setViewport: vi.fn(),
    draw: vi.fn(),
  } as unknown as DrawBoard;
  const opts: DrawInputOptions = {
    canPaint: () => true,
    panMode: () => false,
    onStroke: vi.fn(),
    onDoubleTap: vi.fn(),
    onHover: vi.fn(),
    onHoverEnd: vi.fn(),
  };
  const off = bindDrawInput(canvas, board, opts);
  const ev = (type: string, init: PointerEventInit): void => {
    canvas.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', bubbles: true, ...init }),
    );
  };
  return { canvas, board, opts, off, ev };
}

describe('bindDrawInput', () => {
  it('shift+left-drag pans and never starts a stroke', () => {
    const { board, opts, off, ev } = setup();
    ev('pointerdown', { button: 0, buttons: 1, shiftKey: true, clientX: 100, clientY: 100 });
    ev('pointermove', { button: 0, buttons: 1, shiftKey: true, clientX: 90, clientY: 95 });
    expect(board.setViewport).toHaveBeenCalledWith(2, -110, -105);
    ev('pointerup', { button: 0, buttons: 0, clientX: 90, clientY: 95 });
    expect(opts.onStroke).not.toHaveBeenCalled();
    off();
  });

  it('fires onHover for a buttonless mouse move and onHoverEnd on leave', () => {
    const { opts, off, ev } = setup();
    ev('pointermove', { buttons: 0, clientX: 30, clientY: 40 });
    expect(opts.onHover).toHaveBeenCalledWith(30, 40);
    ev('pointerleave', {});
    expect(opts.onHoverEnd).toHaveBeenCalled();
    off();
  });
});
