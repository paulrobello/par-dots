// @vitest-environment happy-dom

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelSession } from '../src/game/panelSession';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../src/types';
import { createBridge } from '../src/xr/bridge';
import { createTools, nextBuzz, TOOL_ORDER, type ToolId } from '../src/xr/tools';

describe('nextBuzz', () => {
  it('re-arms whenever the panel is not full-but-wrong', () => {
    expect(nextBuzz(false, false)).toBe(true);
    expect(nextBuzz(false, true)).toBe(true);
    expect(nextBuzz(true, false)).toBe(true);
    expect(nextBuzz(true, true)).toBe(false);
  });
});

describe('createTools', () => {
  it('builds one button per tool and hit-tests by ray', () => {
    const tools = createTools();
    tools.root.updateWorldMatrix(true, true);
    const origin = new THREE.Vector3(0, 0, 0.2);
    const at = (x: number): { origin: THREE.Vector3; dir: THREE.Vector3 } => ({
      origin,
      dir: new THREE.Vector3(x, 0, -0.2).normalize(),
    });
    expect(tools.pickTool(at(-0.124))).toBe('place');
    expect(tools.pickTool(at(-0.062))).toBe('remove');
    expect(tools.pickTool(at(0))).toBe('hint');
    expect(tools.pickTool(at(0.062))).toBe('undo');
    expect(tools.pickTool(at(0.124))).toBe('redo');
    expect(tools.pickTool({ origin, dir: new THREE.Vector3(0, 0.5, -1).normalize() })).toBeNull();
    tools.dispose();
  });
});

describe('createTools strip texture and flash (recording 2D context)', () => {
  interface PaintLog {
    texts: string[];
    /** roundRect+fill calls with the fillStyle active at roundRect time. */
    buttons: Array<{ x: number; y: number; w: number; h: number; style: string }>;
  }
  let log: PaintLog;

  beforeEach(() => {
    log = { texts: [], buttons: [] };
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string,
      options?: ElementCreationOptions,
    ) => {
      const el = orig(tag, options);
      if (tag === 'canvas') {
        const ctx = {
          canvas: null,
          fillStyle: '#000000',
          font: '',
          textAlign: '',
          textBaseline: '',
          clearRect: () => undefined,
          beginPath: () => undefined,
          roundRect: (x: number, y: number, w: number, h: number) => {
            log.buttons.push({ x, y, w, h, style: String(ctx.fillStyle) });
          },
          fill: () => undefined,
          fillText: (text: string) => {
            log.texts.push(text);
          },
        } as unknown as CanvasRenderingContext2D;
        (el as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () => ctx;
      }
      return el;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('paints each button exactly in the texture slot its pick zone occupies', () => {
    const tools = createTools();
    const strip = tools.root.children.find((o) => o.name === 'xr-tools-strip') as THREE.Mesh;
    const { width: planeW } = (strip.geometry as THREE.PlaneGeometry).parameters;
    expect(planeW).toBeGreaterThan(0);
    expect((strip.material as THREE.MeshStandardMaterial).transparent).toBe(true);
    log.buttons.forEach((b, i) => {
      const paintedCenterCanvasPx = b.x + b.w / 2;
      const world = (paintedCenterCanvasPx / (128 * TOOL_ORDER.length) - 0.5) * planeW;
      expect(world).toBeCloseTo((i - 2) * 0.062, 5);
      expect((b.w / (128 * TOOL_ORDER.length)) * planeW).toBeCloseTo(0.05, 5);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(640);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h).toBeLessThanOrEqual(128);
    });
    expect(log.buttons).toHaveLength(TOOL_ORDER.length);
    tools.dispose();
  });

  it('flash highlights the given tool and restores it when the timer fires', () => {
    vi.useFakeTimers();
    try {
      const tools = createTools();
      tools.flash('undo');
      const lastPaintOf = (id: ToolId): string => {
        const i = TOOL_ORDER.indexOf(id);
        return log.buttons.filter((_, bi) => bi % TOOL_ORDER.length === i).at(-1)!.style;
      };
      expect(lastPaintOf('undo')).toBe('#4d8dff');
      expect(lastPaintOf('place')).toBe('#4d8dff'); // still the active tool
      vi.advanceTimersByTime(180);
      expect(lastPaintOf('undo')).toBe('#2a2d31');
      expect(lastPaintOf('place')).toBe('#4d8dff');
      tools.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-flashing replaces the pending timer and dispose cancels it', () => {
    vi.useFakeTimers();
    try {
      const tools = createTools();
      tools.flash('hint');
      vi.advanceTimersByTime(100);
      tools.flash('hint');
      vi.advanceTimersByTime(179);
      const i = TOOL_ORDER.indexOf('hint');
      expect(log.buttons.filter((_, bi) => bi % TOOL_ORDER.length === i).at(-1)!.style).toBe(
        '#4d8dff',
      );
      vi.advanceTimersByTime(1);
      expect(log.buttons.filter((_, bi) => bi % TOOL_ORDER.length === i).at(-1)!.style).toBe(
        '#2a2d31',
      );
      tools.flash('redo');
      const paints = log.buttons.length;
      tools.dispose();
      vi.advanceTimersByTime(1000);
      expect(log.buttons).toHaveLength(paints);
    } finally {
      vi.useRealTimers();
    }
  });

  it('picks tools through a rotated, translated root', () => {
    const tools = createTools();
    tools.root.position.set(0.3, 1.1, -0.4);
    tools.root.rotation.y = Math.PI / 6;
    tools.root.updateWorldMatrix(true, true);
    const v = new THREE.Vector3();
    /** World ray along the strip's facing direction at a local strip point. */
    const rayAt = (lx: number, ly: number): { origin: THREE.Vector3; dir: THREE.Vector3 } => ({
      origin: v.set(lx, ly, 0.2).applyMatrix4(tools.root.matrixWorld).clone(),
      dir: new THREE.Vector3(0, 0, -1).transformDirection(tools.root.matrixWorld),
    });
    expect(tools.pickTool(rayAt(0, 0))).toBe('hint');
    expect(tools.pickTool(rayAt(-0.124, 0))).toBe('place');
    expect(tools.pickTool(rayAt(0.124, 0))).toBe('redo');
    expect(tools.pickTool(rayAt(0, 0.03))).toBeNull();
    tools.dispose();
  });
});

describe('remove strokes through the bridge', () => {
  const makeSave = (): PictureSave => {
    const n = PANEL_SIZE * PANEL_SIZE;
    const target = new Uint8Array(n);
    for (let i = 0; i < n; i++) target[i] = i % 3;
    return {
      schemaVersion: 2,
      id: 't1',
      createdAt: 1,
      updatedAt: 1,
      name: 't',
      sourceImageId: 'img',
      aspect: '1:1',
      width: PANEL_SIZE,
      height: PANEL_SIZE,
      palette: [
        { hex: '#101010', name: 'Dark' },
        { hex: '#eeeeee', name: 'Light' },
        { hex: '#3366cc', name: 'Blue' },
      ],
      paletteMode: 'lego',
      origin: 'photo',
      target,
      placed: new Uint8Array(n).fill(EMPTY),
      panelElapsedMs: [0],
    };
  };

  it('removes correct and incorrect dots, one move per stroke', () => {
    const save = makeSave();
    const session = new PanelSession(save, 0);
    session.beginStroke('paint', 1);
    session.applyAt(0, 0);
    session.applyAt(1, 0);
    session.endStroke();
    const wrongCount = [...save.placed].filter(
      (p, i) => p !== EMPTY && p !== save.target[i],
    ).length;
    expect(wrongCount).toBe(1);
    const bridge = createBridge({ session, selected: () => 0, persist: vi.fn() });
    bridge.beginStroke('remove');
    expect(bridge.applyCell(0, 0)).toBe(true);
    expect(bridge.applyCell(1, 0)).toBe(true);
    bridge.endStroke();
    expect(save.placed[0]).toBe(EMPTY);
    expect(save.placed[1]).toBe(EMPTY);
  });
});
