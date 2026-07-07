import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // dev server + SW don't mix well with the API proxy; test via prod build
      devOptions: { enabled: false },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'TransferHero',
        short_name: 'TransferHero',
        description: 'DC Metro transfers with real-time arrivals',
        theme_color: '#E31837',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // stations barely change — fine to serve from cache when offline
            urlPattern: /\/api\/stations/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'stations',
              expiration: { maxEntries: 4, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
          {
            // everything else under /api is real-time — never serve stale from SW
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  build: {
    modulePreload: { polyfill: false } // skip inline polyfill so CSP can block unsafe-inline scripts
  },
  server: {
    port: 3000,
    strictPort: true, // keeps it from silently swapping ports if 3000 is zombie'd
    host: true,       // binds to 0.0.0.0 so tailscale/wifi works
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001', // use IP to avoid node 17+ ipv6 resolution chaos
        changeOrigin: true
      }
    }
  }
})
