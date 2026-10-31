/**
 * XR input model (XR P1): trigger/A/B edge detection and sweep-stroke batching for one
 * controller, DOM-free and XR-API-free so it is fully unit-testable. The per-frame glue that
 * reads `session.inputSources` gamepads and three.js controller poses lives in scene.ts.
 * A trigger press always opens a stroke; dragging paints more studs; release commits —
 * a quick tap lands as a one-stud move, exactly like the 2D stroke path.
 */

import type { Cell } from './plate';

/** What the input model needs to drive; wired to the bridge and plate by scene.ts. */
export interface InputModelDeps {
  /** Trigger tap on a snapped empty stud: a one-cell place (occupied studs never snap). */
  onPlace(cell: Cell): void;
  /** Stroke begin: open a bridge stroke in the current mode. */
  onStrokeStart(cell: Cell | null): void;
  /** Sweep sample: paint/erase the line from the previous stud to `cell`. */
  onStrokeMove(from: Cell, to: Cell): void;
  /** Stroke commit (trigger release or controller loss). */
  onStrokeEnd(): void;
  /** Ghost target under the ray; null clears. */
  onHover(cell: Cell | null): void;
  /** B button edge: leave XR. */
  onExit(): void;
}

/** One controller's button state as read from its gamepad each frame. */
export interface PadState {
  trigger: boolean;
  a: boolean;
  b: boolean;
  /** Grip held (grab modifier); read by world.ts, not the stroke model. */
  grip: boolean;
  /** Thumbstick X in -1..1 (grab-rotate); read by world.ts, not the stroke model. */
  stickX: number;
  /** Thumbstick Y in -1..1 (grab-scale); read by world.ts, not the stroke model. */
  stickY: number;
}

/** xr-standard reserves axes 0/1 for the touchpad and 2/3 for the thumbstick. */
export function readGamepad(gamepad: Pick<Gamepad, 'buttons' | 'axes'>): PadState {
  const b = gamepad.buttons;
  const axis = (i: number): number => {
    const v = gamepad.axes[i];
    return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
  };
  return {
    trigger: !!b[0]?.pressed,
    grip: !!b[1]?.pressed,
    a: !!b[4]?.pressed,
    b: !!b[5]?.pressed,
    stickX: axis(2),
    stickY: axis(3),
  };
}

const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

export function createInputModel(deps: InputModelDeps): {
  update(snap: Cell | null, pad: PadState | null): void;
} {
  let prevTrigger = false;
  let prevB = false;
  let open = false;
  let last: Cell | null = null;

  return {
    update(snap, pad) {
      if (pad?.b && !prevB) deps.onExit();

      const down = pad?.trigger === true && !prevTrigger;
      const up = pad?.trigger === false && prevTrigger;

      if (down && pad.a) {
        open = true;
        last = snap;
        deps.onStrokeStart(snap);
        deps.onHover(null);
      } else if (down) {
        if (snap) deps.onPlace(snap);
      } else if (open && pad?.trigger && snap) {
        if (!last) {
          last = snap;
          deps.onStrokeMove(snap, snap);
        } else if (!sameCell(last, snap)) {
          const from = last;
          last = snap;
          deps.onStrokeMove(from, snap);
        }
      }

      if ((up || !pad) && open) {
        open = false;
        last = null;
        deps.onStrokeEnd();
      }

      if (!open) deps.onHover(snap);

      prevTrigger = pad?.trigger === true;
      prevB = pad?.b === true;
    },
  };
}
