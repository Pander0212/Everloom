import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const backend = process.env.EVERLOOM_BACKEND ?? 'http://127.0.0.1:8787';

/** Which build is running, shown in Settings → About (Docker passes the commit in; .git isn't copied). */
function commit(): string {
  if (process.env.EVERLOOM_COMMIT) return process.env.EVERLOOM_COMMIT.slice(0, 12);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  define: { __EVERLOOM_BUILD__: JSON.stringify({ commit: commit(), date: new Date().toISOString().slice(0, 16).replace('T', ' ') }) },
  plugins: [
    react(),
    tailwind(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'theme-init.js'],
      manifest: {
        name: 'Everloom',
        short_name: 'Everloom',
        description: 'Roleplay and story RPG, self-hosted.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0E0F11',
        theme_color: '#0E0F11',
        // Android: "Share" a character page to Everloom to import it.
        share_target: { action: '/bridge/share', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//],
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        // Everloom's pictures load when a screen needs them (and are cached then), not at install.
        globIgnores: ['art/**', 'avatar/**', 'three/**', 'assets/3d-*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/art/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'art', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 90 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/media/'),
            handler: 'CacheFirst',
            // Only what the server marks cacheable: with the vault on it marks nothing, so no picture stays on the device.
            options: { cacheName: 'media', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 }, cacheableResponse: { statuses: [200], headers: { 'x-everloom-cacheable': 'yes' } } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/media': { target: backend, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // Everything 3D in its own chunks (never precached; fetched only when a 3D screen opens).
        manualChunks: (id) => (/node_modules\/(three|@pixiv)\//.test(id) ? '3d-three' : /features\/avatar3d\//.test(id) ? '3d-avatar' : undefined),
      },
    },
  },
});
