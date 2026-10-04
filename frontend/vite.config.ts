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
    // vertical-rhythm guard test reads `style.css` with Vite's `?raw` query,
    // so process just that file (all other CSS stays stubbed).
    css: { include: [/style\.css/] },
  },
})
