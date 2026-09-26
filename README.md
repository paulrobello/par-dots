# par-dots

A mobile-first LEGO Dots mosaic game for the browser. Pick a bundled picture or upload your own, and par-dots turns it into a stud mosaic of up to 32 colors split into 16x16 baseplate panels. Fill each panel dot by dot from a color tray, using the panel's reference image as your only guide.

Everything runs on-device: uploads never leave your phone, progress is saved locally, and the app installs as a PWA that plays fully offline.

**Play:** https://dots.pardev.net

## Development

Requires [Bun](https://bun.sh).

```bash
make install     # install dependencies
make dev         # dev server on http://localhost:4231
make test        # unit tests (Vitest)
make lint        # Biome lint
make typecheck   # tsc --noEmit
make build       # build the image library, then the static site into dist/
make checkall    # fmt, lint, typecheck, test, build
```

`make build` runs `scripts/build-library.ts`, which converts `images/*.jpg` into WebP images, thumbnails, and `public/library/manifest.json`.

Pushes to `main` are checked and deployed to GitHub Pages by `.github/workflows/deploy.yml`.

## License

MIT. See [LICENSE](LICENSE).
