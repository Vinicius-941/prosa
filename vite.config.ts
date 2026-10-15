import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'desktop' ? './' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/socket.io': { target: 'http://localhost:8787', ws: true },
    },
  },
}))
