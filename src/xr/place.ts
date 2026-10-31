/**
 * XR desk placement (XR P3): pure hit→placement math and the reticle placement state
 * machine, XRFrame-free so it is fully unit-testable. The amber reticle ring follows
 * real-surface hits under the viewer ray; the trigger edge drops the plate at the hit point,
 * yawed to face the head, and the frame and tray spawn at fixed offsets from the plate.
 */

export interface HitPose {
  x: number;
  y: number;
  z: number;
}

export interface Placement {
  pos: HitPose;
  /** Yaw so the plate faces the head at drop time. */
  yaw: number;
}

/** Yaw rotating the plate so it faces the head position at drop time. */
export function placementYaw(head: HitPose, hit: HitPose): number {
  return Math.atan2(head.x - hit.x, head.z - hit.z);
}

/** Frame/tray world positions spawned at fixed plate-local offsets, rotated by yaw. */
export function offsetsFrom(placement: Placement): { frame: HitPose; tray: HitPose } {
  const s = Math.sin(placement.yaw);
  const c = placement.yaw === 0 ? 1 : Math.cos(placement.yaw);
  const at = (dx: number, dy: number, dz: number): HitPose => ({
    x: placement.pos.x + dx * c + dz * s,
    y: placement.pos.y + dy,
    z: placement.pos.z - dx * s + dz * c,
  });
  return { frame: at(-0.24, 0.17, -0.07), tray: at(0.24, 0.1, -0.05) };
}

/** Reticle placement state machine: track the latest hit and head, drop once on the edge. */
export function createPlacer(deps: { onDrop(p: Placement): void }): {
  update(hit: HitPose | null, head: HitPose | null, triggerDown: boolean): void;
} {
  let placed = false;
  let lastHit: HitPose | null = null;
  let lastHead: HitPose | null = null;
  return {
    update(hit, head, triggerDown) {
      if (placed) return;
      if (hit) lastHit = hit;
      if (head) lastHead = head;
      if (triggerDown && lastHit && lastHead) {
        placed = true;
        deps.onDrop({
          pos: lastHit,
          yaw: placementYaw(lastHead, lastHit),
        });
      }
    },
  };
}
