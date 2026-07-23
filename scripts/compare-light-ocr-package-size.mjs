#!/usr/bin/env node

import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MIB = 1024 * 1024
const SHA_PATTERN = /^[a-f0-9]{40}$/
const SUPPORTED_TARGETS = new Map([
  ['darwin-arm64', { suffix: '-mac-arm64.zip' }],
  ['darwin-x64', { suffix: '-mac-x64.zip' }],
  ['linux-arm64', { suffix: '-linux-arm64.tar.gz' }],
  ['linux-x64', { suffix: '-linux-x64.tar.gz' }],
  ['win32-arm64', { suffix: '-windows-arm64.exe' }],
  ['win32-x64', { suffix: '-windows-x64.exe' }]
])

const VALUE_ARGS = new Set([
  'arch',
  'baseline-dir',
  'budgets-path',
  'candidate-dir',
  'candidate-commit',
  'platform',
  'report-path'
])

class InstallerSizeBudgetError extends Error {
  constructor(message, report) {
    super(message)
    this.report = report
  }
}

export function parsePackageSizeArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)

    const [key, inlineValue] = argument.slice(2).split('=', 2)
    if (!VALUE_ARGS.has(key)) throw new Error(`Unknown package-size option: --${key}`)
    let value = inlineValue
    if (value === undefined) {
      value = argv[index + 1]
      if (!value || value === '--' || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`)
      }
      index += 1
    }
    options[key] = value
  }
  return options
}

export function validateSizeBudgets(manifest) {
  if (manifest?.schemaVersion !== 1 || !SHA_PATTERN.test(manifest.baselineCommit ?? '')) {
    throw new Error('Invalid Light OCR package-size budget manifest')
  }
  if (!manifest.installerDeltaBudgetsMiB || typeof manifest.installerDeltaBudgetsMiB !== 'object') {
    throw new Error('Light OCR package-size budgets are missing installer delta limits')
  }
  for (const [target, limit] of Object.entries(manifest.installerDeltaBudgetsMiB)) {
    if (!SUPPORTED_TARGETS.has(target) || !Number.isFinite(limit) || limit < 0) {
      throw new Error(`Invalid installer delta budget for ${target}`)
    }
  }
  return manifest
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function findInstaller(directory, suffix, label) {
  const entries = await readdir(directory, { withFileTypes: true })
  const matches = entries.filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one *${suffix} artifact; found ${matches.length}`)
  }
  const artifactPath = path.join(directory, matches[0].name)
  const artifactStat = await lstat(artifactPath)
  if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
    throw new Error(`${label} installer must be a regular file`)
  }
  return {
    name: matches[0].name,
    path: artifactPath,
    bytes: artifactStat.size
  }
}

export async function compareInstallerDirectories({
  baselineDir,
  candidateDir,
  platform,
  arch,
  budgets,
  candidateCommit = null
}) {
  const target = `${platform}-${arch}`
  const targetDefinition = SUPPORTED_TARGETS.get(target)
  const deltaLimitMiB = budgets.installerDeltaBudgetsMiB[target]
  if (!targetDefinition || !Number.isFinite(deltaLimitMiB)) {
    throw new Error(`No Light OCR installer-size contract exists for ${target}`)
  }
  if (candidateCommit !== null && !SHA_PATTERN.test(candidateCommit)) {
    throw new Error('Candidate commit must be a full Git SHA')
  }

  const [baseline, candidate] = await Promise.all([
    findInstaller(path.resolve(baselineDir), targetDefinition.suffix, 'Baseline directory'),
    findInstaller(path.resolve(candidateDir), targetDefinition.suffix, 'Candidate directory')
  ])
  if ((await realpath(baseline.path)) === (await realpath(candidate.path))) {
    throw new Error('Baseline and candidate installers must be different files')
  }

  const deltaBytes = candidate.bytes - baseline.bytes
  const deltaLimitBytes = deltaLimitMiB * MIB
  const report = {
    schemaVersion: 1,
    target: { platform, arch },
    baselineCommit: budgets.baselineCommit,
    candidateCommit,
    baseline: { artifact: baseline.name, bytes: baseline.bytes },
    candidate: { artifact: candidate.name, bytes: candidate.bytes },
    deltaBytes,
    deltaLimitBytes,
    withinBudget: deltaBytes <= deltaLimitBytes
  }
  if (!report.withinBudget) {
    throw new InstallerSizeBudgetError(
      `Light OCR installer growth exceeded for ${target}: ${deltaBytes} > ${deltaLimitBytes}`,
      report
    )
  }
  return report
}

export async function main(argv = process.argv.slice(2)) {
  const args = parsePackageSizeArgs(argv)
  for (const required of ['baseline-dir', 'candidate-dir', 'platform', 'arch', 'report-path']) {
    if (!args[required]) throw new Error(`--${required} is required`)
  }

  const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const budgetsPath = path.resolve(
    args['budgets-path'] ?? path.join(projectDir, 'resources', 'light-ocr-size-budgets.json')
  )
  const budgets = validateSizeBudgets(await readJson(budgetsPath))
  const reportPath = path.resolve(args['report-path'])
  let report
  try {
    report = await compareInstallerDirectories({
      baselineDir: args['baseline-dir'],
      candidateDir: args['candidate-dir'],
      platform: args.platform,
      arch: args.arch,
      budgets,
      candidateCommit: args['candidate-commit'] ?? null
    })
  } catch (error) {
    if (error instanceof InstallerSizeBudgetError) {
      await mkdir(path.dirname(reportPath), { recursive: true })
      await writeFile(reportPath, `${JSON.stringify(error.report, null, 2)}\n`, 'utf8')
    }
    throw error
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`[Light OCR Package Size] ${JSON.stringify(report)}`)
  return report
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      '[Light OCR Package Size] failed:',
      error instanceof Error ? error.message : error
    )
    process.exitCode = 1
  })
}
