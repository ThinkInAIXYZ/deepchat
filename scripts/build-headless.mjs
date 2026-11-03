#!/usr/bin/env node
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { buildHarness, harnessExternalModules } from './build-harness.mjs'
import { buildCli } from './build-cli.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const electronPackage = /^(?:electron(?:$|[/-])|@electron(?:-toolkit)?\/)/
const electronImport =
  /\b(?:from\s*|import\s*|(?:require|import)\s*\(\s*)['"](?:electron(?:[/-][^'"]*)?|@electron(?:-toolkit)?\/[^'"]*)['"]/
const licenseName = /^(?:licen[sc]es?|copying|notice)(?:[._-]|$)/i

async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Headless distribution contains a symlink: ${file}`)
    if (entry.isDirectory()) yield* files(file)
    else yield file
  }
}

export async function buildHeadless() {
  const metadata = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'))
  const output = path.join(repositoryRoot, 'out', 'headless')
  const harness = path.join(output, 'harness')
  const packageFiles = new Set()
  const directories = new Set()
  const boundary = {
    name: 'headless-dependencies',
    enforce: 'pre',
    resolveId(source, importer) {
      if (electronPackage.test(source)) {
        throw new Error(`Electron import is unavailable in headless: ${source} from ${importer}`)
      }
    },
    async moduleParsed({ id }) {
      if (!path.isAbsolute(id) || !id.includes(`${path.sep}node_modules${path.sep}`)) return
      let directory = path.dirname(id.split('?')[0])
      while (!directories.has(directory)) {
        directories.add(directory)
        const file = path.join(directory, 'package.json')
        try {
          if (JSON.parse(await readFile(file, 'utf8')).name) {
            packageFiles.add(file)
            break
          }
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
        }
        const parent = path.dirname(directory)
        if (parent === directory) break
        directory = parent
      }
    }
  }
  await rm(output, { recursive: true, force: true })
  const watcher = require.resolve('@parcel/watcher/package.json')
  const watcherNative = `@parcel/watcher-${process.platform}-${process.arch}${process.platform === 'linux' ? '-glibc' : ''}`
  const additionalPackages = new Map([
    ['@parcel/watcher', watcher],
    [watcherNative, createRequire(watcher).resolve(`${watcherNative}/package.json`)]
  ])
  const target = await buildHarness({ outDir: harness, plugins: [boundary], additionalPackages })
  await rename(path.join(harness, 'node_modules'), path.join(output, 'node_modules'))
  await build({
    configFile: false,
    root: repositoryRoot,
    publicDir: false,
    plugins: [boundary],
    resolve: {
      conditions: ['node'],
      mainFields: ['main', 'module'],
      alias: {
        '@': path.join(repositoryRoot, 'src', 'main'),
        '@shared': path.join(repositoryRoot, 'src', 'shared')
      }
    },
    define: { __DEEPCHAT_HOST_VERSION__: JSON.stringify(metadata.version) },
    build: {
      target: 'node24',
      outDir: output,
      emptyOutDir: false,
      copyPublicDir: false,
      lib: {
        entry: {
          index: path.join(repositoryRoot, 'src', 'headless', 'index.ts'),
          helper: path.join(repositoryRoot, 'src', 'headless', 'helper.ts')
        },
        formats: ['es'],
        fileName: (_, name) => `${name}.mjs`
      },
      rollupOptions: { external: [...harnessExternalModules, ...additionalPackages.keys()] }
    }
  })
  await buildCli({ outDir: path.join(output, 'cli') })
  await writeFile(
    path.join(output, 'cli', 'deepchat'),
    `#!/bin/sh
set -eu
case "$0" in
  */*) script_dir=\${0%/*} ;;
  *) script_dir=. ;;
esac
script_dir=$(CDPATH= cd -P -- "$script_dir" && pwd)
exec node "$script_dir/deepchat.mjs" "$@"
`,
    { mode: 0o755 }
  )
  await writeFile(
    path.join(output, 'cli', 'deepchat.cmd'),
    '@echo off\r\nnode "%~dp0deepchat.mjs" %*\r\nexit /b %errorlevel%\r\n'
  )
  for (const relative of [
    'resources/model-db',
    'resources/acp-registry',
    'resources/skills',
    'resources/runtime-versions.json',
    'runtime/duckdb',
    'LICENSE'
  ]) {
    const target = path.join(output, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await cp(path.join(repositoryRoot, relative), target, { recursive: true, dereference: true })
  }
  // These two packages are copied selectively by the shared Harness build.
  for (const name of ['better-sqlite3-multiple-ciphers', '@arcships/rutis-runtime']) {
    packageFiles.add(require.resolve(`${name}/package.json`))
  }
  for await (const file of files(output)) {
    if (path.basename(file) === 'package.json') {
      const dependency = JSON.parse(await readFile(file, 'utf8'))
      if (electronPackage.test(dependency.name ?? '')) {
        throw new Error(`Electron dependency is unavailable in headless: ${file}`)
      }
      if (dependency.name && dependency.version) packageFiles.add(file)
    } else if (/\.[cm]?js$/.test(file) && electronImport.test(await readFile(file, 'utf8'))) {
      throw new Error(`Electron import is unavailable in headless: ${file}`)
    }
  }
  const dependencies = []
  for (const file of packageFiles) {
    const dependency = JSON.parse(await readFile(file, 'utf8'))
    dependencies.push({
      name: dependency.name,
      version: dependency.version,
      license: dependency.license,
      source: `npm:${dependency.name}@${dependency.version}`,
      directory: path.dirname(file)
    })
  }
  const cargo = spawnSync(
    'cargo',
    [
      'metadata',
      '--offline',
      '--locked',
      '--format-version',
      '1',
      '--filter-platform',
      target,
      '--manifest-path',
      path.join(repositoryRoot, 'crates', 'deepchat-harness', 'Cargo.toml')
    ],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  )
  if (cargo.error) throw cargo.error
  if (cargo.status !== 0) throw new Error(`Cannot inventory Rust licenses: ${cargo.stderr}`)
  for (const dependency of JSON.parse(cargo.stdout).packages) {
    dependencies.push({
      name: dependency.name,
      version: dependency.version,
      license: dependency.license,
      source: dependency.source ?? `cargo:${dependency.name}@${dependency.version}`,
      directory: path.dirname(dependency.manifest_path),
      licenseFile: dependency.license_file
    })
  }
  const licenses = new Map()
  for (const dependency of dependencies) {
    const name = `${dependency.source.startsWith('npm:') ? 'npm' : 'cargo'}__${dependency.name}@${dependency.version}`
    if (licenses.has(name)) continue
    const source = dependency.directory
    const target = path.join(output, 'licenses', name.replaceAll('/', '__'))
    const entries = (await readdir(source)).filter((entry) => licenseName.test(entry))
    if (dependency.licenseFile && !entries.includes(dependency.licenseFile)) {
      try {
        await access(path.resolve(source, dependency.licenseFile))
        entries.push(dependency.licenseFile)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    for (const entry of entries) {
      await mkdir(target, { recursive: true })
      await cp(path.resolve(source, entry), path.join(target, path.basename(entry)), {
        recursive: true,
        dereference: true
      })
    }
    licenses.set(name, {
      name: dependency.name,
      version: dependency.version,
      license: dependency.license,
      source: dependency.source,
      files: entries.map((entry) =>
        path.relative(output, path.join(target, path.basename(entry))).split(path.sep).join('/')
      )
    })
  }
  await writeFile(
    path.join(output, 'licenses.json'),
    `${JSON.stringify(
      [...licenses.values()].sort((a, b) => a.name.localeCompare(b.name)),
      null,
      2
    )}\n`
  )
  const distributionPackage = {
    name: 'deepchat-headless',
    version: metadata.version,
    private: true,
    type: 'module',
    engines: { node: metadata.engines.node }
  }
  await writeFile(
    path.join(output, 'package.json'),
    `${JSON.stringify(distributionPackage, null, 2)}\n`
  )
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await buildHeadless()
}
