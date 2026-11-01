# PRD: par-dots XR — VR/MR Panel Building

| | |
|---|---|
| **Product** | par-dots XR — WebXR panel-play mode for PAR Dots |
| **Repo** | `~/Repos/par-dots` |
| **Owner** | Paul Robello |
| **Status** | In progress; headset acceptance pending |
| **Date** | 2026-10-30 |
| **Companion doc** | `PRD.md` (2D game) — this PRD covers XR only |

## 1. Overview

PAR Dots gains a WebXR mode for building mosaic panels on Meta Quest 3: the
16×16 build plate as a true-scale 3D object, the panel's reference image as a
floating resizable frame, and the color tray as a floating chip grid. One
three.js scene serves both **VR** (studio backdrop) and **MR**
(passthrough backdrop, plate anchored to the real desk). XR edits write
directly into the same IndexedDB project and undo stack as 2D play on that
device. Export and import a backup to continue on another device.

## 2. Goals

1. Enter VR or MR from Panel Play and build a panel start-to-finish in-headset.
2. Parity for the panel-play build loop: place (single + sweep), remove,
   hint, undo/redo, color selection with 2D tray semantics.
3. Free placement of plate, reference frame, and tray in the user's space;
   MR offers reticle drop onto a real desk, then everything is grabbable.
4. XR edits persist through the existing save points; no 2D regression.
5. Comfortable true-LEGO-scale interaction (8 mm stud pitch) via snap-assist.

## 3. Non-Goals

- Picture setup in XR. The XR gallery lists unfinished photo projects and drawings.
- Hand tracking, gaze input, or Meta VR Glasses readiness (later; controllers
  only for this PRD).
- Locomotion of any kind — the workspace is arm-reach; you move objects, not
  yourself.
- Cross-device sync: IndexedDB is device-local, so "start on phone, continue
  in XR" applies to the same device's Quest browser only.
- Physics simulation (nothing falls); room-plane colliders are unnecessary.
- Custom gestures beyond the mapped buttons (per Meta's hands-only guidance,
  controllers remain the right input for precision work).

## 4. Reference Projects

| Repo | Reused for |
|---|---|
| `par-dots` (this repo) | Everything data-side: `src/types.ts` model (`PANEL_SIZE`, `placed`/`target` Uint8Array, palette), IndexedDB stores, stroke-commit save points, undo history rules (§5.6), tray semantics (§5.5), audio assets in `src/audio`, color quantizer untouched |
| `the-cube` | three.js + Vite + bun pairing and version precedent (0.186), module-per-domain layout, perf discipline under `docs/` |
| `webxr1` | Proven Quest 3 WebXR patterns: session entry button + XRButton flow, controller ray interaction, `getButtonDown` edge detection, haptics via `gamepad.hapticActuators`, MR placement reticle UX (not its IWSDK stack — rejected for this repo, see §5) |

## 5. Architecture Direction

- **In-place, not a sibling app.** three.js is added to the existing Vite +
  TypeScript + bun app; no IWSDK (it wants to own the project shape — wrong
  graft for a hand-rolled PWA). Pin `three` at implementation time (0.186.x is
  house precedent).
- **New module `src/xr/`**, sibling to `render/` (2D): `session.ts`
  (XRSystem detection, VR/AR session request, reference space), `scene.ts`
  (renderer, studio environment, lighting), `plate.ts`, `frame.ts` (reference),
  `tray.ts`, `tools.ts` (tool buttons + undo/redo), `input.ts` (rays, grip,
  snap-assist, haptics), `bridge.ts` (the only file touching game state —
  stroke adapter mirroring the 2D paint/remove call path), `layout.ts`
  (persisted transforms). `src/xr/` never imports from `render/`; both read
  the same stores in `src/storage` and the same game state in `src/game`.
- **Rendering budget:** studs are one `InstancedMesh` (256 instances, per-
  instance color); plate, frame, tray, buttons are simple boxes/cylinders;
  reference frame face is a 512×512 `CanvasTexture` redrawn from panel state
  on change. Target: ≤ 11 ms/frame at 72 Hz in Quest Browser; ≤ ~8 draw calls.
- **Input map (right controller):** Trigger = tool action (place/remove/hint
  target, tray select, button press); **A held = sweep modifier** (trigger
  drag = one stroke); **Grip held = grab** plate/frame/tray/tool panel (fixed grab
  offset, follows the controller's full orientation); thumbstick left/right
  while gripping = rotate the held object, up/down = push it away or pull it closer along the laser beam.
  Hold grip and trigger together while moving the stick up/down to resize it (0.4x–3x);
  B = exit to 2D (plus panel-button exit).
- **MR:** `immersive-ar` session, alpha-blend backdrop, and a placement
  reticle driven by the WebXR hit-test API (controller target-ray space, real-surface
  hits) — point at the desk, trigger drops the plate; frame and tray spawn at
  offsets; everything freely grabbable afterward (the "backdrop" variant is
  just: don't use the reticle, grab the plate into mid-air).
- **VR:** same scene over an opaque studio backdrop (soft void, subtle grid
  floor, neutral lighting for color judgment). Objects spawn in arm reach.
- **State flow:** XR reuses the 2D panel-play store and its in-memory undo
  history (10 moves, stroke = one move, new move clears redo). XR strokes go
  through the same commit path, so saves fire at the same points (stroke end,
  undo/redo, session end ≈ page-hidden, panel complete).

The Settings control is available in the library and build workspace. It offers Studio, Night sky, Sunset and Woodland VR environments and the shared sound, volume, haptics, music, track and place-sound settings; MR keeps passthrough. A progress label shows correct dots and Hint confirms when there are no mistakes. A Ghost tool toggles reference colors and matching symbols on empty plate pegs without obscuring placed dots. A Help tool opens the VR controller guide. Completing a plate plays a fanfare and shows a button to continue to the next plate in VR. In the build workspace, the right controller can point at the reference image and press the trigger to select that cell’s color when it is available in the tray. The gallery lists unfinished photo projects with previews and progress bars. In the gallery, either controller can point and use trigger to select; the thumbstick pages through the list and B exits. Gallery-launched VR saves the panel workspace layout. When MR hit testing is available, placement requires a currently visible surface reticle. If hit testing is unavailable or denied, the workspace appears at the default position.

The workspace also offers Focus for the selected color, a Picture overview for choosing a panel, a Build guide for tracking a physical mosaic, and Layout presets, with the last selected preset restored in later sessions. Drag placement targets the peg under the ray without snapping to neighboring pegs, and the settings card blocks controller rays. XR settings include an optional targeted-cell magnifier and adjustable snap radius. Drawings open in a separate XR editor with palette selection, brush, eraser, picker, symmetry and undo/redo. Gallery export/import transfers project copies between devices without automatic synchronization. These additions require headset acceptance.

The Picture view remains open during placement and can be moved with either grip. Either controller can grip and adjust workspace objects independently, including the library panel. Save stores one reusable custom layout on the device, and Layout cycles through it alongside the built-in presets. Headset acceptance remains pending.

## 6. Phases

Each phase ends with the full gate green (`make checkall`; `checkall-ci`
before any done/push claim) and something demonstrable on the Quest 3.

### P0 — XR foundation
Scope: three.js dependency; `src/xr/session.ts` + `scene.ts`; "Enter VR"
button on Panel Play (hidden when `navigator.xr` unavailable); empty studio
scene; clean enter/exit with zero 2D regression.
**Accept:** Enter/exit VR from an in-progress panel works on Quest 3; the 2D
board is untouched before/after; `checkall-ci` green; no new console errors.

### P1 — Build plate and placement
Scope: plate (16×16, 8 mm pitch, enlarged 6.4 mm × 1.8 mm studs on a 3.2 mm
plate) as InstancedMesh with per-instance color; right-controller ray with
snap-assist (nearest valid stud within radius, marked by a ring at its base without changing its color);
trigger places the current color (occupied studs ignored — parity); A-sweep
paints strokes; haptic pulse + existing dot sound per placement; XR strokes
commit through the bridge (saves + undo history work).
**Accept:** dots placed in XR appear on the 2D board after exit and in
IndexedDB; occupied-stud triggers are no-ops; a sweep = one undo move;
72 fps sustained on Quest 3.

### P2 — Panel build loop
Scope (three independent work units):
- **Reference frame:** floating frame with 512×512 CanvasTexture of the
  panel's reference mosaic (target colors, A/B/C symbols, toggleable progress
  overlay — the 2D Overlay feature); grip to move, grip and trigger plus thumbstick to scale;
  default offset beside the plate.
- **Color tray:** floating chip grid with consistently sized count labels, mirroring 2D tray semantics — remaining
  counts, current-color ring, zero-but-wrong chips dimmed, correctly-complete
  chips shrink away; trigger selects; selection exits Remove (parity); XR
  selection and 2D tray stay consistent through the shared store.
- **Tools:** floating Place / Remove / Hint buttons + Undo / Redo. Remove
  removes correct and incorrect dots (trigger + A-sweep). Hint flashes wrong
  dots 3 s with a count (floating label; full-but-wrong buzz state per §5.5).
  Move is deliberately not ported: grip-grab is the XR Move.
**Accept:** a full panel can be built start-to-finish in VR using only
headset input; tray counts, hint, and undo/redo behave exactly as §5.5–5.6.

### P3 — Mixed reality
Scope: "Enter MR" entry (mode choice next to Enter VR); `immersive-ar`
session with hit-test reticle placement for the plate; frame/tray spawn at
offsets; free grab of all objects (desk or mid-air); passthrough backdrop.
**Accept:** plate drops onto a real desk via reticle and can be re-grabbed
anywhere; all P2 interactions work over the real desk; exit restores 2D.

### P4 — Persistence, performance, comfort
Scope: per-panel XR layout record (plate/frame/tray transforms, frame scale,
overlay state) saved on session end, restored on entry — additive optional
fields, schema stays v2; draw-call/frame audit and InstancedMesh tuning;
sweep-speed tuning; Paul's hardware checklist run.
**Accept:** layout restored across sessions; ≤ 8 draw calls; 20-minute
building session without comfort issues; checklist complete.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Ray precision at true scale (1° wobble ≈ 1 stud at 50 cm) | Snap-assist (Q3); revisit trigger: if hardware testing still misfires, add a fingertip-scale magnifier before shipping |
| three.js bundle grows the PWA (~150 KB gz) | XR modules use dynamic imports; panel play prewarms them on WebXR-capable browsers, but creates a world only on session entry |
| Quest Browser WebXR quirks (AR hit-test, haptics) | webxr1-proven patterns; per-phase hardware checks, not one big-bang test |
| Arm fatigue on 256-dot panels | Free repositioning of plate/frame/tray; true-scale desk building in MR |
| Undo-history divergence between 2D and XR | Single shared in-memory history via the bridge — impossible by construction while one page hosts both |
| MR tracking quality on cluttered/reflective desks | Document desk-surface requirements; reticle only needs one hit to anchor |

## 8. Open Questions

- Exact `three` version to pin — decide at P0 implementation (0.186.x is the
  house precedent from the-cube).
- Whether desktop WebXR emulation should ever join the e2e smoke — default
  no; XR rendering is verified on hardware, logic via vitest.
- Hand tracking / Glasses support — deferred until Meta VR Glasses ship
  (spring 2027); the button/gesture map in §5 keeps the vocabulary small so
  a later hands layer stays simple.
