import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE_PATH || '/'
  return {
    base,
    plugins: [react(), VitePWA({
      registerType: 'prompt',
      includeAssets: ['app-icon.svg', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-shapes-192.png', 'icon-shapes-512.png', 'apple-touch-icon-shapes.png', 'push-events.js'],
      manifest: {
        name: 'ИДБ-26-09 — учебное пространство', short_name: 'ИДБ-26-09', lang: 'ru',
        description: 'Объявления, предметы и учебные материалы вашей группы',
        theme_color: '#41644a', background_color: '#f7f8f5', display: 'standalone',
        id: base, start_url: base, scope: base,
        shortcuts: [
          { name: 'Объявления', url: `${base}#home` },
          { name: 'Предметы', url: `${base}#subjects` },
          { name: 'Дедлайны', url: `${base}#deadlines` },
        ],
        icons: [
          { src: 'icon-shapes-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-shapes-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: { importScripts: ['push-events.js'], globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], navigateFallback: 'index.html' },
    })],
  }
})
