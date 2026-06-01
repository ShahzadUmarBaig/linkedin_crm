import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import path from 'node:path'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@crm/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
})
