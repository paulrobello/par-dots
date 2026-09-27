# ENH-006 — Printable per-panel building sheets with color symbols

## Goal

Export a building guide for making the mosaic with physical LEGO Dots: one PNG per panel, or a single tall PNG. Each shows a 16×16 grid in which every stud carries its palette color *and* a short symbol (1–2 characters) printed on it, with a legend below that maps each symbol to its color name and count. The symbols make the sheet usable in grayscale prints and for colorblind builders. The PRD accessibility section already requires color names alongside color.

## Current state

- `renderMosaicToCanvas(mosaic, cellPx, 'dots', opts)` in `src/render/mosaicImage.ts` draws glossy dots, but has no symbols, grid labels or legend.
- `exportPng(save)` in `src/ui/exportImage.ts` downloads the placed picture as a PNG using `downloadBlob`.
- The palette labels come from `paletteLabels` in `src/ui/pure.ts`.
- Per-panel color counts come from ENH-001 `panelColorCounts`. **Do ENH-001 first, or add that helper here.**

## Implementation

1. **Symbols** in `src/ui/pure.ts`:
   ```ts
   /** Stable 1–2 char symbol per palette index: A..Z, then a..z, then two-letter codes. */
   export function paletteSymbols(n: number): string[]
   ```
   The symbols are unique, and index order matches the palette's luminance order, so dark colors get early letters.
2. **Renderer** in a new `src/render/panelSheet.ts`:
   ```ts
   export function renderPanelSheet(save: PictureSave, panelIndex: number, labels: string[], symbols: string[], counts: number[], cellPx = 40): HTMLCanvasElement
   ```
   - Header: the picture name and "Panel N of M".
   - Column and row numbers 1–16.
   - The grid: each cell is filled with the target color. Draw the symbol centered, in black or white chosen by `luminance(hex) > 0.45` from `src/render/color.ts`, using a bold sans font sized `cellPx*0.45`. Draw thin grid lines, with a heavier line every 4 cells for counting.
   - The legend: swatch, symbol, label and count for the colors used in that panel, ordered by count.
   
   Draw flat squares, not glossy dots, so the sheet prints well. Measure text with `ctx.measureText` to size the legend area.
3. **Export UI** in `src/ui/exportImage.ts`:
   - `exportPanelSheet(save, i)` downloads `<safe-name>-panel-<i+1>.png`.
   - `exportAllSheets(save)` stacks every panel sheet vertically into one canvas, then downloads `<safe-name>-guide.png`.
   - If the stacked canvas would exceed 16384 px in height (a browser limit), fall back to per-panel downloads with a toast.
4. **Entry points**:
   - The overview gets a "Guide" chip that opens a sheet with "All panels" and a "Panel N" select, then downloads.
   - The Parts sheet from ENH-001 gets the same buttons, if it exists.
5. **Tests**:
   - `tests/ui-pure.test.ts`: `paletteSymbols(32)` returns 32 unique strings, each of length ≤ 2, and `paletteSymbols(1)` is `['A']`.
   - Rendering is DOM-only. Cover it in e2e: extend `scripts/e2e-smoke.ts` to click Guide → All panels and assert that a download event fires with a `.png` filename.

## Files to touch

- `src/ui/pure.ts`
- `src/render/panelSheet.ts` (new)
- `src/ui/exportImage.ts`
- `src/ui/overview.ts`
- `src/ui/partsSheet.ts` (if ENH-001 has landed)
- `src/styles.css`
- `tests/ui-pure.test.ts`
- `scripts/e2e-smoke.ts`

## Dependencies

- **ENH-001**, for `panelColorCounts`. If ENH-001 is not done, implement `panelColorCounts` in `src/game/progress.ts` exactly as ENH-001 specifies.
- Audit ARC-006 renames `render/color.ts` exports. Use `luminance`, which keeps its name.

## Verify

1. `bunx vitest run tests/ui-pure.test.ts` passes, including the `paletteSymbols` uniqueness and length tests.
2. GATE passes.
3. `bun run build && bun run preview` and `bun run e2e` pass, with the new Guide download assertion receiving a `.png` download.
4. Manually open the downloaded PNG for a 3×3 picture. It shows 9 labelled 16×16 grids, and every grid cell carries a symbol that appears in that panel's legend.

## Rollback

Revert the commit. The change is purely additive.
