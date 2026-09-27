# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

par-dots is a backend-free, mobile-first PWA (Vite + TypeScript, no UI framework) that turns a picture into a LEGO Dots mosaic split into 16x16 panels the player fills dot by dot. Live at https://dots.pardev.net.

## Commands

Bun is the package manager and runner (version pinned in `package.json` `packageManager`).

```bash
make install     # bun install
make dev         # dev server on http://localhost:4231 (builds public/library/ first if missing)
make checkall    # lint + typecheck + test + build — the gate to run before committing
make test        # Vitest unit tests
make lint        # biome check .
make fmt         # biome format --write .
make typecheck   # tsc --noEmit
make coverage    # Vitest with v8 coverage; lines threshold lives in vite.config.ts
make e2e         # build, serve dist/ via scripts/e2e.sh, run the Playwright smoke test
```

- Single test file: `bunx vitest run tests/game.test.ts`. Single test by name: `bunx vitest run -t "name substring"`.
- `make e2e` needs Chromium (`bunx playwright install chromium`) and fails if port 4231 is already serving. `bun run e2e [url]` runs the smoke test against a server you started yourself. `scripts/e2e-manual-checks.ts` scripts additional audit checks against a running preview.
- `make build` runs `scripts/build-library.ts` first, which turns `images/*.jpg` into WebP, thumbnails and `public/library/manifest.json`. `public/library/` is generated and gitignored; if bundled pictures are missing in dev, `make clean && make dev`.
- Pre-commit hooks run `make lint` and `make typecheck`.

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml` (lint, typecheck, test, build, Playwright smoke test) and deploys to GitHub Pages in production. Pushing is a production release. See `docs/DEPLOYMENT.md`.

## Architecture

Read `docs/ARCHITECTURE.md` before non-trivial changes and `PRD.md` for intended behavior. The points below are the ones that span several files.

- **Layering is one-way.** `src/main.ts` (hash router, service-worker update policy) → `ui/` → `render/`, `game/`, `engine/`, `storage/`, `audio/` → `src/types.ts`. Lower layers never import `ui/`. `engine/`, `game/` and `storage/` are DOM-free and import only `types.ts` and their siblings. `ui/` is the only layer that touches the document.
- **Rules live in `game/`.** `PanelSession` (`src/game/panelSession.ts`) owns strokes, tray colors, undo/redo (10 moves) and completion, mutates `save.placed` in place, and emits events. UI code asks it whether a dot is correct; it never decides that itself. `src/game/geometry.ts` is the single owner of panel geometry (`studDims(aspect)`).
- **Picture creation pipeline.** `ui/source.ts` decodes (`ui/image.ts`, 40 MP guard via `imageHeader.ts`) → `ui/setup.ts` crops/resamples (`engine/resample.ts`) and quantizes in a Web Worker (`engine/client.ts` → `engine/worker.ts` → `buildMosaic()` in `engine/quantize.ts`, main-thread fallback on failure or 20 s timeout) → `createSave()`. `buildMosaic()` is deterministic (seeded k-means++ in free mode, greedy LEGO palette selection in LEGO mode). `#/setup` relies on in-memory handoff state in `ui/state.ts`, so it redirects to `#/new` when opened directly.
- **Screen contract.** Routes (`#/`, `#/new`, `#/setup`, `#/play/:id`, `#/play/:id/:panel`) are parsed by `parseRoute()` in `ui/pure.ts`. Each screen exports `mount*(ctx, ...params)` that builds into `ctx.root` and returns a `Cleanup`; async work checks an `alive` flag after each await. Sheets, dialogs and celebrations must `registerOverlay()` (`ui/dom.ts`) so the router and Escape can close them.
- **Panel play is wiring.** `ui/panelPlay.ts` connects single-concern modules: `playView.ts` (DOM), `gestures.ts` (DOM-free pointer model), `boardInput.ts` (binds events to it), `panelTimer.ts`, `trayModel.ts`, `playFeedback.ts`, and `render/boardRenderer.ts` (Canvas 2D drawing and hit testing).
- **Persistence.** `ui/` reaches IndexedDB only through the save repository `src/ui/saves.ts`, which keeps one shared in-memory object per save id (overview and panel play share the same `placed` array). Every read passes through `migrateSave()` (`storage/migrate.ts`). To change the save shape, bump `SAVE_SCHEMA_VERSION` in `src/types.ts` and add an upgrade step to `migrateSave()`; bump the IndexedDB `DB_VERSION` only when stores or indexes change. Backups (`storage/backup.ts`) import as new saves with fresh ids and never overwrite.
- **PWA updates.** `registerType: 'prompt'`: a new deploy applies only via `shouldApplyUpdate()` in `ui/pure.ts` (page hidden, or on gallery/overview with no overlay open), so play state is never lost to a reload. The production build injects a CSP meta tag from `vite.config.ts`; the dev server omits it.

## Conventions

- Build DOM with `h()`, `icon()`, `iconButton()` from `ui/dom.ts`. They set attributes and text only; never assign HTML strings.
- Put logic that does not need the DOM (routing, crop math, formatting, gestures, timers, tray diffs, palette symbols) in DOM-free modules, mostly `ui/pure.ts`, with unit tests in `tests/`. Player-facing errors go through `userMessage()`.
- Import by file path. `src/game/index.ts` is the only barrel.
- Tests run in Node by default. Storage tests import `fake-indexeddb/auto`; tests needing a DOM start with `// @vitest-environment happy-dom`.
- Biome formatting: 2-space indent, single quotes, 100-column lines.
- When behavior or structure changes, update `PRD.md`, `docs/ARCHITECTURE.md` and `CHANGELOG.md` (Keep a Changelog, `[Unreleased]`), following `docs/DOCUMENTATION_STYLE_GUIDE.md`. Enhancement plans live in `docs/opus/ENH-*.md`.
