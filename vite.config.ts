import { createHash } from 'node:crypto';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

/**
 * Production CSP, injected at build time only: the dev server needs inline scripts and an HMR
 * socket. GA4 (src/analytics.ts) and the Cloudflare beacon are the only external scripts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://*.googletagmanager.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://*.google-analytics.com https://*.googletagmanager.com",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default defineConfig({
  base: '/',
  plugins: [
    {
      name: 'csp-meta',
      apply: 'build',
      transformIndexHtml: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ],
    },
    {
      name: 'build-fingerprint',
      apply: 'build',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const hash = createHash('sha256');
        for (const name of Object.keys(bundle).sort()) {
          const entry = bundle[name];
          hash.update(name);
          hash.update(entry.type === 'chunk' ? entry.code : entry.source);
        }
        const fingerprint = hash.digest('hex');
        const html = bundle['index.html'];
        if (html?.type === 'asset') {
          html.source = String(html.source).replace(
            '</head>',
            `<meta name="build-fingerprint" content="${fingerprint}"></head>`,
          );
        }
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ fingerprint }),
        });
      },
    },
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'favicon.svg',
        'favicon-32.png',
        'favicon-16.png',
        'icons/apple-touch-icon.png',
        'CNAME',
      ],
      manifest: {
        name: 'par-dots — LEGO Dots Mosaic',
        short_name: 'par-dots',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#34383c',
        background_color: '#34383c',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,css,js,svg,png,webp,json,webmanifest,mp3}'],
        globIgnores: ['version.json'],
        // Music tracks are a few MB each; the default 2 MiB cap would drop them from the precache.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Fresh deploys take over uncontrolled pages as soon as the prompt policy activates
        // them, and outdated precache revisions never linger after an activation.
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'html'],
      // Floor of the measured baseline (41.69% on 2026-09-26); raise as UI coverage grows.
      thresholds: { lines: 41 },
    },
  },
});
