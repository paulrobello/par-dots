# ENH-004 — Optional dithering for photo mosaics

## Goal

Add a "Dither" toggle on the Setup screen. It maps pixels to the chosen palette with Floyd–Steinberg error diffusion instead of nearest-color mapping. Photos with gradients (skies, skin) then show tonal steps as mixed dots instead of hard banding, which matters most at low Max colors settings and in LEGO mode, where the palette is fixed.

## Current state

- `buildMosaic(pixels, width, height, mode, maxColors)` in `src/engine/quantize.ts` (about line 341) works in four steps:
  1. collect the distinct colors (`collectColors`, composited over white)
  2. choose the candidates (`chooseLegoEntries` or `chooseFreeEntries`)
  3. `enforceContrast`
  4. map each *distinct color* to its nearest candidate, keep the used candidates sorted by L*, and build `target`
- The output is deterministic, and tests in `tests/engine.test.ts` rely on that.
- The worker protocol lives in `src/engine/worker.ts` (`QuantizeRequest` has `mode` and `maxColors`), and the client in `src/engine/client.ts` `quantizeInWorker(pixels, w, h, mode, maxColors)`.
- Setup (`src/ui/setup.ts`) has Aspect, Palette and Max colors controls, which persist via `setSettings`. `Settings` is sanitized in `src/storage/settings.ts`.

## Implementation

1. **Engine**. Add an optional `dither = false` final parameter to `buildMosaic`. When it is true, replace step 4's per-distinct-color mapping with a per-pixel pass in row-major order:
   - Keep a `Float32Array(width*height*3)` of working RGB values, initialized from the composited pixels.
   - For each pixel, find the nearest candidate in Lab. Reuse `nearest()` on `rgbToLab` of the clamped working RGB.
   - Record the candidate index, then diffuse the RGB error with Floyd–Steinberg weights (7/16 right, 3/16 down-left, 5/16 down, 1/16 down-right), clamping to 0..255.
   - Then keep only the candidates actually used, sort them by L* exactly as today, and remap to palette indices.
   - Use serpentine scanning, left-to-right on even rows and right-to-left on odd rows, mirroring the kernel. This avoids directional artifacts.
   - The pass is deterministic, with no randomness.
2. **Contrast**: `enforceContrast` runs on candidates before mapping, so it is unaffected.
3. **Protocol**: add `dither?: boolean` to `QuantizeRequest`, pass it through `worker.ts` and `client.ts` (`quantizeInWorker(..., maxColors, dither)`), and add it to `runOnMainThread`.
4. **Settings**: add `dither: boolean` (default `false`) to `Settings`, `DEFAULT_SETTINGS` and `sanitize` (`typeof r.dither === 'boolean'`).
5. **Setup UI**: add a switch row "Dither — smoother gradients" under Max colors, bound to `dither`. Changing it calls `setSettings({ dither })` and `schedulePreview()`. Pass `dither` into `computeMosaic`.
6. **Tests** in `tests/engine.test.ts`:
   - For a horizontal gray gradient 48×16 in `free` mode with `maxColors: 4`: `dither: true` is deterministic across two runs, and every row with dithering uses at least 2 palette indices where the plain mapping uses 1.
   - For the same inputs, with dithering off the output equals the existing behavior (golden, or equal to a call without the argument).
   - The palette is sorted by L*.
   - Every target index is less than `palette.length`.
   - Settings: `sanitize({dither: 'yes'})` falls back to `false`.

## Files to touch

- `src/engine/quantize.ts`
- `src/engine/worker.ts`
- `src/engine/client.ts`
- `src/storage/settings.ts`
- `src/ui/setup.ts`
- `tests/engine.test.ts`
- `tests/storage.test.ts`

## Dependencies

- Do this **after audit QA-008**, the quantizer split with golden tests. The per-pixel pass then slots in as its own function (`ditherMap`) next to the split phases, and the golden tests prove non-dither output is unchanged.
- Also after ARC-009 (`MIN_COLORS`).

## Verify

1. `bunx vitest run tests/engine.test.ts tests/storage.test.ts` passes. The tests cover determinism, more than one index per gradient row, unchanged non-dither output, and `sanitize`.
2. GATE passes.
3. Timing: a test asserts `buildMosaic(64×48 free, dither)` finishes in under 1000 ms, and logs the measured duration. The expected time on a laptop is about 50 ms, and the high bound keeps CI from flaking.
4. With `make dev`, Setup shows a "Dither" switch. Toggling it updates the preview, and the choice persists after a reload.

## Rollback

Revert the commit. Existing saves are not affected, because dithering only changes new mosaics. A persisted `dither` key in settings is ignored by older code, since `sanitize` drops unknown keys.
