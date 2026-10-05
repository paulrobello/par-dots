# Title suggestion: I made a browser game that turns photos into LEGO Dots mosaics — now you can draw your own

I built **par-dots**, a little mobile-first project for turning a photo into a LEGO Dots-style mosaic you can build panel by panel. Pick one of the bundled pictures or use your own, then fill in the 16×16 panels dot by dot. New since the first post: you can skip the photo entirely and draw your own mosaic from scratch.

A few things it does:

- Use a bundled image, upload a photo, provide an HTTPS image link — or start from a blank canvas and draw your own picture. The draw editor has brush, line, box, ellipse, polygon, fill, eyedropper and eraser tools, mirror painting, a 50-move undo history, and an editable palette.
- Crop and choose square, portrait, or landscape layouts, split into 9 or 12 panels.
- Use LEGO colors or a free-color palette, with a color limit from 2 to 32. The minimum is now 2, so simpler palettes are an option too.
- Work through each panel with a color tray, hints, remove/move tools, undo/redo, zoom, and a reference overlay.
- Get printable panel guides as PDFs that open with an overview page — the assembled picture with every panel numbered to match its building sheet — and close with an assembly page showing how the panel rows join with Technic pins and hang on the wall.
- Buy the parts to build it for real: per-color dot counts plus the physical build kit (pin-hole canvases, Technic pins, wall-mount panels, and a buildable raised frame) as a BrickLink wanted-list XML or Rebrickable CSV, with an option to leave the frame out. LEGO palette mode only.
- Background music with three looping tracks (Happy, Calm, Energy), separate music and effects volume sliders, and the Settings gear on every screen.
- Save progress locally, back it up, and play offline after loading the app.

## What's new since the first post

- **Draw-your-own mode**: create a blank mosaic and paint it with the same tools you'd expect from a pixel editor, then play it like any other picture.
- **Better guides**: the panel guide PDF now starts with an overview page and ends with an assembly page, with connector and hook counts derived from your panel layout.
- **Real frame**: the parts export's frame is now a buildable raised frame (backing plate, brick ring, plate layer, tile cap) instead of a 1×16 brick border ring, and you can omit it entirely.
- **Renaming**: edit a drawing's title from the draw editor and an imported picture's title from the overview.
- **Music and polish**: background music with three locally generated tracks, fast tooltips, tactile dot-placement feedback, and transparent uploads that composite over a background color you choose.

## How it works

Choose a picture, crop it, and par-dots converts it to a limited-color stud grid on your device. The mosaic is divided into panels; tap or drag to place dots until each panel matches its reference. There’s no account or backend, and uploaded photos stay on your device.

## Tech notes

It’s a static PWA built with Vite and TypeScript, without a UI framework. Canvas 2D renders the board, image quantization runs in a Web Worker, and IndexedDB stores saves locally. It’s MIT licensed.

## Links

- Play: https://dots.pardev.net
- Source: https://github.com/paulrobello/par-dots
- License: MIT
- Made by [Paul Robello](https://github.com/paulrobello)

If you try it, I’d appreciate feedback—especially on the photo-to-mosaic setup, the draw mode, and whether the build guides and parts exports are useful.
