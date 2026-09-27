# ENH-001 — Parts list: dot counts per color, per picture and per panel

## Goal

Show how many dots of each color the picture and each panel need, so a player can buy or sort real LEGO Dots before building the physical mosaic. Place it in the overview under a "Parts" button, and in panel play as a count next to each tray color. Tray counts already exist, so this adds the whole-picture view.

## Current state

- The palette is `save.palette: PaletteColor[]` (`src/types.ts`). In LEGO mode each entry has a LEGO color name from `src/engine/legoPalette.ts`. The target indices are in `save.target: Uint8Array`, row-major, `width*height`.
- Tray counts in panel play show only the remaining dots for the current panel (`src/ui/panelPlay.ts` `syncTray`).
- The overview (`src/ui/overview.ts`) has Ghost and Download PNG controls, and nothing that lists colors.
- `paletteLabels(palette)` in `src/ui/pure.ts` produces the display names, including disambiguation.
- Sheets use `openSheet(title, body)` from `src/ui/dom.ts`.

## Implementation

1. **Pure counting** in `src/game/progress.ts`:
   ```ts
   /** Target dot count per palette index for the whole picture (length = palette.length). */
   export function colorCounts(save: PictureSave): number[]
   /** Target dot count per palette index within one panel. */
   export function panelColorCounts(save: PictureSave, panelIndex: number): number[]
   ```
   Both walk `save.target`. `panelColorCounts` uses `panelOrigin` and `PANEL_SIZE` loops, the same way `panelProgress` does. Export both from `src/game/index.ts`.
2. **Parts sheet** in a new `src/ui/partsSheet.ts`, `openPartsSheet(save: PictureSave): void`:
   - A table, one row per palette color, ordered by count descending:
     - a swatch (`span.css-dot` with `--c`)
     - the label from `paletteLabels`
     - the total count
     - the placed-correct count, meaning cells where `placed[i] === target[i] === c`, shown as "done"
   - A footer: total dots and number of colors.
   - A segmented control "Whole picture / Panel N" that switches the counts to `panelColorCounts`. Use a `<select>` with one option per panel.
   - A "Copy list" button that writes `"<label>\t<count>"` lines to `navigator.clipboard.writeText`. On failure, toast "Copy not available".
3. **Entry point**: in `src/ui/overview.ts`, add a `chip` button "Parts" with a list icon next to the Ghost button, wired to `openPartsSheet(save)`. If `ICONS` has no list icon, add one to `src/ui/dom.ts` as a 24×24 path, matching the existing icon style.
4. **Styles**: add `.parts-table` rules to `src/styles.css`, reusing existing tokens for the sheet body, `.css-dot` and `.muted`.
5. **Tests**:
   - In `tests/game.test.ts`, `colorCounts` sums to `width*height`.
   - `panelColorCounts` summed over all panels equals `colorCounts`.
   - `panelColorCounts` for a panel sums to 256.

## Files to touch

- `src/game/progress.ts`
- `src/game/index.ts`
- `src/ui/partsSheet.ts` (new)
- `src/ui/overview.ts`
- `src/ui/dom.ts` (icon, only if needed)
- `src/styles.css`
- `tests/game.test.ts`

## Dependencies

- None blocking. If audit ARC-001 has landed, import panel geometry from `src/game/geometry.ts`, as today.
- If ARC-005 has landed, the sheet auto-closes on navigation through the overlay registry.

## Verify

1. `bunx vitest run tests/game.test.ts` passes, including the three new `colorCounts`/`panelColorCounts` tests.
2. GATE passes: `bunx biome check . && bun run typecheck && bun run test && bun run build`.
3. `bun run build && bun run preview`, then in agentchrome or Playwright:
   - open a library picture's overview
   - click "Parts": a dialog titled "Parts" lists one row per palette color, and the counts sum to the dot total shown in the footer (`width*height`)
   - switching to "Panel 1" makes the counts sum to 256

## Rollback

Revert the commit. The change is purely additive, with no stored data.
