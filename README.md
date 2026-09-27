# PAR Dots

## Table of Contents

* [About](#about)
* [Screenshots](#screenshots)
* [Features](#features)
    * [Core Capabilities](#core-capabilities)
    * [Building Tools](#building-tools)
    * [Technical Excellence](#technical-excellence)
* [Documentation](#documentation)
* [How to Play](#how-to-play)
* [Development](#development)
* [Project Structure](#project-structure)
* [Troubleshooting](#troubleshooting)
* [Contributing](#contributing)
* [What's new](#whats-new)
    * [Unreleased](https://github.com/paulrobello/par-dots/blob/main/CHANGELOG.md#unreleased)
    * [v0.1.0](https://github.com/paulrobello/par-dots/blob/main/CHANGELOG.md#010---2026-09-26)
* [License](#license)

[![Deploy](https://github.com/paulrobello/par-dots/actions/workflows/deploy.yml/badge.svg)](https://github.com/paulrobello/par-dots/actions/workflows/deploy.yml)
[![Play](https://img.shields.io/badge/play-dots.pardev.net-brightgreen)](https://dots.pardev.net)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.4-000000?logo=bun&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-offline%20ready-5A0FC8?logo=pwa&logoColor=white)
![Runs on iOS | Android | Desktop](https://img.shields.io/badge/runs%20on-iOS%20%7C%20Android%20%7C%20Desktop-blue)

![License](https://img.shields.io/github/license/paulrobello/par-dots)

## About
PAR Dots is a mobile-first LEGO Dots mosaic game for the browser. Pick a bundled picture or upload your own, and PAR Dots turns it into a stud mosaic of up to 32 colors split into 16x16 baseplate panels. Fill each panel dot by dot from a color tray, using the panel's reference image as your only guide.

Everything runs on-device: uploads never leave your phone, progress is saved locally, and the app installs as a PWA that plays fully offline.

**Play:** https://dots.pardev.net

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/probello3)

## Screenshots

| | |
|---|---|
| ![Home screen](https://raw.githubusercontent.com/paulrobello/par-dots/main/screenshots/home-screen.png) | ![New picture library](https://raw.githubusercontent.com/paulrobello/par-dots/main/screenshots/new-picture-library.png) |
| *Home screen* | *Bundled picture library* |
| ![Picture setup](https://raw.githubusercontent.com/paulrobello/par-dots/main/screenshots/picture-setup.png) | ![Progress overview](https://raw.githubusercontent.com/paulrobello/par-dots/main/screenshots/progress-overview.png) |
| *Picture setup* | *Progress overview* |
| ![Panel play, starting](https://raw.githubusercontent.com/paulrobello/par-dots/main/screenshots/panel-play-start.png) | ![Panel play, in progress](https://raw.githubusercontent.com/paulrobello/par-dots/main/screenshots/panel-play-progress.png) |
| *Panel play, starting* | *Panel play, in progress* |
| ![Settings](https://raw.githubusercontent.com/paulrobello/par-dots/main/screenshots/settings.png) | |
| *Settings* | |

## Features

### Core Capabilities
- **Any Picture**: Start from a bundled picture, an uploaded photo, or an `https` image link
- **Framing and Layout**: Drag and pinch to crop, then choose Square, Portrait or Landscape (9 or 12 panels of 16x16 studs)
- **LEGO or Free Colors**: Match the official LEGO Dots palette or let the quantizer pick free colors, from 4 to 32, with optional dithering for photos
- **Panel Play**: A color tray with remaining counts, Remove and Move modes, Hint, Undo/Redo, pinch zoom, and a reference overlay
- **Progress Overview**: Panel progress badges, a Ghost toggle, animated zoom into panels, and previous/next panel navigation
- **Celebrations and Export**: Sounds, haptics and celebrations on completion, plus PNG download of finished pictures

### Building Tools
- **Parts List**: Dot counts per color for the whole picture or a single panel
- **Printable Building Sheets**: Per-panel guides with a symbol on every dot, usable in grayscale and by colorblind builders
- **Back Up and Restore**: Save every picture, its progress and uploaded photo to a `.pardots` file and restore it on any device

### Technical Excellence
- **Offline First**: Installable PWA that precaches the app and bundled library
- **Private by Design**: No backend; saves live in IndexedDB and uploads never leave the device
- **Safe Updates**: New versions apply only when no play state can be lost
- **Fast Quantization**: Deterministic color quantization in a Web Worker with a main-thread fallback
- **Tested**: Vitest unit tests with a coverage threshold and a Playwright smoke test in CI

## Documentation

- [PRD.md](PRD.md): product requirements, as built
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, the new-picture pipeline, routes, persistence and PWA updates
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): CI workflow, custom domain, release verification and rollback
- [docs/DOCUMENTATION_STYLE_GUIDE.md](docs/DOCUMENTATION_STYLE_GUIDE.md): how to write docs in this repository

## How to Play

1. Tap **New Picture**, then pick a bundled picture, upload a photo, or paste an `https` link to an image.
2. On the setup screen, drag and pinch to frame the picture, choose Square, Portrait or Landscape, pick **LEGO colors** or **Free colors**, and set **Max colors**. Tap **Start**.
3. On the overview, tap any panel to build it. Toggle **Ghost** to see the target picture faintly.
4. In a panel, pick a color from the tray and tap or drag across studs to place dots. Each tray color shows how many dots of it are left. A color at 0 can't be placed; if it stays in the tray, one of its dots is on a wrong stud. A color leaves the tray once all its studs are correct.

| Control | What it does |
| --- | --- |
| **Remove** | Tap or drag to take dots off the board |
| **Move** | One finger pans the zoomed board instead of painting |
| **Hint** | Outlines every wrong dot for 3 seconds; pulses when the panel is full but has mistakes |
| **Undo** / **Redo** | Steps through the last 10 strokes of this panel |
| **Overlay** | Shows the target colors faintly on empty studs, each with its color's letter, and shows the letters on the tray; holding a two-finger pinch does the same |
| Two fingers or the mouse wheel | Zoom and pan the board |
| Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z | Undo, redo |
| Escape | Back to the overview |

A panel is done when every stud holds the correct color. Finished pictures can be downloaded as a PNG from the finale, the overview, or the gallery. "Back up all" in the gallery saves every picture, with its progress and uploaded photo, to a `.pardots` file, and "Restore" loads one back on any browser or device. Sound, place sound, haptics, background music (Happy, Calm or Energy) and separate effects and music volumes are in the settings sheet (gear button at the top right of every screen).

## Development

Requires [Bun](https://bun.sh) (the version is pinned in `package.json` under `packageManager`). The browser smoke test also needs Playwright's Chromium (`bunx playwright install chromium`).

```bash
make install     # install dependencies
make dev         # dev server on http://localhost:4231 (builds the image library first if it is missing)
make test        # unit tests (Vitest)
make coverage    # unit tests with v8 coverage and the line-coverage threshold
make lint        # Biome lint and format check
make fmt         # Biome format, writing changes
make typecheck   # tsc --noEmit
make build       # build the image library, then the static site into dist/
make preview     # serve dist/ on http://localhost:4231
make e2e         # build, serve dist/, and run the Playwright smoke test
make checkall    # lint, typecheck, test, build (the CI gate, minus e2e)
make library     # build the image library only if public/library/ is missing
make clean       # remove dist/, public/library/ and coverage/
bun run icons    # regenerate the favicon and PWA icons from scripts/build-icons.ts
```

`make build` runs `scripts/build-library.ts`, which converts `images/*.jpg` into WebP images, thumbnails, and `public/library/manifest.json`. `public/library/` is generated and gitignored. `make e2e` runs `scripts/e2e.sh`; `bun run e2e` runs the same smoke test against a server you have already started.

Pushes to `main` are checked and deployed to GitHub Pages by `.github/workflows/deploy.yml`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the workflow, domain setup, verification and rollback.

## Project Structure

```text
src/
├── main.ts       # entry point: hash router and service-worker update policy
├── types.ts      # shared data model (Mosaic, PictureSave, palette limits)
├── styles.css    # all app styles
├── audio/        # synthesized sounds and haptics
├── engine/       # crop/resample, color quantization, LEGO palette, quantize worker
├── game/         # panel geometry, per-panel rules with undo/redo, progress
├── render/       # Canvas 2D board and overview renderers, sprites, mosaic images
├── storage/      # IndexedDB saves and images, save migration, settings
└── ui/           # screens, DOM helpers, input, save repository
scripts/          # library and icon builders, e2e smoke test
tests/            # Vitest unit tests
images/           # source photos for the bundled library
public/           # static files copied into the build (CNAME, icons, music/)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the layers fit together.

## Troubleshooting

### An image link will not open

**Cause:** The site hosting the image does not allow other apps to download it (no CORS header), the link is not `https`, the file is over 20 MB, or the download took longer than 30 seconds.

**Fix:** Save the image to your device and upload it with **Upload a photo** instead.

### "Storage is full"

**Cause:** The browser's storage quota for the site is used up, usually by uploaded photos.

**Fix:** Delete finished or unwanted pictures from the gallery. Deleting a picture also deletes its uploaded photo.

### The app still shows the old version after a deploy

**Cause:** Updates wait until nothing can be lost, so a new version only loads from the gallery or overview, or while the tab is in the background.

**Fix:** Open the gallery, or switch away from the tab and back.

### `make dev` shows no bundled pictures

**Cause:** `public/library/` is missing or incomplete.

**Fix:** Run `make clean`, then `make dev` (or `bun run scripts/build-library.ts`) to regenerate it.

## Contributing

1. Install the git hooks. The pre-commit hooks in `.pre-commit-config.yaml` run `make lint` and `make typecheck` on every commit.

   ```bash
   pre-commit install
   ```

2. Run the full gate before pushing, and the browser smoke test when you change UI behavior.

   ```bash
   make checkall
   make e2e
   ```

3. Add or update tests in `tests/*.test.ts`. Tests run in Node by default. Storage tests import `fake-indexeddb/auto`; tests that need a DOM start with the `// @vitest-environment happy-dom` comment.
4. Update the docs that describe what you changed: [PRD.md](PRD.md) for behavior, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for structure, following [docs/DOCUMENTATION_STYLE_GUIDE.md](docs/DOCUMENTATION_STYLE_GUIDE.md).

> **Warning:** Every push to `main` deploys to production at https://dots.pardev.net once CI passes.

## What's new

### Unreleased

* **Building tools**: Parts list with dot counts per color, printable per-panel building sheets with color symbols
* **Play**: Previous/next panel navigation, right mouse button removes dots, the panel timer pauses while Settings is open
* **Pictures**: Optional Floyd-Steinberg dithering for photo mosaics
* **Data**: Back up and restore to `.pardots` files, persistent storage request with usage shown in Settings
* **Settings**: Background color presets

### v0.1.0

* First release, live at https://dots.pardev.net

For the full version history, see [CHANGELOG.md](https://github.com/paulrobello/par-dots/blob/main/CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
