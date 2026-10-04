// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/saves', () => ({
  loadSave: vi.fn(),
  persistSave: vi.fn(async () => undefined),
}));

// happy-dom has no 2D context; stub it before the editor module is used. drawImage calls are
// counted so paint-during-stroke tests can assert real repaints happened.
let drawImages = 0;
const drawImageCount = (): number => drawImages;
const ctxStub = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === 'drawImage') return () => void drawImages++;
      return () => ctxStub;
    },
    set: () => true,
  },
) as unknown as CanvasRenderingContext2D;
HTMLCanvasElement.prototype.getContext = (() =>
  ctxStub) as unknown as typeof HTMLCanvasElement.prototype.getContext;
// Fixed geometry so the board lays out real cells and hit tests map client points to studs.
HTMLCanvasElement.prototype.getBoundingClientRect = function (): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 536,
    bottom: 536,
    width: 536,
    height: 536,
    toJSON: () => ({}),
  } as DOMRect;
};

const { loadSave, persistSave } = await import('../src/ui/saves');
const { mountDrawEditor } = await import('../src/ui/drawEditor');

import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';

function drawnSave(): PictureSave {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: 'd1',
    createdAt: 1,
    updatedAt: 1,
    name: 'doodle',
    sourceImageId: '',
    aspect: '1:1',
    paletteMode: 'lego',
    origin: 'drawn',
    palette: [
      { hex: '#05131d', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
    ],
    width: 48,
    height: 48,
    target: new Uint8Array(48 * 48).fill(EMPTY),
    placed: new Uint8Array(48 * 48).fill(EMPTY),
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

function makeCtx(): { ctx: import('../src/ui/screen').ScreenContext; calls: string[] } {
  const calls: string[] = [];
  return {
    ctx: { root: document.body, navigate: (hash: string) => void calls.push(hash) },
    calls,
  };
}

async function addColorViaSheet(): Promise<void> {
  (document.querySelector('[aria-label="Add color"]') as HTMLButtonElement).click();
  const red = [...document.querySelectorAll<HTMLButtonElement>('.sheet button')].find(
    (b) => b.getAttribute('title') === 'Red',
  ) as HTMLButtonElement;
  red.click();
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.mocked(persistSave).mockClear();
  drawImages = 0;
});

describe('mountDrawEditor', () => {
  it('redirects unknown ids to the gallery with a toast', async () => {
    vi.mocked(loadSave).mockResolvedValue(undefined);
    const { ctx, calls } = makeCtx();
    mountDrawEditor(ctx, 'nope');
    await vi.waitFor(() => expect(calls).toContain('#/'));
  });

  it('redirects photo saves to their overview', async () => {
    const save = drawnSave();
    save.origin = 'photo';
    save.id = 'p1';
    vi.mocked(loadSave).mockResolvedValue(save);
    const { ctx, calls } = makeCtx();
    mountDrawEditor(ctx, 'p1');
    await vi.waitFor(() => expect(calls).toContain('#/play/p1'));
  });

  it('mounts the editor with a zero counter and no write until dirty', async () => {
    const save = drawnSave();
    vi.mocked(loadSave).mockResolvedValue(save);
    const { ctx } = makeCtx();
    const cleanup = mountDrawEditor(ctx, save.id);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLCanvasElement>('.draw-canvas')).toBeTruthy(),
    );
    expect(document.querySelector('.draw-count')?.textContent).toBe('0 dots');
    cleanup();
    expect(persistSave).not.toHaveBeenCalled();
  });

  it('flushes a dirty save on cleanup', async () => {
    const save = drawnSave();
    vi.mocked(loadSave).mockResolvedValue(save);
    const { ctx } = makeCtx();
    const cleanup = mountDrawEditor(ctx, save.id);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLCanvasElement>('.draw-canvas')).toBeTruthy(),
    );
    await addColorViaSheet();
    expect(save.palette).toHaveLength(3);
    expect(persistSave).not.toHaveBeenCalled(); // debounce has not fired
    cleanup();
    expect(persistSave).toHaveBeenCalledWith(save);
  });

  it('flushes a dirty save when the page hides', async () => {
    const save = drawnSave();
    vi.mocked(loadSave).mockResolvedValue(save);
    const { ctx } = makeCtx();
    const cleanup = mountDrawEditor(ctx, save.id);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLCanvasElement>('.draw-canvas')).toBeTruthy(),
    );
    await addColorViaSheet();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(persistSave).toHaveBeenCalledWith(save);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    cleanup();
  });

  it('refreshes tray usage counts as cells change', async () => {
    const save = drawnSave();
    vi.mocked(loadSave).mockResolvedValue(save);
    const { ctx } = makeCtx();
    const cleanup = mountDrawEditor(ctx, save.id);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLCanvasElement>('.draw-canvas')).toBeTruthy(),
    );
    const canvas = document.querySelector<HTMLCanvasElement>('.draw-canvas') as HTMLCanvasElement;
    const opts = { pointerId: 1, button: 0, pointerType: 'mouse', bubbles: true } as const;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: 50, clientY: 50 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 64, clientY: 50 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: 64, clientY: 50 }));
    const first = document.querySelector('.draw-swatches .swatch') as HTMLElement;
    expect(first.getAttribute('aria-label')).toMatch(/, [1-9]\d* dots/);
    expect(document.querySelector('.draw-count')?.textContent).toMatch(/^[1-9]\d* dots$/);
    cleanup();
    expect(persistSave).toHaveBeenCalledWith(save);
  });

  it('paints ink live during a brush stroke, before the pointer lifts', async () => {
    const save = drawnSave();
    vi.mocked(loadSave).mockResolvedValue(save);
    const { ctx } = makeCtx();
    const cleanup = mountDrawEditor(ctx, save.id);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLCanvasElement>('.draw-canvas')).toBeTruthy(),
    );
    const canvas = document.querySelector<HTMLCanvasElement>('.draw-canvas') as HTMLCanvasElement;
    const opts = { pointerId: 1, button: 0, pointerType: 'mouse', bubbles: true } as const;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: 50, clientY: 50 }));
    const afterDown = drawImageCount();
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 64, clientY: 50 }));
    expect(drawImageCount()).toBeGreaterThan(afterDown);
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: 64, clientY: 50 }));
    cleanup();
    expect(save.placed.some((v) => v !== EMPTY)).toBe(true);
  });

  it('schedules a repaint for the line-tool preview while dragging', async () => {
    const save = drawnSave();
    vi.mocked(loadSave).mockResolvedValue(save);
    const { ctx } = makeCtx();
    const cleanup = mountDrawEditor(ctx, save.id);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLCanvasElement>('.draw-canvas')).toBeTruthy(),
    );
    const canvas = document.querySelector<HTMLCanvasElement>('.draw-canvas') as HTMLCanvasElement;
    (
      document.querySelector<HTMLButtonElement>('button[aria-label="Line"]') as HTMLButtonElement
    ).click();
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const opts = { pointerId: 1, button: 0, pointerType: 'mouse', bubbles: true } as const;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: 50, clientY: 50 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 200, clientY: 200 }));
    expect(raf).toHaveBeenCalled();
    raf.mockRestore();
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: 200, clientY: 200 }));
    cleanup();
  });
});
