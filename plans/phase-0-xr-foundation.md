# Phase 0 — XR Foundation

Parent: `PRD-XR.md` §6 P0. Goal: XR session plumbing with zero 2D regression.

## Tasks

1. **Add three.js.** `bun add three@0.186.0` (pin exact; revisit at
   implementation against the-cube precedent) + `@types/three`. Confirm
   `make checkall` still green.
   Verify: `make checkall` exit 0.
2. **Lazy XR module shell.** Create `src/xr/session.ts` (XRSystem detection:
   `navigator.xr?.isSessionSupported('immersive-vr' | 'immersive-ar')`,
   session request, `local-floor` reference space, session end events) and
   `src/xr/scene.ts` (WebGLRenderer with `xr.enabled`, studio backdrop:
   void background, grid floor, neutral lights). Dynamic-import `src/xr/`
   from the Panel Play controller so 2D-only sessions never parse it.
   Verify: vitest unit test for support-detection logic with mocked
   `navigator.xr`; `make checkall`.
3. **Enter VR button.** Add "Enter VR" to Panel Play's UI, visible only when
   `immersive-vr` is supported; hidden otherwise (desktop browsers, iOS).
   Click requests the session and hands the renderer to `xr.setSession`.
   Verify: `make checkall`; Playwright e2e still passes (button absent when
   `navigator.xr` undefined — happy-dom default).
4. **Clean exit.** On session end: dispose the XR render loop, restore the
   2D canvas/loop, return to Panel Play unchanged. Panel state reloads from
   the store.
   Verify: vitest test on the exit path (state restore, renderer dispose);
   `make checkall-ci`.

## Phase gate

`make checkall-ci` green. Hardware demo: enter/exit VR from an in-progress
panel on Quest 3, 2D board unchanged before/after (Paul).
Dependencies: none — first wave.
