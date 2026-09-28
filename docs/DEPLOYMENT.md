# Deployment

How par-dots is built, checked and published to GitHub Pages at https://dots.pardev.net, and how to verify or roll back a release. No environment variables or secrets are required.

## Table of Contents

- [Overview](#overview)
- [Workflow](#workflow)
- [Custom Domain Setup](#custom-domain-setup)
- [Deploy a Change](#deploy-a-change)
- [Verify a Release](#verify-a-release)
- [Service-Worker Updates](#service-worker-updates)
- [Roll Back](#roll-back)
- [Troubleshooting](#troubleshooting)
- [Related Documentation](#related-documentation)

## Overview

The app is a static site. `bun run build` generates the bundled picture library (`scripts/build-library.ts` writes `public/library/`) and then runs `vite build` into `dist/`. GitHub Actions publishes `dist/` to GitHub Pages. There is no server, database, API key or secret: every build input is in the repository. The production build injects a Content-Security-Policy `<meta>` tag (`vite.config.ts`) that allowlists the GA4 script (`www.googletagmanager.com`) and the Cloudflare beacon; the dev server omits it.

## Workflow

`.github/workflows/deploy.yml` runs on every push to `main` and on manual dispatch (`workflow_dispatch`). The concurrency group `pages` queues runs instead of cancelling a deploy in progress.

| Job | Permissions | Steps |
| --- | --- | --- |
| `check` | `contents: read` (workflow default) | Checkout; set up the Bun version pinned in the workflow; `bun install --frozen-lockfile`; `bun run lint`; `bun run typecheck`; `bun run test`; `bun run build`; `bunx playwright install --with-deps chromium`; `./scripts/e2e.sh` (browser smoke test against `vite preview`); upload `dist/` as the Pages artifact |
| `deploy` | `pages: write`, `id-token: write` | Runs only after `check` succeeds; deploys the artifact to the `github-pages` environment |

Every action is pinned to a commit SHA with the release tag in a comment. When you update an action, pin the new SHA the same way.

> **Note:** `make checkall` runs the same lint, typecheck, test and build steps locally. It does not run the browser smoke test; run `make e2e` for that.

## Custom Domain Setup

This is a one-time setup, already done for `dots.pardev.net`. Repeat it only when moving the site to another domain.

1. Create a DNS-only (unproxied) Cloudflare CNAME record `dots.pardev.net` pointing to `paulrobello.github.io` in zone `pardev.net`. This overrides the `*.pardev.net` wildcard, which otherwise routes to another host and returns 404.
2. Commit `public/CNAME` containing `dots.pardev.net`. Vite copies it into `dist/`.
3. Register the custom domain in the repository's Pages settings (for example `PUT /repos/paulrobello/par-dots/pages` with the `cname` field). The `CNAME` file alone does not register it.
4. Enable **Enforce HTTPS** once GitHub has issued the certificate.

The site is served from the domain root, so Vite `base`, the service-worker scope and the manifest `start_url` are all `/`.

## Deploy a Change

1. Run the local gate.

   ```bash
   make checkall
   make e2e
   ```

2. Push to `main`.

   ```bash
   git push origin main
   ```

3. Watch the run until both jobs pass.

   ```bash
   gh run watch
   ```

## Verify a Release

An HTTP 200 alone is not acceptance. After the `deploy` job finishes:

1. Load https://dots.pardev.net in a browser.
2. Start a picture, open a panel, and place a few dots.
3. Reload and confirm the progress is still there.
4. Go offline (browser dev tools or airplane mode), reload, and confirm the app still loads and plays.

## Service-Worker Updates

A new deploy does not interrupt players.

- Open pages check for a new service worker every 60 minutes and whenever they become visible again.
- A waiting update is applied only when the page is hidden, or when it shows the gallery or a picture overview with no sheet or dialog open. A player in the middle of a panel or on the setup screen keeps the old version until they return to the gallery or overview.
- To pick up a deploy immediately, open the gallery (`#/`) or switch away from the tab and back.

See [ARCHITECTURE.md](ARCHITECTURE.md#pwa-and-updates) for the implementation.

## Roll Back

Choose one:

- **Re-run an earlier deploy.** In GitHub Actions, open the last good run of the Deploy workflow and choose **Re-run all jobs**. It rebuilds and redeploys that commit.
- **Revert and push.** Revert the bad commit on `main` and push; the normal workflow deploys the revert.

  ```bash
  git revert <bad-commit-sha>
  git push origin main
  ```

Players receive the rolled-back version through the same service-worker update path as any other deploy.

## Troubleshooting

### Problem: The site returns 404 at the custom domain

**Cause:** The DNS record is missing or proxied, so the `*.pardev.net` wildcard answers instead of GitHub Pages, or the custom domain is not registered in Pages settings.

**Fix:** Recreate the DNS-only CNAME and register the domain as described in [Custom Domain Setup](#custom-domain-setup).

**Verify:** `dig +short dots.pardev.net` lists `paulrobello.github.io`, and the site loads.

### Problem: The `check` job fails in `./scripts/e2e.sh`

**Cause:** The browser smoke test found a regression, or `vite preview` did not start on port 4231.

**Fix:** Reproduce locally with `make e2e`, which builds, serves `dist/` and runs the same test.

**Verify:** `make e2e` exits 0.

### Problem: Players still see the old version

**Cause:** The update is waiting for a safe moment (see [Service-Worker Updates](#service-worker-updates)).

**Fix:** Open the gallery, or hide and show the tab.

**Verify:** The new behavior appears after the reload.

## Related Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - Layers, persistence and PWA behavior
- [PRD.md](../PRD.md) - Product requirements, including hosting (section 13)
- [README.md](../README.md) - Local setup and commands
