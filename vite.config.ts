/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.LOCAL_API_TARGET || 'http://127.0.0.1:4174',
    },
  },
  esbuild: command === 'build'
    ? { pure: ['console.log', 'console.debug'] }
    : undefined,
  test: {
    environment: 'jsdom',
  },
}))
