import { resolve } from 'path'
import { defineConfig, type UserConfig } from 'vite'

/**
 * Builds the standalone typed bridge and its splash-specific counterpart for the
 * Go shell. Electron keeps using its own preload; these bundles only adapt the
 * platform transport, not renderer business behavior.
 */
export function createPreloadConfig(
  entry: string,
  fileName: string,
  globalName: string
): UserConfig {
  return {
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
        entry: resolve(entry),
        name: globalName,
        formats: ['iife'],
        fileName: () => fileName
      }
    }
  }
}

export default defineConfig(
  createPreloadConfig('src/preload/createBridge.ts', 'bridge.js', 'DeepchatBridge')
)
