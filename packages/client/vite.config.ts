import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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