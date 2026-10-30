# Phase 1 — Build Plate and Placement

Parent: `PRD-XR.md` §6 P1. Goal: place dots on a true-scale 3D plate in VR,
writing through the shared store. Depends on phase-0-xr-foundation.md.

## Tasks

1. **Plate module** `src/xr/plate.ts`. True LEGO scale, 1 unit = 1 m:
   16×16 studs, 8 mm pitch (plate 128 mm square, 3.2 mm thick), studs
   4.8 mm dia × 1.8 mm tall as one `InstancedMesh` (256 instances,
   per-instance color; EMPTY studs render plate-colored). Reads panel
   `placed`/`target` via the bridge; exposes stud-index ↔ world-cell
   resolution.
   Verify: vitest — geometry dimensions, index math, per-instance colors
   match `placed`; `make checkall`.
2. **Bridge adapter** `src/xr/bridge.ts`. Wraps the 2D panel-play store:
   `stroke(cells[], color, mode)` commits place/remove exactly like a 2D
   stroke (one move in the undo history, save at stroke end), exposes
   current color selection, subscribes XR to store changes.
   Verify: vitest — stroke commit produces identical store mutations to the
   2D path (snapshot against existing paint action tests); undo/redo parity;
   `make checkall`.
3. **Input + snap-assist** `src/xr/input.ts`. Right-controller ray;
   snap-assist = nearest empty stud within a radius of the ray–plate
   intersection, target cell ghost-highlighted; trigger edge-detects place
   (occupied studs are no-ops); A held + trigger drag = sweep stroke
   (commit on release); haptic pulse via `gamepad.hapticActuators` +
   existing dot sound from `src/audio` per placed dot.
   Verify: vitest — snap math (grid-edge cases, occupied skip), stroke
   batching; `make checkall`.
4. **Wire-up.** Plate + input live in the P0 scene; default color = the 2D
   app's current tray selection until the XR tray exists (phase-2).
   Verify: `make checkall-ci`.

## Phase gate

`make checkall-ci` green. Hardware demo (Paul): place dots in VR, exit —
dots on the 2D board and persisted; sweep = one undo; occupied studs reject.
Dependencies: phase-0. Unblocks: phase-2 (tools integration), phase-3 (MR).
