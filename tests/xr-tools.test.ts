// @vitest-environment happy-dom

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PanelSession } from '../src/game/panelSession';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../src/types';
import { createBridge } from '../src/xr/bridge';
import { createTools, nextBuzz } from '../src/xr/tools';

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
