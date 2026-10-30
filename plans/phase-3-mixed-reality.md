# Phase 3 — Mixed Reality

Parent: `PRD-XR.md` §6 P3. Goal: build on the real desk via passthrough.
Depends on phase-2-panel-build-loop.md.

## Tasks

1. **AR session support** in `src/xr/session.ts`: request `immersive-ar`
   (`alpha-blend` blend mode preferred; fall back to default), transparent
   renderer clear, `local-floor` space. Entry UI: mode choice next to
   "Enter VR" ("Enter MR"), shown only when `immersive-ar` is supported.
   Verify: vitest — AR support detection + request args; `make checkall`.
2. **Reticle placement** via WebXR hit-test API (viewer-space ray,
   real-surface hits): amber ring reticle on the first surface under the
   ray; trigger drops the plate at the hit point, yaw facing the head;
   frame and tray spawn at fixed offsets from the plate. After placement
   the reticle is dismissed.
   Verify: vitest — hit→placement math (yaw from head, offsets, reticle
   state machine) with a mocked XRFrame; `make checkall`.
3. **Backdrop-free grabbing**: all three objects grip-movable anywhere
   (desk or mid-air) — this is the "passthrough backdrop" variant; nothing
   anchors after initial placement.
   Verify: `make checkall-ci`.

## Phase gate

`make checkall-ci` green. Hardware demo (Paul): MR entry → reticle drop on
a real desk → full build loop works over the real desk → exit restores 2D.
Dependencies: phase-2. Unblocks: phase-4.
