import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

// Exercise electron-vite's real modulePath transform, not a mocked Worker entry.
export default defineConfig({
  main: {
    resolve: {
      alias: { '@': resolve('src/main'), '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: {
          scanWorker: resolve('src/main/skill/sync/scanWorker.ts'),
          toolScanner: resolve('src/main/skill/sync/toolScanner.ts'),
          discoveries: resolve('src/main/skill/sync/discoveries.ts')
        },
        preserveEntrySignatures: 'strict',
        output: { entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' }
      }
    }
  }
})
