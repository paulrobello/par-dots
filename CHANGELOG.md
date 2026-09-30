# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Uploaded images with transparency now composite over a chosen background color on the setup screen, defaulting to black instead of white, with black and white swatches plus a custom color picker.

### Changed

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
