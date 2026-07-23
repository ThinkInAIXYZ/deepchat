#!/usr/bin/env node

import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const exactPackagePaths = new Set([
  'electron-builder.yml',
  'electron.vite.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'src/main/lib/runtimeHelper.ts',
  'src/main/lightOcrHelperEntry.ts'
])

const packagePrefixes = [
  '.github/actions/',
  '.github/workflows/',
  'build/',
  'plugins/',
  'resources/',
  'scripts/ci/',
  'src/main/ocr/'
]

const packageScriptPattern =
  /^scripts\/(?:afterPack\.js|apple-notarization\.js|build-cua-plugin-runtime\.mjs|compare-light-ocr-package-size\.mjs|fetch-(?:acp-registry|provider-db)\.mjs|generate-icon-collections\.mjs|install-runtime\.mjs|install-sharp-for-platform\.js|installVss\.js|notarize(?:-dmg)?\.js|package-plugin\.mjs|plugin\.mjs|sign-cua-helper\.mjs|smoke-(?:duckdb-vss|light-ocr|opendal-native)\.(?:js|mjs))$/

export function normalizeChangedPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error('Changed paths must be non-empty strings without NUL bytes')
  }
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '')
  if (
    path.posix.isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error(`Changed path escapes the repository: ${value}`)
  }
  return normalized
}

export function isPackageImpactPath(value) {
  const changedPath = normalizeChangedPath(value)
  return (
    exactPackagePaths.has(changedPath) ||
    packagePrefixes.some((prefix) => changedPath.startsWith(prefix)) ||
    packageScriptPattern.test(changedPath)
  )
}

export function classifyPackageImpact(paths) {
  const normalizedPaths = paths.map(normalizeChangedPath)
  const matchedPaths = normalizedPaths.filter(isPackageImpactPath)
  return {
    required: matchedPaths.length > 0,
    matchedPaths
  }
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)
    const [name, inlineValue] = argument.slice(2).split('=', 2)
    if (name !== 'github-output') throw new Error(`Unknown argument: --${name}`)
    const value = inlineValue ?? argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    options[name] = value
  }
  return options
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
  const result = classifyPackageImpact(changedPaths)
  if (options['github-output']) {
    await appendFile(
      options['github-output'],
      `required=${result.required}\nmatched=${JSON.stringify(result.matchedPaths)}\n`,
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
