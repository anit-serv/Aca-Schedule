import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  esbuild: command === 'build'
    ? { pure: ['console.log', 'console.debug'] }
    : undefined,
}))
