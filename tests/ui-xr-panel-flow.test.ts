// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PictureSave } from '../src/types';

const state = vi.hoisted(() => ({
  save: null as PictureSave | null,
  worldDeps: [] as Array<any>,
  launchOpts: null as any,
  end: null as (() => void) | null,
  session: null as unknown as XRSession,
  snapshot: { plate: { pos: { x: 1, y: 2, z: 3 } }, tools: { pos: { x: 4, y: 5, z: 6 } } },
}));

vi.mock('../src/ui/saves', () => ({
  loadSave: vi.fn(async () => state.save),
  persistSave: vi.fn(async () => undefined),
}));
vi.mock('../src/render/boardRenderer', () => ({
  BoardRenderer: class {
    setData() {}
    resize() {}
    setViewport() {}
    setOverlay() {}
    clearHighlight() {}
    completeAnim() {
      return Promise.resolve();
    }
    destroy() {}
  },
}));
vi.mock('../src/ui/boardInput', () => ({ bindBoardInput: vi.fn(() => () => undefined) }));
vi.mock('../src/ui/playFeedback', () => ({
  bindPlayFeedback: vi.fn(() => ({
    checkFullButWrong: () => false,
    resyncCompleting() {},
    dispose() {},
  })),
}));
vi.mock('../src/ui/celebrate', () => ({ celebratePanel: vi.fn(async () => undefined) }));
vi.mock('../src/ui/install', () => ({ maybePromptInstall: vi.fn() }));
vi.mock('../src/ui/settingsSheet', () => ({ openSettingsSheet: vi.fn() }));
vi.mock('../src/ui/swUpdate', () => ({ setImmersiveActive: vi.fn() }));
vi.mock('../src/ui/panelTimer', () => ({
  createPanelTimer: vi.fn(() => ({
    elapsed: () => 0,
    flush: () => 17,
    stop: () => 23,
    setPaused() {},
    setVisible() {},
  })),
}));
vi.mock('../src/ui/playView', () => ({
  renderPlayView: vi.fn((shell: HTMLElement) => {
    const make = (tag: string): HTMLElement => document.createElement(tag);
    const boardCanvas = make('canvas') as HTMLCanvasElement;
    const boardWrap = make('div');
    boardWrap.append(boardCanvas);
    const tray = make('div');
    const playActions = make('div');
    shell.append(boardWrap, tray, playActions);
    return {
      boardCanvas,
      boardWrap,
      tray,
      playActions,
      hintBtn: make('button'),
      undoBtn: make('button'),
      redoBtn: make('button'),
      removeBtn: make('button'),
      moveBtn: make('button'),
      overlayBtn: make('button'),
      pctEl: make('span'),
      timeEl: make('span'),
    };
  }),
  createTrayView: vi.fn(() => ({
    sync() {},
    mark() {},
    scrollTo() {},
    setSymbols() {},
    dispose() {},
  })),
}));
vi.mock('../src/xr/session', () => ({
  xrSupport: vi.fn(async () => ({ vr: true, ar: false })),
  requestVrSession: vi.fn(async () => state.session),
}));
vi.mock('../src/xr/layout', () => ({ getLayout: vi.fn(() => null), setLayout: vi.fn() }));
vi.mock('../src/xr/scene', () => ({
  launchVr: vi.fn((session: XRSession, opts: any) => {
    state.launchOpts = opts;
    state.end = () => {
      opts.onEnd();
      session.dispatchEvent(new Event('end'));
    };
    opts.buildWorld({
      renderer: {
        xr: {
          setSession() {},
          getController: () => ({ userData: {} }),
          getControllerGrip: () => ({}),
          getCamera: () => ({ matrixWorld: {} }),
        },
        setAnimationLoop() {},
      },
      scene: { add() {} },
      render() {},
      dispose() {},
    });
    return { end: async () => state.end?.(), session };
  }),
}));
vi.mock('../src/xr/world', () => ({
  createPanelWorld: vi.fn((_studio: unknown, _xr: unknown, deps: any) => {
    state.worldDeps.push(deps);
    return { layout: () => state.snapshot, dispose() {}, update() {} };
  }),
  createSwapWorld: vi.fn((initial: any) => ({
    ...initial,
    swap: vi.fn((next: any) => Object.assign(initial, next)),
  })),
}));

import { mountPanelPlay } from '../src/ui/panelPlay';

const makeSave = (): PictureSave => ({
  schemaVersion: 2,
  id: 'pic',
  createdAt: 0,
  updatedAt: 0,
  name: 'Test',
  sourceImageId: 'x',
  aspect: '1:1',
  paletteMode: 'lego',
  origin: 'photo',
  width: 48,
  height: 48,
  palette: [
    { hex: '#000000', name: 'Black' },
    { hex: '#ffffff', name: 'White' },
  ],
  target: new Uint8Array(48 * 48),
  placed: new Uint8Array(48 * 48).fill(255),
  panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
});

beforeEach(() => {
  state.save = makeSave();
  state.worldDeps = [];
  state.launchOpts = null;
  state.end = null;
  Object.defineProperty(navigator, 'xr', {
    configurable: true,
    value: { isSessionSupported: async () => true, requestSession: async () => state.session },
  });
  state.session = new EventTarget() as XRSession;
  Object.defineProperty(state.session, 'inputSources', { value: [] });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('panel play XR flow', () => {
  it('carries the workspace when selecting another panel in the overview', async () => {
    const root = document.createElement('main');
    mountPanelPlay({ root, navigate: vi.fn() }, 'pic', 0);
    await vi.waitFor(() => expect(root.querySelector('[aria-label="Enter VR"]')).toBeTruthy());
    (root.querySelector('[aria-label="Enter VR"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(state.worldDeps).toHaveLength(1));
    state.worldDeps[0].onPanelSelect(2);
    await Promise.resolve();
    expect(state.worldDeps[1].sessionLayout).toEqual(state.snapshot);
  });

  it('keeps XR on completion, swaps to the next plate, and restores navigation on exit', async () => {
    const root = document.createElement('main');
    const navigate = vi.fn();
    mountPanelPlay({ root, navigate }, 'pic', 0);
    await vi.waitFor(() => expect(root.querySelector('[aria-label="Enter VR"]')).toBeTruthy());
    (root.querySelector('[aria-label="Enter VR"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(state.worldDeps).toHaveLength(1));

    const first = state.worldDeps[0].panel;
    first.beginStroke('paint', 0);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) first.applyAt(x, y);
    first.endStroke();
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    state.worldDeps[0].onComplete?.();
    state.worldDeps[0].onContinue?.();
    await Promise.resolve();
    expect(state.worldDeps).toHaveLength(2);
    expect(state.worldDeps[1].panel).not.toBe(first);
    expect(state.worldDeps[1].sessionLayout).toEqual(state.snapshot);
    state.worldDeps[1].persist();
    expect(state.save?.panelElapsedMs[1]).toBe(17);
    expect(state.end).not.toBeNull();

    state.end?.();
    expect(navigate).toHaveBeenCalledWith('#/play/pic/1', { replace: true });
  });
});
