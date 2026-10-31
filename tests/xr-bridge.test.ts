import { describe, expect, it, vi } from 'vitest';
import { PanelSession } from '../src/game/panelSession';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../src/types';
import { createBridge } from '../src/xr/bridge';

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
      { hex: '#ff0000', name: 'Red' },
      { hex: '#00ff00', name: 'Green' },
      { hex: '#0000ff', name: 'Blue' },
    ],
    paletteMode: 'lego',
    origin: 'photo',
    target,
    placed: new Uint8Array(n).fill(EMPTY),
    panelElapsedMs: [0],
  };
};

describe('createBridge', () => {
  it('commits strokes with store mutations identical to the 2D path', () => {
    const a = new PanelSession(makeSave(), 0);
    const b = new PanelSession(makeSave(), 0);
    const persist = vi.fn();
    const bridge = createBridge({ session: a, selected: () => 1, persist });

    b.beginStroke('paint', 1);
    expect(b.applyAt(0, 0)).toBe(true);
    expect(b.applyAt(1, 0)).toBe(true);
    expect(b.applyAt(2, 0)).toBe(true);
    b.endStroke();

    bridge.beginStroke('paint', bridge.selected());
    expect(bridge.applyCell(0, 0)).toBe(true);
    expect(bridge.applyCell(1, 0)).toBe(true);
    expect(bridge.applyCell(2, 0)).toBe(true);
    bridge.endStroke();

    expect(Array.from(a.save.placed)).toEqual(Array.from(b.save.placed));
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('matches 2D undo/redo parity and persists after each', () => {
    const a = new PanelSession(makeSave(), 0);
    const bridge = createBridge({ session: a, selected: () => 0, persist: vi.fn() });
    bridge.beginStroke('paint', 0);
    bridge.applyCell(0, 0);
    bridge.applyCell(1, 0);
    bridge.endStroke();
    expect(a.save.placed[0]).not.toBe(EMPTY);
    expect(bridge.undo()).toBe(true);
    expect(a.save.placed[0]).toBe(EMPTY);
    expect(bridge.undo()).toBe(false);
    expect(bridge.redo()).toBe(true);
    expect(a.save.placed[0]).not.toBe(EMPTY);
  });

  it('exposes tray queries and change events', () => {
    const a = new PanelSession(makeSave(), 0);
    const bridge = createBridge({ session: a, selected: () => 0, persist: vi.fn() });
    expect(bridge.trayColors()).toEqual([0, 1, 2]);
    expect(bridge.availableFor(0)).toBeGreaterThan(0);
    expect(bridge.isComplete()).toBe(false);
    const events: string[] = [];
    bridge.onChange((e) => events.push(e.type));
    bridge.beginStroke('paint', 0);
    bridge.applyCell(0, 0);
    bridge.endStroke();
    expect(events).toContain('placed');
  });

  it('sweep lines apply through lineCells including gap fills', () => {
    const a = new PanelSession(makeSave(), 0);
    const bridge = createBridge({ session: a, selected: () => 2, persist: vi.fn() });
    bridge.beginStroke('paint', 2);
    expect(bridge.applyLine(0, 0, 4, 0)).toBe(true);
    bridge.endStroke();
    expect(a.save.placed[0]).toBe(2);
    expect(a.save.placed[4]).toBe(2);
    expect(a.save.placed[2]).toBe(2);
  });
});
