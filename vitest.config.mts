import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['{lib,app,components}/**/*.test.{ts,tsx}'] },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
