#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_RUNTIME_TYPES = ['uv', 'node', 'ripgrep', 'rtk']
const DEFAULT_UV_VERSION = '0.9.18'

function parseList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function parseArgs(argv) {
  const options = {
    arch: process.arch,
    platform: process.platform,
    rootDir: './runtime',
    runtimes: DEFAULT_RUNTIME_TYPES,
    bestEffort: false,
    uvVersion: DEFAULT_UV_VERSION,
    summaryPath: null
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      index += 1
      if (index >= argv.length) {
        throw new Error(`Missing value for ${arg}`)
      }
      return argv[index]
    }

    switch (arg) {
      case '--arch':
      case '-a':
        options.arch = next()
        break
      case '--platform':
      case '-p':
        options.platform = next()
        break
      case '--root-dir':
        options.rootDir = next()
        break
      case '--types':
        options.runtimes = parseList(next())
        break
      case '--best-effort':
      case '--optional':
        options.bestEffort = true
        break
      case '--uv-version':
        options.uvVersion = next()
        break
      case '--summary':
        options.summaryPath = next()
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

export function buildRuntimeCommand({ type, rootDir, arch, platform, uvVersion }) {
  const args = ['-y', 'tiny-runtime-injector', '--type', type, '--dir', resolve(rootDir, type)]

  if (type === 'uv') {
    args.push('--runtime-version', uvVersion)
  }

  if (arch) {
    args.push('-a', arch)
  }

  if (platform) {
    args.push('-p', platform)
  }

  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args
  }
}

function runCommand(command, args, env = process.env) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env
    })

    child.on('error', (error) => {
      resolveRun({
        exitCode: 1,
        signal: null,
        error: error.message
      })
    })

    child.on('close', (exitCode, signal) => {
      resolveRun({
        exitCode: exitCode ?? (signal ? 1 : 0),
        signal,
        error: null
      })
    })
  })
}

async function ensureDir(target) {
  await mkdir(target, { recursive: true })
}

async function writeSummary(targetPath, summary) {
  if (!targetPath) {
    return
  }

  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
}

export async function installRuntimes(options) {
  const {
    arch,
    platform,
    rootDir,
    runtimes,
    bestEffort,
    uvVersion,
    summaryPath,
    runCommand: run = runCommand,
    ensureDir: ensureTargetDir = ensureDir,
    writeSummary: persistSummary = writeSummary
  } = options

  await ensureTargetDir(rootDir)

  const summary = {
    platform,
    arch,
    bestEffort,
    generatedAt: new Date().toISOString(),
    runtimes: []
  }
  let exitCode = 0

  for (const type of runtimes) {
    const { command, args } = buildRuntimeCommand({
      type,
      rootDir,
      arch,
      platform,
      uvVersion
    })
    const startedAt = new Date().toISOString()

    console.log(`[runtime] Installing ${type} for ${platform}-${arch}`)
    const result = await run(command, args)
    const status =
      result.exitCode === 0 ? 'installed' : bestEffort ? 'skipped' : 'failed'

    summary.runtimes.push({
      type,
      status,
      exitCode: result.exitCode,
      signal: result.signal,
      error: result.error,
      command: [command, ...args].join(' '),
      startedAt,
      finishedAt: new Date().toISOString()
    })

    if (status === 'installed') {
      console.log(`[runtime] Installed ${type}`)
      continue
    }

    if (bestEffort) {
      console.warn(`[runtime] Skipped optional ${type} for ${platform}-${arch}`)
      continue
    }

    exitCode = result.exitCode || 1
    console.error(`[runtime] Failed to install ${type}`)
    break
  }

  await persistSummary(summaryPath, summary)
  return {
    exitCode,
    summary
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { exitCode, summary } = await installRuntimes(options)

  const installed = summary.runtimes.filter((item) => item.status === 'installed').length
  const skipped = summary.runtimes.filter((item) => item.status === 'skipped').length
  const failed = summary.runtimes.filter((item) => item.status === 'failed').length

  console.log(
    `[runtime] Summary for ${summary.platform}-${summary.arch}: installed=${installed}, skipped=${skipped}, failed=${failed}`
  )

  process.exitCode = exitCode
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : ''

if (currentFile === invokedFile) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
