# ENH-007 — Draw your own picture

## Goal

A new "draw your own" mode beside the photo pipeline. The player chooses aspect and palette (LEGO or Free) and an optional background, then draws the mosaic directly: one continuous canvas across all panels with visible seams, pan and zoom, and tools that draw across panel seams in a single operation. The drawing is a first-class save in its own gallery list, never "completes", and a LEGO-mode drawing exports parts lists, BrickLink wanted lists and printable panel instructions exactly like a photo picture.

## Current state

- The gallery (`src/ui/gallery.ts`) shows one list of photo saves; `#/new` (`src/ui/source.ts`) offers upload, URL and library; `#/setup` (`src/ui/setup.ts`) quantizes a source image into a `PictureSave`.
- `PictureSave` (`src/types.ts`) is schema v1 with no origin concept; `migrateSave()` (`src/storage/migrate.ts`) rejects `target` entries ≥ palette length (so `EMPTY` in `target` is invalid today).
- Play rules (`PanelSession`, `trayModel`) are target-centric; drawn saves have no target, so they get sibling modules rather than mode flags inside play code.
- `renderMosaicToCanvas` already accepts a `cells` override and draws EMPTY cells as bare studs, so drawn thumbnails work as-is with `{ cells: placed }`.
- Parts and panel-sheet exports gate on `paletteMode === 'lego'` and count colors from `target` (`colorCounts`, `panelColorCounts` in `src/game/progress.ts`), which is all-EMPTY for drawn saves — they must read `placed` there.

## Design decisions

- **Data:** `PictureSave` gains `origin: 'photo' | 'drawn'` and `drawBackground?: string` (hex, absent for none). `SAVE_SCHEMA_VERSION` → 2. Drawn saves keep `target` all-EMPTY forever; the artwork lives in `placed`; `completedAt` is never set; `panelElapsedMs` stays zeros.
- **Structure:** sibling draw modules sharing primitives (O2) — new DOM-free `game/drawSession.ts` + `game/drawTools.ts`, `render/drawBoard.ts`, `ui/drawCreate.ts`, `ui/drawEditor.ts`, `ui/drawTray.ts`. `PanelSession`, `trayModel` and all play rules stay untouched.
- **One grid, no per-panel clipping:** the editor operates on the whole `width×height` stud grid; panels are render guides (seam lines) and output units (instructions, parts), never tool boundaries.
- **No finish line:** drawn saves have no completion celebration or done badge; the gallery card is always "Continue".

## Implementation

1. **Types and migration (schema v2)** in `src/types.ts` + `src/storage/migrate.ts`:
   - Add `origin: 'photo' | 'drawn'` (required in the type; optional-field tolerance at runtime) and optional `drawBackground?: string` (validated as `#rrggbb` when present).
   - `SAVE_SCHEMA_VERSION = 2`. In `migrateSave()`: stamp `origin: 'photo'` when absent; accept `target[i] === EMPTY` (skip the index check there, keep placed checks); validate `drawBackground` shape when present.
   - Backup round-trip (`src/storage/backup.ts`) spreads saves, so the new fields flow through — verify with a round-trip test.
2. **Drawing tools** in new DOM-free `src/game/drawTools.ts` (pure, unit-tested): `brushCells(x, y, size, tip)`, `lineCells(x0, y0, x1, y1)`, `rectCells(...)`, `ellipseCells(...)`, `polygonCells(points)` (scanline fill + boundary), `floodCells(grid, w, h, x, y)` (BFS over equal-value region, EMPTY fillable). Coordinates are whole-grid studs; shapes span panels freely.
3. **Draw session** in new DOM-free `src/game/drawSession.ts`, mirroring PanelSession's role: owns tool state (tool, brush size/tip, fill/stroke flags, primary/secondary color), consumes input intents (stroke begin/extend, shape commit, flood, pick), applies tool output to `save.placed` in place, and emits change events; UI persists on those events via `persistSave`, as panel play does. Optional symmetry mirror (horizontal/vertical axes, toggleable): every applied operation also paints its mirrored cells. The session derives per-color usage counts (placed dots per palette index) and includes them in change events. Eraser paints `drawBackground` (its palette index) or EMPTY when background is None. Undo/redo with per-operation inverse cell maps, depth 50. Palette: `addColor(hex, name)` / `removeColor(index)` (unused colors only), capped at MAX_COLORS. `recolor(index, hex)` rewrites the slot's entry — since cells store palette indices, every dot already placed with that index recolors with it; the operation is undoable (records the old entry). In LEGO mode recolor means choosing a different LEGO color from `LEGO_COLORS` (hex and name swap together, keeping names and catalog IDs valid for parts export); in Free mode any hex with a derived shade name. Recolored palettes are not re-sorted (photo palettes are luminance-ordered for symbol assignment; drawn saves may drift, a cosmetic effect only). New saves seed a two-color palette: in LEGO mode the LEGO table's black and white entries, in Free mode pure black and white.
4. **Renderer** in new `src/render/drawBoard.ts`: whole-mosaic Canvas 2D view with a pan/zoom viewport (`devicePixelRatioSafe`), placed dots via the sprite cache (`drawDot`/`drawStud`, EMPTY as bare stud), seam lines every PANEL_SIZE studs, a faint per-stud grid overlay shown past a zoom threshold, double-tap toggling between fit-to-screen and 1:1, a transient tool-preview overlay, screen→stud hit-testing, and a dirty-flag rAF loop that runs only while dirty.
5. **Tray** in new `src/ui/drawTray.ts`: quick color select at the bottom (same visual language as play's tray) with primary/secondary slots and swap, plus an "Add color" sheet — LEGO mode: grid of all `LEGO_COLORS` with names; Free mode: native color input. Unused palette colors removable; every slot has an edit affordance (opens the same sheet in recolor mode, with a note that placed dots change color too); each swatch shows its usage count (placed dots with that color); cap message at 32.
6. **Editor screen** in new `src/ui/drawEditor.ts` (route `#/draw/:id`): topbar (back, name, undo/redo, Clear all behind a confirm dialog, "?" help), tool bar (pan, brush, line, box, ellipse, polygon, fill, eyedropper, eraser; contextual controls for size/tip and fill/stroke toggles; symmetry mirror toggles; the line tool snaps to 0°/45°/90° when within a few degrees — snap helper in pure `drawTools` so it is unit-testable), canvas, tray, and a live dot counter in the topbar. Tool buttons carry `title`/`aria-label`; the help sheet (registered overlay) explains every tool. Wires pointer input to session intents — reuse `gestures.ts` where it fits, else a thin `ui/drawInput.ts` variant. Standard screen contract: `Cleanup`, `alive` checks after awaits, `registerOverlay()` for sheets.
7. **Create screen** in new `src/ui/drawCreate.ts` (route `#/draw/new`): Name (default "My drawing"), aspect segmented control, palette mode segmented control (defaulted from and persisted to settings), Background (None / black / white / custom color input). Create → `createSave()` with `origin: 'drawn'`, `target` all EMPTY, `placed` pre-filled with the background color (or EMPTY), palette seeded per mode (LEGO table's black and white, or pure black and white in Free mode), plus the background color when a custom one is set, then navigate to the editor.
8. **Routing** in `src/ui/pure.ts` + `src/main.ts`: new routes `drawNew` (`#/draw/new`) and `drawEditor` (`#/draw/:id`), plus `routeHash` inverses. `#/draw/new` parses as create (save ids never collide with `'new'`); any other `#/draw/:id` mounts the editor, which redirects to the gallery for unknown ids.
9. **Gallery and source**: `mountGallery` renders "Your pictures" (photo saves, unchanged) and a "My drawings" section (drawn saves): thumbnail with `{ cells: placed }`, name, dot count ("N dots" — count non-EMPTY placed; no percent, no time, no done badge), and Continue / Download PNG / Back up / Restart / Delete (restart restores the background fill or empty grid, and clears nothing else — drawn saves carry no progress). `mountSource` gains a "Make my own" card at the top → `#/draw/new`. `mountOverview` redirects drawn saves to `#/draw/:id` so old links work.
10. **Exports and counting** in `src/game/progress.ts`: add `effectiveCells(save)` (`placed` for drawn, `target` otherwise) used by `colorCounts`/`panelColorCounts`, skipping EMPTY either way; the panel-sheet and parts flows read cells through it so drawn LEGO saves produce correct parts lists, BrickLink wanted lists and printable instructions. PNG export needs no change. Confirm no gate requires photo origin.
11. **e2e**: extend the Playwright smoke test: gallery → Draw your own → create → draw a brush stroke → reload → reopen → placed dots persisted; gallery shows the drawing under "My drawings".
12. **Docs**: PRD (mode section), ARCHITECTURE (routes table, new modules, persistence note), CHANGELOG `[Unreleased]` Added.

## Files to touch

- `src/types.ts`, `src/storage/migrate.ts`, `src/storage/backup.ts`
- `src/game/drawTools.ts` (new), `src/game/drawSession.ts` (new)
- `src/render/drawBoard.ts` (new)
- `src/ui/drawCreate.ts` (new), `src/ui/drawEditor.ts` (new), `src/ui/drawTray.ts` (new), `src/ui/drawInput.ts` (new, if gestures.ts does not fit)
- `src/ui/pure.ts`, `src/main.ts`, `src/ui/gallery.ts`, `src/ui/source.ts`, `src/ui/overview.ts`, `src/ui/setup.ts` (stamps `origin: 'photo'` on new photo saves)
- `src/game/progress.ts`, `src/ui/partsSheet.ts` and `src/ui/exportImage.ts` (only if cells routing requires it)
- `src/styles.css`
- `tests/` (drawTools, drawSession, migration, backup round-trip, pure routes), `scripts/e2e-smoke.ts`
- `PRD.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`

## Dependencies

None — everything it needs exists (`LEGO_COLORS`, sprite helpers, `createSave`, backup spread, `cells` renderer override).

## Verify

1. `bunx vitest run tests/drawTools.test.ts tests/drawSession.test.ts` — rasterizers (line/box/ellipse/polygon/flood, EMPTY backgrounds, cross-seam spans), 0°/45°/90° snap, and session semantics (undo/redo depth 50, palette cap 32, eraser/background, unused-only removal, recolor updates the slot entry and re-colors placed dots, symmetry mirror paints mirrored cells, LEGO-mode recolor accepts only LEGO colors, per-color usage counts track every operation).
2. Migration tests: v1 saves stamp `origin: 'photo'`; drawn saves round-trip through `migrateSave` and through `backupSaves`/`restoreBackup`.
3. GATE (`make checkall`) passes.
4. `bun run e2e` passes with the new drawing smoke assertions.
5. Manual: create a LEGO drawing with background, draw across two seams, reopen from "My drawings", export Parts (BrickLink XML), print the panel guide, and confirm counts match the drawing; confirm a free-mode drawing offers no Parts sheet.

## Rollback

Revert the commit(s). Additive routes and modules; photo play is untouched (largest shared edit is the `migrateSave` validation relaxation, which photo data satisfies).
