# PRD: par-dots — LEGO Dots Mosaic Game

**Status:** v1 as built (updated 2026-09-26) · **Owner:** Paul Robello

This document describes par-dots as it ships. For how the code is organized, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Table of Contents

- [1. Summary](#1-summary)
- [2. Goals and Non-Goals](#2-goals-and-non-goals)
- [3. Tech Stack and Constraints](#3-tech-stack-and-constraints)
- [4. Core Concepts](#4-core-concepts)
- [5. User Flows](#5-user-flows)
- [6. Visual Design (2D with 3D look)](#6-visual-design-2d-with-3d-look)
- [7. Audio, Haptics, Settings, Stats](#7-audio-haptics-settings-stats)
- [8. Image Processing](#8-image-processing)
- [9. Data Model (IndexedDB)](#9-data-model-indexeddb)
- [10. Performance and Accessibility](#10-performance-and-accessibility)
- [11. Acceptance Criteria](#11-acceptance-criteria)
- [12. Milestones](#12-milestones)
- [13. Hosting and Deployment](#13-hosting-and-deployment)
- [14. Open Questions](#14-open-questions)

## 1. Summary

A mobile-first web game that recreates the LEGO Dots picture-building experience. The player picks a bundled photo or uploads their own, the image is quantized to at most 32 colors (the player can lower the cap) and split into a grid of 16×16-stud panels, and the player rebuilds the picture one panel at a time by placing round dots onto a LEGO baseplate. Play is 2D (top-down, tap/drag) with a 3D look (shaded studs, glossy dots, soft shadows).

## 2. Goals and Non-Goals

**Goals**
- G1. Faithful, tactile "build a LEGO Dots mosaic" feel on phones.
- G2. Any photo becomes a playable puzzle in seconds, entirely on-device.
- G3. Smooth 60 fps interaction on mid-range mobile devices.
- G4. Works offline and keeps progress across sessions.

**Non-Goals (v1)**
- Accounts, cloud sync, multiplayer, sharing to social networks.
- Stock photo APIs.
- Dot shape variety (squares, quarter circles). Round dots only.
- True 3D rendering or camera rotation.
- Scoring, leaderboards, limited hints.

## 3. Tech Stack and Constraints

| Area | Decision |
|---|---|
| Build | Vite + TypeScript (strict), no UI framework |
| Board rendering | HTML Canvas 2D with pre-rendered stud/dot sprites (pseudo-3D) |
| UI chrome | Plain DOM + CSS (menus, tray, toolbar) |
| Storage | IndexedDB (saves, uploaded images), localStorage (settings) |
| Offline | PWA: service worker + web manifest, installable |
| Processing | Image quantization in a Web Worker |
| Backend | None. Uploads never leave the device. |
| Hosting | GitHub Pages at custom domain `dots.pardev.net` (see §13) |
| Tooling | Bun; Makefile targets `install`, `library`, `dev`, `build`, `preview`, `test`, `coverage`, `lint`, `fmt`, `typecheck`, `checkall`, `e2e`, `clean`; Biome for lint and format; Vitest for unit tests; a Playwright smoke test for E2E |

Targets: iOS Safari 17+, Android Chrome (latest two), desktop Chrome/Safari/Firefox as a secondary target. Portrait phone orientation is primary; landscape must remain usable.

## 4. Core Concepts

- **Picture:** a source image processed into a target mosaic, a palette, and panel layout.
- **Aspect / layout:**
  - Square 1:1 → 3×3 = **9 panels**, 48×48 studs.
  - Portrait 3:4 → 3 cols × 4 rows = **12 panels**, 48×64 studs.
  - Landscape 4:3 → 4 cols × 3 rows = **12 panels**, 64×48 studs.
- **Panel:** a 16×16 stud baseplate section (256 studs). Every stud gets exactly one target color (no empty target cells).
- **Palette:** at most `maxColors` colors for the whole picture (4 to 32, default 32). A panel uses a subset.
- **Stud state:** `empty` or `placed(colorIndex)`. A placed dot is correct if it equals the target.

## 5. User Flows

### 5.1 Home / Gallery
- Shows saved pictures (in progress and completed) as thumbnails with progress % and elapsed time.
- Actions per save: Continue (View when complete), Restart (confirm), Delete (confirm), and Download PNG for completed pictures.
- "New Picture" button opens the picture source screen.

### 5.2 New Picture — Source
- **Bundled library:** the 12 user-provided starter images in `images/` (owner-supplied, licensed for use), already cleaned: metadata stripped, orientation applied, max 1024 px long edge, JPEG. A build step copies them into `public/library/`, converts to WebP, and generates a thumbnail plus a manifest with each image's default aspect and default crop.
  - Square defaults (1:1): pixel-beach, pixel-sheep-rider, sheep-in-space, leaping-bunnies, emotional-support-hotdog.
  - Portrait defaults (3:4): dachshund-in-hat, lighthouse, concert-singer, autumn-tree (tall 9:19.5, center-cropped).
  - Landscape defaults (4:3): cartoon-dachshunds, cheshire-cat, orange-sunset (16:9, center-cropped).
  - Every library image can be re-cropped to any aspect in the crop editor.
- **Upload:** file picker accepting any image type the browser can decode (JPEG, PNG, WebP, and HEIC where supported; camera capture on mobile). Max input 20 MB.
- **Image link:** a URL field downloads an image from another site. Only `https:` links are accepted (a bare host such as `example.com/a.jpg` gets `https://` prepended). The request omits credentials and the referrer, the host must allow cross-origin reads (CORS), the body is streamed and aborted past 20 MB, and the download times out after 30 s. When the download fails, the app suggests saving the image and uploading it instead. The picture is named from the last path segment, falling back to the host name.
- **Pixel limit:** uploads and links are rejected before decoding when the image declares more than 40 megapixels. Accepted images are decoded with EXIF orientation applied and downscaled to a 1024 px long edge.
- Uploads are stored on the device with the save; library pictures are referenced by slug and never copied.

### 5.3 New Picture — Setup
1. **Crop editor:** aspect picker (1:1, 3:4, 4:3); pan and pinch-zoom the image under a fixed crop frame. Bundled photos default to their native aspect but can be re-cropped.
2. **Palette mode toggle:**
   - *LEGO colors:* up to `maxColors` colors chosen from the official LEGO solid color set (43 colors, table stored in code with its source cited).
   - *Free colors:* the best `maxColors` colors for the photo (seeded k-means in Lab space).
3. **Max colors slider:** caps the palette from 4 (`MIN_COLORS`) to 32 (`MAX_COLORS`). The final palette can be smaller than the cap: the image may have fewer colors, and near-identical colors are merged (§8).
4. **Live mosaic preview** updates as crop, palette mode or max colors change (debounced, worker-computed) and reports the stud size, panel count and color count.
5. Palette mode and max colors are remembered as settings for the next picture.
6. **Start** creates the save and opens the Overview.

### 5.4 Overview (full picture)
- Renders the full picture on a baseplate grid with panel borders. With a mouse, hovering a panel outlines it.
- Completed studs render as placed dots. Unstarted/empty areas show the empty baseplate; the **Ghost** toggle shows the target mosaic faintly.
- Each panel shows a small completion badge (%, check mark when done). When every panel is done, the badges and panel seams are replaced by one green frame around the picture.
- Tap any panel (any order), or use the numbered panel buttons, to zoom into it with an animated zoom transition.
- Shows overall progress %, total elapsed time, panel count and color count. A completed picture shows **View picture** (the finished mosaic in a sheet, with its own download) and **Download PNG** buttons.
- **Guide** downloads printable building sheets: every panel as a PDF with one panel per US Letter page, or one chosen panel as a PNG.

### 5.5 Panel Play
Layout (portrait phone, top to bottom):
- **Top bar:** back to Overview, panel label (e.g. "Panel 5 / 12"), progress %, timer, settings.
- **Reference image:** the panel's target mosaic as a thumbnail, tappable to enlarge. The **Overlay** toggle, or holding a two-finger pinch on the board, shows the target colors faintly on empty studs, each marked with its color's symbol (A, B, C, … as on the building sheets), and shows the same symbol on each tray dot. Symbols are hidden while the overlay is off.
- **Board:** the 16×16 stud baseplate filling the width, with pinch-zoom and pan for small screens.
- **Toolbar:** Remove, Move, Hint, Undo, Redo.
- **Color tray:** single horizontal, scrollable row of dots, one per color still needed in this panel, each showing how many dots of that color are left in hand: the panel's studs of that color minus the dots of it already placed, right or wrong.
- A panel that was already complete when opened shows "Panel complete" instead of the toolbar and tray.

Interaction:
- **Select color:** tap a dot in the tray (selected state is clearly raised/outlined). Selecting a color exits Remove and Move modes. When the selected color leaves the tray, the next color (else the previous one) is selected.
- **Paint:** tap a stud, or drag across studs, to place the selected color. Occupied studs are ignored (a dot must be removed first). Incorrect colors may be placed.
- **Remove tool:** toggle on; tap or drag across studs to remove dots. Works on correct and incorrect dots.
- **Move tool:** toggle on; one finger (or the mouse) pans the zoomed board instead of painting. Remove and Move are mutually exclusive. A completed panel always pans.
- **Hint:** outlines/flashes every incorrectly placed dot in the current panel for 3 s and toasts the count. Unlimited. If none are wrong, show a brief "No mistakes" toast.
- **Full but wrong:** when every stud holds a dot but some are wrong, the app plays an error buzz and haptic once on entering that state, and the Hint button pulses until tapped.
- **Dot supply:** a color at 0 cannot be placed. If it is still in the tray at 0, at least one of its dots is on a wrong stud, and the dot is dimmed until one is removed.
- **Tray depletion:** when every stud whose target is color C holds a correct C dot, C is removed from the tray (animated). If the player later removes one of those correct dots, C returns to the tray.
- **Gesture disambiguation:** one finger paints or removes; two fingers pan/zoom; the mouse wheel zooms. A touch is held 70 ms (or until it drifts 10 px) before it paints, so the first finger of a pinch never paints; a second finger within 300 ms cancels the stroke. A drag must not scroll the page, and page zoom is locked.
- **Keyboard:** Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z redoes, and Escape returns to the Overview when no sheet or dialog is open.

### 5.6 Undo / Redo
- One continuous paint or remove stroke equals one move.
- History is per panel, max 10 moves; oldest dropped beyond 10.
- A new move clears the redo stack.
- Undo/redo restore tray membership consistently with the resulting board.
- History is kept in memory for the open panel only and is not persisted across reloads or panel switches.

### 5.7 Completion
- **Panel complete:** all 256 studs correct → celebration animation + sound/haptic, then animated return to Overview with the panel marked done. The panel remains viewable but is locked.
- **Picture complete:** after the last panel, a finale animation, final stats (panels, dots, total time), and **Download PNG** that renders the finished mosaic in the dot style.
- **PNG download** is available from the finale, from the Overview of a completed picture, and from the gallery card of a completed picture. The file is named `<picture-name>-dots.png`.

## 6. Visual Design (2D with 3D look)

- **Baseplate:** colored plastic plate with a stud on every cell; each stud has a top highlight, rim, and drop shadow (radial gradients) to read as raised.
- **Dots:** round 1×1 tiles, slightly larger than the stud, with a glossy specular highlight, subtle edge darkening, and a soft shadow. Colors come from the palette.
- **Tray dots:** same sprite, larger; selected dot raised with scale and a ring.
- **Rendering:** one sprite per palette color pre-rendered to offscreen canvases at device pixel ratio, blitted per cell. Redraw only dirty cells during strokes.
- **Motion:** placement "press" micro-animation, tray removal animation, panel zoom in/out, celebration. Respect `prefers-reduced-motion`.

## 7. Audio, Haptics, Settings, Stats

- A place sound on place (five variants: Snap, Click, Pop, Tick, Blip), a softer sound on remove, a chime on color completed, an error buzz on full-but-wrong, and fanfares on panel and picture complete. All sounds are synthesized with the Web Audio API; no audio files ship.
- Haptics via `navigator.vibrate` where supported (iOS Safari lacks it; degrade silently).
- The settings sheet (gear button on the play screen) offers Sound on/off, Place sound (tap to preview), Haptics on/off, Background color, and Install app when not already installed.
- On the first panel played in a mobile browser, the app offers once to install itself.

Settings are stored in localStorage under `par-dots:settings`:

| Setting | Values | Default | Changed in |
|---|---|---|---|
| `sound` | on/off | on | Settings sheet |
| `placeSound` | `snap`, `click`, `pop`, `tick`, `blip` | `snap` | Settings sheet |
| `haptics` | on/off | on | Settings sheet |
| `paletteMode` | `lego`, `free` | `lego` | Setup screen |
| `maxColors` | integer 4–32 | 32 | Setup screen |
| `background` | `gray`, `blue`, `green`, `brown`, `purple` | `gray` | Settings sheet |

- Timer counts only while a panel is open and the page is visible. Progress % = correct studs / total studs, per panel and overall.

## 8. Image Processing

1. Decode, apply EXIF orientation, downscale.
2. Crop to the chosen aspect, then resample to stud resolution (48×48, 48×64, or 64×48) with area averaging.
3. Quantize to at most `maxColors` (4–32) colors. Transparent pixels are composited over white.
   - LEGO mode: choose up to `maxColors` entries from the LEGO color table that minimize weighted Lab ΔE (greedy selection, then swap refinement), then map pixels.
   - Free mode: k-means (k-means++ seeding with a fixed seed, deterministic) in Lab space; each color is named after its nearest LEGO color.
   - Minimum contrast: any two palette colors closer than ΔE 12 (CIE76, `MIN_DELTA_E`) are merged, keeping the one that covers more studs, so every tray color is tellable apart. The palette can end up smaller than `maxColors`.
   - The palette is sorted dark to light and holds only colors actually used.
   - No dithering (clean mosaic); optional dithering is out of scope for v1.
4. Output target grid (color index per stud) and palette. Panel color lists are derived at play time. Processing is deterministic for the same input and settings.
5. Target: under 1 s on a mid-range phone.

## 9. Data Model (IndexedDB)

The source of truth is `src/types.ts`:

```ts
export type Aspect = '1:1' | '3:4' | '4:3';
export type PaletteMode = 'lego' | 'free';

export const PANEL_SIZE = 16;
export const EMPTY = 255; // placed value for a stud with no dot
export const MAX_COLORS = 32;
export const MIN_COLORS = 4;
export const SAVE_SCHEMA_VERSION = 1;

export interface PaletteColor {
  hex: string; // "#rrggbb"
  name: string; // LEGO color name (free mode: nearest LEGO name)
}

export interface Mosaic {
  width: number; // studs
  height: number;
  palette: PaletteColor[]; // length <= MAX_COLORS
  target: Uint8Array; // palette index per stud, row-major, length width*height
}

export interface PictureSave extends Mosaic {
  schemaVersion: number; // SAVE_SCHEMA_VERSION when written
  id: string;
  createdAt: number; // epoch ms
  updatedAt: number;
  name: string;
  sourceImageId: string; // key into the images store, or "library:<slug>"
  aspect: Aspect;
  paletteMode: PaletteMode;
  placed: Uint8Array; // EMPTY or palette index, row-major
  panelElapsedMs: number[]; // visible play time per panel, row-major panel order
  completedAt?: number;
}
```

- Database `par-dots`, version 1. Store `saves` (keyPath `id`) holds `PictureSave` records; store `images` holds uploaded image blobs keyed by the save's `sourceImageId`. Library pictures store only `library:<slug>` and have no image blob.
- Saves are validated and migrated on read (`migrateSave`); records that are malformed or come from a newer build are skipped.
- A new upload's image and save are written in one transaction, so a failure leaves neither behind. Deleting a save deletes its uploaded image.
- Board state is saved at the end of each stroke, after undo/redo, when the page is hidden, when leaving the panel, and when a panel completes.
- Settings live in localStorage (§7). Storage quota errors surface a clear "Storage is full" message.

## 10. Performance and Accessibility

- 60 fps during drag painting; input-to-paint latency < 50 ms.
- First load < 2 s on 4G after first visit (then offline).
- Tap targets ≥ 44 px for tray and toolbar; board supports zoom so studs can be enlarged.
- Colorblind support: each tray dot and hint has a text label/tooltip of the color name; hints use outline shape, not color alone.
- Screen reader labels on all controls.

## 11. Acceptance Criteria

- AC1. A bundled photo and an uploaded photo can each be started in all three aspects.
- AC2. Square pictures produce 9 panels, portrait and landscape produce 12, each 16×16 studs.
- AC3. Palette never exceeds the chosen max colors (at most 32) in either mode; LEGO mode uses only LEGO table colors; no two palette colors are closer than ΔE 12.
- AC4. The tray lists exactly the colors not yet fully and correctly placed in the current panel, and updates on place, remove, undo, and redo.
- AC5. Incorrect dots can be placed; Hint highlights exactly the incorrect dots of the current panel.
- AC6. Occupied studs cannot be painted over; Remove clears a stud.
- AC7. Undo/redo operate on strokes, cap at 10, per panel.
- AC8. Completing a panel returns to the Overview with the panel marked done; completing all panels shows the finale and PNG download.
- AC9. Progress persists across reloads; multiple saves coexist in the gallery.
- AC10. The app installs as a PWA and plays fully offline after first load.
- AC11. Drag painting stays at 60 fps on a mid-range phone (profiled).

## 12. Milestones

1. **M1 Core engine:** data model, quantization worker, panel slicing, unit tests.
2. **M2 Board:** canvas renderer, stud/dot sprites, paint/remove/drag, gestures.
3. **M3 Game rules:** tray depletion, hint, undo/redo, completion.
4. **M4 Screens:** gallery, source picker, crop editor, overview, transitions.
5. **M5 Persistence + PWA:** IndexedDB, service worker, offline.
6. **M6 Polish:** audio, haptics, stats, animations, accessibility, performance pass, E2E tests.

## 13. Hosting and Deployment

- Static build deployed to GitHub Pages by `.github/workflows/deploy.yml` on push to `main` (and on manual dispatch).
- The `check` job installs dependencies with a frozen lockfile, runs `bun run lint`, `bun run typecheck`, `bun run test` and `bun run build`, then installs Playwright Chromium and runs the browser smoke test (`scripts/e2e.sh`) against `vite preview` before uploading `dist/` as the Pages artifact. The `deploy` job runs only after `check` succeeds.
- Canonical URL: `https://dots.pardev.net`, served from root, so Vite `base` stays `/`. Service worker scope and manifest `start_url` are `/`.
- Domain setup, live verification and rollback are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- AC12. `https://dots.pardev.net` serves the app over HTTPS and it installs and plays offline.

## 14. Open Questions

No open questions remain for v1.

- OQ1 (closed). LEGO color table: the current production solid colors from the Rebrickable color list (names match BrickLink), in `src/engine/legoPalette.ts`. Every color in that table is treated as available.
- OQ2 (closed). The app is named par-dots. Its favicon and PWA icons (a green plate with flat dots) are drawn by `scripts/build-icons.ts`; `bun run icons` regenerates them and writes the SVG master to `assets/icon-master.svg`.
