# ENH-003 — Previous/next panel navigation and "next unfinished panel"

## Goal

Let a player move between panels without going back to the overview:

- previous and next buttons in the panel play top bar
- ArrowLeft and ArrowRight keys
- after a panel completes, a "Next panel" action that jumps to the next *unfinished* panel

Each trip through the overview costs two zoom animations. For a 12-panel picture that is 24 extra transitions.

## Current state

- `src/ui/panelPlay.ts`:
  - `goBack(completed)` at about line 171 sets the transition hint and navigates to `#/play/<id>`.
  - The top bar is built at about lines 176-186 and holds the back button, a "Panel N / total" title, progress and time pills, and a settings button.
  - `finishIfComplete` (about line 379) celebrates and then calls `goBack(true)`.
  - `onKey` (about line 647) handles Cmd/Ctrl+Z and Escape.
- `src/game/progress.ts` exports `panelComplete(save, i)` and `pictureComplete(save)`.
- Routes: `routeHash({ name: 'panel', id, panel })` in `src/ui/pure.ts`.
- The router re-mounts the screen on every hash change, so navigating panel→panel is a normal navigation. Cleanup flushes the timer and saves.

## Implementation

1. Add to `src/game/progress.ts`, and export from `src/game/index.ts`:
   ```ts
   /** Next incomplete panel after `from` in row-major order, wrapping; null when every panel is complete. */
   export function nextUnfinishedPanel(save: PictureSave, from: number): number | null
   ```
2. In `panelPlay.ts`:
   - Add `iconButton('chevron-left', 'Previous panel', …)` and `iconButton('chevron-right', 'Next panel', …)` around the title. Previous is disabled at panel 0, next at `total - 1`. Add the chevron icons to `ICONS` in `src/ui/dom.ts` if they are missing.
   - Add `goToPanel(i)`, which navigates to `routeHash({ name: 'panel', id: save.id, panel: i })` with `{ replace: true }` so Back still returns to the overview.
   - In `onKey`, handle ArrowLeft and ArrowRight with no modifiers, only when `!isOverlayOpen()` (or the current `.backdrop` query if ARC-005 has not landed) and the stroke is not active.
3. After completion, replace the unconditional `goBack(true)` in `finishIfComplete`:
   - Compute `const next = nextUnfinishedPanel(save, panel)`.
   - If `pictureComplete(save)`, keep `goBack(true)`. The overview shows the finale.
   - Otherwise, after `celebrate`, show a small sheet "Panel complete" with two buttons, "Next panel (N)" → `goToPanel(next)` and "Overview" → `goBack(true)`. Default focus goes to Next.
4. The overview's zoom-out animation keys off `fromPanel`. Panel→panel navigation does not go through the overview, so no hint is needed. Call `setTransitionHint({})` before `goToPanel` so a stale hint doesn't fire later.
5. Tests in `tests/game.test.ts` for `nextUnfinishedPanel`:
   - wraps past the last panel
   - skips complete panels
   - returns `null` when all panels are complete
   - returns `from` itself when it is the only incomplete panel

## Files to touch

- `src/game/progress.ts`
- `src/game/index.ts`
- `src/ui/panelPlay.ts`
- `src/ui/dom.ts` (icons)
- `src/styles.css` (top bar spacing)
- `tests/game.test.ts`

## Dependencies

- Best done **after audit ARC-002**, which restructures `panelPlay.ts`. If ARC-002 is still open, make the changes in the current closure and expect a merge conflict. The top-bar and `onKey` code are small.

## Verify

1. `bunx vitest run tests/game.test.ts` passes, including the four `nextUnfinishedPanel` cases.
2. GATE passes.
3. `bun run build && bun run preview`, then with Playwright (extend `scripts/e2e-smoke.ts`):
   - on `#/play/<id>/0`, press ArrowRight: the URL becomes `#/play/<id>/1`
   - the "Previous panel" button is disabled on panel 0
   - complete a panel in a multi-panel picture: a "Next panel" button appears, and clicking it navigates to the next unfinished panel's hash

## Rollback

Revert the commit. No data changes.
