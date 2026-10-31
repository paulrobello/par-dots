// @vitest-environment happy-dom

/**
 * Runtime tests for the draw-call batched tray object: instance counts, strip label
 * painting, ray picks on a rotated/translated root, and the pick-plane height. The 2D
 * context is a recording mock so label placement is asserted in canvas pixels.
 */

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTray, type TrayDeps } from '../src/xr/tray';

interface PaintLog {
  clears: number;
  /** fillText calls. */
  texts: Array<{ text: string; x: number; y: number; font: string }>;
  /** arc+fill calls (count-label circles) with the active fillStyle. */
  dots: Array<{ x: number; y: number; r: number; style: string }>;
}

const makeCtx = (): { log: PaintLog; ctx: CanvasRenderingContext2D } => {
  const log: PaintLog = { clears: 0, texts: [], dots: [] };
  const ctx = {
    canvas: null,
    fillStyle: '#000000',
    font: '',
    textAlign: '',
    textBaseline: '',
    clearRect: () => {
      log.clears++;
    },
    beginPath: () => undefined,
    arc: (x: number, y: number, r: number) => {
      log.dots.push({ x, y, r, style: String(ctx.fillStyle) });
    },
    fill: () => undefined,
    fillText: (text: string, x: number, y: number) => {
      log.texts.push({ text, x, y, font: String(ctx.font) });
    },
  } as unknown as CanvasRenderingContext2D;
  return { log, ctx };
};

describe('createTray (batched runtime object)', () => {
  let log: PaintLog;

  beforeEach(() => {
    const { log: paintLog, ctx } = makeCtx();
    log = paintLog;
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string,
      options?: ElementCreationOptions,
    ) => {
      const el = orig(tag, options);
      if (tag === 'canvas') {
        (el as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () => ctx;
      }
      return el;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const deps = (colors: number[], counts: number[], selected = 0): TrayDeps => ({
    bridge: {
      trayColors: () => colors.slice(),
      availableFor: (c: number) => counts[c] ?? 0,
    },
    palette: Array.from({ length: 32 }, (_, i) => ({
      hex: `#${(i + 1).toString(16).padStart(6, '0')}`,
    })),
    selected: () => selected,
  });

  /** Texts painted by the sync that just ran (the log accumulates across syncs). */
  const lastPaint = (before: number): PaintLog['texts'] => log.texts.slice(before);

  it('syncs 32 colors to 32 instances with one shared label strip', () => {
    const tray = createTray(deps([...Array(32).keys()], Array(32).fill(4)));
    const chipsMesh = tray.root.children.find((o) => o instanceof THREE.InstancedMesh);
    expect(chipsMesh).toBeDefined();
    expect((chipsMesh as THREE.InstancedMesh).count).toBe(32);
    expect(log.texts).toHaveLength(32);
    expect(log.texts.map((t) => t.text)).toEqual(Array(32).fill('4'));
    tray.dispose();
  });

  it('repaints counts and drops chips as colors complete', () => {
    const colors = [0, 1, 2];
    const counts = [3, 2, 1];
    const tray = createTray(deps(colors, counts));
    counts[0] = 2;
    let before = log.texts.length;
    tray.sync();
    expect(lastPaint(before).map((t) => t.text)).toEqual(['2', '2', '1']);
    colors.pop();
    before = log.texts.length;
    tray.sync();
    const chipsMesh = tray.root.children.find((o) => o instanceof THREE.InstancedMesh)!;
    expect((chipsMesh as THREE.InstancedMesh).count).toBe(2);
    expect(lastPaint(before)).toHaveLength(2);
    tray.dispose();
  });

  it('keeps the count label and badge the same physical size as the tray shrinks', () => {
    const colors = [...Array(32).keys()];
    const tray = createTray(deps(colors, Array(32).fill(9)));
    const quad = tray.root.children.find(
      (o) => o instanceof THREE.Mesh && (o.material as THREE.MeshBasicMaterial).map !== null,
    ) as THREE.Mesh;
    let expectedRadius = 0;
    let expectedFontSize = 0;
    for (const n of [32, 16, 8, 4, 2, 1]) {
      colors.length = n;
      tray.sync();
      const extent = (quad.geometry as THREE.PlaneGeometry).parameters.width;
      const radius = log.dots.at(-1)?.r ?? 0;
      const font = log.texts.at(-1)?.font ?? '';
      const fontPixels = Number.parseFloat(font.split(' ')[1]);
      const worldRadius = (radius / 512) * extent;
      const worldFontSize = (fontPixels / 512) * extent;
      if (n === 32) {
        expectedRadius = worldRadius;
        expectedFontSize = worldFontSize;
      }
      expect(worldRadius).toBeCloseTo(expectedRadius, 8);
      expect(worldFontSize).toBeCloseTo(expectedFontSize, 8);
      expect(worldRadius).toBeGreaterThan(0.009);
      expect(worldFontSize).toBeGreaterThan(0.011);
    }
    tray.dispose();
  });

  it('paints every count label inside the strip canvas for a 6x6 grid', () => {
    const tray = createTray(deps([...Array(32).keys()], Array(32).fill(9)));
    const r = log.dots[0]?.r ?? 0;
    for (const t of log.texts) {
      expect(t.x).toBeGreaterThanOrEqual(r);
      expect(t.x).toBeLessThanOrEqual(512 - r);
      expect(t.y).toBeGreaterThanOrEqual(r);
      expect(t.y).toBeLessThanOrEqual(512 - r);
    }
    const centers = new Set(log.texts.map((t) => `${t.x},${t.y}`));
    expect(centers.size).toBe(32);
    tray.dispose();
  });

  it('keeps the strip background transparent (clear, no opaque fill)', () => {
    const tray = createTray(deps([0, 1, 2], [1, 1, 1]));
    expect(log.clears).toBeGreaterThanOrEqual(1);
    expect(log.dots).toHaveLength(3);
    expect(log.dots.every((d) => d.style === 'rgba(15,16,18,0.85)')).toBe(true);
    tray.dispose();
  });

  it('picks chips through a rotated, translated root', () => {
    const tray = createTray(deps([0, 1, 2], [1, 1, 1]));
    tray.root.position.set(0.5, 1.0, -0.3);
    tray.root.rotation.y = Math.PI / 4;
    tray.root.updateWorldMatrix(true, true);
    const v = new THREE.Vector3();
    const rayAt = (sx: number, sz: number): { origin: THREE.Vector3; dir: THREE.Vector3 } => {
      v.set(sx, 0, sz).applyMatrix4(tray.root.matrixWorld);
      return {
        origin: v.clone().add(new THREE.Vector3(0, 0.2, 0)),
        dir: new THREE.Vector3(0, -1, 0),
      };
    };
    expect(tray.pickChip(rayAt(-0.018, 0))).toBe(0);
    expect(tray.pickChip(rayAt(0.018, 0))).toBe(1);
    expect(tray.pickChip(rayAt(-0.018, 0.036))).toBe(2);
    expect(tray.pickChip(rayAt(0.036, 0.036))).toBeNull();
    tray.dispose();
  });

  it('intersects the pick plane at chip-top height, not below the tray', () => {
    const tray = createTray(deps([7], [1]));
    // Oblique ray through the chip-0 centre at y = +CHIP_HEIGHT/2; at y = -CHIP_HEIGHT/2 the
    // same ray passes ~0.024 beside the chip (reach 0.0196), so only the correct constant hits.
    const origin = new THREE.Vector3(0.3, 0.104, 0);
    const dir = new THREE.Vector3(-0.3, -0.1, 0).normalize();
    expect(tray.pickChip({ origin, dir })).toBe(7);
    tray.dispose();
  });

  it('maps the strip canvas onto a quad sized to the grid', () => {
    const tray = createTray(deps([0, 1, 2], [1, 1, 1]));
    const quad = tray.root.children.find(
      (o) => o instanceof THREE.Mesh && (o.material as THREE.MeshBasicMaterial).map !== null,
    ) as THREE.Mesh;
    const geo = quad.geometry as THREE.PlaneGeometry;
    expect(geo.parameters.width).toBeCloseTo(geo.parameters.height);
    expect(quad.position.z).toBeCloseTo(0.018);
    const canvas = ((quad.material as THREE.MeshBasicMaterial).map as THREE.CanvasTexture)
      .image as HTMLCanvasElement;
    expect(canvas.width).toBe(512);
    tray.dispose();
  });
});
