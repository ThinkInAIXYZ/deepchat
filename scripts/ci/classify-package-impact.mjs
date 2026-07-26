#!/usr/bin/env node

import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

export const PACKAGE_IMPACT_PLATFORMS = Object.freeze(['windows', 'linux', 'macos'])

const allPlatforms = PACKAGE_IMPACT_PLATFORMS

const sharedPackagePaths = new Set([
  '.github/workflows/package-check.yml',
  'electron-builder.yml',
  'electron.vite.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'resources/light-ocr-size-budgets.json',
  'resources/package-size-baseline.json',
  'resources/package-size-policy.json',
  'resources/runtime-versions.json',
  'scripts/afterPack.js',
  'scripts/build-cua-plugin-runtime.mjs',
  'scripts/compare-light-ocr-package-size.mjs',
  'scripts/install-runtime.mjs',
  'scripts/install-sharp-for-platform.js',
  'scripts/installVss.js',
  'scripts/package-plugin.mjs',
  'scripts/plugin.mjs',
  'scripts/smoke-duckdb-vss.js',
  'scripts/smoke-light-ocr.js',
  'scripts/smoke-opendal-native.js',
  'scripts/ci/check-package-size.mjs',
  'scripts/ci/classify-package-impact.mjs',
  'scripts/ci/package-contract.mjs',
  'scripts/ci/package-files.mjs',
  'scripts/ci/package-manifest.mjs',
  'src/main/lib/runtimeHelper.ts',
  'src/main/lightOcrHelperEntry.ts',
  'src/main/ocr/lightOcrHelper.ts',
  'src/main/ocr/lightOcrProtocol.ts'
])

const windowsPackagePaths = new Set([
  '.github/workflows/_package-windows.yml',
  'build/icon.ico',
  'build/nsis-installer.nsh',
  'resources/icon.ico',
  'resources/win_tray.ico'
])

const linuxPackagePaths = new Set([
  '.github/workflows/_package-linux.yml',
  'build/icon.png',
  'resources/linux_tray.png'
])

const macosPackagePaths = new Set([
  '.github/workflows/_package-macos.yml',
  'build/dmg-background.png',
  'build/dmg-background@2x.png',
  'build/entitlements.mac.plist',
  'build/icon.icns',
  'resources/macTrayTemplate.png',
  'scripts/apple-notarization.js',
  'scripts/macos-release-contract.mjs',
  'scripts/notarize-dmg.js',
  'scripts/notarize.js',
  'scripts/cua-macos-contract.mjs',
  'scripts/ci/verify-cua-macos-helper.mjs',
  'scripts/sign-cua-helper.mjs'
])

const packageImpactRules = Object.freeze([
  {
    id: 'shared-package-contract',
    platforms: allPlatforms,
    matches: (changedPath) =>
      sharedPackagePaths.has(changedPath) ||
      changedPath.startsWith('.github/actions/light-ocr-package-size/') ||
      changedPath.startsWith('plugins/')
  },
  {
    id: 'windows-package-input',
    platforms: ['windows'],
    matches: (changedPath) => windowsPackagePaths.has(changedPath)
  },
  {
    id: 'linux-package-input',
    platforms: ['linux'],
    matches: (changedPath) => linuxPackagePaths.has(changedPath)
  },
  {
    id: 'macos-package-input',
    platforms: ['macos'],
    matches: (changedPath) => macosPackagePaths.has(changedPath)
  },
  {
    id: 'desktop-runtime-icon',
    platforms: ['linux', 'macos'],
    matches: (changedPath) => changedPath === 'resources/icon.png'
  }
])

const packageJsonContractFields = Object.freeze([
  'name',
  'version',
  'description',
  'author',
  'license',
  'homepage',
  'repository',
  'main',
  'type',
  'packageManager',
  'os',
  'cpu',
  'files',
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'bundledDependencies',
  'bundleDependencies',
  'pnpm',
  'build'
])

const packagingScriptNames = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prebuild',
  'build',
  'postbuild',
  'install:sharp',
  'afterSign'
])

function findPackageImpactRule(changedPath) {
  return packageImpactRules.find(({ matches }) => matches(changedPath)) ?? null
}

function validatePackageJson(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value
}

function objectField(manifest, field, label) {
  const value = manifest[field]
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} ${field} must be a JSON object`)
  }
  return value
}

function isPackagingScript(name) {
  return (
    packagingScriptNames.has(name) ||
    name.startsWith('build:') ||
    name.startsWith('installRuntime:') ||
    name.startsWith('plugin:') ||
    name.startsWith('smoke:')
  )
}

function isPackagingDevDependency(name) {
  return (
    name === 'app-builder-bin' ||
    name === 'dmg-builder' ||
    name === '7zip-bin' ||
    name === 'electron' ||
    name.startsWith('electron-') ||
    name.startsWith('@electron/')
  )
}

function changedSelectedKeys(baseValues, headValues, predicate) {
  const keys = new Set([...Object.keys(baseValues), ...Object.keys(headValues)])
  return [...keys]
    .filter(predicate)
    .filter((key) => !isDeepStrictEqual(baseValues[key], headValues[key]))
    .sort()
}

export function classifyPackageJsonImpact(baseValue, headValue) {
  const base = validatePackageJson(baseValue, 'Base package.json')
  const head = validatePackageJson(headValue, 'Head package.json')
  const changedFields = packageJsonContractFields.filter(
    (field) => !isDeepStrictEqual(base[field], head[field])
  )
  const changedScripts = changedSelectedKeys(
    objectField(base, 'scripts', 'Base package.json'),
    objectField(head, 'scripts', 'Head package.json'),
    isPackagingScript
  )
  const changedDevDependencies = changedSelectedKeys(
    objectField(base, 'devDependencies', 'Base package.json'),
    objectField(head, 'devDependencies', 'Head package.json'),
    isPackagingDevDependency
  )
  return {
    required:
      changedFields.length > 0 ||
      changedScripts.length > 0 ||
      changedDevDependencies.length > 0,
    changedFields,
    changedScripts,
    changedDevDependencies
  }
}

export function normalizeChangedPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error('Changed paths must be non-empty strings without NUL bytes')
  }
  const normalized = value.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '')
  const segments = normalized.split('/')
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    path.posix.isAbsolute(normalized) ||
    segments.includes('..')
  ) {
    throw new Error(`Changed path escapes the repository: ${value}`)
  }
  if (segments.some((segment) => segment.length === 0 || segment === '.')) {
    throw new Error(`Changed path is not canonical: ${value}`)
  }
  return normalized
}

export function getPackageImpactRule(value) {
  const changedPath = normalizeChangedPath(value)
  return findPackageImpactRule(changedPath)
}

export function isPackageImpactPath(value) {
  return getPackageImpactRule(value) !== null
}

export function classifyPackageImpact(paths, options = {}) {
  const normalizedPaths = [...new Set(paths.map(normalizeChangedPath))]
  const impact = Object.fromEntries(
    PACKAGE_IMPACT_PLATFORMS.map((platform) => [platform, false])
  )
  const matches = []
  for (const changedPath of normalizedPaths) {
    if (changedPath === 'package.json') {
      if (!options.basePackageJson || !options.headPackageJson) {
        throw new Error('package.json classification requires base and head snapshots')
      }
      const packageJsonImpact = classifyPackageJsonImpact(
        options.basePackageJson,
        options.headPackageJson
      )
      if (packageJsonImpact.required) {
        for (const platform of allPlatforms) impact[platform] = true
        matches.push({
          path: changedPath,
          rule: 'package-json-package-contract',
          platforms: [...allPlatforms],
          details: packageJsonImpact
        })
      }
      continue
    }
    const rule = findPackageImpactRule(changedPath)
    if (!rule) continue
    for (const platform of rule.platforms) impact[platform] = true
    matches.push({
      path: changedPath,
      rule: rule.id,
      platforms: [...rule.platforms]
    })
  }
  const matchedPaths = matches.map(({ path: changedPath }) => changedPath)
  return {
    required: matchedPaths.length > 0,
    windows: impact.windows,
    linux: impact.linux,
    macos: impact.macos,
    matchedPaths,
    matches
  }
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)
    const [name, inlineValue] = argument.slice(2).split('=', 2)
    if (!['github-output', 'base-package-json', 'head-package-json'].includes(name)) {
      throw new Error(`Unknown argument: --${name}`)
    }
    const value = inlineValue ?? argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    options[name] = value
  }
  return options
}

async function readPackageJsonSnapshot(filePath, label) {
  try {
    return validatePackageJson(JSON.parse(await readFile(filePath, 'utf8')), label)
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${filePath}`, { cause: error })
  }
}

export async function main(argv = process.argv.slice(2), stdin = process.stdin) {
  const options = parseArguments(argv)
  const chunks = []
  for await (const chunk of stdin) chunks.push(chunk)
  const input = Buffer.concat(chunks).toString('utf8')
  if (input.length > 0 && !input.endsWith('\0')) {
    throw new Error('Changed paths must be NUL-delimited and end with a NUL byte')
  }
  const changedPaths = input.split('\0').filter(Boolean)
  const packageJsonChanged = changedPaths
    .map(normalizeChangedPath)
    .includes('package.json')
  if (
    packageJsonChanged &&
    (!options['base-package-json'] || !options['head-package-json'])
  ) {
    throw new Error('package.json diff requires base and head snapshot paths')
  }
  const result = classifyPackageImpact(changedPaths, {
    basePackageJson: packageJsonChanged
      ? await readPackageJsonSnapshot(options['base-package-json'], 'base package.json')
      : undefined,
    headPackageJson: packageJsonChanged
      ? await readPackageJsonSnapshot(options['head-package-json'], 'head package.json')
      : undefined
  })
  if (options['github-output']) {
    await appendFile(
      options['github-output'],
      [
        `required=${result.required}`,
        `windows=${result.windows}`,
        `linux=${result.linux}`,
        `macos=${result.macos}`,
        `matched=${JSON.stringify(result.matchedPaths)}`
      ].join('\n') + '\n',
      'utf8'
    )
  }
  console.log(JSON.stringify(result))
  return result
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      '[Package Impact] failed:',
      error instanceof Error ? error.message : error
    )
    process.exitCode = 1
  })
}
