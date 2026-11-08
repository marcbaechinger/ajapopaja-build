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
    // stylesheet-ownership and theme-conformance tests read `style.css`,
    // `PiView.css`, `Keybinding.css` and Tailwind's palette with Vite's `?raw`
    // query, so process those files (all other CSS stays stubbed).
    css: {
      include: [
        /style\.css/,
        /PiView\.css/,
        /Keybinding\.css/,
        /tailwindcss\/theme\.css/,
      ],
    },
  },
})
