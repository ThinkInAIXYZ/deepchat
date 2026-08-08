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
runtime_node="$script_dir/../runtime/node/bin/node"
if [ ! -x "$runtime_node" ]; then
  runtime_node="$script_dir/../../runtime/node/bin/node"
fi
if [ ! -x "$runtime_node" ]; then
  runtime_node="$script_dir/../runtime/node/node.exe"
fi
if [ ! -x "$runtime_node" ]; then
  runtime_node="$script_dir/../../runtime/node/node.exe"
fi
cli_module="$script_dir/deepchat.mjs"
if [ -x "$runtime_node" ] && [ -f "$cli_module" ]; then
  exec "$runtime_node" "$cli_module" "$@"
fi
echo "DeepChat CLI bundled resources are unavailable." >&2
exit 127
`

export const WINDOWS_LAUNCHER = `@echo off\r
set "runtime_node=%~dp0..\\runtime\\node\\node.exe"\r
if not exist "%runtime_node%" set "runtime_node=%~dp0..\\..\\runtime\\node\\node.exe"\r
if not exist "%runtime_node%" goto missing_runtime\r
if not exist "%~dp0deepchat.mjs" goto missing_runtime\r
"%runtime_node%" "%~dp0deepchat.mjs" %*\r
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
