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
        // Music tracks are a few MB each; the default 2 MiB cap would drop them from the precache.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
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
