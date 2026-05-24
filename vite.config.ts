import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Deployed at https://examungus-code.github.io/mongly_clocks/ — subpath base.
// If a custom domain is ever wired up, switch base back to '/'.
const BASE = '/mongly_clocks/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Clockwork Traveler',
        short_name: 'Clockwork',
        description: 'Inventory and point-of-sale for handmade jewelry sold at festivals',
        theme_color: '#B5895A',
        background_color: '#F2E8D5',
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
