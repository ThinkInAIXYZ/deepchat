#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SMOKE_CONTENT = Buffer.from('deepchat-opendal-smoke')
const REQUIRED_CONSTRUCTORS = ['Operator', 'RetryLayer', 'TimeoutLayer']

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

function packageMatches(packageDir, packageName, expectedVersion) {
  const packageJsonPath = path.join(packageDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return false
  if (!expectedVersion) return true

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  return packageJson.name === packageName && packageJson.version === expectedVersion
}

function resolvePackageDirFromNodeModules(nodeModulesDir, packageName, expectedVersion) {
  const directDir = path.join(nodeModulesDir, ...packagePathParts(packageName))
  if (packageMatches(directDir, packageName, expectedVersion)) {
    return fs.realpathSync(directDir)
  }

  const pnpmNodeModulesDir = path.join(nodeModulesDir, '.pnpm', 'node_modules', ...packagePathParts(packageName))
  if (packageMatches(pnpmNodeModulesDir, packageName, expectedVersion)) {
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
      if (packageMatches(candidate, packageName, expectedVersion)) {
        return fs.realpathSync(candidate)
      }
    }
  }

  const versionSuffix = expectedVersion ? `@${expectedVersion}` : ''
  throw new Error(`OpenDAL package ${packageName}${versionSuffix} not found under ${nodeModulesDir}`)
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

async function maybeLoadOpendal(opendalDir, platform, arch, label) {
  if (platform !== process.platform || arch !== process.arch) {
    console.log(
      `[OpenDAL Smoke] ${label}: target ${platform}/${arch} differs from host ${process.platform}/${process.arch}; verified file presence only.`
    )
    return
  }

  const opendalEntry = path.join(opendalDir, 'index.mjs')
  if (!fs.existsSync(opendalEntry)) {
    throw new Error(`${label} OpenDAL ESM entry not found at ${opendalEntry}`)
  }

  const opendal = await import(pathToFileURL(opendalEntry).href)
  for (const exportName of REQUIRED_CONSTRUCTORS) {
    if (typeof opendal[exportName] !== 'function') {
      throw new Error(`${label} OpenDAL export ${exportName} is not a constructor`)
    }
  }

  const memory = new opendal.Operator('memory')
  const timeout = new opendal.TimeoutLayer()
  timeout.timeout = 5_000
  timeout.ioTimeout = 5_000
  memory.layer(timeout.build())

  const retry = new opendal.RetryLayer()
  retry.maxTimes = 1
  retry.jitter = true
  memory.layer(retry.build())

  await memory.write('smoke.txt', SMOKE_CONTENT)
  const content = Buffer.from(await memory.read('smoke.txt'))
  if (!content.equals(SMOKE_CONTENT)) {
    throw new Error(`${label} OpenDAL memory round trip returned unexpected content`)
  }

  new opendal.Operator('s3', {
    root: '/',
    endpoint: 'https://example.invalid',
    bucket: 'deepchat-smoke',
    region: 'auto',
    access_key_id: 'smoke',
    secret_access_key: 'smoke',
    enable_exact_buf_write: 'true'
  })

  console.log(`[OpenDAL Smoke] ${label}: exercised ESM runtime from ${opendalEntry}`)
}

async function smokeNodeModules({ nodeModulesDir, platform, arch, label }) {
  const nativePackageName = getOpendalNativePackage(platform, arch)
  const opendalDir = resolvePackageDirFromNodeModules(nodeModulesDir, 'opendal')
  const opendalPackageJson = JSON.parse(
    fs.readFileSync(path.join(opendalDir, 'package.json'), 'utf8')
  )
  if (opendalPackageJson.name !== 'opendal' || typeof opendalPackageJson.version !== 'string') {
    throw new Error(`Invalid ${label} OpenDAL package identity at ${opendalDir}`)
  }
  const nativePackageDir = resolvePackageDirFromNodeModules(
    nodeModulesDir,
    nativePackageName,
    opendalPackageJson.version
  )
  const nativeEntry = assertPackageMainExists(nativePackageDir, `${label} ${nativePackageName}`)

  console.log(`[OpenDAL Smoke] ${label}: found ${nativePackageName} at ${nativePackageDir}`)
  console.log(`[OpenDAL Smoke] ${label}: native entry ${nativeEntry}`)
  await maybeLoadOpendal(opendalDir, platform, arch, label)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const platform = args.platform ? normalizePlatform(args.platform) : process.platform
  const arch = args.arch ? normalizeArch(args.arch) : process.arch
  const projectDir = path.resolve(args.projectDir ?? args['project-dir'] ?? process.cwd())
  const resourcesPath = args.resourcesPath ?? args['resources-path']

  await smokeNodeModules({
    nodeModulesDir: path.join(projectDir, 'node_modules'),
    platform,
    arch,
    label: 'source'
  })

  if (resourcesPath) {
    await smokeNodeModules({
      nodeModulesDir: path.join(path.resolve(resourcesPath), 'app.asar.unpacked', 'node_modules'),
      platform,
      arch,
      label: 'packaged'
    })
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error('[OpenDAL Smoke] failed:', error)
    process.exit(1)
  })
}
