import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EMPTY, PANEL_SIZE } from '../src/types';
import {
  cellFromLocal,
  createPlate,
  PITCH,
  PLATE_THICKNESS,
  type PlateSource,
  STUD_RADIUS,
  snapToEmpty,
  snapToOccupied,
} from '../src/xr/plate';

const cell = (x: number, y: number): { target: number; placed: number } => ({
  target: x % 3,
  placed: x === 0 && y === 0 ? 1 : EMPTY,
});

const source: PlateSource = { cellAt: (x, y) => cell(x, y) };

describe('cellFromLocal', () => {
  it('maps plate-local millimetres to cells', () => {
    expect(cellFromLocal(-0.0639, -0.0639)).toEqual({ x: 0, y: 0 });
    expect(cellFromLocal(0, 0)).toEqual({ x: 8, y: 8 });
    expect(cellFromLocal(0.064, 0.064)).toBeNull();
  });
});

describe('snapToEmpty', () => {
  it('returns the hit cell when empty', () => {
    const occ = (x: number, y: number): boolean => x === 4 && y === 4;
    expect(snapToEmpty({ x: 5, y: 5 }, occ)).toEqual({ x: 5, y: 5 });
  });

  it('snaps to the nearest empty within radius over occupied cells', () => {
    const occ = (): boolean => true;
    expect(snapToEmpty({ x: 4, y: 4 }, occ, 1)).toBeNull();
    const near = (x: number, y: number): boolean => !(x === 4 && y === 3);
    expect(snapToEmpty({ x: 4, y: 4 }, near, 1)).toEqual({ x: 4, y: 3 });
  });

  it('remove snaps to occupied studs, never empty ones', () => {
    expect(snapToOccupied({ x: 4, y: 4 }, (): boolean => true)).toEqual({ x: 4, y: 4 });
    const oneDot = (x: number, y: number): boolean => x === 5 && y === 4;
    expect(snapToOccupied({ x: 4, y: 4 }, oneDot, 1)).toEqual({ x: 5, y: 4 });
    expect(snapToOccupied({ x: 4, y: 4 }, (): boolean => false, 2)).toBeNull();
  });
});

describe('createPlate', () => {
  const palette = [{ hex: '#ff0000' }, { hex: '#00ff00' }, { hex: '#0000ff' }];

  it('builds 256 stud instances with colors from placed', () => {
    const plate = createPlate(source, palette);
    const studs = plate.root.children.find((c) => c.name === 'xr-plate-studs');
    expect(studs).toBeDefined();
    const mesh = studs as THREE.InstancedMesh;
    expect(mesh.count).toBe(PANEL_SIZE * PANEL_SIZE);
    const c = new THREE.Color();
    mesh.getColorAt(0, c);
    expect(c.getHexString()).toBe('00ff00');
    mesh.getColorAt(1, c);
    expect(c.getHexString()).toBe('9a968a');
    plate.dispose();
  });

  it('uses visibly larger pegs without crossing the eight millimetre pitch', () => {
    expect(STUD_RADIUS).toBeGreaterThan(0.0024);
    expect(STUD_RADIUS * 2).toBeLessThan(PITCH);
  });

  it('accepts optional palette symbols without changing the default plate API', () => {
    const plate = createPlate(source, palette, ['A', 'B', 'C']);
    expect(plate.root.name).toBe('xr-plate');
    plate.dispose();
    expect(() => createPlate(source, palette)).not.toThrow();
  });

  it('shows reference colors on empty pegs without changing placed dots', () => {
    const plate = createPlate(source, palette);
    const mesh = plate.root.children.find(
      (c) => c.name === 'xr-plate-studs',
    ) as THREE.InstancedMesh;
    const color = new THREE.Color();
    plate.setReferenceOverlay(true);
    mesh.getColorAt(0, color);
    expect(color.getHexString()).toBe('00ff00');
    mesh.getColorAt(1, color);
    expect(color.getHexString()).toBe(
      new THREE.Color('#00ff00').lerp(new THREE.Color(0x9a968a), 0.5).getHexString(),
    );
    plate.setReferenceOverlay(false);
    mesh.getColorAt(1, color);
    expect(color.getHexString()).toBe('9a968a');
    plate.dispose();
  });

  it('highlights a hovered stud with a ring without changing stud colors', () => {
    const plate = createPlate(source, palette);
    const mesh = plate.root.children.find(
      (c) => c.name === 'xr-plate-studs',
    ) as THREE.InstancedMesh;
    const c = new THREE.Color();
    mesh.getColorAt(5 * PANEL_SIZE + 5, c);
    const emptyBefore = c.getHexString();
    mesh.getColorAt(0, c);
    const placedBefore = c.getHexString();
    plate.setGhost({ x: 5, y: 5 });
    const ring = plate.root.getObjectByName('xr-plate-hover-ring');
    expect(ring?.visible).toBe(true);
    expect(ring?.position.x).toBe((5 - (PANEL_SIZE - 1) / 2) * PITCH);
    expect(ring?.position.z).toBe((5 - (PANEL_SIZE - 1) / 2) * PITCH);
    mesh.getColorAt(5 * PANEL_SIZE + 5, c);
    expect(c.getHexString()).toBe(emptyBefore);
    mesh.getColorAt(0, c);
    expect(c.getHexString()).toBe(placedBefore);
    plate.setGhost(null);
    expect(ring?.visible).toBe(false);
    plate.dispose();
  });
});

describe('constants', () => {
  it('uses true LEGO dimensions', () => {
    expect(PITCH).toBe(0.008);
    expect(PLATE_THICKNESS).toBe(0.0032);
  });
});
