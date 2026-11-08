/// <reference types="vitest" />
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Vitest stubs CSS imports to an empty module by default. The PiView
    // stylesheet-ownership guard tests read `style.css` and `PiView.css` with
    // Vite's `?raw` query, so process just those files (all other CSS stays
    // stubbed).
    css: { include: [/style\.css/, /PiView\.css/] },
  },
})
