Original prompt: Implement all six proposed subtle visual polish improvements and push.

# Visual polish progress

- [x] Inspect live app and existing effects, create and bootstrap isolated worktree.
- [x] O1: Reduce background stud contrast while retaining all themes.
- [x] O2: Refine dot placement compression, settle, and highlight.
- [x] O3: Animate tray selection and changing counts.
- [x] O4: Checkmark and smooth collapse for completed colors, safe undo/redo.
- [x] O5: Panel light sweep and badge, picture-only confetti.
- [x] O6: Reversible reference overlay fade.
- [x] Verify reduced motion, lifecycle cleanup, mobile and desktop rendering.
- [x] Run make checkall and production browser smoke.

Verification: 282 unit tests, lint, strict TypeScript, production build, the existing end-to-end suite (including offline play), and the new normal/reduced-motion browser suite pass. Browser coverage includes rapid overlay toggling, color depletion on a wrong stud, undo/redo during tray removal, indicator alignment after resizing, and navigation during completion. Visual checks cover all five background themes and phone, landscape, and desktop layouts. Review also verified keyboard focus moves to the next tray color without stealing focus from toolbar controls.

Release uses the existing Deploy workflow on main. No implementation follow-ups remain.

## Free color naming

Request: name Free colors by their actual shade, including existing saves, while preserving LEGO labels and saved progress.

- [x] Add shared descriptive color naming and use it for newly generated Free palettes.
- [x] Derive legacy Free labels in the tray, Parts, and guide exports without rewriting saves.
- [x] Verify screenshot shades, duplicate suffixes, unchanged LEGO names, and unchanged grids.
- [x] Run project and browser gates.

Verification: 288 tests, lint, strict TypeScript, and build pass. All browser suites pass, including legacy Free and LEGO fixtures checked in the tray, Parts list, and downloaded guide. Browser storage snapshots confirm palette values, target cells, and placed cells are unchanged. Original LEGO golden hashes remain pinned; Free hex/index hashes match the original quantizer. Imported shorthand hexes remain supported. Release uses the existing Deploy workflow on main.
