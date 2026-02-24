import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'Prancheta ANCB',
        short_name: 'Prancheta ANCB',
        description: 'Prancheta tática de basquete da ANCB',
        theme_color: '#062553',
        background_color: '#062553',
        display: 'fullscreen',
        orientation: 'portrait',
        icons: [
          {
            src: 'https://i.imgur.com/m3P6wTd.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'https://i.imgur.com/m3P6wTd.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/i\.imgur\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'imgur-images',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30
              }
            }
          },
          {
            urlPattern: /^https:\/\/ui-avatars\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'avatars',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7
              }
            }
          }
        ]
      }
    })
  ],
})
