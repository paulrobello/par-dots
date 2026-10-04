# ENH-007 — Draw Your Own Picture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "draw your own" mode beside the photo pipeline: the player picks aspect, palette mode and an optional background, then paints one continuous mosaic across all panels with brush/shape/fill/eyedropper/eraser tools, pan/zoom, undo/redo (depth 50), an editable palette, and a gallery section of its own — a first-class save that never "completes" and, in LEGO mode, exports parts lists, BrickLink wanted lists and printable panel instructions exactly like a photo picture.

**Architecture:** Sibling draw modules sharing the existing primitives (spec option O2): DOM-free `game/drawTools.ts` (rasterizers) and `game/drawSession.ts` (tool state, palette editing, undo/redo, usage counts — the drawn-mode counterpart of `PanelSession`), whole-mosaic renderer `render/drawBoard.ts`, and UI modules `ui/drawTray.ts`, `ui/drawCreate.ts`, `ui/drawInput.ts`, `ui/drawEditor.ts`. `PanelSession`, `trayModel` and all play rules stay untouched. Schema v2 adds `origin: 'photo' | 'drawn'` and optional `drawBackground`; drawn saves keep `target` all-EMPTY forever, the artwork lives in `placed`, `completedAt` is never set, `panelElapsedMs` stays zeros.

**Tech Stack:** Vite + TypeScript (no UI framework), Bun, Vitest (node environment by default; `// @vitest-environment happy-dom` per file for DOM tests; `fake-indexeddb/auto` for storage tests), Playwright e2e, Biome (2-space indent, single quotes, 100 columns).

**Spec:** `docs/opus/ENH-007-draw-your-own.md`

## Global Constraints

- Bun is the runner. Gate: `make checkall` (lint + typecheck + test + build) must pass before every commit.
- Biome formatting: 2-space indent, single quotes, 100-column lines.
- Layering is one-way: `ui/` → `render/` / `game/` / `engine/` / `storage/` / `audio/` → `src/types.ts`; `game/` imports only `types.ts` and its siblings. Consequence: `DrawSession` receives palette entries as data and never imports `engine/`; the LEGO-only recolor constraint lives in the pure UI helper `paletteEntryFor` (`ui/pure.ts`, Task 8) instead of the session. This is a deliberate, documented deviation from the spec's `recolor(index, hex)` sketch.
- Build DOM only with `h()`, `icon()`, `iconButton()`, `openSheet()`, `confirmDialog()` from `ui/dom.ts`; never assign HTML strings. Sheets get overlay registration from `openSheet` itself.
- `PANEL_SIZE = 16`, `MAX_COLORS = 32`, `EMPTY = 255` live in `src/types.ts` — import them, never re-declare.
- Save schema v2: `SAVE_SCHEMA_VERSION = 2`; every new save carries `origin`; drawn saves have `sourceImageId: ''`, `target` all `EMPTY`, zero `panelElapsedMs`, and never set `completedAt`.
- Screen contract: `mount*(ctx, ...)` builds into `ctx.root`, returns a `Cleanup`, guards async work with an `alive` flag re-checked after each await.
- Every task: targeted tests green, then `make checkall` green, then an atomic conventional commit (no co-author trailer).

## Review Focus

The five inputs most likely to bite a player, each pinned by a test in the named task:

1. **Navigation away mid-stroke.** Cleanup while a stroke or shape drag is open must end it, never persist an uncommitted shape, and flush the debounced save (including the hide-time flush). Pinned by Task 5 session tests (an uncommitted shape never mutates `placed`; a stroke with no changes records no move) and Task 9's `flushPersist` on cleanup and `visibilitychange`; Task 11 e2e reloads mid-session.
2. **Palette edge cases.** Adding a 33rd color and removing a color that has placed dots must fail without mutating state. Pinned by Task 5 tests (`addColor` throws at the cap; `removeColor` throws when the slot is used).
3. **Second finger mid-stroke.** A pinch that starts during a stroke/shape must cancel it without painting. Pinned by Task 5 (`cancelShape` reverts without mutating) plus the existing pinch-cancel contract in `tests/ui-gestures.test.ts`; Task 11 asserts the editor stays consistent.
4. **Reload mid-shape.** An uncommitted rubber-band shape leaves `placed` untouched after reload. Pinned by Task 5 (`updateShape` does not mutate) and Task 11's reload assertion.
5. **Cross-linked ids.** `#/draw/:photoId` must land on the photo overview; `#/play/:drawnId` must land on the editor; unknown ids must toast and return to the gallery. Pinned by Task 9 parseRoute tests and redirects; exercised in Task 11.

---

### Task 1: Schema v2 — origin and drawBackground

**Files:**
- Modify: `src/types.ts` (SAVE_SCHEMA_VERSION line, PictureSave fields, new SaveOrigin type)
- Modify: `src/storage/migrate.ts`
- Modify: `src/ui/setup.ts` (save literal, around line 449)
- Test: `tests/storage.test.ts`

**Interfaces:**
- Consumes: existing `migrateSave(raw): PictureSave | undefined`.
- Produces: `type SaveOrigin = 'photo' | 'drawn'`; `PictureSave.origin: SaveOrigin` (required in the type); `PictureSave.drawBackground?: string`; `SAVE_SCHEMA_VERSION === 2`. Every later task keys off `save.origin === 'drawn'` after `migrateSave`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/storage.test.ts` (extend imports with `MAX_COLORS` if absent):

```ts
describe('migrateSave schema v2', () => {
  const base = {
    id: 's1',
    createdAt: 1,
    updatedAt: 1,
    name: 'p',
    sourceImageId: '',
    aspect: '1:1',
    paletteMode: 'lego',
    palette: [
      { hex: '#05131d', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
    ],
    width: 48,
    height: 48,
    target: new Uint8Array(48 * 48),
    placed: new Uint8Array(48 * 48),
    panelElapsedMs: [],
  };

  it('stamps origin photo on v1 saves', () => {
    const out = migrateSave({ ...base, target: new Uint8Array(48 * 48).fill(0) });
    expect(out?.origin).toBe('photo');
    expect(out?.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(out?.drawBackground).toBeUndefined();
  });

  it('accepts a drawn save with EMPTY target and drawBackground', () => {
    const out = migrateSave({
      ...base,
      origin: 'drawn',
      drawBackground: '#05131d',
      target: new Uint8Array(48 * 48).fill(EMPTY),
      placed: new Uint8Array(48 * 48).fill(0),
    });
    expect(out?.origin).toBe('drawn');
    expect(out?.drawBackground).toBe('#05131d');
  });

  it('rejects a bad drawBackground and an unknown origin', () => {
    expect(migrateSave({ ...base, origin: 'drawn', drawBackground: 'red' })).toBeUndefined();
    expect(migrateSave({ ...base, origin: 'photo' })).toBeDefined();
    expect(migrateSave({ ...base, origin: 'sketch' })).toBeUndefined();
  });

  it('still rejects out-of-range target values other than EMPTY', () => {
    const target = new Uint8Array(48 * 48);
    target[0] = MAX_COLORS; // far past palette.length (2)
    expect(migrateSave({ ...base, target })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/storage.test.ts`
Expected: FAIL — `origin` is not part of PictureSave (type error) and `SAVE_SCHEMA_VERSION` is still 1.

- [ ] **Step 3: Implement**

`src/types.ts` — bump the version, add the type alias near `PaletteMode`, add two fields to `PictureSave` after `paletteMode`:

```ts
/** Current PictureSave record shape; bump with a migration in storage/migrate.ts. */
export const SAVE_SCHEMA_VERSION = 2;

/** Where a picture came from: quantized from a photo, or drawn freehand in the app. */
export type SaveOrigin = 'photo' | 'drawn';
```

```ts
  /** Palette mode the picture was quantized with. */
  paletteMode: PaletteMode;
  /** How the picture was made: 'photo' quantized, or 'drawn' freehand (target stays all EMPTY). */
  origin: SaveOrigin;
  /** Drawn saves: background hex the eraser paints, absent when the background is None. */
  drawBackground?: string;
```

`src/storage/migrate.ts` — add `type SaveOrigin` to the types import, add the regex near the top, the two new validations before the cell loop, the relaxed loop, and the extended return:

```ts
/** A valid drawn-save background: lowercase "#rrggbb". */
const HEX_RE = /^#[0-9a-f]{6}$/;
```

```ts
  if (
    r.drawBackground !== undefined &&
    (typeof r.drawBackground !== 'string' || !HEX_RE.test(r.drawBackground))
  ) {
    return undefined;
  }
  const origin: SaveOrigin = r.origin === 'drawn' ? 'drawn' : 'photo';
```

```ts
  for (let i = 0; i < cells; i++) {
    if (target[i] !== EMPTY && target[i] >= palette.length) return undefined;
    if (placed[i] !== EMPTY && placed[i] >= palette.length) return undefined;
  }
```

```ts
  return {
    ...(r as unknown as PictureSave),
    origin,
    schemaVersion: SAVE_SCHEMA_VERSION,
    panelElapsedMs,
  };
```

`src/ui/setup.ts` — add `origin: 'photo',` to the save literal right after `paletteMode: mode,`.

- [ ] **Step 4: Run tests and the gate**

Run: `bunx vitest run tests/storage.test.ts` (expect PASS). Then `make checkall`; fix any other `PictureSave` literal the now-required `origin` field flushes out (test factories: add `origin: 'photo'`).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/storage/migrate.ts src/ui/setup.ts tests/storage.test.ts
git commit -m "feat(schema): PictureSave origin + drawBackground, schema v2 (ENH-007)"
```

### Task 2: Counting — effectiveCells routes exports

**Files:**
- Modify: `src/game/progress.ts`
- Modify: `src/game/index.ts` (barrel)
- Modify: `src/ui/partsSheet.ts` (doneCounts)
- Test: `tests/game.test.ts`

**Interfaces:**
- Consumes: `PictureSave.origin` (Task 1).
- Produces: `effectiveCells(save: PictureSave): ArrayLike<number>` exported from `src/game` (`placed` for drawn saves, `target` otherwise); `colorCounts`/`panelColorCounts` skip `EMPTY`. `partsSheet.doneCounts` counts a placed drawn dot as done.

- [ ] **Step 1: Write the failing tests**

Append to `tests/game.test.ts` (add imports: `effectiveCells` from `../src/game`; `EMPTY`, `SAVE_SCHEMA_VERSION`, `type PictureSave` from `../src/types`):

```ts
function drawnSaveFixture(): PictureSave {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: 'd1',
    createdAt: 1,
    updatedAt: 1,
    name: 'd',
    sourceImageId: '',
    aspect: '1:1',
    paletteMode: 'lego',
    origin: 'drawn',
    palette: [
      { hex: '#05131d', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
    ],
    width: 48,
    height: 48,
    target: new Uint8Array(48 * 48).fill(EMPTY),
    placed: new Uint8Array(48 * 48),
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

describe('effectiveCells (drawn saves)', () => {
  it('counts placed dots for a drawn save and skips EMPTY', () => {
    const save = drawnSaveFixture();
    save.placed[0] = 1;
    save.placed[1] = 1;
    expect(colorCounts(save)).toEqual([2302, 2]);
    expect(effectiveCells(save)).toBe(save.placed);
  });

  it('counts target for a photo save', () => {
    const save = drawnSaveFixture();
    save.origin = 'photo';
    save.target[0] = 1;
    expect(colorCounts(save)).toEqual([2303, 1]);
  });

  it('panelColorCounts reads placed dots for drawn saves', () => {
    const save = drawnSaveFixture();
    save.placed[0] = 1;
    expect(panelColorCounts(save, 0)).toEqual([255, 1]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/game.test.ts -t "effectiveCells"`
Expected: FAIL — `effectiveCells` is not exported; the unpatched counters read the all-EMPTY target.

- [ ] **Step 3: Implement**

`src/game/progress.ts`:

```ts
/**
 * The cells exports and counting read: the target for photo saves, the placed dots for
 * drawn ones (a drawn save's target is all EMPTY).
 */
export function effectiveCells(save: PictureSave): ArrayLike<number> {
  return save.origin === 'drawn' ? save.placed : save.target;
}

/** Dot count per palette index for the whole picture (length = palette.length); skips EMPTY. */
export function colorCounts(save: PictureSave): number[] {
  const cells = effectiveCells(save);
  const counts = new Array<number>(save.palette.length).fill(0);
  for (let i = 0; i < save.width * save.height; i++) {
    const c = cells[i];
    if (c !== EMPTY) counts[c]++;
  }
  return counts;
}

```ts
export function panelColorCounts(save: PictureSave, panelIndex: number): number[] {
  const cells = effectiveCells(save);
  const counts = new Array<number>(save.palette.length).fill(0);
  const o = panelOrigin(save, panelIndex);
  for (let y = 0; y < PANEL_SIZE; y++) {
    const row = (o.y + y) * save.width + o.x;
    for (let x = 0; x < PANEL_SIZE; x++) {
      const c = cells[row + x];
      if (c !== EMPTY) counts[c]++;
    }
  }
  return counts;
}
```

`src/game/index.ts` — add `effectiveCells` to the progress export list.

`src/ui/partsSheet.ts` — import `effectiveCells` from `'../game'` and replace `doneCounts`:

```ts
/** Correctly placed dots per palette index; for drawn saves every placed dot is done. */
function doneCounts(save: PictureSave, panelIndex: number | null): number[] {
  const cells = effectiveCells(save);
  const done = new Array<number>(save.palette.length).fill(0);
  const count = (i: number): void => {
    const c = cells[i];
    if (c !== EMPTY && save.placed[i] === c) done[c]++;
  };
  if (panelIndex === null) {
    for (let i = 0; i < save.width * save.height; i++) count(i);
    return done;
  }
  const o = panelOrigin(save, panelIndex);
  for (let y = 0; y < PANEL_SIZE; y++) {
    for (let x = 0; x < PANEL_SIZE; x++) count((o.y + y) * save.width + o.x + x);
  }
  return done;
}
```

(`EMPTY` is already imported in partsSheet.ts from `'../types'`.)

- [ ] **Step 4: Run tests and the gate**

Run: `bunx vitest run tests/game.test.ts` (PASS), then `make checkall` (PASS — photo counts are unchanged because photo targets never hold EMPTY).

- [ ] **Step 5: Commit**

```bash
git add src/game/progress.ts src/game/index.ts src/ui/partsSheet.ts tests/game.test.ts
git commit -m "feat(game): effectiveCells so drawn saves count for exports (ENH-007)"
```

### Task 3: Backup round-trip for drawn saves

**Files:**
- Modify: `src/storage/backup.ts` (decodeEntry)
- Test: `tests/backup.test.ts`

**Interfaces:**
- Consumes: `PictureSave.origin` (Task 1). `buildBackup` needs no change — for an empty `sourceImageId` the `getImage` lookup misses, so no image entry is written.
- Produces: drawn saves (empty `sourceImageId`) restore from `.pardots` backups without an image entry; uploaded photo saves still require one.

- [ ] **Step 1: Write the failing tests**

Append to `tests/backup.test.ts`:

```ts
function drawnBackupSave(): PictureSave {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: 'd1',
    createdAt: 1,
    updatedAt: 1,
    name: 'doodle',
    sourceImageId: '',
    aspect: '1:1',
    paletteMode: 'lego',
    origin: 'drawn',
    drawBackground: '#05131d',
    palette: [
      { hex: '#05131d', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
    ],
    width: 48,
    height: 48,
    target: new Uint8Array(48 * 48).fill(EMPTY),
    placed: new Uint8Array(48 * 48).fill(0),
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

it('round-trips a drawn save through a backup without an image', async () => {
  const blob = await buildBackup([drawnBackupSave()], async () => undefined);
  const entries = await parseBackup(await blob.text());
  expect(entries).toHaveLength(1);
  expect(entries[0].image).toBeUndefined();
  expect(entries[0].save.origin).toBe('drawn');
  expect(entries[0].save.drawBackground).toBe('#05131d');
});

it('still requires an image for uploaded photo saves', async () => {
  const photo = {
    ...drawnBackupSave(),
    origin: 'photo' as const,
    drawBackground: undefined,
    sourceImageId: 'img-1',
  };
  const blob = await buildBackup([photo], async () => undefined);
  const entries = await parseBackup(await blob.text());
  expect(entries).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/backup.test.ts`
Expected: the drawn round-trip FAILS with 0 entries — `decodeEntry` demands an image for any non-library save.

- [ ] **Step 3: Implement**

`src/storage/backup.ts`, in `decodeEntry`, immediately after the library-prefix early return, add:

```ts
  // Drawn saves carry no image at all.
  if (save.sourceImageId === '') return { save };
```

- [ ] **Step 4: Run tests and the gate**

Run: `bunx vitest run tests/backup.test.ts` (PASS), then `make checkall` (PASS).

- [ ] **Step 5: Commit**

```bash
git add src/storage/backup.ts tests/backup.test.ts
git commit -m "feat(backup): drawn saves round-trip without a source image (ENH-007)"
```

### Task 4: Rasterizers — `game/drawTools.ts`

**Files:**
- Create: `src/game/drawTools.ts`
- Modify: `src/ui/pure.ts` (replace the local `cellLine` function with a re-export of `lineCells`)
- Test: `tests/drawTools.test.ts` (new)

**Interfaces:**
- Consumes: nothing but TypeScript; the module is standalone and DOM-free.
- Produces (exported here; added to the `src/game` barrel in Task 5): `interface GridCell { x: number; y: number }`; `type BrushTip = 'round' | 'square'`; `brushCells(x, y, size, tip): GridCell[]`; `lineCells(x0, y0, x1, y1): GridCell[]`; `snapLine(x0, y0, x1, y1, toleranceDeg = 7): GridCell`; `rectCells(x0, y0, x1, y1, filled): GridCell[]`; `ellipseCells(x0, y0, x1, y1, filled): GridCell[]`; `polygonCells(points, filled): GridCell[]`; `floodCells(grid, w, h, x, y): GridCell[]`. Generators may return out-of-bounds cells (brush stamps near edges); the applier in Task 5 clips. `ui/pure.ts` re-exports `lineCells as cellLine`, so `panelPlay` and its tests keep working unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/drawTools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  brushCells,
  ellipseCells,
  floodCells,
  lineCells,
  polygonCells,
  rectCells,
  snapLine,
} from '../src/game/drawTools';

describe('brushCells', () => {
  it('stamps square and round tips', () => {
    expect(brushCells(3, 3, 1, 'round')).toEqual([{ x: 3, y: 3 }]);
    expect(brushCells(3, 3, 3, 'square')).toHaveLength(9);
    const plus = brushCells(3, 3, 3, 'round');
    expect(plus).toHaveLength(5);
    expect(plus).toEqual(
      expect.arrayContaining([
        { x: 3, y: 3 },
        { x: 2, y: 3 },
        { x: 4, y: 3 },
        { x: 3, y: 2 },
        { x: 3, y: 4 },
      ]),
    );
    // Stamps may leave the grid near edges; the applier clips.
    expect(brushCells(0, 0, 3, 'round').every((c) => c.x >= -1 && c.y >= -1)).toBe(true);
  });
});

describe('lineCells', () => {
  it('draws a Bresenham line inclusive of both ends', () => {
    expect(lineCells(0, 0, 2, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
    ]);
    expect(lineCells(1, 1, 1, 4)).toHaveLength(4);
  });
});

describe('snapLine', () => {
  it('snaps near-axis lines and leaves others', () => {
    expect(snapLine(0, 0, 10, 1)).toEqual({ x: 10, y: 0 });
    expect(snapLine(0, 0, 7, 7)).toEqual({ x: 7, y: 7 });
    expect(snapLine(0, 0, 10, 4)).toEqual({ x: 10, y: 4 }); // 21.8 degrees is not near 0/45/90
    expect(snapLine(5, 5, 5, 5)).toEqual({ x: 5, y: 5 });
  });
});

describe('rectCells', () => {
  it('builds rect outlines and fills', () => {
    expect(rectCells(0, 0, 2, 2, false)).toHaveLength(8);
    expect(rectCells(0, 0, 2, 2, true)).toHaveLength(9);
    expect(rectCells(2, 1, 0, 3, true)).toHaveLength(12); // corners in any order
  });
});

describe('ellipseCells', () => {
  it('builds ellipse outlines and fills', () => {
    const filled = ellipseCells(0, 0, 4, 4, true);
    expect(filled).toContainEqual({ x: 2, y: 2 });
    expect(filled).toContainEqual({ x: 2, y: 0 });
    expect(ellipseCells(0, 0, 4, 4, false).some((c) => c.x === 2 && c.y === 1)).toBe(false);
    expect(ellipseCells(3, 3, 3, 3, true)).toEqual([{ x: 3, y: 3 }]);
  });
});

describe('polygonCells', () => {
  it('fills and outlines polygons', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
    ];
    expect(polygonCells(square, true)).toHaveLength(16);
    expect(polygonCells(square, false)).toHaveLength(12);
    expect(polygonCells(square.slice(0, 2), true)).toEqual([]); // fewer than 3 points
  });
});

describe('floodCells', () => {
  it('floods the connected equal-value region', () => {
    const grid = [0, 0, 1, 0, 1, 1, 0, 0, 1];
    expect(floodCells(grid, 3, 3, 0, 0)).toHaveLength(5);
    expect(floodCells(grid, 3, 3, 2, 2)).toHaveLength(4);
    expect(floodCells(grid, 3, 3, 9, 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/drawTools.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `src/game/drawTools.ts`:

```ts
/**
 * Rasterizers for the draw mode: pure cell-set generators over the whole stud grid.
 * Coordinates are whole-grid studs, so shapes span panel seams freely. Generators may
 * return out-of-bounds cells (brush stamps near edges); the applier clips.
 */

/** A whole-grid stud coordinate. */
export interface GridCell {
  x: number;
  y: number;
}

/** Brush stamp tip. */
export type BrushTip = 'round' | 'square';

/** Cells covered by a brush stamp centered on (x, y). `size` is an odd stud count (1..9). */
export function brushCells(x: number, y: number, size: number, tip: BrushTip): GridCell[] {
  const half = Math.max(0, Math.floor((size - 1) / 2));
  const out: GridCell[] = [];
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      if (tip === 'round' && dx * dx + dy * dy > (half + 0.25) * (half + 0.25)) continue;
      out.push({ x: x + dx, y: y + dy });
    }
  }
  return out;
}

/** Cells on the Bresenham line from (x0, y0) to (x1, y1), inclusive of both ends. */
export function lineCells(x0: number, y0: number, x1: number, y1: number): GridCell[] {
  const out: GridCell[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** Degrees of tolerance for the line tool's 0/45/90-degree snap. */
export const SNAP_TOLERANCE_DEG = 7;

/** (x1, y1) snapped to the nearest 45-degree step within tolerance, keeping its length. */
export function snapLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  toleranceDeg: number = SNAP_TOLERANCE_DEG,
): GridCell {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return { x: x1, y: y1 };
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const k = Math.round(angle / step);
  const offDeg = Math.abs(angle - k * step) * (180 / Math.PI);
  if (offDeg > toleranceDeg) return { x: x1, y: y1 };
  const len = Math.round(Math.hypot(dx, dy));
  return {
    x: x0 + Math.round(len * Math.cos(k * step)),
    y: y0 + Math.round(len * Math.sin(k * step)),
  };
}

/** Cells of the axis-aligned box with corners (x0, y0) and (x1, y1): outline or fill. */
export function rectCells(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  filled: boolean,
): GridCell[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const out: GridCell[] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (filled || x === left || x === right || y === top || y === bottom) out.push({ x, y });
    }
  }
  return out;
}

/** Cells of the ellipse inscribed in the box with corners (x0, y0) and (x1, y1). */
export function ellipseCells(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  filled: boolean,
): GridCell[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  if (rx === 0 && ry === 0) return [{ x: left, y: top }];
  const value = (x: number, y: number): number => {
    const nx = rx === 0 ? 0 : (x - cx) / rx;
    const ny = ry === 0 ? 0 : (y - cy) / ry;
    return nx * nx + ny * ny;
  };
  const out: GridCell[] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const v = value(x, y);
      if (filled) {
        if (v <= 1) out.push({ x, y });
      } else if (
        v <= 1 &&
        (value(x - 1, y) > 1 || value(x + 1, y) > 1 || value(x, y - 1) > 1 || value(x, y + 1) > 1)
      ) {
        out.push({ x, y });
      }
    }
  }
  return out;
}

/** Cells of the closed polygon through `points`: edge lines, or edge lines plus scanline fill. */
export function polygonCells(points: GridCell[], filled: boolean): GridCell[] {
  if (points.length < 3) return [];
  const out: GridCell[] = [];
  const seen = new Set<number>();
  const push = (x: number, y: number): void => {
    const k = y * 4096 + x;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x, y });
  };
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (const c of lineCells(a.x, a.y, b.x, b.y)) push(c.x, c.y);
  }
  if (!filled) return out;
  const ys = points.map((p) => p.y);
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
    const crosses: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        crosses.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    crosses.sort((m, n) => m - n);
    for (let k = 0; k + 1 < crosses.length; k += 2) {
      for (let x = Math.round(crosses[k]); x <= Math.round(crosses[k + 1]); x++) push(x, y);
    }
  }
  return out;
}

/** The 4-connected region of equal values containing (x, y); empty when out of bounds. */
export function floodCells(
  grid: ArrayLike<number>,
  w: number,
  h: number,
  x: number,
  y: number,
): GridCell[] {
  if (x < 0 || y < 0 || x >= w || y >= h) return [];
  const target = grid[y * w + x];
  const seen = new Uint8Array(w * h);
  const out: GridCell[] = [];
  const queue = [y * w + x];
  seen[y * w + x] = 1;
  const tryPush = (nx: number, ny: number): void => {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
    const j = ny * w + nx;
    if (seen[j] || grid[j] !== target) return;
    seen[j] = 1;
    queue.push(j);
  };
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const cx = i % w;
    const cy = Math.floor(i / w);
    out.push({ x: cx, y: cy });
    tryPush(cx + 1, cy);
    tryPush(cx - 1, cy);
    tryPush(cx, cy + 1);
    tryPush(cx, cy - 1);
  }
  return out;
}
```

In `src/ui/pure.ts`, delete the whole `cellLine` function (its doc comment and body, `/** Cells on the Bresenham line from (x0, y0) to (x1, y1), inclusive of both ends. */` through its closing brace) and put this in its place:

```ts
export { lineCells as cellLine } from '../game/drawTools';
```

- [ ] **Step 4: Run tests and the gate**

Run: `bunx vitest run tests/drawTools.test.ts tests/ui-pure.test.ts` (PASS — the cellLine tests now exercise the re-export). Then `make checkall` (PASS).

- [ ] **Step 5: Commit**

```bash
git add src/game/drawTools.ts src/ui/pure.ts tests/drawTools.test.ts
git commit -m "feat(game): pure draw rasterizers (ENH-007)"
```

### Task 5: Draw session — `game/drawSession.ts`

**Files:**
- Create: `src/game/drawSession.ts`
- Modify: `src/game/index.ts` (barrel: export drawTools + drawSession symbols)
- Test: `tests/drawSession.test.ts` (new)

**Interfaces:**
- Consumes: Task 4 rasterizers; `PictureSave.origin`, `PictureSave.drawBackground` (Task 1); `EMPTY`, `MAX_COLORS` from `src/types.ts`.
- Produces (added to the `src/game` barrel): `MAX_DRAW_HISTORY = 50`; `type DrawTool = 'brush' | 'line' | 'rect' | 'ellipse' | 'poly' | 'fill' | 'pick'`; `type Symmetry = 'none' | 'horizontal' | 'vertical'`; `type DrawCause = 'draw' | 'undo' | 'redo'`; `interface DrawCellChange { x; y; before; after }`; `type DrawEvent = { type: 'cells'; changes: DrawCellChange[]; usage: number[]; cause: DrawCause } | { type: 'palette'; usage: number[] }`; and `class DrawSession` with:
  - `readonly save: PictureSave`; `get currentTool()` / `setTool(t)`; `setBrushSize(n)` / `get brushSize()`; `setBrushTip(t)` / `get brushTip()`; `setFilled(b)` / `get filled()`; `setPrimary(i)` / `get primary()`; `setSecondary(i)` / `get secondary()`; `setSymmetry(s)` / `get symmetry()`.
  - `beginStroke(mode: 'paint' | 'erase')`; `strokeAt(x, y): boolean`; `endStroke(): void`; `cancelStroke(): void`; `get strokeActive()`.
  - `beginShape(kind: 'line' | 'rect' | 'ellipse' | 'poly', x, y)`; `addPolyPoint(x, y)`; `updateShape(x, y): GridCell[]`; `shapePreview(): GridCell[]`; `commitShape(): boolean`; `cancelShape(): void`; `get shapeActive()`; `get shapePointCount()`.
  - `flood(x, y): boolean`; `pick(x, y): number | null`; `clearAll(): boolean`; `eraseValue(): number`.
  - `addColor(entry: PaletteColor): number`; `removeColor(index: number): void`; `recolor(index: number, entry: PaletteColor): void`.
  - `undo()/redo(): boolean`; `get canUndo/canRedo()`; `usageCounts(): number[]`; `onChange(cb): () => void`.
- Semantics pinned here: shapes and strokes always paint the primary color (or the erase value for eraser strokes); an uncommitted shape never mutates `placed` (Review Focus 4); a stroke with no changes records no move (Review Focus 1); `addColor` throws `RangeError` at `MAX_COLORS`, `removeColor` throws when the slot has placed dots (Review Focus 2); removing a color drops earlier history (cell indices shift) but the removal itself is undoable; `recolor` is undoable and moves no dots. The LEGO-only color constraint stays in the UI (`paletteEntryFor`, Task 8) — the session accepts any valid `PaletteColor`. `addColor` is append-only and not undoable (existing indices stay stable). Symmetry mirrors every draw operation (not undo/redo replay).

- [ ] **Step 1: Write the failing tests**

Create `tests/drawSession.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DrawSession, MAX_DRAW_HISTORY, type DrawEvent, type GridCell } from '../src/game';
import { EMPTY, MAX_COLORS, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';

function drawnSave(): PictureSave {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: 'd1',
    createdAt: 1,
    updatedAt: 1,
    name: 'd',
    sourceImageId: '',
    aspect: '1:1',
    paletteMode: 'lego',
    origin: 'drawn',
    palette: [
      { hex: '#05131d', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
    ],
    width: 48,
    height: 48,
    target: new Uint8Array(48 * 48).fill(EMPTY),
    placed: new Uint8Array(48 * 48).fill(EMPTY),
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

function stroke(s: DrawSession, cells: GridCell[], mode: 'paint' | 'erase' = 'paint'): void {
  s.beginStroke(mode);
  for (const c of cells) s.strokeAt(c.x, c.y);
  s.endStroke();
}

describe('DrawSession strokes', () => {
  it('paints the primary color and tracks usage', () => {
    const s = new DrawSession(drawnSave());
    expect(s.currentTool).toBe('brush');
    stroke(s, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(s.save.placed[0]).toBe(0);
    expect(s.usageCounts()).toEqual([2, 0]);
    expect(s.canUndo).toBe(true);
  });

  it('a stroke that changes nothing records no move', () => {
    const s = new DrawSession(drawnSave());
    s.beginStroke('paint');
    s.endStroke();
    expect(s.canUndo).toBe(false);
    stroke(s, [{ x: 0, y: 0 }]);
    stroke(s, [{ x: 0, y: 0 }]);
    s.undo();
    expect(s.save.placed[0]).toBe(EMPTY);
  });

  it('cancelStroke reverts without an undoable move', () => {
    const s = new DrawSession(drawnSave());
    s.beginStroke('paint');
    s.strokeAt(0, 0);
    s.cancelStroke();
    expect(s.save.placed[0]).toBe(EMPTY);
    expect(s.canUndo).toBe(false);
  });

  it('erase paints the background index, or EMPTY without one', () => {
    const withBg = drawnSave();
    withBg.drawBackground = '#ffffff';
    const s = new DrawSession(withBg);
    expect(s.eraseValue()).toBe(1);
    stroke(s, [{ x: 0, y: 0 }]);
    stroke(s, [{ x: 0, y: 0 }], 'erase');
    expect(s.save.placed[0]).toBe(1);
    const bare = new DrawSession(drawnSave());
    expect(bare.eraseValue()).toBe(EMPTY);
    stroke(bare, [{ x: 0, y: 0 }]);
    stroke(bare, [{ x: 0, y: 0 }], 'erase');
    expect(bare.save.placed[0]).toBe(EMPTY);
    expect(bare.usageCounts()).toEqual([0, 0]);
  });

  it('brush size and tip change the stamp', () => {
    const s = new DrawSession(drawnSave());
    s.setBrushSize(3);
    stroke(s, [{ x: 5, y: 5 }]);
    expect(s.usageCounts()[0]).toBe(9);
    s.setBrushTip('round');
    stroke(s, [{ x: 20, y: 20 }]);
    expect(s.usageCounts()[0]).toBe(14);
  });

  it('undo/redo restores cells and respects depth 50', () => {
    const s = new DrawSession(drawnSave());
    for (let i = 0; i < MAX_DRAW_HISTORY + 10; i++) {
      stroke(s, [{ x: i % 48, y: Math.floor(i / 48) }]);
    }
    let undos = 0;
    while (s.undo()) undos++;
    expect(undos).toBe(MAX_DRAW_HISTORY);
    expect(s.usageCounts()[0]).toBe(40);
    expect(s.redo()).toBe(true);
    expect(s.usageCounts()[0]).toBe(41);
  });

  it('history navigation is disabled while a stroke is open', () => {
    const s = new DrawSession(drawnSave());
    stroke(s, [{ x: 0, y: 0 }]);
    s.beginStroke('paint');
    expect(s.canUndo).toBe(false);
    s.endStroke();
    expect(s.canUndo).toBe(true);
  });
});

describe('DrawSession shapes', () => {
  it('preview never mutates placed; commit does', () => {
    const s = new DrawSession(drawnSave());
    s.beginShape('rect', 2, 2);
    expect(s.updateShape(6, 6)).toHaveLength(25);
    expect(s.usageCounts()).toEqual([0, 0]);
    expect(s.shapeActive).toBe(true);
    expect(s.commitShape()).toBe(true);
    expect(s.usageCounts()[0]).toBe(25);
    expect(s.canUndo).toBe(true);
  });

  it('rect outline paints only the border', () => {
    const s = new DrawSession(drawnSave());
    s.setFilled(false);
    s.beginShape('rect', 0, 0);
    s.updateShape(3, 3);
    s.commitShape();
    expect(s.usageCounts()[0]).toBe(12);
  });

  it('the line tool snaps to 45-degree steps', () => {
    const s = new DrawSession(drawnSave());
    s.beginShape('line', 0, 0);
    s.updateShape(10, 1);
    s.commitShape();
    expect(s.save.placed[0]).toBe(0);
    expect(s.save.placed[10]).toBe(0);
    expect(s.save.placed[10 + 48]).toBe(EMPTY);
  });

  it('cancelShape leaves placed untouched', () => {
    const s = new DrawSession(drawnSave());
    s.beginShape('ellipse', 1, 1);
    s.updateShape(5, 5);
    s.cancelShape();
    expect(s.usageCounts()).toEqual([0, 0]);
    expect(s.canUndo).toBe(false);
  });

  it('polygons commit from tapped points', () => {
    const s = new DrawSession(drawnSave());
    s.beginShape('poly', 0, 0);
    s.addPolyPoint(4, 0);
    s.addPolyPoint(4, 4);
    s.addPolyPoint(0, 4);
    expect(s.commitShape()).toBe(true);
    expect(s.usageCounts()[0]).toBe(25);
    s.beginShape('poly', 10, 10);
    expect(s.commitShape()).toBe(false);
    expect(s.shapeActive).toBe(false);
  });

  it('flood fills the equal-value region with the primary color', () => {
    const s = new DrawSession(drawnSave());
    s.setPrimary(1);
    stroke(s, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    s.setPrimary(0);
    expect(s.flood(0, 1)).toBe(true); // an EMPTY cell: floods every EMPTY cell
    expect(s.usageCounts()).toEqual([48 * 48 - 2, 2]);
    expect(s.flood(0, 1)).toBe(false);
    expect(s.flood(0, 0)).toBe(true); // the white pair floods to color 0
    expect(s.usageCounts()).toEqual([48 * 48, 0]);
  });

  it('pick returns the placed color or null', () => {
    const s = new DrawSession(drawnSave());
    expect(s.pick(3, 3)).toBeNull();
    stroke(s, [{ x: 3, y: 3 }]);
    expect(s.pick(3, 3)).toBe(0);
    expect(s.pick(-1, 0)).toBeNull();
  });
});

describe('DrawSession palette', () => {
  it('addColor caps at MAX_COLORS', () => {
    const s = new DrawSession(drawnSave());
    while (s.save.palette.length < MAX_COLORS) s.addColor({ hex: '#123456', name: 'X' });
    expect(() => s.addColor({ hex: '#654321', name: 'Y' })).toThrow(RangeError);
  });

  it('removeColor rejects used colors and remaps unused ones', () => {
    const s = new DrawSession(drawnSave());
    s.setPrimary(1);
    stroke(s, [{ x: 0, y: 0 }]);
    s.addColor({ hex: '#123456', name: 'X' });
    expect(() => s.removeColor(1)).toThrow(RangeError);
    s.removeColor(0);
    expect(s.save.palette).toHaveLength(2);
    expect(s.save.placed[0]).toBe(0);
    expect(s.primary).toBe(0);
    s.undo();
    expect(s.save.placed[0]).toBe(1);
    expect(s.save.palette[0].hex).toBe('#05131d');
  });

  it('removing a color drops earlier history', () => {
    const s = new DrawSession(drawnSave());
    stroke(s, [{ x: 0, y: 0 }]);
    s.addColor({ hex: '#123456', name: 'X' });
    s.removeColor(2);
    s.undo();
    expect(s.save.palette).toHaveLength(3);
    expect(s.canUndo).toBe(false);
  });

  it('recolor swaps the entry and is undoable', () => {
    const s = new DrawSession(drawnSave());
    stroke(s, [{ x: 0, y: 0 }]);
    s.recolor(0, { hex: '#c91a09', name: 'Red' });
    expect(s.save.palette[0]).toEqual({ hex: '#c91a09', name: 'Red' });
    expect(s.usageCounts()).toEqual([1, 0]);
    s.undo();
    expect(s.save.palette[0].hex).toBe('#05131d');
    expect(s.save.placed[0]).toBe(0);
  });

  it('symmetry mirrors every draw operation', () => {
    const s = new DrawSession(drawnSave());
    s.setSymmetry('vertical');
    stroke(s, [{ x: 0, y: 10 }]);
    expect(s.save.placed[10 * 48]).toBe(0);
    expect(s.save.placed[10 * 48 + 47]).toBe(0);
    expect(s.usageCounts()[0]).toBe(2);
    s.setSymmetry('none');
    stroke(s, [{ x: 20, y: 20 }]);
    expect(s.usageCounts()[0]).toBe(3);
  });

  it('clearAll paints the erase value everywhere in one move', () => {
    const save = drawnSave();
    save.drawBackground = '#ffffff';
    const s = new DrawSession(save);
    stroke(s, [{ x: 0, y: 0 }]);
    expect(s.clearAll()).toBe(true);
    expect(s.usageCounts()).toEqual([0, 48 * 48]);
    expect(s.clearAll()).toBe(false);
    s.undo();
    expect(s.usageCounts()).toEqual([1, 48 * 48 - 1]);
  });

  it('emits cells and palette events with usage', () => {
    const s = new DrawSession(drawnSave());
    const events: DrawEvent[] = [];
    const off = s.onChange((e) => events.push(e));
    stroke(s, [{ x: 0, y: 0 }]);
    s.addColor({ hex: '#123456', name: 'X' });
    s.recolor(0, { hex: '#c91a09', name: 'Red' });
    off();
    s.strokeAt(1, 1);
    expect(events.map((e) => e.type)).toEqual(['cells', 'palette', 'palette']);
    expect(events[0]).toMatchObject({
      cause: 'draw',
      changes: [{ x: 0, y: 0, before: EMPTY, after: 0 }],
    });
    expect(events[0].usage).toEqual([1, 0]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/drawSession.test.ts`
Expected: FAIL — `DrawSession` is not exported.

- [ ] **Step 3: Implement**

Create `src/game/drawSession.ts` (full module):

```ts
/**
 * DrawSession: the draw mode's state machine over a drawn PictureSave, the counterpart of
 * PanelSession. Owns tool state, applies tool output to save.placed in place, edits the
 * palette, keeps undo/redo history (depth MAX_DRAW_HISTORY) and per-color usage counts, and
 * emits change events the UI persists through. DOM-free. Draw operations (strokes, shapes,
 * flood, clear-all) mirror through `symmetry`; history navigation does not. Removing a color
 * shifts palette indices, so it drops earlier history; the removal itself is undoable.
 * addColor is append-only and not undoable. The LEGO-only color constraint lives in the UI
 * (ui/pure.ts paletteEntryFor); the session accepts any PaletteColor.
 */

import { EMPTY, MAX_COLORS, type PaletteColor, type PictureSave } from '../types';
import {
  type BrushTip,
  brushCells,
  ellipseCells,
  floodCells,
  lineCells,
  polygonCells,
  rectCells,
  snapLine,
  type GridCell,
} from './drawTools';

/** Undo/redo depth for draw moves. */
export const MAX_DRAW_HISTORY = 50;

/** Draw tools. The eraser is a stroke mode, not a tool. */
export type DrawTool = 'brush' | 'line' | 'rect' | 'ellipse' | 'poly' | 'fill' | 'pick';

/** Mirror axis: across the horizontal center line (flips y) or the vertical one (flips x). */
export type Symmetry = 'none' | 'horizontal' | 'vertical';

/** What caused a board or palette change: a draw operation, or history navigation. */
export type DrawCause = 'draw' | 'undo' | 'redo';

/** One stud's before/after values in a move or event. */
export interface DrawCellChange {
  x: number;
  y: number;
  before: number;
  after: number;
}

/** Change events. `cells` fires per applied batch; `palette` on any palette edit. */
export type DrawEvent =
  | { type: 'cells'; changes: DrawCellChange[]; usage: number[]; cause: DrawCause }
  | { type: 'palette'; usage: number[] };

/** Callback registered with DrawSession.onChange. */
export type DrawListener = (event: DrawEvent) => void;

type DrawMove =
  | { kind: 'cells'; changes: DrawCellChange[] }
  | { kind: 'recolor'; index: number; before: PaletteColor; after: PaletteColor }
  | {
      kind: 'removeColor';
      index: number;
      entry: PaletteColor;
      primaryBefore: number;
      secondaryBefore: number;
      primaryAfter: number;
      secondaryAfter: number;
    };

interface OpenShape {
  kind: 'line' | 'rect' | 'ellipse' | 'poly';
  start: GridCell;
  points: GridCell[];
  current: GridCell;
}

/**
 * Tool state and board mutations for one drawn picture. Mutates `save.placed` and
 * `save.palette` in place; the UI persists `save` on this session's events.
 */
export class DrawSession {
  /** The drawn picture; `placed` and `palette` are mutated in place. */
  readonly save: PictureSave;
  private tool: DrawTool = 'brush';
  private brushSize = 1;
  private brushTip: BrushTip = 'round';
  private filled = true;
  private primary = 0;
  private secondary: number;
  private symmetry: Symmetry = 'none';
  /** Per palette index: placed dots of that color. */
  private usage: number[];
  private undoStack: DrawMove[] = [];
  private redoStack: DrawMove[] = [];
  private stroke: { value: number; changes: DrawCellChange[] } | null = null;
  private shape: OpenShape | null = null;
  private readonly listeners = new Set<DrawListener>();

  constructor(save: PictureSave) {
    this.save = save;
    this.secondary = save.palette.length > 1 ? 1 : 0;
    this.usage = new Array<number>(save.palette.length).fill(0);
    for (const v of save.placed) if (v !== EMPTY) this.usage[v]++;
  }

  // ---- tool state ---------------------------------------------------------

  setTool(tool: DrawTool): void {
    this.tool = tool;
  }

  get currentTool(): DrawTool {
    return this.tool;
  }

  setBrushSize(size: number): void {
    this.brushSize = Math.max(1, Math.min(9, Math.round(size)));
  }

  get brushSize(): number {
    return this.brushSize;
  }

  setBrushTip(tip: BrushTip): void {
    this.brushTip = tip;
  }

  get brushTip(): BrushTip {
    return this.brushTip;
  }

  setFilled(filled: boolean): void {
    this.filled = filled;
  }

  get filled(): boolean {
    return this.filled;
  }

  /** Sets the primary color; out-of-range indices are ignored. */
  setPrimary(index: number): void {
    if (Number.isInteger(index) && index >= 0 && index < this.save.palette.length) {
      this.primary = index;
    }
  }

  get primary(): number {
    return this.primary;
  }

  setSecondary(index: number): void {
    if (Number.isInteger(index) && index >= 0 && index < this.save.palette.length) {
      this.secondary = index;
    }
  }

  get secondary(): number {
    return this.secondary;
  }

  setSymmetry(symmetry: Symmetry): void {
    this.symmetry = symmetry;
  }

  get symmetry(): Symmetry {
    return this.symmetry;
  }

  /** Value the eraser paints: the background color's palette index, or EMPTY without one. */
  eraseValue(): number {
    const bg = this.save.drawBackground;
    if (bg) {
      const i = this.save.palette.findIndex((c) => c.hex === bg);
      if (i >= 0) return i;
    }
    return EMPTY;
  }

  // ---- strokes ------------------------------------------------------------

  /** Start a stroke. An open stroke is ended first. */
  beginStroke(mode: 'paint' | 'erase'): void {
    if (this.stroke) this.endStroke();
    this.stroke = { value: mode === 'paint' ? this.primary : this.eraseValue(), changes: [] };
  }

  /** Stamp the brush at a whole-grid stud. Returns true when a cell changed. */
  strokeAt(x: number, y: number): boolean {
    const s = this.stroke;
    if (!s) return false;
    return this.applyCells(brushCells(x, y, this.brushSize, this.brushTip), s.value, s.changes);
  }

  /** Close the open stroke. A stroke that changed anything becomes one undoable move. */
  endStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s || s.changes.length === 0) return;
    this.pushMove({ kind: 'cells', changes: s.changes });
  }

  /** Abandon the open stroke, reverting its changes, without recording a move. */
  cancelStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    for (let k = s.changes.length - 1; k >= 0; k--) {
      this.setCell(s.changes[k], true);
    }
    this.emitCells(s.changes, 'undo');
  }

  get strokeActive(): boolean {
    return this.stroke !== null;
  }

  // ---- shapes -------------------------------------------------------------

  /** Start a rubber-band shape; for `poly`, (x, y) is the first vertex. */
  beginShape(kind: 'line' | 'rect' | 'ellipse' | 'poly', x: number, y: number): void {
    if (this.stroke) this.endStroke();
    this.shape = { kind, start: { x, y }, points: [{ x, y }], current: { x, y } };
  }

  /** Append a vertex to an open polygon. */
  addPolyPoint(x: number, y: number): void {
    if (this.shape?.kind === 'poly') this.shape.points.push({ x, y });
  }

  /** Track the shape's far end and return its preview cells. Never mutates `placed`. */
  updateShape(x: number, y: number): GridCell[] {
    if (!this.shape) return [];
    this.shape.current = { x, y };
    return this.previewCells();
  }

  /** Cells of the open shape as it stands. */
  shapePreview(): GridCell[] {
    return this.previewCells();
  }

  /** Rasterize and apply the open shape as one undoable move. False when nothing changed. */
  commitShape(): boolean {
    const s = this.shape;
    if (!s) return false;
    const cells = this.previewCells();
    this.shape = null;
    const changes: DrawCellChange[] = [];
    if (!this.applyCells(cells, this.primary, changes)) return false;
    this.pushMove({ kind: 'cells', changes });
    this.emitCells(changes, 'draw');
    return true;
  }

  /** Drop the open shape. Placed was never touched, so there is nothing to revert. */
  cancelShape(): void {
    this.shape = null;
  }

  get shapeActive(): boolean {
    return this.shape !== null;
  }

  /** Vertex count of an open polygon, else 0. */
  get shapePointCount(): number {
    return this.shape?.kind === 'poly' ? this.shape.points.length : 0;
  }

  // ---- flood, pick, clear -------------------------------------------------

  /** Fill the equal-value region at (x, y) with the primary color. One undoable move. */
  flood(x: number, y: number): boolean {
    const { width, height } = this.save;
    const region = floodCells(this.save.placed, width, height, x, y);
    if (region.length === 0) return false;
    const changes: DrawCellChange[] = [];
    if (!this.applyCells(region, this.primary, changes)) return false;
    this.pushMove({ kind: 'cells', changes });
    this.emitCells(changes, 'draw');
    return true;
  }

  /** Palette index at (x, y), or null for EMPTY and out of bounds. */
  pick(x: number, y: number): number | null {
    const { width, height } = this.save;
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const v = this.save.placed[y * width + x];
    return v === EMPTY ? null : v;
  }

  /** Paint every stud with the erase value. One undoable move. */
  clearAll(): boolean {
    this.cancelShape();
    const { width, height } = this.save;
    const cells: GridCell[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) cells.push({ x, y });
    }
    const changes: DrawCellChange[] = [];
    if (!this.applyCells(cells, this.eraseValue(), changes)) return false;
    this.pushMove({ kind: 'cells', changes });
    this.emitCells(changes, 'draw');
    return true;
  }

  // ---- palette ------------------------------------------------------------

  /** Append a color and return its index. Throws RangeError at the MAX_COLORS cap. */
  addColor(entry: PaletteColor): number {
    if (this.save.palette.length >= MAX_COLORS) {
      throw new RangeError(`palette is full (${MAX_COLORS} colors max)`);
    }
    this.save.palette.push({ ...entry });
    this.usage.push(0);
    this.emitPalette();
    return this.save.palette.length - 1;
  }

  /**
   * Remove an unused color, remapping palette indices above it. Throws RangeError when the
   * color has placed dots or is the last one. Earlier history is dropped: cell moves would
   * replay stale indices. The removal itself is one undoable move.
   */
  removeColor(index: number): void {
    if (this.save.palette.length <= 1) {
      throw new RangeError('the palette needs at least one color');
    }
    if ((this.usage[index] ?? 0) > 0) {
      throw new RangeError('color has placed dots; erase them first');
    }
    const entry = { ...this.save.palette[index] };
    const primaryBefore = this.primary;
    const secondaryBefore = this.secondary;
    this.save.palette.splice(index, 1);
    this.usage.splice(index, 1);
    this.remapColors(index, false);
    this.undoStack = [];
    this.redoStack = [];
    this.undoStack.push({
      kind: 'removeColor',
      index,
      entry,
      primaryBefore,
      secondaryBefore,
      primaryAfter: this.primary,
      secondaryAfter: this.secondary,
    });
    this.emitPalette();
  }

  /**
   * Rewrite a palette slot's entry. Cells store indices, so every dot placed with it
   * recolors with it; the operation is one undoable move and moves no dots.
   */
  recolor(index: number, entry: PaletteColor): void {
    if (index < 0 || index >= this.save.palette.length) {
      throw new RangeError(`bad palette index ${index}`);
    }
    const move: DrawMove = {
      kind: 'recolor',
      index,
      before: { ...this.save.palette[index] },
      after: { ...entry },
    };
    this.save.palette[index] = { ...entry };
    this.pushMove(move);
    this.emitPalette();
  }

  // ---- history ------------------------------------------------------------

  get canUndo(): boolean {
    return this.stroke === null && this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.stroke === null && this.redoStack.length > 0;
  }

  /** Revert the last move. Returns true when something changed. */
  undo(): boolean {
    const move = this.canUndo ? this.undoStack.pop() : undefined;
    if (!move) return false;
    this.replay(move, true);
    this.redoStack.push(move);
    return true;
  }

  /** Reapply the last undone move. Returns true when something changed. */
  redo(): boolean {
    const move = this.canRedo ? this.redoStack.pop() : undefined;
    if (!move) return false;
    this.replay(move, false);
    this.undoStack.push(move);
    return true;
  }

  // ---- events and helpers -------------------------------------------------

  /** Placed dots per palette index (skips EMPTY). */
  usageCounts(): number[] {
    return [...this.usage];
  }

  /** Subscribe to change events. Returns a function that unsubscribes. */
  onChange(cb: DrawListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(event: DrawEvent): void {
    for (const cb of [...this.listeners]) cb(event);
  }

  private emitCells(changes: DrawCellChange[], cause: DrawCause): void {
    this.emit({ type: 'cells', changes: [...changes], usage: this.usageCounts(), cause });
  }

  private emitPalette(): void {
    this.emit({ type: 'palette', usage: this.usageCounts() });
  }

  private pushMove(move: DrawMove): void {
    this.undoStack.push(move);
    if (this.undoStack.length > MAX_DRAW_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Apply `value` to `cells`, mirrored per symmetry. Returns true when any cell changed. */
  private applyCells(cells: GridCell[], value: number, changes: DrawCellChange[]): boolean {
    let changed = false;
    for (const c of cells) {
      if (this.applyValue(c.x, c.y, value, changes)) changed = true;
      if (this.symmetry !== 'none') {
        const m = this.mirrored(c);
        if (this.applyValue(m.x, m.y, value, changes)) changed = true;
      }
    }
    return changed;
  }

  private applyValue(x: number, y: number, value: number, changes: DrawCellChange[]): boolean {
    const { width, height } = this.save;
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = y * width + x;
    const before = this.save.placed[i];
    if (before === value) return false;
    if (before !== EMPTY) this.usage[before]--;
    if (value !== EMPTY) this.usage[value]++;
    this.save.placed[i] = value;
    changes.push({ x, y, before, after: value });
    return true;
  }

  private setCell(c: DrawCellChange, reverse: boolean): void {
    const from = reverse ? c.after : c.before;
    const to = reverse ? c.before : c.after;
    const i = c.y * this.save.width + c.x;
    if (from !== EMPTY) this.usage[from]--;
    if (to !== EMPTY) this.usage[to]++;
    this.save.placed[i] = to;
  }

  private mirrored(c: GridCell): GridCell {
    if (this.symmetry === 'horizontal') return { x: c.x, y: this.save.height - 1 - c.y };
    if (this.symmetry === 'vertical') return { x: this.save.width - 1 - c.x, y: c.y };
    return c;
  }

  /** Shift palette indices above `index` by one, in `placed` and the color selections. */
  private remapColors(index: number, up: boolean): void {
    const placed = this.save.placed;
    for (let i = 0; i < placed.length; i++) {
      const v = placed[i];
      if (v === EMPTY) continue;
      if (up ? v >= index : v > index) placed[i] = up ? v + 1 : v - 1;
    }
    const bump = (c: number): number => {
      if (up) return c >= index ? c + 1 : c;
      if (c === index) return 0;
      return c > index ? c - 1 : c;
    };
    this.primary = bump(this.primary);
    this.secondary = bump(this.secondary);
  }

  private replay(move: DrawMove, reverse: boolean): void {
    switch (move.kind) {
      case 'cells': {
        const list = reverse ? [...move.changes].reverse() : move.changes;
        for (const c of list) this.setCell(c, reverse);
        this.emitCells(move.changes, reverse ? 'undo' : 'redo');
        break;
      }
      case 'recolor': {
        this.save.palette[move.index] = { ...(reverse ? move.before : move.after) };
        this.emitPalette();
        break;
      }
      case 'removeColor': {
        if (reverse) {
          this.save.palette.splice(move.index, 0, { ...move.entry });
          this.usage.splice(move.index, 0, 0);
          this.remapColors(move.index, true);
          this.primary = move.primaryBefore;
          this.secondary = move.secondaryBefore;
        } else {
          this.save.palette.splice(move.index, 1);
          this.usage.splice(move.index, 1);
          this.remapColors(move.index, false);
          this.primary = move.primaryAfter;
          this.secondary = move.secondaryAfter;
        }
        this.emitPalette();
        break;
      }
    }
  }

  private previewCells(): GridCell[] {
    const s = this.shape;
    if (!s) return [];
    if (s.kind === 'poly') {
      if (s.points.length >= 3) return polygonCells(s.points, this.filled);
      if (s.points.length === 2) {
        return lineCells(s.points[0].x, s.points[0].y, s.points[1].x, s.points[1].y);
      }
      return [...s.points];
    }
    const end =
      s.kind === 'line' ? snapLine(s.start.x, s.start.y, s.current.x, s.current.y) : s.current;
    if (s.kind === 'line') return lineCells(s.start.x, s.start.y, end.x, end.y);
    if (s.kind === 'rect') return rectCells(s.start.x, s.start.y, end.x, end.y, this.filled);
    return ellipseCells(s.start.x, s.start.y, end.x, end.y, this.filled);
  }
}
```

Append the draw exports to `src/game/index.ts` (keep alphabetical grouping per existing lists):

```ts
export {
  type BrushTip,
  brushCells,
  ellipseCells,
  floodCells,
  type GridCell,
  lineCells,
  polygonCells,
  rectCells,
  snapLine,
  SNAP_TOLERANCE_DEG,
} from './drawTools';
export {
  type DrawCause,
  type DrawCellChange,
  DrawSession,
  type DrawEvent,
  type DrawListener,
  type DrawTool,
  MAX_DRAW_HISTORY,
  type Symmetry,
} from './drawSession';
```

- [ ] **Step 4: Run tests and the gate**

Run: `bunx vitest run tests/drawSession.test.ts` (PASS). Then `make checkall` (PASS).

- [ ] **Step 5: Commit**

```bash
git add src/game/drawSession.ts src/game/index.ts tests/drawSession.test.ts
git commit -m "feat(game): DrawSession with tools, palette editing and 50-deep history (ENH-007)"
```

### Task 6: Whole-mosaic renderer — `render/drawBoard.ts`

**Files:**
- Create: `src/render/drawBoard.ts`
- Test: `tests/render-draw-board.test.ts` (new, happy-dom with a stubbed 2D context — this repo has no canvas-backed unit tests; the e2e task exercises real rendering)

**Interfaces:**
- Consumes: `SpriteCache`, `PLATE_GREEN` from `render/sprites`; `clearCanvas`, `resizeBacking` from `render/canvas`; `fitGrid`, `screenToCell`, `cellToScreen`, `cellDeviceRect`, `IDENTITY_VIEWPORT`, `zoomViewportAt`, `GridLayout`, `Viewport` from `render/layout`; `clientToCanvas` from `render/motion`; `GridCell` from `../game/drawTools`.
- Produces: `class DrawBoard` with `constructor(canvas)`; `setData(save: PictureSave, previewValue: number)`; `setPreviewValue(index: number)`; `setPreview(cells: GridCell[] | null)`; `setViewport(scale, offsetX, offsetY)` / `getViewport(): Viewport`; `getSize(): { width; height }`; `oneToOneScale(): number` (scale that renders a stud at `STUD_CSS_PX` CSS px, clamped to at least fit); `resize()`; `draw()`; `drawCells(cells: Iterable<GridCell>)`; `requestDraw()` (one coalesced rAF redraw); `hitTest(clientX, clientY): GridCell | null`; `destroy()`; and `export const STUD_CSS_PX = 22`. Scale 1 is fit-to-screen (same convention BoardRenderer and `bindBoardInput`/`zoomViewportAt` use).

- [ ] **Step 1: Write the failing test**

Create `tests/render-draw-board.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DrawBoard } from '../src/render/drawBoard';
import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';

// happy-dom has no 2D context; a recording proxy keeps constructor/draw calls harmless.
const ctxStub = new Proxy(
  {},
  {
    get: () => () => ctxStub,
    set: () => true,
  },
) as unknown as CanvasRenderingContext2D;

function drawnSave(): PictureSave {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: 'd1',
    createdAt: 1,
    updatedAt: 1,
    name: 'd',
    sourceImageId: '',
    aspect: '1:1',
    paletteMode: 'lego',
    origin: 'drawn',
    palette: [
      { hex: '#05131d', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
    ],
    width: 48,
    height: 48,
    target: new Uint8Array(48 * 48).fill(EMPTY),
    placed: new Uint8Array(48 * 48).fill(EMPTY),
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

describe('DrawBoard', () => {
  it('constructs, tracks state, and destroys safely before any layout', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = (() => ctxStub) as typeof canvas.getContext;
    const board = new DrawBoard(canvas);
    const save = drawnSave();
    board.setData(save, 0);
    expect(board.hitTest(0, 0)).toBeNull(); // no layout until resize()
    board.setViewport(2, -10, -10);
    expect(board.getViewport().scale).toBe(2);
    board.setPreview([{ x: 0, y: 0 }, { x: 99, y: 99 }]);
    expect(() => board.drawCells([{ x: 0, y: 0 }])).not.toThrow(); // cell size 0: no-op
    expect(() => board.draw()).not.toThrow();
    expect(() => board.destroy()).not.toThrow();
  });

  it('oneToOneScale never drops below fit', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = (() => ctxStub) as typeof canvas.getContext;
    const board = new DrawBoard(canvas);
    board.setData(drawnSave(), 0);
    expect(board.oneToOneScale()).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render-draw-board.test.ts`
Expected: FAIL — `DrawBoard` does not exist.

- [ ] **Step 3: Implement**

Create `src/render/drawBoard.ts`:

```ts
/**
 * Whole-mosaic draw board renderer (Canvas 2D). Owns the sprite cache, the viewport
 * (scale 1 = fit-to-screen), panel seam lines, a faint per-stud grid overlay past a zoom
 * threshold, a transient tool preview, hit testing, and one coalesced rAF redraw. The
 * editor calls setData, resize, then draw/drawCells as the session changes; destroy on
 * unmount. Cells are whole-grid studs, unlike BoardRenderer's panel-local ones.
 */

import { EMPTY, PANEL_SIZE, type PaletteColor, type PictureSave } from '../types';
import { type GridCell } from '../game/drawTools';
import { clearCanvas, drawPlate, resizeBacking } from './canvas';
import {
  cellDeviceRect,
  cellToScreen,
  fitGrid,
  type GridLayout,
  screenToCell,
  type Viewport,
} from './layout';
import { clientToCanvas } from './motion';
import { PLATE_GREEN, SpriteCache } from './sprites';

/** Cell size past which the faint per-stud grid overlay is drawn (device px). */
const GRID_THRESHOLD_PX = 14;
/** CSS px per stud at the 1:1 zoom step (double-tap). */
export const STUD_CSS_PX = 22;
/** Preview dot alpha. */
const PREVIEW_ALPHA = 0.5;
const MARGIN_CELLS = 0.25;

/** Draws the whole drawn mosaic with seams, grid overlay and tool preview. */
export class DrawBoard {
  /** The canvas this renderer draws into. */
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new SpriteCache();
  private save: PictureSave | null = null;
  private palette: PaletteColor[] = [];
  private vp: Viewport = { scale: 1, offsetX: 0, offsetY: 0 };
  private layout: GridLayout = { cell: 0, originX: 0, originY: 0, cols: 0, rows: 0 };
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private preview = new Set<number>();
  private previewValue = 0;
  private raf = 0;
  private destroyed = false;

  /** Takes the canvas's 2D context. Throws when no 2D context is available. */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  /** Board contents and the palette index preview shapes render in. */
  setData(save: PictureSave, previewValue: number): void {
    this.save = save;
    this.palette = save.palette;
    this.previewValue = previewValue;
  }

  setPreviewValue(index: number): void {
    this.previewValue = index;
  }

  /** Show the transient tool preview on `cells` (null clears). Does not redraw. */
  setPreview(cells: GridCell[] | null): void {
    this.preview.clear();
    if (!cells || !this.save) return;
    for (const c of cells) {
      if (this.inGrid(c.x, c.y)) this.preview.add(c.y * this.save.width + c.x);
    }
  }

  setViewport(scale: number, offsetX: number, offsetY: number): void {
    this.vp = { scale: scale > 0 ? scale : 1, offsetX, offsetY };
  }

  getViewport(): Viewport {
    return { ...this.vp };
  }

  /** Canvas size in CSS px. */
  getSize(): { width: number; height: number } {
    return { width: this.cssW, height: this.cssH };
  }

  /** Scale that renders one stud at STUD_CSS_PX CSS px, never below fit (1). */
  oneToOneScale(): number {
    return Math.max(1, STUD_CSS_PX / (this.layout.cell || 1));
  }

  /** Re-read the canvas CSS size and DPR, refit the layout, and redraw. */
  resize(): void {
    if (!this.save || this.destroyed) return;
    ({ cssW: this.cssW, cssH: this.cssH, dpr: this.dpr } = resizeBacking(this.canvas));
    this.layout = fitGrid(this.cssW, this.cssH, this.save.width, this.save.height, MARGIN_CELLS);
    this.draw();
  }

  /** Full redraw: plate, studs, dots, preview, seam lines, grid overlay. */
  draw(): void {
    if (this.destroyed || !this.save) return;
    clearCanvas(this.ctx);
    if (this.layout.cell <= 0) return;
    this.drawPlate();
    const { width, height } = this.save;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) this.paintCell(x, y);
    }
    this.paintPreview();
    this.drawSeams();
    this.drawGridOverlay();
  }

  /** Redraw the given cells, then the preview, seams and grid overlay above them. */
  drawCells(cells: Iterable<GridCell>): void {
    if (this.destroyed || !this.save || this.layout.cell <= 0) return;
    for (const c of cells) {
      if (this.inGrid(c.x, c.y)) this.paintCell(c.x, c.y);
    }
    this.paintPreview();
    this.drawSeams();
    this.drawGridOverlay();
  }

  /** Schedule one coalesced full redraw on the next animation frame. */
  requestDraw(): void {
    if (this.raf || this.destroyed || typeof requestAnimationFrame !== 'function') return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  /** Client (viewport) coordinates to a whole-grid stud, or null off the studs. */
  hitTest(clientX: number, clientY: number): GridCell | null {
    if (!this.save) return null;
    const p = clientToCanvas(this.canvas, this.cssW, this.cssH, clientX, clientY);
    return screenToCell(this.layout, this.vp, p.x, p.y);
  }

  /** Stop animations and release resources. */
  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.preview.clear();
    this.sprites.clear();
  }

  private inGrid(x: number, y: number): boolean {
    if (!this.save) return false;
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.save.width && y < this.save.height;
  }

  private drawPlate(): void {
    const L = this.layout;
    const m = L.cell * MARGIN_CELLS;
    const a = {
      x: this.vp.offsetX + this.vp.scale * (L.originX - m),
      y: this.vp.offsetY + this.vp.scale * (L.originY - m),
    };
    const size = this.vp.scale * (L.cell * L.cols + 2 * m);
    const d = this.dpr;
    drawPlate(
      this.ctx,
      { x: a.x * d, y: a.y * d, w: size * d, h: this.vp.scale * (L.cell * L.rows + 2 * m) * d },
      Math.min(size * d * 0.02, 10 * d),
      PLATE_GREEN,
      { blur: 12 * d, offsetY: 4 * d, color: 'rgba(0,0,0,0.35)' },
    );
  }

  private paintCell(x: number, y: number): void {
    if (!this.save) return;
    const r = cellDeviceRect(this.layout, this.vp, this.dpr, x, y);
    if (r.w <= 0 || r.h <= 0) return;
    if (r.x + r.w < 0 || r.y + r.h < 0 || r.x > this.canvas.width || r.y > this.canvas.height) {
      return;
    }
    const s = Math.max(r.w, r.h);
    const ctx = this.ctx;
    const i = y * this.save.width + x;
    const idx = this.save.placed[i];
    const color = idx !== EMPTY ? this.palette[idx] : undefined;
    ctx.drawImage(this.sprites.stud(s), r.x, r.y, r.w, r.h);
    if (color) ctx.drawImage(this.sprites.dot(color.hex, s), r.x, r.y, r.w, r.h);
  }

  private paintPreview(): void {
    if (!this.save || this.preview.size === 0) return;
    const color = this.palette[this.previewValue];
    if (!color) return;
    const ctx = this.ctx;
    ctx.globalAlpha = PREVIEW_ALPHA;
    for (const i of this.preview) {
      const r = cellDeviceRect(this.layout, this.vp, this.dpr, i % this.save.width, Math.floor(i / this.save.width));
      if (r.w <= 0 || r.h <= 0) continue;
      const s = Math.max(r.w, r.h);
      ctx.drawImage(this.sprites.dot(color.hex, s), r.x, r.y, r.w, r.h);
    }
    ctx.globalAlpha = 1;
  }

  private drawSeams(): void {
    if (!this.save) return;
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = Math.max(1, Math.round(d));
    ctx.beginPath();
    for (let x = PANEL_SIZE; x < this.save.width; x += PANEL_SIZE) {
      const a = cellToScreen(this.layout, this.vp, x, 0);
      const b = cellToScreen(this.layout, this.vp, x, this.save.height);
      ctx.moveTo(Math.round(a.x * d), Math.round(a.y * d));
      ctx.lineTo(Math.round(b.x * d), Math.round(b.y * d));
    }
    for (let y = PANEL_SIZE; y < this.save.height; y += PANEL_SIZE) {
      const a = cellToScreen(this.layout, this.vp, 0, y);
      const b = cellToScreen(this.layout, this.vp, this.save.width, y);
      ctx.moveTo(Math.round(a.x * d), Math.round(a.y * d));
      ctx.lineTo(Math.round(b.x * d), Math.round(b.y * d));
    }
    ctx.stroke();
  }

  private drawGridOverlay(): void {
    if (!this.save) return;
    const cellPx = this.layout.cell * this.vp.scale * this.dpr;
    if (cellPx < GRID_THRESHOLD_PX) return;
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < this.save.width; x++) {
      const a = cellToScreen(this.layout, this.vp, x, 0);
      const b = cellToScreen(this.layout, this.vp, x, this.save.height);
      ctx.moveTo(Math.round(a.x * d), Math.round(a.y * d));
      ctx.lineTo(Math.round(b.x * d), Math.round(b.y * d));
    }
    for (let y = 1; y < this.save.height; y++) {
      const a = cellToScreen(this.layout, this.vp, 0, y);
      const b = cellToScreen(this.layout, this.vp, this.save.width, y);
      ctx.moveTo(Math.round(a.x * d), Math.round(a.y * d));
      ctx.lineTo(Math.round(b.x * d), Math.round(b.y * d));
    }
    ctx.stroke();
  }
}
```

Add to `src/styles.css` (near the play-screen board rules; exact visual values follow the file's existing palette):

```css
/* Draw editor */
.screen.draw-editor { display: flex; flex-direction: column; height: 100dvh; }
.draw-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.draw-stage { flex: 1; min-height: 0; position: relative; }
.draw-canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; display: block; }
.draw-toolbar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 6px 8px; }
.draw-count { font-variant-numeric: tabular-nums; }
```

- [ ] **Step 4: Run tests and the gate**

Run: `bunx vitest run tests/render-draw-board.test.ts` (PASS). Then `make checkall` (PASS).

- [ ] **Step 5: Commit**

```bash
git add src/render/drawBoard.ts src/styles.css tests/render-draw-board.test.ts
git commit -m "feat(render): whole-mosaic DrawBoard with seams, grid overlay and preview (ENH-007)"
```

### Task 7: Create screen — `ui/drawCreate.ts`, route `#/draw/new`

**Files:**
- Create: `src/ui/drawCreate.ts`
- Modify: `src/ui/pure.ts` (Route union, parseRoute, routeHash, `seededPalette`, `buildDrawnSave`)
- Modify: `src/main.ts` (route case)
- Modify: `src/styles.css` (create-form field styles)
- Test: `tests/ui-draw-create.test.ts` (new), `tests/ui-pure.test.ts` (append)

**Interfaces:**
- Consumes: `getSettings`/`setSettings` (`storage/settings`), `createSave` (`ui/saves`), `h`/`icon`/`iconButton`/`toast` (`ui/dom`), `describeColor` (`engine/colorNames`), `studDims`/`panelCountOf` (`game` barrel), `newId` (`storage/id`).
- Produces: `mountDrawCreate(ctx: ScreenContext): Cleanup`; in `ui/pure.ts`: `seededPalette(mode: PaletteMode): PaletteColor[]` (LEGO table's Black+White, or pure black+white) and `buildDrawnSave(opts: { name: string; aspect: Aspect; mode: PaletteMode; background: string | null }): PictureSave` (`origin: 'drawn'`, `sourceImageId: ''`, `target` all EMPTY, `placed` pre-filled with the background's palette index or EMPTY, `drawBackground` set when a background is chosen, `panelElapsedMs` zeros, `completedAt` never); Route variant `{ name: 'drawNew' }` parsing `#/draw/new`. The editor route (`#/draw/:id`) is added in Task 9; until then the create screen navigates to the editor with a literal hash (`#/draw/${id}`), which Task 9 converts to `routeHash`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui-pure.test.ts` (inside the routing describe, matching its style):

```ts
it('parses the draw-new route', () => {
  expect(parseRoute('#/draw/new')).toEqual({ name: 'drawNew' });
  expect(parseRoute('#/draw/new/')).toEqual({ name: 'drawNew' });
});
```

Add `'#/draw/new'` to the list in the existing `round-trips through routeHash` test.

Create `tests/ui-draw-create.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/saves', () => ({ createSave: vi.fn(async () => undefined) }));

const { createSave } = await import('../src/ui/saves');
const { mountDrawCreate } = await import('../src/ui/drawCreate');
import { resetSettingsCache } from '../src/storage/settings';
import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';

function makeCtx(): { ctx: import('../src/ui/screen').ScreenContext; calls: string[] } {
  const calls: string[] = [];
  return {
    ctx: { root: document.body, navigate: (hash: string) => void calls.push(hash) },
    calls,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  resetSettingsCache();
  localStorage.clear();
  vi.mocked(createSave).mockClear();
});

describe('mountDrawCreate', () => {
  it('creates a drawn save with the defaults and opens the editor', async () => {
    const { ctx, calls } = makeCtx();
    mountDrawCreate(ctx);
    const name = document.querySelector<HTMLInputElement>('input[aria-label="Drawing name"]');
    expect(name?.value).toBe('My drawing');
    (document.querySelector<HTMLButtonElement>('button.btn.primary.big') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(createSave).toHaveBeenCalledTimes(1));
    const save = vi.mocked(createSave).mock.calls[0][0] as PictureSave;
    expect(save.origin).toBe('drawn');
    expect(save.sourceImageId).toBe('');
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(save.drawBackground).toBeUndefined();
    expect(save.target.every((v) => v === EMPTY)).toBe(true);
    expect(save.placed.every((v) => v === EMPTY)).toBe(true);
    expect(save.palette.map((c) => c.name)).toEqual(['Black', 'White']);
    expect(save.panelElapsedMs.every((ms) => ms === 0)).toBe(true);
    expect(calls[0]).toMatch(/^#\/draw\/[^/]+$/);
  });

  it('pre-fills a free-mode custom background and stores drawBackground', async () => {
    const { ctx } = makeCtx();
    mountDrawCreate(ctx);
    [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((b) => b.textContent === 'Free colors')
      .click();
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Custom background color"]',
    );
    expect(input).toBeTruthy();
    input.value = '#336699';
    input.dispatchEvent(new Event('input'));
    (
      document.querySelector<HTMLButtonElement>('button.btn.primary.big') as HTMLButtonElement
    ).click();
    await vi.waitFor(() => expect(createSave).toHaveBeenCalledTimes(1));
    const save = vi.mocked(createSave).mock.calls[0][0] as PictureSave;
    expect(save.paletteMode).toBe('free');
    expect(save.drawBackground).toBe('#336699');
    expect(save.palette).toHaveLength(3);
    expect(save.placed.every((v) => v === 2)).toBe(true);
  });

  it('keeps the LEGO background choices to seeded LEGO colors', () => {
    const { ctx } = makeCtx();
    mountDrawCreate(ctx);
    expect(document.querySelector('input[aria-label="Custom background color"]')).toBeNull();
    const hexes = [...document.querySelectorAll<HTMLElement>('[role="radio"]')]
      .filter((b) => b.style.background !== '')
      .map((b) => b.style.background);
    expect(hexes).toContain('rgb(5, 19, 29)'); // LEGO Black #05131d
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/ui-draw-create.test.ts tests/ui-pure.test.ts`
Expected: FAIL — `mountDrawCreate` and `drawNew` do not exist; the round-trip case fails on the new hash.

- [ ] **Step 3: Implement**

`src/ui/pure.ts` — add to the `Route` union: `| { name: 'drawNew' }`. In `parseRoute`, after the `setup` line add:

```ts
  if (parts[0] === 'draw' && parts.length === 2 && parts[1] === 'new') {
    return { name: 'drawNew' };
  }
```

In `routeHash`, add the case `case 'drawNew': return '#/draw/new';`. Add these two helpers (with `import { panelCountOf, studDims } from '../game';` and `import { newId } from '../storage/id';` added to the imports; `describeColor` is already imported):

```ts
/** Seeded two-color palette for a new drawing: the LEGO table's black and white, or pure ones. */
export function seededPalette(mode: PaletteMode): PaletteColor[] {
  if (mode === 'lego') {
    return [{ ...LEGO_COLORS[0] }, { ...LEGO_COLORS[1] }];
  }
  return [
    { hex: '#000000', name: 'Black' },
    { hex: '#ffffff', name: 'White' },
  ];
}

/** Build a new drawn save: empty target, seeded palette, background pre-placed. */
export function buildDrawnSave(opts: {
  name: string;
  aspect: Aspect;
  mode: PaletteMode;
  /** Background hex ("#rrggbb") or null for None. */
  background: string | null;
}): PictureSave {
  const { width, height } = studDims(opts.aspect);
  const palette = seededPalette(opts.mode);
  let fill = EMPTY;
  if (opts.background) {
    const hit = palette.findIndex((c) => c.hex === opts.background);
    if (hit >= 0) {
      fill = hit;
    } else {
      fill = palette.length;
      palette.push({ hex: opts.background, name: describeColor(opts.background) });
    }
  }
  const nowMs = Date.now();
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: newId(),
    createdAt: nowMs,
    updatedAt: nowMs,
    name: opts.name,
    sourceImageId: '',
    aspect: opts.aspect,
    paletteMode: opts.mode,
    origin: 'drawn',
    ...(opts.background ? { drawBackground: opts.background } : {}),
    palette,
    width,
    height,
    target: new Uint8Array(width * height).fill(EMPTY),
    placed: new Uint8Array(width * height).fill(fill),
    panelElapsedMs: new Array<number>(panelCountOf(opts.aspect)).fill(0),
  };
}
```

`pure.ts` also gains `import { LEGO_COLORS } from '../engine/legoPalette';` and `SAVE_SCHEMA_VERSION`, `EMPTY` to its `../types` import list (check what is already there).

Create `src/ui/drawCreate.ts`:

```ts
/**
 * Draw-create screen (`#/draw/new`): name, aspect, palette mode and background for a new
 * drawing, then creates the drawn save and opens the editor. No source image involved.
 */

import { getSettings, setSettings } from '../storage/settings';
import { type Aspect, type PaletteMode } from '../types';
import { h, icon, iconButton, toast } from './dom';
import { buildDrawnSave, routeHash, userMessage } from './pure';
import { createSave } from './saves';
import type { Cleanup, ScreenContext } from './screen';
import { settingsButton } from './settingsSheet';

const ASPECTS: Array<{ value: Aspect; label: string }> = [
  { value: '1:1', label: 'Square' },
  { value: '3:4', label: 'Portrait' },
  { value: '4:3', label: 'Landscape' },
];

/** Mounts the draw-create screen (route `#/draw/new`). */
export function mountDrawCreate({ root, navigate }: ScreenContext): Cleanup {
  let aspect: Aspect = '1:1';
  let mode: PaletteMode = getSettings().paletteMode;
  let background: string | null = null;
  let creating = false;

  const nameInput = h('input', {
    type: 'text',
    class: 'name-input',
    value: 'My drawing',
    maxlength: '60',
    'aria-label': 'Drawing name',
    autocomplete: 'off',
  });

  const segmented = <T extends string>(
    label: string,
    options: Array<{ value: T; label: string }>,
    get: () => T,
    set: (v: T) => void,
  ): HTMLElement => {
    const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
    const buttons = options.map((o) => {
      const b = h('button', { type: 'button', role: 'radio', 'data-value': o.value }, o.label);
      b.addEventListener('click', () => {
        set(o.value);
        sync();
      });
      return b;
    });
    const sync = (): void => {
      for (const b of buttons) {
        const on = b.dataset.value === get();
        b.setAttribute('aria-checked', String(on));
        b.classList.toggle('on', on);
      }
    };
    sync();
    group.append(...buttons);
    return group;
  };

  const aspectCtl = segmented('Aspect', ASPECTS, () => aspect, (v) => {
    aspect = v;
  });
  const modeCtl = segmented<PaletteMode>(
    'Palette',
    [
      { value: 'lego', label: 'LEGO colors' },
      { value: 'free', label: 'Free colors' },
    ],
    () => mode,
    (v) => {
      mode = v;
      // A custom background may not be a LEGO color; switch modes only keeps swatch picks.
      const keep = ['#ffffff', v === 'lego' ? '#05131d' : '#000000'];
      if (background !== null && !keep.includes(background)) background = null;
      setSettings({ paletteMode: v });
      syncBackground();
    },
  );

  // Background: None/Black/White swatches plus a custom color input in Free mode only, so
  // every LEGO-mode background is a LEGO color and the parts exports stay valid.
  const bgWrap = h('div', { class: 'setting-row column' });
  const syncBackground = (): void => {
    const choices: Array<{ hex: string | null; label: string }> = [
      { hex: null, label: 'None' },
      { hex: mode === 'lego' ? '#05131d' : '#000000', label: 'Black' },
      { hex: '#ffffff', label: 'White' },
    ];
    const swatches = h('div', {
      class: 'swatches',
      role: 'radiogroup',
      'aria-label': 'Background',
    });
    for (const { hex, label } of choices) {
      const b = h('button', {
        type: 'button',
        role: 'radio',
        class: background === hex ? 'swatch on' : 'swatch',
        'aria-checked': String(background === hex),
        'aria-label': label,
        title: label,
      });
      if (hex) b.style.background = hex;
      b.addEventListener('click', () => {
        background = hex;
        syncBackground();
      });
      swatches.append(b);
    }
    if (mode === 'free') {
      const input = h('input', {
        type: 'color',
        value: background ?? '#808080',
        'aria-label': 'Custom background color',
      });
      input.addEventListener('input', () => {
        background = input.value;
        syncBackground();
      });
      swatches.append(input);
    }
    bgWrap.replaceChildren(
      h('span', {}, h('strong', {}, 'Background'), h('small', {}, 'Painted across the empty grid')),
      swatches,
    );
  };
  syncBackground();

  const createBtn = h(
    'button',
    { type: 'button', class: 'btn primary big' },
    icon('brush'),
    'Create',
  );
  createBtn.addEventListener('click', async () => {
    if (creating) return;
    creating = true;
    createBtn.disabled = true;
    try {
      const save = buildDrawnSave({
        name: nameInput.value.trim() || 'My drawing',
        aspect,
        mode,
        background,
      });
      await createSave(save);
      // Task 9 replaces this literal with routeHash({ name: 'drawEditor', id: save.id }).
      navigate(`#/draw/${encodeURIComponent(save.id)}`, { replace: true });
    } catch (err) {
      creating = false;
      createBtn.disabled = false;
      console.error(err);
      toast(`Could not create: ${userMessage(err)}`, 4000);
    }
  });

  root.append(
    h(
      'div',
      { class: 'screen draw-create' },
      h(
        'header',
        { class: 'topbar' },
        iconButton('back', 'Back to gallery', () => navigate('#/')),
        h('h1', { class: 'title' }, 'New drawing'),
        h('span', { class: 'spacer' }),
        settingsButton(),
      ),
      h(
        'div',
        { class: 'scroll' },
        h('div', { class: 'field' }, h('span', {}, 'Name'), nameInput),
        aspectCtl,
        modeCtl,
        bgWrap,
        createBtn,
      ),
    ),
  );
  return () => undefined;
}
```

Wait — `routeHash` is imported above but unused until Task 9 converts the literal; import only `buildDrawnSave` and `userMessage` now to keep lint green. Drop `routeHash` from the import list in this task.

`src/main.ts` — add `import { mountDrawCreate } from './ui/drawCreate';` and the switch case:

```ts
    case 'drawNew':
      cleanup = mountDrawCreate(ctx);
      break;
```

`src/styles.css`:

```css
/* Draw create */
.draw-create .field { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
.draw-create .field > span { font-size: 0.9rem; font-weight: 600; }
.draw-create input[type='text'] { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid #8886; background: transparent; color: inherit; font-size: 1rem; }
.draw-create .scroll { display: flex; flex-direction: column; gap: 12px; padding: 16px; max-width: 560px; margin: 0 auto; width: 100%; }
```

- [ ] **Step 4: Run tests and the gate**

Run: `bunx vitest run tests/ui-draw-create.test.ts tests/ui-pure.test.ts` (PASS). Then `make checkall` (PASS). Manual: `make dev`, open `#/new` (no entry link yet — navigate to `#/draw/new` directly), create a drawing; it lands on a blank screen (`#/draw/:id` unrouted until Task 9).

- [ ] **Step 5: Commit**

```bash
git add src/ui/drawCreate.ts src/ui/pure.ts src/main.ts src/styles.css tests/ui-draw-create.test.ts tests/ui-pure.test.ts
git commit -m "feat(draw): create screen with seeded palette and background (ENH-007)"
```

### Task 8: Palette tray — `ui/drawTray.ts`, `paletteEntryFor`

**Files:**
- Create: `src/ui/drawTray.ts`
- Modify: `src/ui/pure.ts` (add `paletteEntryFor`)
- Modify: `src/styles.css` (tray styles)
- Test: `tests/ui-draw-tray.test.ts` (new)

**Interfaces:**
- Consumes: `DrawSession` (Task 5), `LEGO_COLORS` (`engine/legoPalette`), `openSheet`/`iconButton`/`h`/`toast` (`ui/dom`), `luminance` (`render/color`), `describeColor` via pure.
- Produces: in `ui/pure.ts`: `paletteEntryFor(mode: PaletteMode, hex: string): PaletteColor` — LEGO mode must match a `LEGO_COLORS` hex (else it throws, so names and catalog IDs stay valid for parts export); Free mode derives the name with `describeColor` and lowercases the hex. In `ui/drawTray.ts`: `createDrawTray(tray: HTMLElement, session: DrawSession, mode: PaletteMode, onPick: (c: number) => void): DrawTrayHandle` where `DrawTrayHandle = { refresh(): void; dispose(): void }`. The tray renders primary/secondary slots with a swap button, one swatch per palette color with its usage count and an edit affordance, and an Add color button (cap toast at 32). The add/edit sheet: LEGO mode shows the `LEGO_COLORS` grid; Free mode a native color input; recolor mode notes that placed dots change color too and offers Remove (disabled while the color is used).

- [ ] **Step 1: Write the failing tests**

Create `tests/ui-draw-tray.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { DrawSession } from '../src/game';
import { paletteEntryFor } from '../src/ui/pure';
import { createDrawTray } from '../src/ui/drawTray';
import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';
import { h } from '../src/ui/dom';

function drawnSave(): PictureSave {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: 'd1',
    createdAt: 1,
    updatedAt: 1,
    name: 'd',
    sourceImageId: '',
    aspect: '1:1',
    paletteMode: 'lego',
    origin: 'drawn',
    palette: [
      { hex: '#05131d', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
    ],
    width: 48,
    height: 48,
    target: new Uint8Array(48 * 48).fill(EMPTY),
    placed: new Uint8Array(48 * 48).fill(EMPTY),
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

describe('paletteEntryFor', () => {
  it('accepts LEGO table colors only in LEGO mode', () => {
    expect(paletteEntryFor('lego', '#c91a09')).toEqual({ hex: '#c91a09', name: 'Red' });
    expect(() => paletteEntryFor('lego', '#123456')).toThrow();
  });

  it('derives free names from the shade', () => {
    const entry = paletteEntryFor('free', '#336699');
    expect(entry.hex).toBe('#336699');
    expect(entry.name).toBe('Blue');
  });
});

describe('createDrawTray', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    el = h('div', {});
    document.body.append(el);
  });

  it('renders swatches with usage counts and forwards picks', () => {
    const session = new DrawSession(drawnSave());
    session.beginStroke('paint');
    session.strokeAt(0, 0);
    session.endStroke();
    const picks: number[] = [];
    const tray = createDrawTray(el, session, 'lego', (c) => picks.push(c));
    const swatches = [...el.querySelectorAll<HTMLButtonElement>('.draw-swatch button')].filter(
      (b) => b.getAttribute('role') === 'radio',
    );
    expect(swatches).toHaveLength(2);
    expect(el.querySelectorAll('.draw-swatch')[1].textContent).toContain('1');
    swatches[0].click();
    expect(picks).toEqual([0]);
    tray.dispose();
  });

  it('the add-color sheet adds a LEGO color and refreshes', () => {
    const session = new DrawSession(drawnSave());
    const tray = createDrawTray(el, session, 'lego', () => undefined);
    (el.querySelector('[aria-label="Add color"]') as HTMLButtonElement).click();
    const sheet = document.querySelector('.sheet') as HTMLElement;
    expect(sheet).toBeTruthy();
    const red = [...sheet.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('title') === 'Red',
    ) as HTMLButtonElement;
    red.click();
    expect(session.save.palette).toHaveLength(3);
    expect(session.save.palette[2].name).toBe('Red');
    expect(document.querySelector('.sheet')).toBeNull(); // closed after apply
    tray.dispose();
  });

  it('the edit sheet blocks removing a used color', () => {
    const session = new DrawSession(drawnSave());
    session.beginStroke('paint');
    session.strokeAt(0, 0);
    session.endStroke();
    const tray = createDrawTray(el, session, 'lego', () => undefined);
    (el.querySelector('[aria-label="Edit Black"]') as HTMLButtonElement).click();
    const remove = [...document.querySelectorAll<HTMLButtonElement>('.sheet button')].find(
      (b) => b.textContent === 'Remove color',
    ) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    tray.dispose();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/ui-draw-tray.test.ts`
Expected: FAIL — `createDrawTray` and `paletteEntryFor` do not exist.

- [ ] **Step 3: Implement**

`src/ui/pure.ts` — add (with `LEGO_COLORS` already imported in Task 7):

```ts
/**
 * Validate a color for the mode: LEGO mode accepts only LEGO table hexes (names and
 * catalog IDs must stay valid for parts exports); Free mode names the shade.
 */
export function paletteEntryFor(mode: PaletteMode, hex: string): PaletteColor {
  if (mode === 'lego') {
    const hit = LEGO_COLORS.find((c) => c.hex === hex.toLowerCase());
    if (!hit) throw new Error('Choose a LEGO color');
    return { hex: hit.hex, name: hit.name };
  }
  return { hex: hex.toLowerCase(), name: describeColor(hex) };
}
```

Create `src/ui/drawTray.ts`:

```ts
/**
 * Draw tray: primary/secondary color slots with swap, palette swatches with usage counts
 * and per-color edit affordances, and the add/edit color sheet (LEGO grid or Free input).
 */

import type { DrawSession } from '../game';
import { LEGO_COLORS } from '../engine/legoPalette';
import { type PaletteColor, type PaletteMode, MAX_COLORS } from '../types';
import { h, iconButton, openSheet, toast } from './dom';
import { paletteEntryFor, userMessage } from './pure';

/** What the editor drives: refresh after session events, dispose on unmount. */
export interface DrawTrayHandle {
  refresh(): void;
  dispose(): void;
}

/** Mounts the draw tray into `tray`. `onPick` fires with the clicked palette index. */
export function createDrawTray(
  tray: HTMLElement,
  session: DrawSession,
  mode: PaletteMode,
  onPick: (c: number) => void,
): DrawTrayHandle {
  let disposed = false;

  function slot(index: number, label: string, primary: boolean): HTMLElement {
    const hex = session.save.palette[index]?.hex ?? '#888888';
    const b = h('button', {
      type: 'button',
      class: primary ? 'slot primary' : 'slot',
      'aria-label': `${label} color`,
      title: `${label} color`,
      style: `--c:${hex};background:${hex}`,
    });
    b.addEventListener('click', () => onPick(index));
    return b;
  }

  function swap(): void {
    const p = session.primary;
    session.setPrimary(session.secondary);
    session.setSecondary(p);
    build();
  }

  function build(): void {
    if (disposed) return;
    const usage = session.usageCounts();
    const row = h('div', {
      class: 'draw-swatches',
      role: 'radiogroup',
      'aria-label': 'Drawing colors',
    });
    session.save.palette.forEach((entry, i) => {
      const pick = h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(i === session.primary),
        class: i === session.primary ? 'swatch on' : 'swatch',
        'aria-label': `${entry.name}, ${usage[i]} dots`,
        title: `${entry.name} (${usage[i]})`,
        style: `--c:${entry.hex};background:${entry.hex};--count-ink:${
          isLight(entry.hex) ? '#1b1b1b' : '#fff'
        }`,
      }, h('span', { class: 'count' }, String(usage[i])));
      pick.addEventListener('click', () => onPick(i));
      const edit = iconButton('gear', `Edit ${entry.name}`, () => openColorSheet(i), 'icon-btn edit-btn');
      row.append(h('span', { class: 'draw-swatch' }, pick, edit));
    });
    row.append(
      iconButton('plus', 'Add color', () => {
        if (session.save.palette.length >= MAX_COLORS) {
          toast(`Palette is full (${MAX_COLORS} colors max)`);
          return;
        }
        openColorSheet(null);
      }),
    );
    tray.replaceChildren(
      slot(session.primary, 'Primary', true),
      iconButton('move', 'Swap colors', swap, 'icon-btn swap'),
      slot(session.secondary, 'Secondary', false),
      row,
    );
  }

  function openColorSheet(index: number | null): void {
    const recolor = index !== null;
    const usage = session.usageCounts();
    const body = h(
      'div',
      { class: 'confirm' },
      h(
        'p',
        { class: 'muted small' },
        recolor
          ? 'Pick a new color for this slot. Dots already placed with it change color too.'
          : 'Add a color to the palette.',
      ),
    );
    const apply = (entry: PaletteColor): void => {
      try {
        if (recolor) session.recolor(index, entry);
        else session.addColor(entry);
      } catch (err) {
        toast(userMessage(err), 3000);
        return;
      }
      sheet.close();
      build();
    };
    let picker: HTMLElement;
    if (mode === 'lego') {
      picker = h('div', { class: 'lego-grid', role: 'listbox', 'aria-label': 'LEGO colors' });
      for (const c of LEGO_COLORS) {
        const b = h('button', {
          type: 'button',
          class: 'swatch',
          'aria-label': c.name,
          title: c.name,
          style: `--c:${c.hex};background:${c.hex}`,
        });
        b.addEventListener('click', () => apply(paletteEntryFor('lego', c.hex)));
        picker.append(b);
      }
    } else {
      const input = h('input', {
        type: 'color',
        value: recolor ? session.save.palette[index].hex : '#808080',
        'aria-label': 'Color',
      });
      const ok = h('button', { type: 'button', class: 'btn primary' }, recolor ? 'Apply' : 'Add');
      ok.addEventListener('click', () => {
        try {
          apply(paletteEntryFor('free', input.value));
        } catch (err) {
          toast(userMessage(err), 3000);
        }
      });
      picker = h('div', { class: 'guide-row' }, input, ok);
    }
    body.append(picker);
    if (recolor) {
      const remove = h('button', { type: 'button', class: 'btn ghost' }, 'Remove color');
      remove.disabled = usage[index] > 0;
      remove.title = remove.disabled ? 'Erase this color’s dots first' : '';
      remove.addEventListener('click', () => {
        try {
          session.removeColor(index);
        } catch (err) {
          toast(userMessage(err), 3000);
          return;
        }
        sheet.close();
        build();
      });
      body.append(remove);
    }
    const sheet = openSheet(recolor ? 'Edit color' : 'Add color', body);
  }

  build();
  return {
    refresh: build,
    dispose: () => {
      disposed = true;
    },
  };
}

function isLight(hex: string): boolean {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.45;
}
```

`src/styles.css`:

```css
/* Draw tray */
.draw-tray { display: flex; align-items: center; gap: 10px; padding: 8px 12px 12px; overflow-x: auto; }
.draw-tray .slot { width: 34px; height: 34px; border-radius: 50%; border: 2px solid #8886; flex: none; cursor: pointer; }
.draw-tray .slot.primary { outline: 2px solid currentColor; outline-offset: 2px; }
.draw-tray .swap { flex: none; }
.draw-swatches { display: flex; gap: 10px; align-items: center; }
.draw-swatch { position: relative; flex: none; display: inline-flex; }
.draw-swatch button[role='radio'] { width: 32px; height: 32px; border-radius: 50%; border: 1px solid #8886; cursor: pointer; position: relative; }
.draw-swatch button[role='radio'].on { outline: 2px solid currentColor; outline-offset: 2px; }
.draw-swatch .count { position: absolute; inset: 0; display: grid; place-items: center; font-size: 0.65rem; font-weight: 700; color: var(--count-ink, #fff); pointer-events: none; }
.draw-swatch .edit-btn { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; min-width: 18px; padding: 0; border-radius: 50%; }
.lego-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(34px, 1fr)); gap: 8px; }
.lego-grid .swatch { width: 34px; height: 34px; border-radius: 50%; border: 1px solid #8886; cursor: pointer; }
```

- [ ] **Step 4: Run tests and the gate**

Run: `bunx vitest run tests/ui-draw-tray.test.ts` (PASS). Then `make checkall` (PASS).

- [ ] **Step 5: Commit**

```bash
git add src/ui/drawTray.ts src/ui/pure.ts src/styles.css tests/ui-draw-tray.test.ts
git commit -m "feat(draw): palette tray with usage counts and add/edit color sheet (ENH-007)"
```

### Task 9: Editor + input + routing — `ui/drawEditor.ts`, `ui/drawInput.ts`, `#/draw/:id`

**Files:**
- Create: `src/ui/drawInput.ts`
- Create: `src/ui/drawEditor.ts`
- Modify: `src/ui/dom.ts` (new tool icons: `brush`, `line`, `box`, `ellipse`, `polygon`, `fill`, `pipette`)
- Modify: `src/ui/pure.ts` (Route union + parseRoute + routeHash for `drawEditor`)
- Modify: `src/main.ts` (route case)
- Modify: `src/ui/overview.ts` and `src/ui/panelPlay.ts` (redirect drawn saves to the editor)
- Modify: `src/ui/drawCreate.ts` (literal hash becomes `routeHash`)
- Test: `tests/ui-draw-editor.test.ts` (new), `tests/ui-pure.test.ts` (append)

**Interfaces:**
- Consumes: everything from Tasks 1-8; `bindBoardGestures`-style input from `ui/gestures.ts` (reused directly); `openPartsSheet`/`openGuideSheet` (`ui/partsSheet`, works for drawn saves once Task 2 routes counts through `effectiveCells`); `zoomViewportAt` (`render/layout`).
- Produces: `mountDrawEditor(ctx: ScreenContext, id: string): Cleanup` (route `#/draw/:id`); `bindDrawInput(canvas: HTMLCanvasElement, board: DrawBoard, opts: { canPaint: (erase: boolean) => boolean; panMode: () => boolean; onStroke: (i: StrokeIntent) => void; onDoubleTap: (x: number, y: number) => void }): () => void` in `ui/drawInput.ts`, where `StrokeIntent` is the same extract of gesture intents `ui/boardInput.ts` exports. Route variant `{ name: 'drawEditor'; id: string }`. Cross-linked ids (Review Focus 5): `#/draw/:photoId` redirects to the photo overview; `#/play/:drawnId` (overview and panel) redirects to the editor; unknown ids toast and return to the gallery.
- **Persistence (Review Focus 1):** the editor persists on a 500 ms debounce (`schedulePersist` on every session event) and flushes the dirty save on cleanup, on `visibilitychange` to hidden, and on `pagehide` (covers reload). An untouched editor never writes (a `dirty` flag guards `flushPersist`).
- **Double-tap zoom:** a second tap within 340 ms and 24 px of the first is swallowed (its stroke never reaches the session) and toggles fit/1:1; if the first tap just painted (brush/eraser, within 450 ms), that dot is undone so the double-tap only zooms.
- Editor topbar: back, name, dot counter, Parts, Guide. Toolbar: pan, brush, line, box, ellipse, polygon (+ Close shape while a polygon with 3+ points is open), fill, eyedropper, eraser, undo, redo, Clear all, help; contextual brush size (1/3/5/7/9), tip (round/square) and fill/stroke controls, and Mirror ↔ / Mirror ↕ toggles.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui-pure.test.ts` (routing describe):

```ts
it('parses the draw editor route', () => {
  expect(parseRoute('#/draw/abc')).toEqual({ name: 'drawEditor', id: 'abc' });
  expect(parseRoute('#/draw')).toEqual({ name: 'gallery' });
  expect(parseRoute('#/draw/%E0')).toEqual({ name: 'gallery' });
});
```

Add `'#/draw/abc'` to the `round-trips through routeHash` list.

Create `tests/ui-draw-editor.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/saves', () => ({
  loadSave: vi.fn(),
  persistSave: vi.fn(async () => undefined),
}));

// happy-dom has no 2D context; stub it before the editor module is used.
const ctxStub = new Proxy(
  {},
  {
    get: () => () => ctxStub,
    set: () => true,
  },
) as unknown as CanvasRenderingContext2D;
HTMLCanvasElement.prototype.getContext = (() => ctxStub) as typeof HTMLCanvasElement.prototype.getContext;

const { loadSave, persistSave } = await import('../src/ui/saves');
const { mountDrawEditor } = await import('../src/ui/drawEditor');
import { EMPTY, type PictureSave, SAVE_SCHEMA_VERSION } from '../src/types';

function drawnSave(): PictureSave {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id: 'd1',
    createdAt: 1,
    updatedAt: 1,
    name: 'doodle',
    sourceImageId: '',
    aspect: '1:1',
    paletteMode: 'lego',
    origin: 'drawn',
    palette: [
      { hex: '#05131d', name: 'Black' },
      { hex: '#ffffff', name: 'White' },
    ],
    width: 48,
    height: 48,
    target: new Uint8Array(48 * 48).fill(EMPTY),
    placed: new Uint8Array(48 * 48).fill(EMPTY),
    panelElapsedMs: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

function makeCtx(): { ctx: import('../src/ui/screen').ScreenContext; calls: string[] } {
  const calls: string[] = [];
  return {
    ctx: { root: document.body, navigate: (hash: string) => void calls.push(hash) },
    calls,
  };
}

async function addColorViaSheet(): Promise<void> {
  (document.querySelector('[aria-label="Add color"]') as HTMLButtonElement).click();
  const red = [...document.querySelectorAll<HTMLButtonElement>('.sheet button')].find(
    (b) => b.getAttribute('title') === 'Red',
  ) as HTMLButtonElement;
  red.click();
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.mocked(persistSave).mockClear();
});

describe('mountDrawEditor', () => {
  it('redirects unknown ids to the gallery with a toast', async () => {
    vi.mocked(loadSave).mockResolvedValue(undefined);
    const { ctx, calls } = makeCtx();
    mountDrawEditor(ctx, 'nope');
    await vi.waitFor(() => expect(calls).toContain('#/'));
  });

  it('redirects photo saves to their overview', async () => {
    const save = drawnSave();
    save.origin = 'photo';
    save.id = 'p1';
    vi.mocked(loadSave).mockResolvedValue(save);
    const { ctx, calls } = makeCtx();
    mountDrawEditor(ctx, 'p1');
    await vi.waitFor(() => expect(calls).toContain('#/play/p1'));
  });

  it('mounts the editor with a zero counter and no write until dirty', async () => {
    const save = drawnSave();
    vi.mocked(loadSave).mockResolvedValue(save);
    const { ctx } = makeCtx();
    const cleanup = mountDrawEditor(ctx, save.id);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLCanvasElement>('.draw-canvas')).toBeTruthy(),
    );
    expect(document.querySelector('.draw-count')?.textContent).toBe('0 dots');
    cleanup();
    expect(persistSave).not.toHaveBeenCalled();
  });

  it('flushes a dirty save on cleanup', async () => {
    const save = drawnSave();
    vi.mocked(loadSave).mockResolvedValue(save);
    const { ctx } = makeCtx();
    const cleanup = mountDrawEditor(ctx, save.id);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLCanvasElement>('.draw-canvas')).toBeTruthy(),
    );
    await addColorViaSheet();
    expect(save.palette).toHaveLength(3);
    expect(persistSave).not.toHaveBeenCalled(); // debounce has not fired
    cleanup();
    expect(persistSave).toHaveBeenCalledWith(save);
  });

  it('flushes a dirty save when the page hides', async () => {
    const save = drawnSave();
    vi.mocked(loadSave).mockResolvedValue(save);
    const { ctx } = makeCtx();
    const cleanup = mountDrawEditor(ctx, save.id);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLCanvasElement>('.draw-canvas')).toBeTruthy(),
    );
    await addColorViaSheet();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(persistSave).toHaveBeenCalledWith(save);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    cleanup();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/ui-draw-editor.test.ts tests/ui-pure.test.ts`
Expected: FAIL — `mountDrawEditor` and the `drawEditor` route do not exist.

- [ ] **Step 3: Implement**

`src/ui/dom.ts` — add these paths to the `ICONS` map (the existing 24x24 stroke set):

```ts
  brush:
    'M4 20l1-4 9.5-9.5 3 3L8 19l-4 1zM14 6l2.5-2.5a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L17 9',
  line: 'M5 19L19 5',
  box: 'M5 5h14v14H5z',
  ellipse: 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14z',
  polygon: 'M12 3l8 6-3 10H7L4 9z',
  fill: 'M5 11l7-7 7 7-7 7zM18.5 15.5s2 2.3 2 3.7a2 2 0 0 1-4 0c0-1.4 2-3.7 2-3.7z',
  pipette: 'M20.7 3.3a2.4 2.4 0 0 0-3.4 0L14 6.6l3.4 3.4 3.3-3.3a2.4 2.4 0 0 0 0-3.4zM12.6 8L5 15.6V19h3.4L16 11.4',
```

Create `src/ui/drawInput.ts`:

```ts
/**
 * Draw board pointer binding: pointer and wheel events feed the shared gesture model, pan
 * and zoom intents resize DrawBoard's viewport, stroke intents go to the editor, and a
 * second quick tap becomes a double-tap (zoom) instead of a stroke. Thin variant of
 * ui/boardInput.ts typed to DrawBoard.
 */

import type { DrawBoard } from '../render/drawBoard';
import { zoomViewportAt } from '../render/layout';
import {
  type BoardGesturesOptions,
  createBoardGestures,
  type GestureIntent,
  type GesturePointer,
} from './gestures';

const MAX_ZOOM = 4;
/** A stroke shorter than this counts as a tap (for double-tap detection). */
const TAP_MS = 220;
/** Two taps within this window and this distance are a double-tap. */
const DBL_MS = 340;
const DBL_SLOP_PX = 24;

export type StrokeIntent = Extract<
  GestureIntent,
  { type: 'strokeStart' | 'strokeMove' | 'strokeEnd' | 'strokeCancel' }
>;

export interface DrawInputOptions {
  canPaint: BoardGesturesOptions['canPaint'];
  panMode: BoardGesturesOptions['panMode'];
  onStroke: (intent: StrokeIntent) => void;
  onDoubleTap: (x: number, y: number) => void;
}

/** Returns a cleanup that detaches listeners and drops any pending touch. */
export function bindDrawInput(
  canvas: HTMLCanvasElement,
  board: DrawBoard,
  opts: DrawInputOptions,
): () => void {
  const gestures = createBoardGestures({
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    canPaint: opts.canPaint,
    panMode: opts.panMode,
  });
  const canvasPoint = (x: number, y: number): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: x - r.left, y: y - r.top };
  };
  const clampVp = (s: number, ox: number, oy: number): void => {
    const { width, height } = board.getSize();
    const cx = Math.min(0, Math.max(width - width * s, ox));
    const cy = Math.min(0, Math.max(height - height * s, oy));
    board.setViewport(s, cx, cy);
    board.draw();
  };
  const zoomAt = (factor: number, mx: number, my: number, dmx = 0, dmy = 0): void => {
    const z = zoomViewportAt(board.getViewport(), factor, mx, my, 1, MAX_ZOOM);
    clampVp(z.scale, z.offsetX + dmx, z.offsetY + dmy);
  };

  let strokeStartAt = 0;
  let strokeStartPt = { x: 0, y: 0 };
  let lastTapAt = 0;
  let lastTapPt = { x: 0, y: 0 };

  const offIntent = gestures.onIntent((i) => {
    switch (i.type) {
      case 'pan': {
        const vp = board.getViewport();
        clampVp(vp.scale, vp.offsetX + i.dx, vp.offsetY + i.dy);
        break;
      }
      case 'zoom': {
        const m = canvasPoint(i.mx, i.my);
        zoomAt(i.factor, m.x, m.y, i.dmx, i.dmy);
        break;
      }
      case 'strokeStart': {
        const nowMs = performance.now();
        if (
          nowMs - lastTapAt < DBL_MS &&
          Math.hypot(i.x - lastTapPt.x, i.y - lastTapPt.y) < DBL_SLOP_PX
        ) {
          lastTapAt = 0;
          opts.onDoubleTap(i.x, i.y);
          break; // second tap of a double-tap: zoom, never a stroke
        }
        strokeStartAt = nowMs;
        strokeStartPt = { x: i.x, y: i.y };
        opts.onStroke(i);
        break;
      }
      case 'strokeEnd': {
        opts.onStroke(i);
        const nowMs = performance.now();
        if (nowMs - strokeStartAt < TAP_MS) {
          lastTapAt = nowMs;
          lastTapPt = strokeStartPt;
        }
        break;
      }
      default:
        opts.onStroke(i);
    }
  });

  const toPointer = (e: PointerEvent): GesturePointer => ({
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    type: e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse',
    erase: e.pointerType === 'mouse' && e.button === 2,
  });
  const onDown = (e: PointerEvent): void => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers may not be capturable.
    }
    gestures.down(toPointer(e));
  };
  const onMove = (e: PointerEvent): void => {
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    gestures.move(toPointer(e), coalesced.map(toPointer));
  };
  const onUp = (e: PointerEvent): void => gestures.up(toPointer(e), e.type !== 'pointerup');
  const onContextMenu = (e: MouseEvent): void => e.preventDefault();
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = canvasPoint(e.clientX, e.clientY);
    zoomAt(Math.exp(-e.deltaY * 0.002), p.x, p.y);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  return () => {
    gestures.dispose();
    offIntent();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
}
```

Create `src/ui/drawEditor.ts`:

```ts
/**
 * Draw editor screen (`#/draw/:id`): the whole mosaic with pan/zoom, draw tools, palette
 * tray, undo/redo (50) and Clear all. Sessions are saved through a 500 ms debounced persist
 * flushed on cleanup, hide, and pagehide, so no stroke is lost to navigation or reload.
 */

import {
  type DrawEvent,
  DrawSession,
  type DrawTool,
  lineCells,
  type Symmetry,
} from '../game';
import { DrawBoard } from '../render/drawBoard';
import { zoomViewportAt } from '../render/layout';
import type { PictureSave } from '../types';
import { h, iconButton, confirmDialog, openSheet, toast } from './dom';
import { bindDrawInput, type StrokeIntent } from './drawInput';
import { openGuideSheet, openPartsSheet } from './partsSheet';
import { routeHash, userMessage } from './pure';
import { loadSave, persistSave } from './saves';
import type { Cleanup, ScreenContext } from './screen';
import { settingsButton } from './settingsSheet';
import { createDrawTray, type DrawTrayHandle } from './drawTray';

const PERSIST_MS = 500;
type EditorTool = DrawTool | 'pan' | 'eraser';

const TOOLS: Array<{ id: DrawTool; icon: Parameters<typeof iconButton>[0]; label: string }> = [
  { id: 'brush', icon: 'brush', label: 'Brush' },
  { id: 'line', icon: 'line', label: 'Line' },
  { id: 'rect', icon: 'box', label: 'Box' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse' },
  { id: 'poly', icon: 'polygon', label: 'Polygon' },
  { id: 'fill', icon: 'fill', label: 'Fill' },
  { id: 'pick', icon: 'pipette', label: 'Eyedropper' },
];

/**
 * Mounts the draw editor (route `#/draw/:id`). Unknown ids toast and return to the gallery;
 * photo saves redirect to their overview. The Cleanup unbinds input, flushes the save,
 * and tears down the renderer and tray.
 */
export function mountDrawEditor({ root, navigate }: ScreenContext, id: string): Cleanup {
  let alive = true;
  let teardown: Cleanup = () => undefined;
  const shell = h(
    'div',
    { class: 'screen draw-editor' },
    h('p', { class: 'muted center pad' }, 'Loading…'),
  );
  root.append(shell);

  void loadSave(id)
    .then((save) => {
      if (!alive) return;
      if (!save) {
        toast('Picture not found');
        navigate('#/', { replace: true });
        return;
      }
      if (save.origin !== 'drawn') {
        navigate(routeHash({ name: 'overview', id: save.id }), { replace: true });
        return;
      }
      teardown = build(save);
    })
    .catch((err: unknown) => {
      console.error(err);
      if (!alive) return;
      toast(`Could not open picture: ${userMessage(err)}`, 4000);
      navigate('#/', { replace: true });
    });

  const build = (save: PictureSave): Cleanup => {
    const session = new DrawSession(save);
    let tool: EditorTool = 'brush';

    // ---- persistence --------------------------------------------------------
    let dirty = false;
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPersist = (): void => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      if (!dirty) return;
      dirty = false;
      persistSave(save).catch((err: unknown) => {
        console.error(err);
        toast(`Save failed: ${userMessage(err)}`, 4000);
      });
    };
    const schedulePersist = (): void => {
      dirty = true;
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(flushPersist, PERSIST_MS);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flushPersist();
    };
    const onPageHide = (): void => flushPersist();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    // ---- DOM ----------------------------------------------------------------
    const countEl = h('span', { class: 'pill draw-count', 'aria-label': 'Dots placed' });
    const canvas = h('canvas', {
      class: 'draw-canvas',
      role: 'application',
      'aria-label': 'Drawing board. Drag to draw, two fingers to zoom, double-tap to zoom.',
    });
    const stage = h('div', { class: 'draw-stage' }, canvas);
    const trayEl = h('div', { class: 'draw-tray', role: 'group', 'aria-label': 'Palette' });
    const toolbar = h('div', { class: 'draw-toolbar', role: 'toolbar', 'aria-label': 'Draw tools' });
    shell.replaceChildren(
      h(
        'header',
        { class: 'topbar' },
        iconButton('back', 'Back to gallery', () => navigate('#/')),
        h('h1', { class: 'title' }, save.name),
        countEl,
        h('span', { class: 'spacer' }),
        h(
          'button',
          { type: 'button', class: 'chip', on: { click: () => openPartsSheet(save) } },
          'Parts',
        ),
        h(
          'button',
          { type: 'button', class: 'chip', on: { click: () => openGuideSheet(save) } },
          'Guide',
        ),
        settingsButton(),
      ),
      h('div', { class: 'draw-body' }, stage),
      toolbar,
      trayEl,
    );

    // ---- board, tray, session events ----------------------------------------
    const board = new DrawBoard(canvas);
    board.setData(save, session.primary);
    board.resize();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => board.resize()) : null;
    ro?.observe(stage);

    const tray: DrawTrayHandle = createDrawTray(trayEl, session, save.paletteMode, (c) => {
      selectColor(c);
    });
    const selectColor = (c: number): void => {
      session.setPrimary(c);
      board.setPreviewValue(c);
      tray.refresh();
    };

    const syncCount = (): void => {
      const dots = session.usageCounts().reduce((a, b) => a + b, 0);
      countEl.textContent = `${dots} dots`;
    };
    const undoBtn = iconButton('undo', 'Undo', () => historyStep(() => session.undo()));
    const redoBtn = iconButton('redo', 'Redo', () => historyStep(() => session.redo()));
    const syncHistoryButtons = (): void => {
      undoBtn.disabled = !session.canUndo;
      redoBtn.disabled = !session.canRedo;
    };
    const historyStep = (step: () => boolean): void => {
      if (!step()) return;
      syncCount();
      syncHistoryButtons();
      schedulePersist();
    };

    const onEvent = (e: DrawEvent): void => {
      if (e.type === 'cells') board.drawCells(e.changes);
      else tray.refresh();
      syncCount();
      syncHistoryButtons();
      schedulePersist();
    };
    const offEvent = session.onChange(onEvent);

    // ---- toolbar ------------------------------------------------------------
    const toolBtns = new Map<EditorTool, HTMLButtonElement>();
    const addToggle = (t: EditorTool, label: string, icon: Parameters<typeof iconButton>[0]): void => {
      const b = iconButton(icon, label, () => setTool(t));
      toolBtns.set(t, b);
      toolbar.append(b);
    };
    for (const t of TOOLS) addToggle(t.id, t.label, t.icon);
    addToggle('pan', 'Pan', 'move');
    addToggle('eraser', 'Eraser', 'eraser');
    toolbar.append(undoBtn, redoBtn);
    const clearBtn = iconButton('trash', 'Clear all', async () => {
      const ok = await confirmDialog(
        'Clear all?',
        'Every dot will be removed. You can undo this.',
        'Clear',
      );
      if (!ok) return;
      if (session.clearAll()) schedulePersist();
      syncCount();
      syncHistoryButtons();
    });
    const helpBtn = iconButton('bulb', 'Draw help', () => {
      openSheet(
        'Draw help',
        h(
          'div',
          { class: 'confirm' },
          h(
            'p',
            { class: 'muted small' },
            'Brush draws freehand; Line, Box, Ellipse and Polygon drag or tap out shapes. Fill floods a region with the selected color. The eyedropper picks a placed color. The eraser paints the background (or removes dots when the background is None). Right-click always erases.',
          ),
          h(
            'p',
            { class: 'muted small' },
            'One finger draws, two fingers pan and pinch-zoom, and a double-tap switches between fit-to-screen and full size. Mirror buttons paint the opposite side as you draw.',
          ),
        ),
      );
    });
    const closeBtn = h(
      'button',
      { type: 'button', class: 'chip', hidden: true },
      'Close shape',
    );
    closeBtn.addEventListener('click', () => {
      board.setPreview(null);
      if (session.commitShape()) schedulePersist();
      syncCount();
      syncHistoryButtons();
      syncToolButtons();
    });
    toolbar.append(closeBtn, clearBtn, helpBtn);

    // Contextual controls: size, tip, fill/stroke, mirror.
    const ctxRow = h('div', { class: 'draw-toolbar' });
    const chipBtn = (label: string, onClick: () => void): HTMLButtonElement => {
      const b = h('button', { type: 'button', class: 'chip' }, label);
      b.addEventListener('click', onClick);
      return b;
    };
    for (const size of [1, 3, 5, 7, 9]) {
      const b = chipBtn(String(size), () => {
        session.setBrushSize(size);
        syncContextRow();
      });
      b.dataset.size = String(size);
      ctxRow.append(b);
    }
    const tipBtn = chipBtn(session.brushTip === 'round' ? 'Round' : 'Square', () => {
      session.setBrushTip(session.brushTip === 'round' ? 'square' : 'round');
      syncContextRow();
    });
    ctxRow.append(tipBtn);
    const fillBtn = chipBtn(session.filled ? 'Fill' : 'Outline', () => {
      session.setFilled(!session.filled);
      syncContextRow();
    });
    ctxRow.append(fillBtn);
    const mirrorV = chipBtn('Mirror ↔', () => {
      session.setSymmetry(session.symmetry === 'vertical' ? 'none' : 'vertical');
      syncContextRow();
    });
    const mirrorH = chipBtn('Mirror ↕', () => {
      session.setSymmetry(session.symmetry === 'horizontal' ? 'none' : 'horizontal');
      syncContextRow();
    });
    ctxRow.append(mirrorV, mirrorH);
    toolbar.after(ctxRow);

    const syncContextRow = (): void => {
      for (const b of ctxRow.querySelectorAll<HTMLButtonElement>('[data-size]')) {
        const on = Number(b.dataset.size) === session.brushSize;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      tipBtn.textContent = session.brushTip === 'round' ? 'Round' : 'Square';
      fillBtn.textContent = session.filled ? 'Fill' : 'Outline';
      mirrorV.classList.toggle('on', session.symmetry === 'vertical');
      mirrorV.setAttribute('aria-pressed', String(session.symmetry === 'vertical'));
      mirrorH.classList.toggle('on', session.symmetry === 'horizontal');
      mirrorH.setAttribute('aria-pressed', String(session.symmetry === 'horizontal'));
      const shapes = tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'poly';
      const brushy = tool === 'brush' || tool === 'eraser';
      for (const b of ctxRow.querySelectorAll<HTMLButtonElement>('[data-size]')) {
        b.hidden = !brushy;
      }
      tipBtn.hidden = !brushy;
      fillBtn.hidden = !shapes;
      mirrorV.hidden = mirrorH.hidden = tool === 'pan';
    };
    const syncToolButtons = (): void => {
      for (const [t, b] of toolBtns) {
        b.setAttribute('aria-pressed', String(t === tool));
        b.classList.toggle('on', t === tool);
      }
      closeBtn.hidden = !(session.shapeActive && session.shapePointCount >= 3);
      canvas.classList.toggle('panning', tool === 'pan');
      syncContextRow();
    };
    const setTool = (t: EditorTool): void => {
      tool = t;
      if (session.shapeActive && t !== 'poly') {
        session.cancelShape();
        board.setPreview(null);
      }
      syncToolButtons();
    };

    // ---- pointer input ------------------------------------------------------
    let lastCell: { x: number; y: number } | null = null;
    let lastOpAt = 0;
    const strokeTo = (clientX: number, clientY: number): boolean => {
      const cell = board.hitTest(clientX, clientY);
      if (!cell) {
        lastCell = null;
        return false;
      }
      const path = lastCell ? lineCells(lastCell.x, lastCell.y, cell.x, cell.y) : [cell];
      let changed = false;
      for (const c of lastCell ? path.slice(1) : path) {
        if (session.strokeAt(c.x, c.y)) changed = true;
      }
      lastCell = cell;
      return changed;
    };
    const hit = (x: number, y: number): { x: number; y: number } | null => board.hitTest(x, y);
    const onStroke = (i: StrokeIntent): void => {
      if (i.type === 'strokeStart') {
        lastCell = null;
        const erase = tool === 'eraser' || i.erase;
        if (tool === 'fill' && !erase) {
          const c = hit(i.x, i.y);
          if (c && session.flood(c.x, c.y)) schedulePersist();
          syncCount();
          syncHistoryButtons();
        } else if (tool === 'pick' && !erase) {
          const c = hit(i.x, i.y);
          if (c) {
            const idx = session.pick(c.x, c.y);
            if (idx !== null) selectColor(idx);
          }
        } else if (tool === 'poly' && !erase) {
          const c = hit(i.x, i.y);
          if (c) {
            if (!session.shapeActive) session.beginShape('poly', c.x, c.y);
            else session.addPolyPoint(c.x, c.y);
            board.setPreview(session.shapePreview());
            syncToolButtons();
          }
        } else if (
          (tool === 'line' || tool === 'rect' || tool === 'ellipse') &&
          !erase
        ) {
          const c = hit(i.x, i.y);
          if (c) {
            session.beginShape(tool, c.x, c.y);
            board.setPreview([c]);
          }
        } else {
          session.beginStroke(erase ? 'erase' : 'paint');
          strokeTo(i.x, i.y);
        }
      } else if (i.type === 'strokeMove') {
        const dragging = tool === 'line' || tool === 'rect' || tool === 'ellipse';
        if (dragging && session.shapeActive) {
          for (const p of i.points) {
            const c = hit(p.x, p.y);
            if (c) board.setPreview(session.updateShape(c.x, c.y));
          }
        } else if (tool === 'poly' && session.shapeActive) {
          for (const p of i.points) {
            const c = hit(p.x, p.y);
            if (c) board.setPreview(session.shapePreview());
          }
        } else if (session.strokeActive) {
          let changed = false;
          for (const p of i.points) {
            if (strokeTo(p.x, p.y)) changed = true;
          }
          if (changed) {
            syncCount();
            schedulePersist();
          }
        }
      } else if (i.type === 'strokeEnd') {
        if (session.strokeActive) {
          session.endStroke();
          if (tool === 'brush' || tool === 'eraser') lastOpAt = Date.now();
          schedulePersist();
        } else if (session.shapeActive && tool !== 'poly') {
          board.setPreview(null);
          if (session.commitShape()) schedulePersist();
        }
        lastCell = null;
        syncCount();
        syncHistoryButtons();
        syncToolButtons();
      } else {
        // strokeCancel: a second finger, a pointercancel — never commit a shape.
        if (session.strokeActive) session.cancelStroke();
        if (session.shapeActive) {
          session.cancelShape();
          board.setPreview(null);
        }
        lastCell = null;
        syncCount();
        syncHistoryButtons();
        syncToolButtons();
      }
    };
    const onDoubleTap = (): void => {
      if (
        (tool === 'brush' || tool === 'eraser') &&
        Date.now() - lastOpAt < 450 &&
        session.canUndo
      ) {
        session.undo(); // the first tap's dot goes with the zoom gesture
        syncCount();
        syncHistoryButtons();
        schedulePersist();
      }
      const vp = board.getViewport();
      const target = vp.scale > 1.01 ? 1 : Math.min(4, board.oneToOneScale());
      const { width, height } = board.getSize();
      const z = zoomViewportAt(vp, target / vp.scale, width / 2, height / 2);
      board.setViewport(z.scale, z.offsetX, z.offsetY);
      board.draw();
    };
    const unbindInput = bindDrawInput(canvas, board, {
      canPaint: () => tool !== 'pan',
      panMode: () => tool === 'pan',
      onStroke,
      onDoubleTap,
    });

    // ---- keyboard -----------------------------------------------------------
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        (e.shiftKey ? redoBtn : undoBtn).click();
      } else if (e.key === 'Escape' && !session.shapeActive) {
        navigate('#/');
      } else if (e.key === 'Escape' && session.shapeActive) {
        session.cancelShape();
        board.setPreview(null);
        syncToolButtons();
      }
    };
    document.addEventListener('keydown', onKey);

    // ---- go -----------------------------------------------------------------
    syncCount();
    syncHistoryButtons();
    syncToolButtons();
    tray.refresh();

    return () => {
      unbindInput();
      flushPersist();
      offEvent();
      tray.dispose();
      ro?.disconnect();
      board.destroy();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  };

  return () => {
    alive = false;
    teardown();
  };
}

// Re-exported so Task 10's gallery and future callers can reuse the symmetry labels.
export type { Symmetry };
```

Note on unused import: if lint flags the re-exported `Symmetry` type import, drop the trailing re-export line and the `Symmetry` import instead — the tray handles its own labels.

- [ ] **Step 4: Run tests and the gate** — continued in the next step block.

- [ ] **Step 4: Routing, redirects, and gate**

`src/ui/pure.ts` — extend the `Route` union with `| { name: 'drawEditor'; id: string }`. Replace the Task 7 `draw` branch in `parseRoute` with:

```ts
  if (parts[0] === 'draw' && parts.length === 2) {
    if (parts[1] === 'new') return { name: 'drawNew' };
    try {
      return { name: 'drawEditor', id: decodeURIComponent(parts[1]) };
    } catch {
      return { name: 'gallery' };
    }
  }
```

Add the `routeHash` case:

```ts
    case 'drawEditor':
      return `#/draw/${encodeURIComponent(route.id)}`;
```

`src/main.ts` — add `import { mountDrawEditor } from './ui/drawEditor';` and the switch case:

```ts
    case 'drawEditor':
      cleanup = mountDrawEditor(ctx, route.id);
      break;
```

`src/ui/drawCreate.ts` — replace the literal navigation with the route helper (add `routeHash` back to the pure import):

```ts
      navigate(routeHash({ name: 'drawEditor', id: save.id }), { replace: true });
```

`src/ui/overview.ts` — in the `loadSave(id).then((save) => {...})` handler, immediately after the `!save` guard, add:

```ts
      if (save.origin === 'drawn') {
        navigate(routeHash({ name: 'drawEditor', id: save.id }), { replace: true });
        return;
      }
```

`src/ui/panelPlay.ts` — same guard, same place (after its `!save` check):

```ts
      if (save.origin === 'drawn') {
        navigate(routeHash({ name: 'drawEditor', id: save.id }), { replace: true });
        return;
      }
```

`src/styles.css` — the editor styles went in with Task 6; nothing new here.

Run: `bunx vitest run tests/ui-draw-editor.test.ts tests/ui-pure.test.ts tests/ui-draw-create.test.ts` (PASS). Then `make checkall` (PASS). Manual with `make dev`: create a drawing from `#/draw/new`, paint with brush/line/box/fill, undo, switch colors in the tray, reload mid-session and confirm the dots are still there (pagehide flush), open `#/play/:drawnId` and confirm it lands in the editor.

- [ ] **Step 5: Commit**

```bash
git add src/ui/drawInput.ts src/ui/drawEditor.ts src/ui/dom.ts src/ui/pure.ts src/main.ts src/ui/drawCreate.ts src/ui/overview.ts src/ui/panelPlay.ts tests/ui-draw-editor.test.ts tests/ui-pure.test.ts
git commit -m "feat(draw): editor screen with tools, input binding and routing (ENH-007)"
```

### Task 10: Gallery section, source card, restart

**Files:**
- Modify: `src/game/progress.ts` (add `placedCount`) and `src/game/index.ts` (barrel)
- Modify: `src/ui/saves.ts` (add `restartDrawnSave`)
- Modify: `src/ui/gallery.ts` ("My drawings" section with drawn-specific cards)
- Modify: `src/ui/source.ts` ("Make my own" card at the top)
- Test: `tests/game.test.ts` and `tests/ui-saves.test.ts` (append)

**Interfaces:**
- Consumes: `PictureSave.origin` (Task 1), `routeHash({ name: 'drawEditor', id })` (Task 9), `exportPng` (works as-is: it renders `cells: save.placed`), the `brush` icon (Task 9).
- Produces: `placedCount(save: PictureSave): number` (non-EMPTY entries in `placed`) exported from the game barrel; `restartDrawnSave(save: PictureSave): Promise<void>` in `ui/saves.ts` (refills `placed` with the background color's palette index, or EMPTY with no background, then persists — drawn saves carry no timers or completion to clear). The gallery splits saves by origin: photo saves keep the existing card unchanged under "Your pictures"; drawn saves get their own card under "My drawings" — thumbnail, name, "N dots", and Continue / Download PNG / Back up / Restart / Delete. No progress bar, no time, no done badge, ever (spec: no finish line).

- [ ] **Step 1: Write the failing tests**

Append to `tests/game.test.ts` (add `placedCount` to the `../src/game` import):

```ts
describe('placedCount', () => {
  it('counts non-empty placed cells', () => {
    const save = makeSave();
    expect(placedCount(save)).toBe(0);
    save.placed[0] = 1;
    save.placed[5] = 2;
    expect(placedCount(save)).toBe(2);
  });
});
```

Append to `tests/ui-saves.test.ts` (the file mocks `../src/storage/db`; reuse that mock's captured `putSave`):

```ts
describe('restartDrawnSave', () => {
  it('refills placed with the background index and persists', async () => {
    const { restartDrawnSave } = await import('../src/ui/saves');
    const save = {
      id: 'd1',
      aspect: '1:1',
      origin: 'drawn',
      drawBackground: '#ffffff',
      palette: [
        { hex: '#05131d', name: 'Black' },
        { hex: '#ffffff', name: 'White' },
      ],
      width: 48,
      height: 48,
      placed: new Uint8Array(48 * 48).fill(0),
    } as unknown as Parameters<typeof restartDrawnSave>[0];
    save.placed[7] = 1;
    await restartDrawnSave(save);
    expect(save.placed.every((v: number) => v === 1)).toBe(true); // white background index
  });

  it('clears to EMPTY when there is no background', async () => {
    const { restartDrawnSave } = await import('../src/ui/saves');
    const save = {
      id: 'd2',
      aspect: '1:1',
      origin: 'drawn',
      palette: [
        { hex: '#05131d', name: 'Black' },
        { hex: '#ffffff', name: 'White' },
      ],
      width: 48,
      height: 48,
      placed: new Uint8Array(48 * 48).fill(0),
    } as unknown as Parameters<typeof restartDrawnSave>[0];
    await restartDrawnSave(save);
    expect(save.placed.every((v: number) => v === 255)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/game.test.ts tests/ui-saves.test.ts`
Expected: FAIL — `placedCount` and `restartDrawnSave` are not exported.

- [ ] **Step 3: Implement**

`src/game/progress.ts` — add:

```ts
/** Number of placed dots (non-EMPTY entries in `placed`). */
export function placedCount(save: PictureSave): number {
  let n = 0;
  for (let i = 0; i < save.placed.length; i++) if (save.placed[i] !== EMPTY) n++;
  return n;
}
```

`src/game/index.ts` — add `placedCount` to the progress export list.

`src/ui/saves.ts` — add:

```ts
/** Reset a drawn save to its background fill (or an empty grid) and persist. */
export async function restartDrawnSave(save: PictureSave): Promise<void> {
  const bgIndex = save.drawBackground
    ? save.palette.findIndex((c) => c.hex === save.drawBackground)
    : -1;
  save.placed.fill(bgIndex >= 0 ? bgIndex : EMPTY);
  await persistSave(save);
}
```

`src/ui/source.ts` — in the `root.append(...)` call, insert at the top of the `.scroll` container, before the upload card:

```ts
        h(
          'button',
          { type: 'button', class: 'upload-card', on: { click: () => navigate('#/draw/new') } },
          icon('brush'),
          h('span', {}, h('strong', {}, 'Make my own'), h('small', {}, 'Draw a mosaic freehand')),
        ),
```

`src/ui/gallery.ts`:

1. Add imports: `placedCount` from `'../game'`, `restartDrawnSave` from `'./saves'`, `routeHash` is already imported.
2. Split the list in `render()`. Replace the body after loading `saves` with:

```ts
    if (!alive) return;
    const photos = saves.filter((s) => s.origin !== 'drawn');
    const drawn = saves.filter((s) => s.origin === 'drawn');
    if (saves.length === 0) {
      list.replaceChildren(
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty-dots', 'aria-hidden': 'true' }, dotLogo()),
          h('p', {}, 'No pictures yet.'),
          h('p', { class: 'muted' }, 'Tap New Picture to pick a photo and start building.'),
        ),
      );
      return;
    }
    list.replaceChildren(
      h('div', { class: 'save-grid-inner' }, ...photos.map((s) => card(s))),
      photos.length === 0
        ? h('p', { class: 'muted' }, 'No pictures yet.')
        : null,
      h('h2', { class: 'section-title' }, 'My drawings'),
      drawn.length === 0
        ? h('p', { class: 'muted' }, 'No drawings yet. Tap Make my own to start one.')
        : h('div', { class: 'save-grid-inner' }, ...drawn.map((s) => drawnCard(s))),
    );
```

3. Add the drawn card next to `card`:

```ts
  const drawnCard = (save: PictureSave): HTMLElement => {
    const cellPx = Math.max(2, Math.round(192 / Math.max(save.width, save.height)));
    const thumb = asThumb(
      renderMosaicToCanvas(save, cellPx * (window.devicePixelRatio > 1 ? 2 : 1), 'dots', {
        cells: save.placed,
      }),
      `${save.name} preview`,
    );
    const open = (): void => navigate(routeHash({ name: 'drawEditor', id: save.id }));
    const restart = async (): Promise<void> => {
      const ok = await confirmDialog(
        'Restart drawing?',
        `Everything drawn in "${save.name}" will be removed.`,
        'Restart',
      );
      if (!ok) return;
      try {
        await restartDrawnSave(save);
      } catch (err) {
        console.error(err);
        toast(`Could not restart: ${userMessage(err)}`);
      }
      void render();
    };
    const del = async (): Promise<void> => {
      const ok = await confirmDialog(
        'Delete drawing?',
        `"${save.name}" will be deleted. This cannot be undone.`,
        'Delete',
      );
      if (!ok) return;
      try {
        await removeSave(save.id);
      } catch (err) {
        console.error(err);
        toast(`Could not delete: ${userMessage(err)}`);
      }
      void render();
    };
    return h(
      'article',
      { class: 'save-card' },
      h(
        'button',
        {
          type: 'button',
          class: 'save-thumb',
          'aria-label': `Continue ${save.name}`,
          on: { click: open },
        },
        thumb,
      ),
      h(
        'div',
        { class: 'save-meta' },
        h('h3', {}, save.name),
        h('p', { class: 'muted small' }, `${placedCount(save)} dots`),
      ),
      h(
        'div',
        { class: 'save-actions' },
        h(
          'button',
          { type: 'button', class: 'btn primary', on: { click: open } },
          icon('play'),
          'Continue',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Download ${save.name} as PNG`,
            title: 'Download PNG',
            on: { click: () => exportPng(save) },
          },
          icon('download'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Back up ${save.name}`,
            title: 'Back up',
            on: {
              click: () => void downloadBackup([save], `${safeFileStem(save.name)}.pardots`),
            },
          },
          icon('backup'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Restart ${save.name}`,
            title: 'Restart',
            on: { click: () => void restart() },
          },
          icon('restart'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Delete ${save.name}`,
            title: 'Delete',
            on: { click: () => void del() },
          },
          icon('trash'),
        ),
      ),
    );
  };
```

4. The outer `list` element's class stays `save-grid` for the photos-only empty state; adjust if the two `save-grid-inner` wrappers need grid styling:

```css
.save-grid-inner { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); width: 100%; }
```

(The existing `.save-grid` rules in `src/styles.css` show the pattern; reuse its declarations.)

- [ ] **Step 4: Run tests and the gate**

Run: `bunx vitest run tests/game.test.ts tests/ui-saves.test.ts` (PASS). Then `make checkall` (PASS). Manual: gallery shows both sections; a drawn card's Continue opens the editor; Restart refills the background.

- [ ] **Step 5: Commit**

```bash
git add src/game/progress.ts src/game/index.ts src/ui/saves.ts src/ui/gallery.ts src/ui/source.ts src/styles.css tests/game.test.ts tests/ui-saves.test.ts
git commit -m "feat(gallery): My drawings section and Make my own entry (ENH-007)"
```

### Task 11: e2e smoke + docs

**Files:**
- Modify: `scripts/e2e-smoke.ts` (draw-your-own flow before the offline section)
- Modify: `PRD.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: everything from Tasks 1-10 against a built preview (`make build && bunx vite preview --port 4231 --strictPort`), per `scripts/e2e-smoke.ts`'s header. The e2e pins Review Focus 1/3/4 end-to-end: draw a stroke, reload mid-session, reopen, dots persisted, editor still functional. Task 11 asserts the editor stays consistent after reload (no phantom undo state, counter matches the gallery's dot count).

- [ ] **Step 1: Extend the smoke test**

In `scripts/e2e-smoke.ts`, after the "setup without source redirected to `#/new`" check and before the horizontal-overflow check, insert:

```ts
  // Draw-your-own: create, paint, reload mid-session, reopen from My drawings.
  await page.goto(`${base}#/new`);
  await page.getByRole('button', { name: 'Make my own' }).click();
  await page.waitForURL(/#\/draw\/new$/);
  await shot(page, '23-draw-create');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/#\/draw\/[^/]+$/);
  await page.locator('.draw-canvas').waitFor();
  const dbox = await page.locator('.draw-canvas').boundingBox();
  if (!dbox) throw new Error('no draw canvas');
  const dcx = dbox.x + dbox.width / 2;
  const dcy = dbox.y + dbox.height / 2;
  await page.mouse.move(dcx - 40, dcy);
  await page.mouse.down();
  await page.mouse.move(dcx + 40, dcy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const dots1 = await page.locator('.draw-count').textContent();
  if (dots1 === '0 dots') throw new Error('brush stroke placed no dots');
  console.log('draw dots after stroke:', dots1);
  // Reload mid-session: the pagehide flush must have persisted the stroke.
  await page.reload();
  await page.locator('.draw-canvas').waitFor();
  const dots2 = await page.locator('.draw-count').textContent();
  if (dots2 !== dots1) throw new Error(`dots lost on reload: ${dots1} -> ${dots2}`);
  console.log('draw dots persisted across reload:', dots2);
  // The editor still works after the reload.
  await page.mouse.move(dcx - 40, dcy + 40);
  await page.mouse.down();
  await page.mouse.move(dcx + 40, dcy + 40, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const dots3 = await page.locator('.draw-count').textContent();
  if (Number.parseInt(dots3 ?? '0', 10) <= Number.parseInt(dots2 ?? '0', 10)) {
    throw new Error(`second stroke did not add dots: ${dots2} -> ${dots3}`);
  }
  await shot(page, '23b-draw-reopened');
  await page.getByRole('button', { name: 'Back to gallery' }).click();
  await page.getByText('My drawings').waitFor();
  const drawnCard = page.locator('.save-card', { hasText: 'My drawing' });
  await drawnCard.waitFor();
  if (!(await drawnCard.textContent())?.includes('dots')) {
    throw new Error('drawn card lacks its dot count');
  }
  await shot(page, '23c-gallery-drawings');
```

- [ ] **Step 2: Run the e2e**

Run: `make build && bunx vite preview --port 4231 --strictPort &` (background, or use `make e2e` which does both), then `bun run scripts/e2e-smoke.ts`.
Expected: the full smoke passes including the new `23-*` shots; exit code 0 and `errors: none`.

- [ ] **Step 3: Update the docs**

`PRD.md`:
- Add to the Table of Contents and Section 5: `### 5.8 Draw Your Own` after 5.7 Completion, with this content:

```markdown
### 5.8 Draw Your Own

A "Make my own" card on the New Picture screen opens a create form (name, aspect, palette
mode, background: None, black, white, or any color in Free mode). Creating opens the draw
editor: one continuous mosaic across all panels with visible seams, pan/zoom (drag, pinch,
double-tap), and brush, line, box, ellipse, polygon, fill, eyedropper and eraser tools with
undo/redo to 50 moves, per-color usage counts, an editable palette (add, recolor, remove
unused), and optional mirror painting.

Drawn pictures never complete: no progress bar, no timer, no done badge. The gallery lists
them under "My drawings" with their dot count. In LEGO mode a drawing exports parts lists,
BrickLink wanted lists and printable panel instructions exactly like a photo picture.
```

- In Section 9 (Data Model), extend the save-record description: records carry `origin: 'photo' | 'drawn'` (schema v2) and an optional `drawBackground`; drawn saves keep `target` all-empty forever, never set `completedAt`, and store the artwork in `placed`.

`docs/ARCHITECTURE.md`:
- Routes table, two new rows after `#/setup`:

```markdown
| `#/draw/new` | `drawNew` | `mountDrawCreate` | `src/ui/drawCreate.ts` |
| `#/draw/:id` | `drawEditor` | `mountDrawEditor` | `src/ui/drawEditor.ts` |
```

- Add a short "Draw mode" paragraph near the picture-creation pipeline: sibling DOM-free modules `game/drawTools.ts` (rasterizers) and `game/drawSession.ts` (tool state, palette editing, undo/redo 50, usage counts), `render/drawBoard.ts` (whole-mosaic renderer with seams, grid overlay, preview), and UI modules `ui/drawCreate.ts`, `ui/drawEditor.ts`, `ui/drawInput.ts`, `ui/drawTray.ts`. `PanelSession`, `trayModel` and play rules are untouched; the editor persists on a 500 ms debounce flushed on cleanup, hide, and pagehide. Cross-links: `#/draw/:photoId` redirects to the overview; `#/play/:drawnId` redirects to the editor.

`CHANGELOG.md` — under `[Unreleased]` → `### Added`, prepend:

```markdown
- Draw-your-own mode: create a blank mosaic (aspect, palette mode, background) and paint it with brush, line, box, ellipse, polygon, fill, eyedropper and eraser tools, mirror painting, a 50-move undo history, an editable palette, and — in LEGO mode — the same parts exports as photo pictures.
```

- [ ] **Step 4: Full gate and commit**

Run: `make checkall` (PASS). Commit the smoke change first, then the docs (two atomic commits):

```bash
git add scripts/e2e-smoke.ts
git commit -m "test(e2e): draw-your-own smoke flow (ENH-007)"
git add PRD.md docs/ARCHITECTURE.md CHANGELOG.md
git commit -m "docs: draw-your-own mode in PRD, ARCHITECTURE and CHANGELOG (ENH-007)"
```

- [ ] **Step 5: Verify against the spec checklist**

Re-read the spec's Verify section (`docs/opus/ENH-007-draw-your-own.md`) and confirm each item with evidence in the final report: drawTools/drawSession tests green, migration and backup round-trip tests green (Tasks 1-3), `make checkall` green, `bun run e2e` green, and the manual checklist (LEGO drawing with background, draw across two seams, reopen from My drawings, export BrickLink XML, print a panel guide, free-mode drawing shows no Parts sheet — the Parts sheet itself renders the LEGO-only message). Report anything that fails instead of marking the card done.
