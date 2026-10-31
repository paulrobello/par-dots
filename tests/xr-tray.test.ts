import { describe, expect, it, vi } from 'vitest';
import { PanelSession } from '../src/game/panelSession';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../src/types';
import { createBridge } from '../src/xr/bridge';
import { chipStates } from '../src/xr/tray';

const makeSave = (mutate?: (save: PictureSave) => void): PictureSave => {
  const n = PANEL_SIZE * PANEL_SIZE;
  const target = new Uint8Array(n);
  for (let i = 0; i < n; i++) target[i] = i % 3;
  const save: PictureSave = {
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
  mutate?.(save);
  return save;
};

const bridgeOf = (save: PictureSave, selected = 0) =>
  createBridge({ session: new PanelSession(save, 0), selected: () => selected, persist: vi.fn() });

describe('chipStates parity with the 2D tray', () => {
  it('fresh panel: every color listed, full counts, none dimmed', () => {
    const save = makeSave();
    const counts = { 0: 86, 1: 85, 2: 85 };
    const bridge = bridgeOf(save);
    const states = chipStates(bridge, 0);
    expect(states.map((s) => s.c)).toEqual([0, 1, 2]);
    for (const s of states) {
      expect(s.count).toBe(counts[s.c as 0 | 1 | 2]);
      expect(s.dimmed).toBe(false);
    }
    expect(states.find((s) => s.selected)?.c).toBe(0);
  });

  it('mid-build: listed colors and counts match availableFor', () => {
    const save = makeSave();
    const session = new PanelSession(save, 0);
    session.beginStroke('paint', 2);
    session.applyAt(0, 0);
    session.applyAt(1, 0);
    session.endStroke();
    const bridge = createBridge({ session, selected: () => 1, persist: vi.fn() });
    const states = chipStates(bridge, 1);
    expect(states.find((s) => s.c === 2)?.count).toBe(83);
    expect(states.find((s) => s.c === 2)?.dimmed).toBe(false);
    expect(states.find((s) => s.c === 1)?.selected).toBe(true);
  });

  it('zero-but-wrong: color stays listed and dimmed', () => {
    const save = makeSave();
    save.placed.set(save.target);
    const zeroAt = save.target.findIndex((t) => t === 0);
    const oneAt = save.target.findIndex((t) => t === 1);
    save.placed[zeroAt] = 1;
    save.placed[oneAt] = 0;
    const session = new PanelSession(save, 0);
    const bridge = createBridge({ session, selected: () => 0, persist: vi.fn() });
    const zeroWrong = chipStates(bridge, 0).find((s) => s.c === 0);
    expect(zeroWrong).toBeDefined();
    expect(zeroWrong?.count).toBeLessThanOrEqual(0);
    expect(zeroWrong?.dimmed).toBe(true);
  });

  it('complete panel: tray is empty', () => {
    const save = makeSave((s) => {
      s.placed.set(s.target);
    });
    const bridge = bridgeOf(save);
    expect(chipStates(bridge, 0)).toEqual([]);
  });

  it('selection mirrors through the shared bridge accessor', () => {
    const bridge = bridgeOf(makeSave(), 2);
    expect(chipStates(bridge, 2).find((s) => s.selected)?.c).toBe(2);
  });
});
