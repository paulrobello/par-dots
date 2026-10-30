# Phase 4 — Persistence, Performance, Comfort

Parent: `PRD-XR.md` §6 P4. Goal: ship-quality pass. Depends on
phase-3-mixed-reality.md.

## Tasks

1. **Layout persistence** `src/xr/layout.ts`. Per-panel XR layout record:
   plate/frame/tray positions + yaw, frame scale, overlay state. Additive
   optional fields on the save record (schema stays v2; absent = defaults).
   Save on session end alongside the existing save points; restore on entry.
   Verify: vitest — serialize/round-trip, absent-field defaults, validation
   rejects malformed layout; `make checkall`.
2. **Performance audit.** Count draw calls and GPU frame time in Quest
   Browser; target ≤ 8 draw calls, ≤ 11 ms/frame (PRD §5 budget): batch
   button/tray label textures, confirm single InstancedMesh studs, lazy
   `src/xr/` import verified (2D-only page never parses three.js).
   Verify: measured numbers recorded in `progress.md`; `make checkall`.
3. **Sweep and comfort tuning.** Sweep sampling rate (studs/second),
   snap-assist radius, default spawn distances, reticle behavior — tune on
   hardware; document chosen values in the PRD §5 if they change.
   Verify: hardware pass (Paul).
4. **Hardware checklist** (Paul, Quest 3): full panel in VR; MR desk build;
   20-minute session without comfort issues; exit/resume on the 2D side;
   undo/redo parity between 2D and XR.

## Phase gate

`make checkall-ci` green + checklist complete. Dependencies: phase-3.
