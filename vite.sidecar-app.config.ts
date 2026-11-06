import { resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * Builds the sidecar that runs the app's real main process.
 *
 * `electron` resolves to the shim in `platform/node/electron`, so the desktop
 * code runs unchanged while the Go shell owns windows, pages and native surfaces.
 * The platform hosts swap to their Node implementations for the same reason they
 * do in `vite.sidecar.config.ts`.
 */
/**
 * electron-vite emits `import x from './worker?modulePath'` as a separate chunk
 * and resolves its path at build time. The sidecar must do the same: a source
 * filename alone would make Node resolve a non-existent file in the cwd.
 */
const skillSyncWorkerEntry = resolve('src/main/skill/sync/scanWorkerEntry.ts')
const modulePathPrefix = '\0modulePath:'
const modulePathPlugin = {
  name: 'sidecar-module-path',
  enforce: 'pre' as const,
  async resolveId(id: string, importer: string | undefined) {
    if (!id.endsWith('?modulePath')) return null
    const target = id.replace(/\?modulePath$/, '')
    const resolved = await this.resolve(target, importer, { skipSelf: true })
    return resolved ? `${modulePathPrefix}${resolved.id}` : null
  },
  load(id: string) {
    if (!id.startsWith(modulePathPrefix)) return null
    const target = id.slice(modulePathPrefix.length)
    if (target !== skillSyncWorkerEntry) {
      throw new Error(`Unsupported sidecar module path: ${target}`)
    }
    return `
import { fileURLToPath } from 'node:url'
export default fileURLToPath(new URL('./scanWorkerEntry.mjs', import.meta.url))
`
  }
}

export default defineConfig({
  resolve: {
    // Order matters: the host swaps must come before the generic `@/` prefix.
    alias: [
      { find: /^electron$/, replacement: resolve('src/main/platform/node/electron/index.ts') },
      {
        find: /^electron-updater$/,
        replacement: resolve('src/main/platform/node/electron/updater.ts')
      },
      {
        find: /^@electron-toolkit\/utils$/,
        replacement: resolve('src/main/platform/node/electron/toolkit.ts')
      },
      {
        find: /^@\/platform\/(appHost|processHost|secretHost|storeHost|themeHost|shellHost)$/,
        replacement: resolve('src/main/platform/node') + '/$1.ts'
      },
      { find: /^@\/(.*)$/, replacement: resolve('src/main') + '/$1' },
      { find: '@shared', replacement: resolve('src/shared') }
    ]
  },
  plugins: [modulePathPlugin],
  // Bundle these so they resolve `electron` to the shim instead of requiring the
  // real module at runtime.
  ssr: {
    noExternal: ['electron-window-state']
  },
  define: {
    'import.meta.env.DEV': 'false'
  },
  build: {
    target: 'node20',
    outDir: 'out/sidecar',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    ssr: true,
    rollupOptions: {
      input: {
        app: resolve('src/main/sidecar/app.ts'),
        backgroundExecUtilityHost: resolve('src/main/backgroundExecUtilityHostEntry.ts'),
        codeModeUtilityHost: resolve('src/main/codeModeUtilityHostEntry.ts'),
        fileWatcherUtilityHost: resolve('src/main/fileWatcherUtilityHostEntry.ts'),
        scanWorkerEntry: skillSyncWorkerEntry,
        schedulerUtilityHost: resolve('src/main/schedulerUtilityHostEntry.ts')
      },
      // `electron` is not external here: it resolves to the shim above.
      external: ['electron-store', 'better-sqlite3-multiple-ciphers'],
      output: {
        format: 'es',
        entryFileNames: '[name].mjs',
        // The main process is written for CommonJS output; give the bundle the two
        // globals it assumes.
        banner:
          "import { fileURLToPath as __shimFileURLToPath } from 'node:url';" +
          "import { dirname as __shimDirname } from 'node:path';" +
          'const __filename = __shimFileURLToPath(import.meta.url);' +
          'const __dirname = __shimDirname(__filename);'
      }
    }
  }
})
