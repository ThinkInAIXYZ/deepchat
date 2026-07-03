#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (!arg.startsWith('--')) continue
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    let value = inlineValue
    if (value === undefined) {
      const next = argv[index + 1]
      if (next === undefined || next === '--' || next.startsWith('--')) {
        throw new Error(`Missing value for --${rawKey}`)
      }
      value = next
      index += 1
    }
    options[rawKey] = value
  }
  return options
}

function normalizePlatform(value) {
  switch (value) {
    case 'darwin':
    case 'mac':
    case 'macos':
    case 'osx':
      return 'darwin'
    case 'win32':
    case 'windows':
    case 'win':
      return 'win32'
    case 'linux':
      return 'linux'
    default:
      throw new Error(`Unsupported OpenDAL platform: ${value}`)
  }
}

function normalizeArch(value) {
  switch (value) {
    case 'x64':
    case 'amd64':
      return 'x64'
    case 'arm64':
    case 'aarch64':
      return 'arm64'
    default:
      throw new Error(`Unsupported OpenDAL architecture: ${value}`)
  }
}

function getOpendalNativePackage(platform, arch) {
  switch (`${platform}:${arch}`) {
    case 'darwin:x64':
      return '@opendal/lib-darwin-x64'
    case 'darwin:arm64':
      return '@opendal/lib-darwin-arm64'
    case 'win32:x64':
      return '@opendal/lib-win32-x64-msvc'
    case 'win32:arm64':
      return '@opendal/lib-win32-arm64-msvc'
    case 'linux:x64':
      return '@opendal/lib-linux-x64-gnu'
    case 'linux:arm64':
      return '@opendal/lib-linux-arm64-gnu'
    default:
      throw new Error(`Unsupported OpenDAL target: ${platform}/${arch}`)
  }
}

function packagePathParts(packageName) {
  return packageName.split('/')
}

function resolvePackageDirFromNodeModules(nodeModulesDir, packageName) {
  const directDir = path.join(nodeModulesDir, ...packagePathParts(packageName))
  if (fs.existsSync(path.join(directDir, 'package.json'))) {
    return fs.realpathSync(directDir)
  }

  const pnpmNodeModulesDir = path.join(nodeModulesDir, '.pnpm', 'node_modules', ...packagePathParts(packageName))
  if (fs.existsSync(path.join(pnpmNodeModulesDir, 'package.json'))) {
    return fs.realpathSync(pnpmNodeModulesDir)
  }

  const pnpmVirtualStoreDir = path.join(nodeModulesDir, '.pnpm')
  if (fs.existsSync(pnpmVirtualStoreDir)) {
    for (const entry of fs.readdirSync(pnpmVirtualStoreDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(
        pnpmVirtualStoreDir,
        entry.name,
        'node_modules',
        ...packagePathParts(packageName)
      )
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        return fs.realpathSync(candidate)
      }
    }
  }

  throw new Error(`OpenDAL package ${packageName} not found under ${nodeModulesDir}`)
}

function assertPackageMainExists(packageDir, label) {
  const packageJsonPath = path.join(packageDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`${label} package.json not found at ${packageJsonPath}`)
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  if (!packageJson.main) {
    throw new Error(`${label} package.json has no main field at ${packageJsonPath}`)
  }

  const mainPath = path.join(packageDir, packageJson.main)
  if (!fs.existsSync(mainPath)) {
    throw new Error(`${label} native entry not found at ${mainPath}`)
  }
  return mainPath
}

function maybeLoadOpendal(opendalDir, platform, arch, label) {
  if (platform !== process.platform || arch !== process.arch) {
    console.log(
      `[OpenDAL Smoke] ${label}: target ${platform}/${arch} differs from host ${process.platform}/${process.arch}; verified file presence only.`
    )
    return
  }

  const opendalEntry = path.join(opendalDir, 'index.cjs')
  const requireFromOpendal = createRequire(opendalEntry)
  requireFromOpendal(opendalEntry)
  console.log(`[OpenDAL Smoke] ${label}: loaded opendal from ${opendalEntry}`)
}

function smokeNodeModules({ nodeModulesDir, platform, arch, label }) {
  const nativePackageName = getOpendalNativePackage(platform, arch)
  const opendalDir = resolvePackageDirFromNodeModules(nodeModulesDir, 'opendal')
  const nativePackageDir = resolvePackageDirFromNodeModules(nodeModulesDir, nativePackageName)
  const nativeEntry = assertPackageMainExists(nativePackageDir, `${label} ${nativePackageName}`)

  console.log(`[OpenDAL Smoke] ${label}: found ${nativePackageName} at ${nativePackageDir}`)
  console.log(`[OpenDAL Smoke] ${label}: native entry ${nativeEntry}`)
  maybeLoadOpendal(opendalDir, platform, arch, label)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const platform = args.platform ? normalizePlatform(args.platform) : process.platform
  const arch = args.arch ? normalizeArch(args.arch) : process.arch
  const projectDir = path.resolve(args.projectDir ?? args['project-dir'] ?? process.cwd())
  const resourcesPath = args.resourcesPath ?? args['resources-path']

  smokeNodeModules({
    nodeModulesDir: path.join(projectDir, 'node_modules'),
    platform,
    arch,
    label: 'source'
  })

  if (resourcesPath) {
    smokeNodeModules({
      nodeModulesDir: path.join(path.resolve(resourcesPath), 'app.asar.unpacked', 'node_modules'),
      platform,
      arch,
      label: 'packaged'
    })
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error('[OpenDAL Smoke] failed:', error)
    process.exit(1)
  }
}
