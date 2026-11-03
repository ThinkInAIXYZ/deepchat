#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, copyFile, chmod } from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
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
    plugins: [
      {
        name: 'harness-module-path',
        load(id) {
          if (!id.endsWith('?modulePath')) return null
          const reference = this.emitFile({ type: 'chunk', id: id.slice(0, -11) })
          return `import { fileURLToPath } from 'node:url'
export default fileURLToPath(import.meta.ROLLUP_FILE_URL_${reference})`
        }
      }
    ],
    resolve: {
      conditions: ['node'],
      mainFields: ['main', 'module'],
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
        entry: {
          core: path.join(repositoryRoot, 'src', 'harness', 'plugins', 'core.ts'),
          memory: path.join(repositoryRoot, 'src', 'harness', 'plugins', 'memory.ts'),
          hooks: path.join(repositoryRoot, 'src', 'harness', 'plugins', 'hooks.ts'),
          'memory-vector': path.join(
            repositoryRoot,
            'src',
            'harness',
            'plugins',
            'memory-vector.ts'
          )
        },
        formats: ['es'],
        fileName: (_, name) => `${name}.mjs`
      },
      rollupOptions: {
        external: [
          ...builtinModules,
          /^node:/,
          'better-sqlite3-multiple-ciphers',
          '@duckdb/node-api',
          '@duckdb/node-bindings',
          'sharp',
          '@ff-labs/fff-node',
          'opendal',
          'pdf-parse-new',
          'node-pty',
          '@larksuiteoapi/node-sdk'
        ]
      }
    }
  })
  const extension = platform === 'win32' ? '.exe' : ''
  const binary = path.join(output, `deepchat-harness-${platform}-${arch}${extension}`)
  await copyFile(
    path.join(crate, 'target', target, 'release', `deepchat-harness${extension}`),
    binary
  )
  await chmod(binary, 0o755)
  const sqlite = path.dirname(require.resolve('better-sqlite3-multiple-ciphers/package.json'))
  const sqliteOutput = path.join(output, 'node_modules', 'better-sqlite3-multiple-ciphers')
  await mkdir(path.join(sqliteOutput, 'prebuilds'), { recursive: true })
  await copyFile(path.join(sqlite, 'package.json'), path.join(sqliteOutput, 'package.json'))
  await cp(path.join(sqlite, 'lib'), path.join(sqliteOutput, 'lib'), { recursive: true })
  await copyFile(
    path.join(sqlite, 'prebuilds', `${platform}-${arch}.node`),
    path.join(sqliteOutput, 'prebuilds', `${platform}-${arch}.node`)
  )
  if (platform === 'linux') {
    await copyFile(
      path.join(sqlite, 'prebuilds', `linuxmusl-${arch}.node`),
      path.join(sqliteOutput, 'prebuilds', `linuxmusl-${arch}.node`)
    )
  }
  const runtimePackage = require.resolve('@arcships/rutis-runtime/package.json')
  const runtimeRoot = path.dirname(runtimePackage)
  const runtimeOutput = path.join(output, 'node_modules', '@arcships', 'rutis-runtime')
  await mkdir(runtimeOutput, { recursive: true })
  await copyFile(runtimePackage, path.join(runtimeOutput, 'package.json'))
  await cp(path.join(runtimeRoot, 'src'), path.join(runtimeOutput, 'src'), { recursive: true })
  const runtimeRequire = createRequire(runtimePackage)
  // The compiled first-party runtime needs Cordis and WebSocket support, not the TS generator.
  const apiPackage = require.resolve('@duckdb/node-api/package.json')
  const apiRequire = createRequire(apiPackage)
  const bindingsPackage = apiRequire.resolve('@duckdb/node-bindings/package.json')
  const bindingsRequire = createRequire(bindingsPackage)
  const packages = new Map([
    ...['@deepseek-ai/cordis', '@deepseek-ai/cosmokit', 'ws'].map((name) => [
      name,
      runtimeRequire.resolve(`${name}/package.json`)
    ]),
    ['@duckdb/node-api', apiPackage],
    ['@duckdb/node-bindings', bindingsPackage],
    ['detect-libc', bindingsRequire.resolve('detect-libc/package.json')],
    [
      `@duckdb/node-bindings-${platform}-${arch}`,
      bindingsRequire.resolve(`@duckdb/node-bindings-${platform}-${arch}/package.json`)
    ]
  ])
  const sharpPackage = path.resolve(path.dirname(require.resolve('sharp')), '../package.json')
  const sharpRequire = createRequire(sharpPackage)
  const fffPackage = require.resolve('@ff-labs/fff-node/package.json')
  const fffRequire = createRequire(fffPackage)
  const ffiPackage = fffRequire.resolve('ffi-rs/package.json')
  const ffiRequire = createRequire(ffiPackage)
  const nativePlatform = platform === 'linux' ? `linux-${arch}-gnu` : `${platform}-${arch}`
  const napiPlatform = platform === 'win32' ? `${nativePlatform}-msvc` : nativePlatform
  packages.set('sharp', sharpPackage)
  packages.set('@ff-labs/fff-node', fffPackage)
  packages.set('ffi-rs', ffiPackage)
  packages.set(`@ff-labs/fff-bin-${nativePlatform}`,
    fffRequire.resolve(`@ff-labs/fff-bin-${nativePlatform}/package.json`))
  packages.set(`@yuuang/ffi-rs-${napiPlatform}`,
    ffiRequire.resolve(`@yuuang/ffi-rs-${napiPlatform}/package.json`))
  packages.set('@img/colour', path.join(path.dirname(sharpRequire.resolve('@img/colour')), 'package.json'))
  packages.set('semver', sharpRequire.resolve('semver/package.json'))
  packages.set(`@img/sharp-${platform}-${arch}`,
    sharpRequire.resolve(`@img/sharp-${platform}-${arch}/package`))
  if (platform !== 'win32')
    packages.set(`@img/sharp-libvips-${platform}-${arch}`,
      sharpRequire.resolve(`@img/sharp-libvips-${platform}-${arch}/package`))
  const opendalPackage = require.resolve('opendal/package.json')
  packages.set('opendal', opendalPackage)
  packages.set(`@opendal/lib-${napiPlatform}`,
    createRequire(opendalPackage).resolve(`@opendal/lib-${napiPlatform}/package.json`))
  const pdfPackage = require.resolve('pdf-parse-new/package.json')
  const pdfRequire = createRequire(pdfPackage)
  const debugPackage = pdfRequire.resolve('debug/package.json')
  packages.set('pdf-parse-new', pdfPackage)
  packages.set('node-ensure', pdfRequire.resolve('node-ensure/package.json'))
  packages.set('debug', debugPackage)
  packages.set('ms', createRequire(debugPackage).resolve('ms/package.json'))
  packages.set('node-pty', require.resolve('node-pty/package.json'))
  packages.set('@larksuiteoapi/node-sdk', require.resolve('@larksuiteoapi/node-sdk/package.json'))
  for (const [name, packageFile] of packages) {
    const source = path.dirname(packageFile)
    const metadata = JSON.parse(await readFile(packageFile, 'utf8'))
    const dependencyRequire = createRequire(packageFile)
    for (const dependency of Object.keys(metadata.dependencies ?? {})) {
      let dependencyFile
      try {
        dependencyFile = dependencyRequire.resolve(`${dependency}/package.json`)
      } catch (error) {
        if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
        let directory = path.dirname(dependencyRequire.resolve(dependency))
        while (true) {
          const file = path.join(directory, 'package.json')
          try {
            if (JSON.parse(await readFile(file, 'utf8')).name === dependency) {
              dependencyFile = file
              break
            }
          } catch (error) {
            if (error.code !== 'ENOENT') throw error
          }
          const parent = path.dirname(directory)
          if (parent === directory) throw new Error(`Cannot locate ${dependency}`)
          directory = parent
        }
      }
      if (!packages.has(dependency)) packages.set(dependency, dependencyFile)
      else if (JSON.parse(await readFile(packages.get(dependency), 'utf8')).version !==
        JSON.parse(await readFile(dependencyFile, 'utf8')).version)
        packages.set(`${name}/node_modules/${dependency}`, dependencyFile)
    }
    await cp(source, path.join(output, 'node_modules', name), {
      recursive: true,
      dereference: true,
      filter: (file) => {
        const relative = path.relative(source, file)
        const parts = relative.split(path.sep)
        return (
          !parts.includes('node_modules') &&
          !['test', 'tests'].includes(parts[0]) &&
          !/\.(?:map|pdb|d\.[cm]?ts)$/.test(relative)
        )
      }
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
