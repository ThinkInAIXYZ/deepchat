import { resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * Builds the Node sidecar: the main-process services without Electron.
 *
 * `platform/electron/*` is replaced by `platform/node/*` at bundle time instead
 * of at runtime, so the business modules keep importing one symbol and Electron
 * never reaches the Node output. See docs/features/mygo-rewrite/platform-abstraction.md.
 */
export default defineConfig({
  resolve: {
    // Order matters: the host swaps must come before the generic `@/` prefix.
    alias: [
      {
        find: /^@\/platform\/(appHost|processHost|secretHost|storeHost|themeHost|shellHost)$/,
        replacement: resolve('src/main/platform/node') + '/$1.ts'
      },
      { find: /^@\/(.*)$/, replacement: resolve('src/main') + '/$1' },
      { find: '@shared', replacement: resolve('src/shared') }
    ]
  },
  define: {
    'import.meta.env.DEV': 'false'
  },
  build: {
    target: 'node20',
    outDir: 'out/sidecar',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    ssr: true,
    rollupOptions: {
      input: resolve('src/main/sidecar/entry.ts'),
      external: ['electron', 'electron-store', 'better-sqlite3-multiple-ciphers'],
      output: {
        format: 'es',
        entryFileNames: 'entry.mjs'
      }
    }
  }
})
