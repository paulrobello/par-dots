import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
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
        globPatterns: ['**/*.{html,css,js,svg,png,webp,json,webmanifest}'],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'], passWithNoTests: true },
});
