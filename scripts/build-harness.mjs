#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, copyFile, chmod } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const targets = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu'
}

export async function buildHarness({ platform = process.platform, arch = process.arch } = {}) {
  const target = targets[`${platform}-${arch}`]
  if (!target) throw new Error(`Unsupported harness target: ${platform}-${arch}`)
  const crate = path.join(repositoryRoot, 'crates', 'deepchat-harness')
  const output = path.join(repositoryRoot, 'out', 'harness')
  const result = spawnSync(
    'cargo',
    [
      'build',
      '--locked',
      '--release',
      '--target',
      target,
      '--manifest-path',
      path.join(crate, 'Cargo.toml')
    ],
    { cwd: repositoryRoot, stdio: 'inherit' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Harness build failed for ${target}`)
  await build({
    configFile: false,
    root: repositoryRoot,
    publicDir: false,
    resolve: {
      alias: {
        '@': path.join(repositoryRoot, 'src', 'main'),
        '@shared': path.join(repositoryRoot, 'src', 'shared')
      }
    },
    build: {
      target: 'node24',
      outDir: output,
      emptyOutDir: true,
      copyPublicDir: false,
      lib: {
        entry: path.join(repositoryRoot, 'src', 'harness', 'plugins', 'admission.ts'),
        formats: ['es'],
        fileName: () => 'admission.mjs'
      },
      rollupOptions: { external: [/^node:/] }
    }
  })
  const extension = platform === 'win32' ? '.exe' : ''
  const binary = path.join(output, `deepchat-harness-${platform}-${arch}${extension}`)
  await copyFile(
    path.join(crate, 'target', target, 'release', `deepchat-harness${extension}`),
    binary
  )
  await chmod(binary, 0o755)
  const runtimePackage = require.resolve('@arcships/rutis-runtime/package.json')
  const runtimeRoot = path.dirname(runtimePackage)
  const runtimeOutput = path.join(output, 'node_modules', '@arcships', 'rutis-runtime')
  await mkdir(runtimeOutput, { recursive: true })
  await copyFile(runtimePackage, path.join(runtimeOutput, 'package.json'))
  await cp(path.join(runtimeRoot, 'src'), path.join(runtimeOutput, 'src'), { recursive: true })
  const runtimeRequire = createRequire(runtimePackage)
  // The compiled first-party runtime needs Cordis and WebSocket support, not the TS generator.
  for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/cosmokit', 'ws']) {
    const source = path.dirname(runtimeRequire.resolve(`${name}/package.json`))
    await cp(source, path.join(output, 'node_modules', name), {
      recursive: true,
      dereference: true,
      filter: (file) => !path.relative(source, file).split(path.sep).includes('node_modules')
    })
  }
  const pkg = JSON.parse(await readFile(runtimePackage, 'utf8'))
  if (pkg.version !== '0.16.0') throw new Error('Rutis SDK/runtime version mismatch')
}

export default async function beforePack(context) {
  const arch =
    typeof context.arch === 'string'
      ? context.arch
      : new Map([
          [1, 'x64'],
          [3, 'arm64']
        ]).get(context.arch)
  if (!arch) throw new Error(`Unsupported harness package architecture: ${context.arch}`)
  await buildHarness({ platform: context.electronPlatformName, arch })
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await buildHarness()
}
