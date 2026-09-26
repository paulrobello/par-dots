# PRD: par-dots — LEGO Dots Mosaic Game

**Status:** Draft v1 · **Date:** 2026-09-26 · **Owner:** Paul Robello

## 1. Summary

A mobile-first web game that recreates the LEGO Dots picture-building experience. The player picks a bundled photo or uploads their own, the image is quantized to at most 32 colors and split into a grid of 16×16-stud panels, and the player rebuilds the picture one panel at a time by placing round dots onto a LEGO baseplate. Play is 2D (top-down, tap/drag) with a 3D look (shaded studs, glossy dots, soft shadows).

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
| Tooling | Makefile targets `build`, `test`, `lint`, `fmt`, `typecheck`, `checkall`; Vitest for unit tests, Playwright for E2E |

Targets: iOS Safari 17+, Android Chrome (latest two), desktop Chrome/Safari/Firefox as a secondary target. Portrait phone orientation is primary; landscape must remain usable.

## 4. Core Concepts

- **Picture:** a source image processed into a target mosaic, a palette, and panel layout.
- **Aspect / layout:**
  - Square 1:1 → 3×3 = **9 panels**, 48×48 studs.
  - Portrait 3:4 → 3 cols × 4 rows = **12 panels**, 48×64 studs.
  - Landscape 4:3 → 4 cols × 3 rows = **12 panels**, 64×48 studs.
- **Panel:** a 16×16 stud baseplate section (256 studs). Every stud gets exactly one target color (no empty target cells).
- **Palette:** at most 32 colors for the whole picture. A panel uses a subset.
- **Stud state:** `empty` or `placed(colorIndex)`. A placed dot is correct if it equals the target.

## 5. User Flows

### 5.1 Home / Gallery
- Shows saved pictures (in progress and completed) as thumbnails with progress % and elapsed time.
- Actions per save: Continue, Restart (confirm), Delete (confirm).
- "New Picture" button opens the picture source screen.

### 5.2 New Picture — Source
- **Bundled library:** the 12 user-provided starter images in `images/` (owner-supplied, licensed for use), already cleaned: metadata stripped, orientation applied, max 1024 px long edge, JPEG. A build step copies them into `public/library/`, converts to WebP, and generates a thumbnail plus a manifest with each image's default aspect and default crop.
  - Square defaults (1:1): pixel-beach, pixel-sheep-rider, sheep-in-space, leaping-bunnies, emotional-support-hotdog.
  - Portrait defaults (3:4): dachshund-in-hat, lighthouse, concert-singer, autumn-tree (tall 9:19.5, center-cropped).
  - Landscape defaults (4:3): cartoon-dachshunds, cheshire-cat, orange-sunset (16:9, center-cropped).
  - Every library image can be re-cropped to any aspect in the crop editor.
- **Upload:** file picker accepting JPEG/PNG/WebP/HEIC-where-supported (also camera capture on mobile). Max input 20 MB; images downscaled before processing.

### 5.3 New Picture — Setup
1. **Crop editor:** aspect picker (1:1, 3:4, 4:3); pan and pinch-zoom the image under a fixed crop frame. Bundled photos default to their native aspect but can be re-cropped.
2. **Palette mode toggle:**
   - *LEGO palette:* snap to up to 32 colors chosen from the official LEGO solid color set (table stored in code, cited source).
   - *Free palette:* best 32 colors for the photo (k-means or median cut in Lab space).
3. **Live mosaic preview** updates as crop or palette mode changes (debounced, worker-computed).
4. **Start** creates the save and opens the Overview.

### 5.4 Overview (full picture)
- Renders the full picture on a baseplate grid with panel borders.
- Completed studs render as placed dots. Unstarted/empty areas show the empty baseplate, with an optional toggle to view the target mosaic faintly.
- Each panel shows a small completion badge (%, check mark when done).
- Tap any panel (any order) to zoom into it with an animated zoom transition.
- Shows overall progress % and total elapsed time.

### 5.5 Panel Play
Layout (portrait phone, top to bottom):
- **Top bar:** back to Overview, panel label (e.g. "Panel 5 / 12"), progress %, timer.
- **Reference image:** the panel's target mosaic as a thumbnail, tappable to enlarge or toggle overlay; pinch-toggle on the board also shows it. This is the player's only color guidance (no numbers, no ghost tints).
- **Board:** the 16×16 stud baseplate filling the width, with pinch-zoom and pan for small screens.
- **Toolbar:** Remove tool, Hint, Undo, Redo.
- **Color tray:** single horizontal, scrollable row of dots, one per color still needed in this panel.

Interaction:
- **Select color:** tap a dot in the tray (selected state is clearly raised/outlined). Selecting a color exits Remove mode.
- **Paint:** tap a stud, or drag across studs, to place the selected color. Occupied studs are ignored (a dot must be removed first). Incorrect colors may be placed.
- **Remove tool:** toggle on; tap or drag across studs to remove dots. Works on correct and incorrect dots.
- **Hint:** outlines/flashes every incorrectly placed dot in the current panel for ~3 s. Unlimited. If none are wrong, show a brief "No mistakes" toast.
- **Tray depletion:** when every stud whose target is color C holds a correct C dot, C is removed from the tray (animated). If the player later removes one of those correct dots, C returns to the tray.
- **Gesture disambiguation:** one finger paints or removes; two fingers pan/zoom. A drag must not scroll the page.

### 5.6 Undo / Redo
- One continuous paint or remove stroke equals one move.
- History is per panel, max 10 moves; oldest dropped beyond 10.
- A new move clears the redo stack.
- Undo/redo restore tray membership consistently with the resulting board.
- History is kept in memory for the open panel only and is not persisted across reloads or panel switches.

### 5.7 Completion
- **Panel complete:** all 256 studs correct → celebration animation + sound/haptic, then animated return to Overview with the panel marked done. The panel remains viewable but is locked.
- **Picture complete:** after the last panel, a finale animation, final stats (total time), and "Export PNG" that renders the finished mosaic in the dot style.

## 6. Visual Design (2D with 3D look)

- **Baseplate:** colored plastic plate with a stud on every cell; each stud has a top highlight, rim, and drop shadow (radial gradients) to read as raised.
- **Dots:** round 1×1 tiles, slightly larger than the stud, with a glossy specular highlight, subtle edge darkening, and a soft shadow. Colors come from the palette.
- **Tray dots:** same sprite, larger; selected dot raised with scale and a ring.
- **Rendering:** one sprite per palette color pre-rendered to offscreen canvases at device pixel ratio, blitted per cell. Redraw only dirty cells during strokes.
- **Motion:** placement "press" micro-animation, tray removal animation, panel zoom in/out, celebration. Respect `prefers-reduced-motion`.

## 7. Audio, Haptics, Stats

- Click sound on place, softer sound on remove, chime on color completed, fanfare on panel/picture complete. Web Audio API, preloaded.
- Haptics via `navigator.vibrate` where supported (iOS Safari lacks it; degrade silently).
- Settings: sound on/off, haptics on/off.
- Timer counts only while a panel is open and the page is visible. Progress % = correct studs / total studs, per panel and overall.

## 8. Image Processing

1. Decode, apply EXIF orientation, downscale.
2. Crop to the chosen aspect, then resample to stud resolution (48×48, 48×64, or 64×48) with area averaging.
3. Quantize to ≤32 colors:
   - LEGO mode: choose up to 32 palette entries from the LEGO color table that minimize error (Lab ΔE), then map pixels.
   - Free mode: k-means (seeded, deterministic) in Lab space.
   - No dithering by default (clean mosaic); optional dithering is out of scope for v1.
4. Output target grid (color index per stud), palette, and per-panel color lists. Processing is deterministic for the same input and settings.
5. Target: under 1 s on a mid-range phone.

## 9. Data Model (IndexedDB)

```ts
interface PictureSave {
  id: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  sourceImageId: string;          // blob in images store
  aspect: '1:1' | '3:4' | '4:3';
  paletteMode: 'lego' | 'free';
  palette: string[];              // hex, length <= 32
  width: number;                  // studs
  height: number;
  target: Uint8Array;             // palette index per stud
  placed: Uint8Array;             // 255 = empty, else palette index
  panelElapsedMs: number[];
  completedAt?: number;
}
```

Stores: `saves`, `images`, plus localStorage `settings`. Board state is saved at the end of each stroke. Storage quota errors surface a clear message.

## 10. Performance and Accessibility

- 60 fps during drag painting; input-to-paint latency < 50 ms.
- First load < 2 s on 4G after first visit (then offline).
- Tap targets ≥ 44 px for tray and toolbar; board supports zoom so studs can be enlarged.
- Colorblind support: each tray dot and hint has a text label/tooltip of the color name; hints use outline shape, not color alone.
- Screen reader labels on all controls.

## 11. Acceptance Criteria

- AC1. A bundled photo and an uploaded photo can each be started in all three aspects.
- AC2. Square pictures produce 9 panels, portrait and landscape produce 12, each 16×16 studs.
- AC3. Palette never exceeds 32 colors in either mode; LEGO mode uses only LEGO table colors.
- AC4. The tray lists exactly the colors not yet fully and correctly placed in the current panel, and updates on place, remove, undo, and redo.
- AC5. Incorrect dots can be placed; Hint highlights exactly the incorrect dots of the current panel.
- AC6. Occupied studs cannot be painted over; Remove clears a stud.
- AC7. Undo/redo operate on strokes, cap at 10, per panel.
- AC8. Completing a panel returns to the Overview with the panel marked done; completing all panels shows the finale and PNG export.
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

- Static build deployed to GitHub Pages via a GitHub Actions workflow (`actions/deploy-pages`) on push to `main`, gated on `make checkall`.
- Canonical URL: `https://dots.pardev.net`, served from root, so Vite `base` stays `/`.
- Setup order (house pattern for `*.pardev.net`):
  1. Create a DNS-only (unproxied) Cloudflare CNAME `dots.pardev.net` → `paulrobello.github.io` in zone `pardev.net`. This overrides the `*.pardev.net` wildcard that otherwise routes to lenny1 and 404s.
  2. Commit `public/CNAME` containing `dots.pardev.net`.
  3. Register the custom domain explicitly via `PUT /repos/paulrobello/par-dots/pages` (the CNAME file alone does not register it), then enable Enforce HTTPS once the certificate is issued.
- Service worker scope and manifest `start_url` are `/`.
- Verification: load the live site and play a panel; an HTTP 200 alone is not acceptance.
- AC12. `https://dots.pardev.net` serves the app over HTTPS and it installs and plays offline.

## 14. Open Questions

- OQ1. Source for the official LEGO color table (e.g. BrickLink/Rebrickable color list) and which subset counts as "Dots-available".
- OQ2. App name and icon.
