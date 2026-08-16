import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // All /api calls go to the Python backend — no hardcoded port in frontend code
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // Don't fail the whole page if backend is temporarily down
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.warn('[proxy] backend unreachable:', err.message)
            if (!res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ detail: 'Backend not running. Start it with: cd backend && uvicorn main:app --reload --http h11' }))
            }
          })
        },
      },
    },
  },
})
