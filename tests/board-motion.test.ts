import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardRenderer } from '../src/render/boardRenderer';

class FakeGradient {
  addColorStop(): void {}
}

class FakeContext {
  readonly canvas: FakeCanvas;
  clearCalls = 0;
  fillRects = 0;
  globalAlpha = 1;
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  lineWidth = 1;
  font = '';
  textAlign = 'left';
  textBaseline = 'alphabetic';

  constructor(canvas: FakeCanvas) {
    this.canvas = canvas;
  }

  setTransform(): void {}
  clearRect(): void {
    this.clearCalls++;
  }
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  closePath(): void {}
  rect(): void {}
  clip(): void {}
  drawImage(): void {}
  fillRect(): void {
    this.fillRects++;
  }
  arc(): void {}
  arcTo(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  fill(): void {}
  fillText(): void {}
  setLineDash(): void {}
  createLinearGradient(): FakeGradient {
    return new FakeGradient();
  }
  createRadialGradient(): FakeGradient {
    return new FakeGradient();
  }
}

class FakeCanvas {
  width = 320;
  height = 320;
  readonly clientWidth = 320;
  readonly clientHeight = 320;
  readonly context: FakeContext;

  constructor() {
    this.context = new FakeContext(this);
  }

  getContext(): FakeContext {
    return this.context;
  }

  getBoundingClientRect(): DOMRect {
    return { width: 320, height: 320, left: 0, top: 0 } as DOMRect;
  }
}

describe('BoardRenderer motion lifecycle', () => {
  let clock = 0;
  let reduced = false;
  let nextFrame = 1;
  let frames = new Map<number, FrameRequestCallback>();
  let originalDocument: Document | undefined;
  let originalRaf: typeof requestAnimationFrame | undefined;
  let originalCancel: typeof cancelAnimationFrame | undefined;
  let originalMatchMedia: typeof matchMedia | undefined;

  beforeEach(() => {
    clock = 0;
    reduced = false;
    nextFrame = 1;
    frames = new Map();
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    originalDocument = globalThis.document;
    originalRaf = globalThis.requestAnimationFrame;
    originalCancel = globalThis.cancelAnimationFrame;
    originalMatchMedia = globalThis.matchMedia;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => new FakeCanvas() },
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      },
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: (id: number) => frames.delete(id),
    });
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: reduced }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: originalRaf,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: originalCancel,
    });
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function createBoard(): { board: BoardRenderer; context: FakeContext } {
    const canvas = new FakeCanvas();
    const board = new BoardRenderer(canvas as unknown as HTMLCanvasElement);
    board.setData(
      () => ({ placed: 0, target: 1 }),
      [
        { hex: '#237841', name: 'green' },
        { hex: '#ffffff', name: 'white' },
      ],
      ['A', 'B'],
    );
    return { board, context: canvas.context };
  }

  function frameAt(ms: number): void {
    clock = ms;
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(ms);
  }

  it('repaints the exact final overlay frame and becomes idle', () => {
    const { board, context } = createBoard();
    board.setOverlay(true);
    expect(frames.size).toBe(1);
    const before = context.clearCalls;
    frameAt(160);
    expect(context.clearCalls).toBe(before + 1);
    expect(frames.size).toBe(0);

    board.setOverlay(false);
    const beforeHide = context.clearCalls;
    frameAt(320);
    expect(context.clearCalls).toBe(beforeHide + 1);
    expect(frames.size).toBe(0);
    board.destroy();
  });

  it('shares completion promises and resolves on destroy while cancelling the loop', async () => {
    const { board } = createBoard();
    const first = board.completeAnim();
    expect(board.completeAnim()).toBe(first);
    expect(frames.size).toBe(1);
    board.destroy();
    await expect(first).resolves.toBeUndefined();
    expect(frames.size).toBe(0);
  });

  it('resolves the completion sweep and leaves no pending frame', async () => {
    const { board, context } = createBoard();
    const promise = board.completeAnim();
    const fillsBefore = context.fillRects;
    frameAt(300);
    expect(context.fillRects).toBeGreaterThan(fillsBefore);
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    frameAt(600);
    await Promise.resolve();
    expect(settled).toBe(true);
    expect(frames.size).toBe(0);
    board.destroy();
  });

  it('bypasses animation when reduced motion is enabled', async () => {
    reduced = true;
    const { board } = createBoard();
    const promise = board.completeAnim();
    await expect(promise).resolves.toBeUndefined();
    expect(frames.size).toBe(0);
    board.setOverlay(true);
    expect(frames.size).toBe(0);
    board.destroy();
  });
});
