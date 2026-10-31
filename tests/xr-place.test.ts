import { describe, expect, it, vi } from 'vitest';
import { createPlacer, type HitPose, offsetsFrom, placementYaw } from '../src/xr/place';

const hit = (x: number, y: number, z: number): HitPose => ({ x, y, z });
const near = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe('placementYaw', () => {
  it('faces the head', () => {
    expect(placementYaw(hit(0, 0, 0), hit(0, 0, -1))).toBe(0);
    const yaw = placementYaw(hit(1, 0, 0), hit(0, 0, -1));
    near(yaw, Math.PI / 4);
  });
});

describe('offsetsFrom', () => {
  it('spawns frame and tray at fixed plate offsets at yaw 0', () => {
    const { frame, tray, tools } = offsetsFrom({ pos: hit(1, 1, -1), yaw: 0 });
    near(frame.x, 0.76);
    near(frame.y, 1.17);
    near(frame.z, -1.07);
    near(tray.x, 1.24);
    near(tray.y, 1.1);
    near(tray.z, -1.05);
    near(tools.x, 1);
    near(tools.y, 0.81);
    near(tools.z, -1.02);
  });

  it('rotates offsets with yaw', () => {
    const { frame } = offsetsFrom({ pos: hit(0, 0, 0), yaw: Math.PI / 2 });
    near(frame.x, -0.07);
    near(frame.z, 0.24);
  });
});

describe('createPlacer', () => {
  it('drops once with head-facing yaw on the trigger edge', () => {
    const drops: Array<{ pos: HitPose; yaw: number }> = [];
    const placer = createPlacer({ onDrop: (p) => drops.push(p) });
    placer.update(null, hit(0, 1.6, 0), false);
    placer.update(hit(0, 0.75, -0.5), hit(0, 1.6, 0), false);
    placer.update(hit(0, 0.75, -0.5), hit(0, 1.6, 0), true);
    placer.update(hit(0, 0.75, -0.5), hit(0, 1.6, 0), true);
    expect(drops).toHaveLength(1);
    expect(drops[0].pos).toEqual(hit(0, 0.75, -0.5));
    expect(drops[0].yaw).toBe(0);
  });

  it('does not place at a stale hit when the reticle is no longer visible', () => {
    const drops: Array<{ pos: HitPose; yaw: number }> = [];
    const placer = createPlacer({ onDrop: (p) => drops.push(p) });
    placer.update(hit(0.5, 0.72, -0.4), hit(0, 1.6, 0), false);
    placer.update(null, null, true);
    expect(drops).toHaveLength(0);
    placer.update(hit(0.5, 0.72, -0.4), hit(0, 1.6, 0), true);
    expect(drops).toHaveLength(1);
  });
});

describe('requestArSession', () => {
  it('requests immersive-ar with local-floor and hit-test', async () => {
    const { requestArSession } = await import('../src/xr/session');
    const session = new EventTarget() as unknown as XRSession;
    const xr = {
      requestSession: vi.fn(() => Promise.resolve(session)),
    } as unknown as XRSystem;
    await expect(requestArSession(xr)).resolves.toBe(session);
    expect(xr.requestSession).toHaveBeenCalledWith('immersive-ar', {
      optionalFeatures: ['local-floor', 'hit-test'],
    });
  });
});
