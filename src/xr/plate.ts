/**
 * XR build plate (XR P1): true-scale 16x16 LEGO plate — 128 mm square, 3.2 mm thick, studs
 * 4.8 mm dia x 1.8 mm tall on an 8 mm pitch — studs as one InstancedMesh with per-instance
 * colors straight from `placed` (EMPTY studs render plate-colored). Geometry helpers are pure
 * and unit-tested; the mesh work is CPU-side three.js that runs in Node tests too. 1 unit = 1 m.
 */

import * as THREE from 'three';
import { EMPTY, PANEL_SIZE } from '../types';

/** Stud pitch in meters (true LEGO: 8 mm). */
export const PITCH = 0.008;
/** Plate thickness in meters (true LEGO plate: 3.2 mm). */
export const PLATE_THICKNESS = 0.0032;
/** Stud radius in meters (true LEGO: 4.8 mm diameter). */
export const STUD_RADIUS = 0.0024;
/** Stud height in meters (true LEGO: 1.8 mm). */
export const STUD_HEIGHT = 0.0018;
/** Snap-assist radius in studs: how far a ray hit may miss an empty stud and still snap. */
export const SNAP_RADIUS_STUDS = 2;

export interface Cell {
  x: number;
  y: number;
}

/** Plate-local stud-cell lookup: a point on the plate-top plane to a cell, null outside. */
export function cellFromLocal(lx: number, lz: number): Cell | null {
  const x = Math.floor((lx + (PANEL_SIZE * PITCH) / 2) / PITCH);
  const y = Math.floor((lz + (PANEL_SIZE * PITCH) / 2) / PITCH);
  if (x < 0 || y < 0 || x >= PANEL_SIZE || y >= PANEL_SIZE) return null;
  return { x, y };
}

/**
 * Snap-assist (paint): the nearest empty stud within `radius` studs of a ray hit, null when
 * every nearby stud is occupied/out of bounds.
 */
export function snapToEmpty(
  hit: Cell,
  isOccupied: (x: number, y: number) => boolean,
  radius: number = SNAP_RADIUS_STUDS,
): Cell | null {
  if (!isOccupied(hit.x, hit.y)) return hit;
  return scanRing(hit, isOccupied, radius, false);
}

/**
 * Snap-assist (remove): the nearest occupied stud within `radius` studs of a ray hit —
 * remove targets dots, never empty studs.
 */
export function snapToOccupied(
  hit: Cell,
  isOccupied: (x: number, y: number) => boolean,
  radius: number = SNAP_RADIUS_STUDS,
): Cell | null {
  if (isOccupied(hit.x, hit.y)) return hit;
  return scanRing(hit, isOccupied, radius, true);
}

/** Ring scan shared by both snap directions; `want` picks the occupancy to land on. */
function scanRing(
  hit: Cell,
  isOccupied: (x: number, y: number) => boolean,
  radius: number,
  want: boolean,
): Cell | null {
  let best: Cell | null = null;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = hit.x + dx;
      const y = hit.y + dy;
      if (x < 0 || y < 0 || x >= PANEL_SIZE || y >= PANEL_SIZE) continue;
      if (isOccupied(x, y) !== want) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** Stud-cell center in plate-local coordinates (cell 0,0 corner at -64 mm,-64 mm). */
const cellCenter = (c: Cell): { x: number; z: number } => ({
  x: (c.x - (PANEL_SIZE - 1) / 2) * PITCH,
  z: (c.y - (PANEL_SIZE - 1) / 2) * PITCH,
});

/** What the plate needs from the panel rules; structural so tests can pass a PanelSession. */
export interface PlateSource {
  cellAt(x: number, y: number): { target: number; placed: number };
}

/** True-scale 16x16 build plate; XR-side handle for hit testing, ghosting and syncing. */
export interface PlateHandle {
  root: THREE.Group;
  /** Re-scan `placed`/`target` into the stud instance colors (on change events, not per frame). */
  sync(): void;
  /** Ghost-highlight the stud a placement would fill; null clears. */
  setGhost(cell: Cell | null): void;
  /** Flash a set of studs (hint's wrong dots) toward red until cleared. */
  setFlash(cells: Cell[] | null): void;
  /** Ray (plate-local frame) to a snapped stud; paint snaps to empty, remove to occupied. */
  pickCell(
    ray: { origin: THREE.Vector3; dir: THREE.Vector3 },
    mode: 'paint' | 'remove',
  ): Cell | null;
  dispose(): void;
}

const PLATE_COLOR = 0xd6d2c4;
const PLATE_HEX = '#d6d2c4';

export function createPlate(
  source: PlateSource,
  palette: ReadonlyArray<{ hex: string }>,
): PlateHandle {
  const root = new THREE.Group();
  root.name = 'xr-plate';

  const plateGeo = new THREE.BoxGeometry(PANEL_SIZE * PITCH, PLATE_THICKNESS, PANEL_SIZE * PITCH);
  const plateMat = new THREE.MeshStandardMaterial({ color: PLATE_COLOR, roughness: 0.9 });
  const plateMesh = new THREE.Mesh(plateGeo, plateMat);
  plateMesh.position.y = -PLATE_THICKNESS / 2;
  root.add(plateMesh);

  const studGeo = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 12);
  const studMat = new THREE.MeshStandardMaterial({ roughness: 0.55 });
  const studs = new THREE.InstancedMesh(studGeo, studMat, PANEL_SIZE * PANEL_SIZE);
  studs.name = 'xr-plate-studs';
  root.add(studs);
  const m = new THREE.Matrix4();
  const plateColor = new THREE.Color(PLATE_COLOR);
  const tmp = new THREE.Color();
  const ghostTint = new THREE.Color(0xffffff);
  const warn = new THREE.Color(0xe5484d);
  let ghostCell: Cell | null = null;
  const flash = new Set<string>();

  const sync = (): void => {
    for (let y = 0; y < PANEL_SIZE; y++) {
      for (let x = 0; x < PANEL_SIZE; x++) {
        const i = y * PANEL_SIZE + x;
        const c = cellCenter({ x, y });
        m.makeTranslation(c.x, PLATE_THICKNESS / 2 + STUD_HEIGHT / 2, c.z);
        studs.setMatrixAt(i, m);
        const { placed, target } = source.cellAt(x, y);
        if (ghostCell && ghostCell.x === x && ghostCell.y === y) {
          if (placed === EMPTY) {
            tmp.set(palette[target]?.hex ?? PLATE_HEX);
            tmp.lerp(plateColor, 0.45);
          } else {
            tmp.set(palette[placed]?.hex ?? PLATE_HEX);
            tmp.lerp(ghostTint, 0.4);
          }
        } else if (placed === EMPTY) {
          tmp.copy(plateColor);
        } else {
          tmp.set(palette[placed]?.hex ?? PLATE_HEX);
        }
        if (flash.has(`${x},${y}`)) tmp.lerp(warn, 0.65);
        studs.setColorAt(i, tmp);
      }
    }
    studs.instanceMatrix.needsUpdate = true;
    if (studs.instanceColor) studs.instanceColor.needsUpdate = true;
  };

  const setGhost = (cell: Cell | null): void => {
    ghostCell = cell;
    sync();
  };

  const setFlash = (cells: Cell[] | null): void => {
    flash.clear();
    if (cells) for (const c of cells) flash.add(`${c.x},${c.y}`);
    sync();
  };

  const ray = new THREE.Ray();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  const pickCell = (
    r: { origin: THREE.Vector3; dir: THREE.Vector3 },
    mode: 'paint' | 'remove',
  ): Cell | null => {
    ray.origin.copy(r.origin);
    ray.direction.copy(r.dir).normalize();
    if (!ray.intersectPlane(plane, hit)) return null;
    const cell = cellFromLocal(hit.x, hit.z);
    if (!cell) return null;
    const isOccupied = (x: number, y: number): boolean => source.cellAt(x, y).placed !== EMPTY;
    return mode === 'remove' ? snapToOccupied(cell, isOccupied) : snapToEmpty(cell, isOccupied);
  };

  const dispose = (): void => {
    plateGeo.dispose();
    plateMat.dispose();
    studGeo.dispose();
    studMat.dispose();
    studs.dispose();
  };

  sync();
  return { root, sync, setGhost, setFlash, pickCell, dispose };
}
