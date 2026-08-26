import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Swimmable',
        short_name: 'Swimmable',
        description: 'Is the ocean good to swim today?',
        theme_color: '#08121E',
        background_color: '#08121E',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/marine-api\.open-meteo\.com/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'marine-api',
              expiration: { maxAgeSeconds: 1800, maxEntries: 20 }
            }
          },
          {
            urlPattern: /^https:\/\/api\.open-meteo\.com/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'forecast-api',
              expiration: { maxAgeSeconds: 1800, maxEntries: 20 }
            }
          },
          {
            urlPattern: /^https:\/\/nominatim\.openstreetmap\.org/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'geocoding',
              expiration: { maxAgeSeconds: 86400, maxEntries: 50 }
            }
          }
        ]
      }
    })
  ],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl']
        }
      }
    }
  }
})
