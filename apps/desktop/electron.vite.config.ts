import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * Dev only: @vitejs/plugin-react injects an inline refresh preamble,
 * which a strict CSP blocks. Packaged builds keep the strict CSP.
 */
function allowInlineScriptsInDev(): Plugin {
  return {
    name: 'dev-csp-allow-inline-scripts',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    },
  }
}

// Workspace packages are TypeScript source ("internal packages" pattern):
// they are bundled into main/preload output, so only Electron and Node
// builtins stay external. The app ships with empty runtime dependencies.
const nodeExternal = ['electron', /^node:/]

const workspaceAliases = {
  '@tt/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts'),
  '@tt/core': resolve(__dirname, '../../packages/core/src/index.ts'),
}

export default defineConfig({
  main: {
    resolve: { alias: workspaceAliases },
    build: {
      rollupOptions: { external: nodeExternal },
    },
  },
  preload: {
    resolve: { alias: workspaceAliases },
    build: {
      rollupOptions: { external: nodeExternal },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: workspaceAliases },
    plugins: [react(), tailwindcss(), allowInlineScriptsInDev()],
    build: {
      // Resolved relative to the project root, matching out/main and out/preload.
      outDir: 'out/renderer',
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
})
