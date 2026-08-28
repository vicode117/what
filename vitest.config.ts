import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    // Vitest does not read the per-app tsconfigs; keep the automatic JSX
    // runtime for .tsx test files.
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@tt/contracts': resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@tt/core': resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
  test: {
    globals: true, // enables Testing Library auto-cleanup between tests
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
  },
})
