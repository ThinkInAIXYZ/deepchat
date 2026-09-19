#!/usr/bin/env node

import { chmod, copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { sharedSourceAliases } from '../../../scripts/shared-source-aliases.mjs'
import { BUNDLED_POSIX_LAUNCHER, BUNDLED_WINDOWS_LAUNCHER } from '../src/launcher.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
export const packageDirectory = path.resolve(scriptDirectory, '..')
export const cliOutputDirectory = path.join(packageDirectory, 'dist')

function parseBuildOptions(argv) {
  const versionIndex = argv.indexOf('--version')
  const version = versionIndex >= 0 ? argv[versionIndex + 1]?.trim() : undefined
  if (!version || versionIndex + 2 !== argv.length) {
    throw new Error('Usage: build.mjs --version <desktop-release-version>')
  }
  return { version }
}

export async function buildCli(options) {
  if (!options.version.trim()) throw new Error('DeepChat CLI build requires a release version')
  const outDir = options.outDir ? path.resolve(options.outDir) : cliOutputDirectory

  await build({
    configFile: false,
    root: packageDirectory,
    publicDir: false,
    resolve: {
      alias: sharedSourceAliases
    },
    define: {
      __DEEPCHAT_CLI_VERSION__: JSON.stringify(options.version)
    },
    build: {
      target: 'node24',
      outDir,
      emptyOutDir: true,
      copyPublicDir: false,
      minify: 'esbuild',
      lib: {
        entry: path.join(packageDirectory, 'src', 'index.ts'),
        formats: ['es']
      },
      rollupOptions: {
        external: [/^node:/],
        output: {
          format: 'es',
          entryFileNames: 'deepchat.mjs',
          inlineDynamicImports: true,
          banner: '#!/usr/bin/env node'
        }
      }
    },
    logLevel: options.logLevel ?? 'info'
  })

  await copyFile(
    path.join(packageDirectory, 'src', 'launcher.mjs'),
    path.join(outDir, 'launcher.mjs')
  )
  await copyFile(
    path.join(packageDirectory, 'src', 'launcher.d.mts'),
    path.join(outDir, 'launcher.d.mts')
  )
  await writeFile(path.join(outDir, 'deepchat'), BUNDLED_POSIX_LAUNCHER, { mode: 0o755 })
  await chmod(path.join(outDir, 'deepchat'), 0o755)
  await writeFile(path.join(outDir, 'deepchat.cmd'), BUNDLED_WINDOWS_LAUNCHER, 'utf8')
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await buildCli(parseBuildOptions(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
