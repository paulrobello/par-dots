# Phase 2 — Panel Build Loop (Frame, Tray, Tools)

Parent: `PRD-XR.md` §6 P2. Goal: full panel build in VR with headset input
only. Depends on phase-0; tools depend on phase-1. Three independent work
units — tasks A and B can run in parallel with each other; C integrates.

## Tasks

### A. Reference frame (`src/xr/frame.ts`) — depends: phase-0
1. Floating frame (flat box + bevel) with a 512×512 `CanvasTexture` face
   rendered from panel state: target mosaic colors, color symbols (A, B, C —
   same symbols as building sheets), and the toggleable progress overlay
   (faint target colors + symbols on empty studs — the 2D Overlay feature).
   Redraw on store change (debounced).
   Verify: vitest — canvas render contains per-stud colors/symbols for a
   fixture panel; overlay toggle changes the draw list; `make checkall`.
2. Grip-move (fixed grab offset), thumbstick up/down scale while gripped
   (clamp 0.4×–3×), default offset beside the plate.
   Verify: vitest — grab offset math, scale clamping; `make checkall`.

### B. Color tray (`src/xr/tray.ts`) — depends: phase-0
1. Chip grid floating opposite the frame: one chip per color still needed,
   remaining-count label per chip (CanvasTexture atlas), current-color ring,
   2D parity semantics: zero-count-with-wrong-dots chips dimmed (not
   hidden), correctly-complete chips shrink away, trigger selects.
   Verify: vitest — membership/counts match the 2D tray store for fixture
   states (fresh, mid-build, zero-but-wrong, complete); selection parity;
   `make checkall`.
2. Selection exits Remove mode and mirrors into the shared store so 2D and
   XR stay consistent.
   Verify: vitest — mode-exit + shared-selection assertion; `make checkall`.

### C. Tools (`src/xr/tools.ts`) — depends: A, B, phase-1
1. Floating Place / Remove / Hint buttons + Undo / Redo beside the tray;
   trigger presses; light click feedback (audio + micro-haptic).
   Verify: vitest — button hit-testing + action dispatch; `make checkall`.
2. Remove mode: trigger removes correct/incorrect dots, A-sweep strokes;
   hint flashes wrong dots 3 s with floating count label; full-but-wrong
   state plays the §5.5 error buzz once on entering.
   Verify: vitest — remove strokes through the bridge, hint target list,
   buzz state machine; `make checkall-ci`.

## Phase gate

`make checkall-ci` green. Hardware demo (Paul): one panel built
start-to-finish in VR — tray, overlay, remove, hint, undo/redo all behave
per PRD §5.5–5.6. Dependencies: phase-0 (A, B), phase-0+1 (C).
Unblocks: phase-3, phase-4.
