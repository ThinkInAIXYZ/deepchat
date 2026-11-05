import { resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * Builds the preload bridge (`createBridge`) as a standalone script the Go shell
 * can drop into its preload.
 *
 * The bridge only needs `invoke` and `on`-style IPC, which the shell emulates over
 * its own binding, so bundling it gives the renderer the same contract validation
 * it gets under Electron without pulling any Electron module in.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve('src/main') + '/$1' },
      { find: '@shared', replacement: resolve('src/shared') }
    ]
  },
  build: {
    target: 'safari16',
    outDir: 'out/preload',
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
    lib: {
      entry: resolve('src/preload/createBridge.ts'),
      name: 'DeepchatBridge',
      formats: ['iife'],
      fileName: () => 'bridge.js'
    }
  }
})
