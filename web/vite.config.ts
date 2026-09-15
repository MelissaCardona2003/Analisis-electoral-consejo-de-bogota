import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('maplibre-gl')) return 'maplibre'
          if (id.includes('node_modules/d3') || id.includes('node_modules/internmap')) return 'd3'
          return undefined
        },
      },
    },
  },
})
