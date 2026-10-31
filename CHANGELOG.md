# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- VR builders can toggle a ghost of the reference colors on empty plate pegs and select available colors directly from the reference image.

- Six bundled mosaic pictures: koi pond, camper at sunset, moonlit barn owl, butterfly garden, sunset balloon and a cozy reading scene.
- WebXR panel play (XR P0–P4): "Enter VR" / "Enter MR" chips on panel play, shown only when the headset reports the mode, drive a true-scale 16x16 build plate (one InstancedMesh of studs at 8 mm pitch) with controller placement — trigger taps place, holding A sweeps strokes (one undo move per stroke), snap-assist skips occupied studs — a floating reference frame with the building-sheet symbols and the 2D Overlay behind a toggle, a color tray with the 2D parity semantics (counts, zero-but-wrong dimmed, ring on the current color) whose selection mirrors the shared store, and Place/Remove/Hint/Undo/Redo tool buttons with hint flashes and the full-but-wrong buzz. MR enters passthrough, drops the workspace onto a real desk via a hit-test reticle facing you, and everything grip-grabs anywhere including mid-air. XR edits commit through the same PanelSession as 2D play — identical undo history and save points — and each panel's workspace layout persists on session end and is restored on the next VR entry. three.js stays in a lazy chunk 2D-only sessions never parse.
- Guide PDFs now include a Frame page between the coloring sheets and the assembly page: it builds the raised frame layer by layer with the exact pieces per side — backing (a 16x16 plate per panel plus a 1-stud border ring of plates), brick ring (longest pieces first, per-side piece lists), plate layer, then a tile cap inset 2 studs with four studded 2x2 corners for a corner plate and the hangers. The piece lists come from the same recipe as the Buy parts export (`frameRingPieces`), so what the PDF teaches and what the manifest sells cannot drift.
- Picture sizes: the setup and draw-create screens offer Small, Medium, Large and Custom. Medium doubles and Large triples the panel grid per axis (square grows from 9 to 36 to 81 panels); Custom takes typed columns and rows from 1×1 to 10×10, with the crop ratio following the grid. Preview, parts lists, printable guides and the assembly plan all scale with the grid, and existing saves keep playing unchanged.
- Draw mode: rename a drawing any time by editing its title in the draw editor's top bar.
- Imported pictures rename the same way: edit the title in the overview screen's top bar.
- Buy parts: a "No frame" choice omits the frame parts from the BrickLink wanted-list XML and Rebrickable CSV.

- Draw-your-own mode: create a blank mosaic (aspect, palette mode, background) and paint it with brush, line, box, ellipse, polygon, fill, eyedropper and eraser tools, mirror painting, a 50-move undo history, an editable palette, and — in LEGO mode — the same parts exports as photo pictures.
- Guide PDFs open with an overview page — the assembled picture with panel seams and every panel numbered to match its building sheet — then the coloring sheets, and close with an assembly page (rows joined with three black connectors per shared edge, rows joined to each other, hanging hooks) whose connector and hook counts derive from the panel layout.
- Draw mode plays the same dot-placement sounds and haptics as panel play, hovering shows a ghost of the cells the next stroke will paint, and Shift+drag pans.
- Fast styled tooltips replace native `title` tooltips throughout the app.
- Uploaded images with transparency now composite over a chosen background color on the setup screen, defaulting to black instead of white, with black and white swatches plus a custom color picker.

### Changed

- In XR, gripping and moving the thumbstick forward or backward pushes or pulls the held item; hold the trigger as well to scale it. Left/right rotation remains available while gripping.

- Redesigned the VR tool palette with clear icons, labels and a high-contrast active tool.

- XR library lists all unfinished photo projects with progress bars and thumbstick paging. Gallery-launched workspaces save their VR layout and defer updates until the immersive session ends. When MR hit testing is available, placement requires a visible surface reticle; otherwise the workspace appears at the default position.

- Replaced seven bundled pictures with simple, boldly outlined fox, submarine, dinosaur, mushroom-house, owl, rocket and sea turtle illustrations for mosaic building.
- Simplified Pixel Beach into a limited-palette scene with larger shapes for mosaic building.
- Replaced Autumn Tree's plaid background with a plain sky.
- XR workspace: grip-grab now tracks the controller's full orientation — pitch, roll and yaw — not just position, and while gripping the right thumbstick rotates (left/right) and moves (up/down) whatever is held; hold the trigger too to resize (0.4x–3x). The color tray now tilts like a desk console facing you instead of standing edge-on, so it is selectable from oblique angles. Saved workspaces from earlier builds restore unchanged.
- Faster, cache-safe update detection: the page checks for a new deploy immediately and every 5 minutes (was 60) via a network-only `/version.json` build fingerprint, and the service-worker script registers with `updateViaCache: 'none'`. A changed fingerprint triggers the normal safe apply path; nothing reloads during active XR play.
- Buy parts: the frame export is now a buildable raised frame — a backing plate one stud larger than the panels, a brick ring to panel-top height, a plate layer to dot height, and a smooth tile cap one plate above the dots, corners left studded — replacing the 1x16 brick border ring, which the pin-hole canvases cannot hold.
- Buy parts: the pin budget now matches the assembly guide's three connectors per shared edge (was five).
- The palette swap button has its own arrows icon instead of the pan tool's.

### Fixed

- Kept the 2D reference and XR controls within their panel at short desktop heights and made Overview visually distinct from panel navigation.

- Separated the Overview and Previous panel controls and kept the reference, Overlay, VR and MR controls clear of the board on narrow screens.

- VR gallery controllers now appear and select pictures or exit with B. Controller input follows connection slots, tray selection updates immediately, and highlighted pegs retain their color. Grip proximity highlights the controller marker, and the restyled tool panel can be moved.

- The raised frame's ring recipe was four studs short per studded layer: the side runs used the cap's inset length (D−4) instead of the full border span (D−2), so the backing border, brick ring and plate layer each came up one to two pieces short at the four corner junctions. Corrected per-side piece lists now appear on the Frame page and in the Buy parts exports; for a 9-panel picture the brick bill changes from ten to twelve 1x16 bricks and the plate 1x6 and 1x8/1x4 bricks drop out.
- Draw-editor partial repaints no longer stack seam and grid lines, which made white seams appear after undo and the grid brighten with every tool use.

- Free color names now describe the actual shade, including burgundy, rust, and peach, instead of borrowing the nearest LEGO name. Existing pictures show the corrected names in the tray, Parts, and building guides without changing their colors or progress. LEGO mode retains official names.
- Softer background studs, tactile dot placement with a brief highlight, smooth tray selection and count feedback, and reversible reference-overlay fades.
- Completed tray colors briefly show a checkmark before collapsing. Undo and redo safely restore colors even while they are leaving.
- Panel completion uses a light sweep and local badge. Confetti is reserved for completing the whole picture, with reduced-motion alternatives throughout.
- A tray color's count is now the dots of it left in hand, so a wrong dot uses one up. A color at 0 can no longer be placed; it stays in the tray, dimmed, while any of its dots are misplaced.
- A finished picture's overview shows one green frame instead of a check mark on every panel.
- Glass buttons, chips and panels are darker for contrast.
- The Settings gear is on every screen (gallery, New Picture, setup, overview and panel), not only the panel screen.
- View picture uses the same dark chip style as Ghost, Parts and Guide.

### Added

- Buy parts in the Parts sheet: download the picture's (or one panel's) dot counts, plus the build kit (black 16x16 pin-hole canvases, 5 Technic pins per joined edge, two wall-mount panels, a 1x16 brick border frame in black or white), as a BrickLink wanted-list XML or a Rebrickable part-list CSV. LEGO palette mode only; free shades have no catalog color.
- Google Analytics 4 measures visits and hash-route page views. The script is allowlisted in the production content-security policy; the dev server has no CSP.
- Overlay marks each empty stud with its color's symbol, as on the building sheets, and shows the symbols on the tray dots while it is on.
- View picture on the overview of a finished picture opens the finished mosaic in a sheet, next to Download PNG.
- The overview lists the picture's color count next to its panel count.
- Guide → All panels downloads a PDF with one panel per page instead of one tall PNG.
- Background music: three looping tracks (Happy, the default; Calm; Energy) generated locally with Stable Audio 3, with a Music toggle and track picker in Settings, and separate Effects volume and Music volume sliders. Music starts on the first tap, pauses while the page is hidden, and plays offline.
- Settings: Background color presets (gray, blue, green, brown, purple), applied app-wide with the browser theme color and remembered across visits.
- Back up and restore: "Back up all" in the gallery (or Back up on one card) saves pictures and their uploaded photos to a `.pardots` file; "Restore" imports one as new pictures, on any browser or after clearing site data.

### Audit remediation (2026-09-26)

Changes from the 2026-09-26 audit remediation.

### Added

- `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` and `docs/DOCUMENTATION_STYLE_GUIDE.md`; README sections for how to play, project structure, the full command list, troubleshooting and contributing; TSDoc for the data model, storage, `PanelSession`, the renderers, the worker protocol and every screen; module headers on every source file.
- Saved pictures carry a `schemaVersion` and are validated and migrated on load (`src/storage/migrate.ts`); malformed records are skipped instead of breaking the gallery.
- Service-worker updates are checked every 60 minutes and when the page becomes visible.
- `make library`, `make coverage`, `make clean` and a self-contained `make e2e` that builds, serves and runs the Playwright smoke test.
- CI runs the Playwright smoke test against the production build before deploying.
- Unit tests for the DOM helpers, gestures, panel timer, tray model, update polling, worker fallback and image headers; golden tests pinning quantizer output; a coverage threshold.

### Changed

- A new deploy no longer reloads the page mid-game: updates apply only on the gallery or overview with no sheet open, or while the page is hidden.
- The uploaded image and its new save are written in one transaction, so a failed Start leaves nothing behind.
- Settings are cached in memory; the tray and HUD resync during a stroke only when a stud changed.
- `make checkall` checks formatting instead of rewriting files; Bun is pinned through `packageManager`.
- Internal restructuring with no behavior change: panel geometry has one owner (`src/game/geometry.ts`); the save repository lives in `src/ui/saves.ts`; the panel play screen is split into gesture, timer, tray, input, view and feedback modules; the renderers share canvas helpers; the quantizer is split into named selection steps.
- Error messages shown to the player are consistent, and failures that were silent are now logged and shown.

### Fixed

- Opening a picture no longer hangs on "Loading…" when the save fails to load; the app returns to the gallery with a message.
- A malformed route hash falls back to the gallery instead of blanking the app.
- Navigating away from an open sheet or celebration closes it properly instead of leaking its listeners.
- The overview's zoom-in timer is cancelled when the screen unmounts.
- Escape on the play screen respects every open overlay.
- A quantize job that hangs in the worker finishes on the main thread after 20 seconds.
- The setup screen reports a missing 2D canvas context instead of silently drawing nothing.
- The minimum color count is enforced consistently (4 to 32) across settings, the slider and the quantizer.

### Security

- Images declaring more than 40 megapixels are rejected before decoding.
- Image links must be `https`, are streamed with a 20 MB cap and a 30-second timeout, and are fetched without credentials or a referrer.
- The production build sets a Content-Security-Policy and a `no-referrer` policy.
- The deploy workflow grants `contents: read` by default and Pages write access only to the deploy job; every action is pinned to a commit SHA.

## [0.1.0] - 2026-09-26

First release, live at https://dots.pardev.net.

### Added

- Turn a bundled picture, an uploaded photo, or an image link into a LEGO Dots mosaic of 9 or 12 panels (16x16 studs each) in square, portrait or landscape.
- LEGO colors or free colors, a Max colors slider (4 to 32), and a minimum contrast between palette colors so every tray color is tellable apart.
- Panel play with a color tray that shows remaining counts, Remove, Move, Hint, and Undo/Redo (10 strokes), plus Cmd/Ctrl+Z and Escape shortcuts.
- Pinch zoom that never paints, and a reference overlay while pinching or toggled on.
- An error buzz and pulsing Hint when a panel is full but has wrong dots.
- Overview with panel progress badges, Ghost toggle, hover highlight, and animated zoom into and out of panels.
- Celebrations for completed panels and pictures, and PNG download from the finale, the overview and the gallery.
- Synthesized sounds with five place-sound variants, and haptics.
- Offline play and installation as a PWA, with an install prompt on first mobile play.
- Progress, per-panel time and uploads saved on the device in IndexedDB.

[Unreleased]: https://github.com/paulrobello/par-dots/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/paulrobello/par-dots/releases/tag/v0.1.0
