#!/usr/bin/env node

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = path.resolve(scriptDirectory, '..')
export const cliOutputDirectory = path.join(repositoryRoot, 'out', 'cli')

export const POSIX_LAUNCHER = `#!/bin/sh
set -eu

case "$0" in
  */*) script_dir=\${0%/*} ;;
  *) script_dir=. ;;
esac
script_dir=$(CDPATH= cd -P -- "$script_dir" && pwd)
cli_module="$script_dir/deepchat.mjs"
electron_host=""
for candidate in \\
  "$script_dir/../../../MacOS/DeepChat" \\
  "$script_dir/../../../deepchat.bin" \\
  "$script_dir/../../../DeepChat" \\
  "$script_dir/../../../deepchat" \\
  "$script_dir/../../../DeepChat.exe" \\
  "$script_dir/../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \\
  "$script_dir/../../node_modules/electron/dist/electron" \\
  "$script_dir/../../node_modules/electron/dist/electron.exe"
do
  if [ -f "$candidate" ] && [ -x "$candidate" ]; then
    electron_host="$candidate"
    break
  fi
done
if [ -n "$electron_host" ] && [ -f "$cli_module" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$electron_host" "$cli_module" "$@"
fi
echo "DeepChat CLI bundled resources are unavailable." >&2
exit 127
`

export const WINDOWS_LAUNCHER = `@echo off\r
setlocal\r
set "cli_module=%~dp0deepchat.mjs"\r
set "electron_host=%~dp0..\\..\\node_modules\\electron\\dist\\electron.exe"\r
if not exist "%electron_host%" set "electron_host=%~dp0..\\..\\..\\DeepChat.exe"\r
if not exist "%electron_host%" set "electron_host=%~dp0..\\..\\..\\DeepChat"\r
if not exist "%electron_host%" goto missing_runtime\r
if exist "%electron_host%\\" goto missing_runtime\r
if not exist "%cli_module%" goto missing_runtime\r
set ELECTRON_RUN_AS_NODE=1\r
"%electron_host%" "%cli_module%" %*\r
exit /b %errorlevel%\r
:missing_runtime\r
echo DeepChat CLI bundled resources are unavailable. 1>&2\r
exit /b 127\r
`

export async function buildCli(options = {}) {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')
  )
  const outDir = options.outDir ? path.resolve(options.outDir) : cliOutputDirectory

  await build({
    configFile: false,
    root: repositoryRoot,
    publicDir: false,
    resolve: {
      alias: {
        '@shared': path.join(repositoryRoot, 'src', 'shared')
      }
    },
    define: {
      __DEEPCHAT_CLI_VERSION__: JSON.stringify(packageJson.version)
    },
    build: {
      target: 'node24',
      outDir,
      emptyOutDir: true,
      copyPublicDir: false,
      minify: 'esbuild',
      lib: {
        entry: path.join(repositoryRoot, 'src', 'cli', 'index.ts'),
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

  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'deepchat'), POSIX_LAUNCHER, { mode: 0o755 })
  await chmod(path.join(outDir, 'deepchat'), 0o755)
  await writeFile(path.join(outDir, 'deepchat.cmd'), WINDOWS_LAUNCHER, 'utf8')
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  buildCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
