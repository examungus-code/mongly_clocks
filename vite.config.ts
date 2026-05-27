import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// Deployed at https://examungus-code.github.io/mongly_clocks/ — subpath base.
// If a custom domain is ever wired up, switch base back to '/'.
const BASE = '/mongly_clocks/';

// Version string injected as __BUILD_VERSION__ so every deploy is visible at
// runtime — short git SHA + build-time HH:MM, so even a rebuild of the same
// commit shows a different number. Falls back gracefully for non-git builds.
function buildVersion(): string {
  let sha = 'dev';
  try {
    sha = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    /* not a git checkout */
  }
  const stamp = new Date()
    .toISOString()
    .slice(11, 16); // HH:MM
  return `${sha} · ${stamp}`;
}

export default defineConfig({
  base: BASE,
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Clockwork Traveler',
        short_name: 'Clockwork',
        description: 'Offline-first inventory for handmade jewelry sold at festivals',
        theme_color: '#FFC700',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Drive API responses aren't cached — they should always go to network.
        navigateFallbackDenylist: [/^\/api/, /googleapis\.com/],
      },
    }),
  ],
  build: {
    sourcemap: true,
  },
});
