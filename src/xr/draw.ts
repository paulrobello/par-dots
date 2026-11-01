/** XR drawing world. Keeps drawing state in DrawSession and exposes the same save to 2D. */

import * as THREE from 'three';
import { DrawSession, type DrawTool, type Symmetry } from '../game';
import { EMPTY, type PictureSave } from '../types';
import type { Studio, XrWorld } from './scene';
import { createXrTooltip } from './tooltip';

export interface DrawWorldDeps {
  studio: Studio;
  xrSession: XRSession;
  save: PictureSave;
  persist(): void;
  onExit(): void;
}

const WIDTH = 0.8;
const HEIGHT = 0.8;
const CANVAS = 640;
const TOOL_H = 128;
const PALETTE_Y = 104;
const PALETTE_TOP = 84;
const PALETTE_BOTTOM = 124;

/** A compact XR canvas editor: trigger paints, the toolbar selects tools/colors/symmetry. */
export function createDrawWorld(deps: DrawWorldDeps): XrWorld {
  const session = new DrawSession(deps.save);
  const root = new THREE.Group();
  root.name = 'xr-draw-world';
  root.position.set(0, 1.35, -0.55);
  root.lookAt(0, 1.55, 0.2);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS;
  canvas.height = CANVAS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('XR drawing requires a 2D canvas');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH, HEIGHT),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
  );
  root.add(mesh);
  deps.studio.scene.add(root);

  let tool: DrawTool = 'brush';
  let erase = false;
  let hovered: { x: number; y: number } | null = null;
  let paintedHover: { x: number; y: number } | null = null;
  let dirty = true;
  const controls = ['brush', 'erase', 'pick', 'undo', 'redo', 'symmetry', 'exit'] as const;
  const tooltip = createXrTooltip(root, 0.25);
  const tooltipMesh = root.getObjectByName('xr-hover-tooltip');
  if (tooltipMesh) tooltipMesh.position.set(0, HEIGHT / 2 + 0.04, 0.002);

  const paint = (): void => {
    ctx.fillStyle = deps.save.drawBackground ?? '#111820';
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    const cellW = CANVAS / deps.save.width;
    const cellH = (CANVAS - TOOL_H) / deps.save.height;
    for (let y = 0; y < deps.save.height; y++) {
      for (let x = 0; x < deps.save.width; x++) {
        const value = deps.save.placed[y * deps.save.width + x];
        if (value === EMPTY) continue;
        ctx.fillStyle = deps.save.palette[value]?.hex ?? '#808080';
        ctx.fillRect(x * cellW + 1, TOOL_H + y * cellH + 1, cellW - 2, cellH - 2);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= deps.save.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cellW, TOOL_H);
      ctx.lineTo(x * cellW, CANVAS);
      ctx.stroke();
    }
    for (let y = 0; y <= deps.save.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, TOOL_H + y * cellH);
      ctx.lineTo(CANVAS, TOOL_H + y * cellH);
      ctx.stroke();
    }
    ctx.fillStyle = '#20282d';
    ctx.fillRect(0, 0, CANVAS, TOOL_H);
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    controls.forEach((id, i) => {
      const x = (i + 0.5) * (CANVAS / controls.length);
      const active = id === tool || (id === 'symmetry' && session.symmetry !== 'none');
      ctx.fillStyle = active ? '#f2cd37' : '#43515a';
      ctx.beginPath();
      ctx.roundRect(x - 42, 12, 84, 58, 12);
      ctx.fill();
      ctx.fillStyle = active ? '#252117' : '#f4f5f6';
      ctx.fillText(id === 'symmetry' ? session.symmetry : id, x, 48);
    });
    const paletteW = CANVAS / Math.max(1, deps.save.palette.length);
    deps.save.palette.forEach((entry, i) => {
      const x = i * paletteW + paletteW / 2;
      ctx.fillStyle = entry.hex;
      ctx.beginPath();
      ctx.arc(x, PALETTE_Y, 9, 0, Math.PI * 2);
      ctx.fill();
      if (i === session.primary) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    });
    if (hovered) {
      const x = hovered.x * cellW;
      const y = TOOL_H + hovered.y * cellH;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 2, y + 2, cellW - 4, cellH - 4);
    }
    texture.needsUpdate = true;
  };
  const unsubscribe = session.onChange(() => {
    dirty = true;
    deps.persist();
  });
  paint();
  dirty = false;

  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const cellAt = (position: THREE.Vector3, dir: THREE.Vector3): { x: number; y: number } | null => {
    root.updateWorldMatrix(true, true);
    inverse.copy(root.matrixWorld).invert();
    origin.copy(position).applyMatrix4(inverse);
    direction.copy(dir).transformDirection(inverse);
    ray.origin.copy(origin);
    ray.direction.copy(direction);
    if (
      !ray.intersectPlane(plane, hit) ||
      Math.abs(hit.x) > WIDTH / 2 ||
      Math.abs(hit.y) > HEIGHT / 2
    )
      return null;
    const x = Math.floor((hit.x / WIDTH + 0.5) * deps.save.width);
    const boardTop = HEIGHT / 2 - (TOOL_H / CANVAS) * HEIGHT;
    if (hit.y > boardTop) return null;
    const boardHeight = HEIGHT - (TOOL_H / CANVAS) * HEIGHT;
    const y = Math.floor(((boardTop - hit.y) / boardHeight) * deps.save.height);
    if (x < 0 || y < 0 || x >= deps.save.width || y >= deps.save.height) return null;
    return { x, y };
  };
  const controlAt = (
    position: THREE.Vector3,
    dir: THREE.Vector3,
  ): (typeof controls)[number] | `palette:${number}` | null => {
    root.updateWorldMatrix(true, true);
    inverse.copy(root.matrixWorld).invert();
    origin.copy(position).applyMatrix4(inverse);
    direction.copy(dir).transformDirection(inverse);
    ray.origin.copy(origin);
    ray.direction.copy(direction);
    if (!ray.intersectPlane(plane, hit) || hit.y < -HEIGHT / 2 || hit.y > HEIGHT / 2) return null;
    const pixelY = ((HEIGHT / 2 - hit.y) / HEIGHT) * CANVAS;
    if (pixelY >= PALETTE_TOP && pixelY <= PALETTE_BOTTOM) {
      const index = Math.floor((hit.x / WIDTH + 0.5) * deps.save.palette.length);
      return index >= 0 && index < deps.save.palette.length ? `palette:${index}` : null;
    }
    if (pixelY >= TOOL_H) return null;
    const index = Math.floor((hit.x / WIDTH + 0.5) * controls.length);
    return controls[index] ?? null;
  };
  const controllers = [0, 1].map((index) => deps.studio.renderer.xr.getController(index));
  for (const controller of controllers) deps.studio.scene.add(controller);
  const prev = controllers.map((controller) =>
    Boolean(
      (controller.userData.xrSource as XRInputSource | undefined)?.gamepad?.buttons[0]?.pressed,
    ),
  );
  let drawingOwner: number | null = null;
  const visuals: THREE.Object3D[] = [];
  const listeners: Array<() => void> = [];
  controllers.forEach((controller, ownerIndex) => {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.65 }),
    );
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xd6d8dc, roughness: 0.35 }),
    );
    controller.add(line, marker);
    visuals.push(line, marker);
    const connected = (event: { data: XRInputSource }): void => {
      controller.userData.xrSource = event.data;
    };
    const disconnected = (): void => {
      delete controller.userData.xrSource;
      if (drawingOwner === ownerIndex) {
        session.endStroke();
        drawingOwner = null;
        dirty = true;
      }
    };
    const events = controller as unknown as THREE.EventDispatcher<{
      connected: { data: XRInputSource };
      disconnected: Record<string, never>;
    }>;
    events.addEventListener('connected', connected);
    events.addEventListener('disconnected', disconnected);
    listeners.push(() => {
      events.removeEventListener('connected', connected);
      events.removeEventListener('disconnected', disconnected);
    });
  });
  const update = (): void => {
    let hoverControl: string | null = null;
    controllers.forEach((controller, index) => {
      const source = controller.userData.xrSource as XRInputSource | undefined;
      const trigger = Boolean(source?.gamepad?.buttons[0]?.pressed);
      if (!source) {
        prev[index] = false;
        return;
      }
      if (drawingOwner !== null && drawingOwner !== index) {
        prev[index] = trigger;
        return;
      }
      const position = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
      const dir = new THREE.Vector3(0, 0, -1).transformDirection(controller.matrixWorld);
      const control = controlAt(position, dir);
      if (!hoverControl && drawingOwner === null && control) {
        hoverControl = control.startsWith('palette:')
          ? (deps.save.palette[Number(control.slice(8))]?.name ?? 'Color')
          : control === 'pick'
            ? 'Pick color'
            : control === 'exit'
              ? 'Exit drawing'
              : control[0].toUpperCase() + control.slice(1);
      }
      const cell = cellAt(position, dir);
      hovered = cell;
      if (hovered?.x !== paintedHover?.x || hovered?.y !== paintedHover?.y) dirty = true;
      if (trigger && !prev[index]) {
        if (control) {
          if (control.startsWith('palette:')) {
            session.setPrimary(Number(control.slice('palette:'.length)));
            tool = 'brush';
            erase = false;
            dirty = true;
          } else if (control === 'brush') {
            tool = 'brush';
            erase = false;
            dirty = true;
          } else if (control === 'erase') {
            tool = 'brush';
            erase = true;
            dirty = true;
          } else if (control === 'pick') {
            tool = 'pick';
            dirty = true;
          } else if (control === 'undo') {
            session.undo();
            dirty = true;
          } else if (control === 'redo') {
            session.redo();
            dirty = true;
          } else if (control === 'exit') deps.onExit();
          else {
            const next: Symmetry =
              session.symmetry === 'none'
                ? 'vertical'
                : session.symmetry === 'vertical'
                  ? 'horizontal'
                  : 'none';
            session.setSymmetry(next);
            dirty = true;
          }
        } else if (cell) {
          if (tool === 'pick') {
            const picked = session.pick(cell.x, cell.y);
            if (picked !== null) session.setPrimary(picked);
            tool = 'brush';
          } else {
            session.beginStroke(tool === 'brush' && !erase ? 'paint' : 'erase');
            if (session.strokeAt(cell.x, cell.y)) dirty = true;
            drawingOwner = index;
          }
        }
      } else if (trigger && drawingOwner === index && cell) {
        if (session.strokeAt(cell.x, cell.y)) dirty = true;
      } else if (!trigger && prev[index] && drawingOwner === index) {
        drawingOwner = null;
        session.endStroke();
      }
      prev[index] = trigger;
    });
    tooltip.set(hoverControl);
    if (dirty) {
      paintedHover = hovered ? { ...hovered } : null;
      paint();
      dirty = false;
    }
  };
  const dispose = (): void => {
    if (drawingOwner !== null) {
      session.endStroke();
      drawingOwner = null;
    }
    unsubscribe();
    for (const remove of listeners) remove();
    for (const visual of visuals) {
      visual.removeFromParent();
      if (visual instanceof THREE.Mesh || visual instanceof THREE.Line) {
        visual.geometry.dispose();
        visual.material.dispose();
      }
    }
    for (const controller of controllers) controller.removeFromParent();
    tooltip.dispose();
    root.removeFromParent();
    texture.dispose();
    mesh.geometry.dispose();
    (mesh.material as THREE.MeshBasicMaterial).dispose();
  };
  return { update, layout: () => null, dispose, repaint: paint };
}
