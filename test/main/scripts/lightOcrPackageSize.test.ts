import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  compareInstallerDirectories,
  main,
  parsePackageSizeArgs,
  validateSizeBudgets
} from '../../../scripts/compare-light-ocr-package-size.mjs'

const baselineCommit = '2f6852b388e36e568859ee4845916b1d2f8d81f7'

describe('compare-light-ocr-package-size', () => {
  let tempDir: string
  let baselineDir: string
  let candidateDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-ocr-package-size-test-'))
    baselineDir = path.join(tempDir, 'baseline')
    candidateDir = path.join(tempDir, 'candidate')
    await Promise.all([
      mkdir(baselineDir, { recursive: true }),
      mkdir(candidateDir, { recursive: true })
    ])
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('parses strict comparison arguments', () => {
    expect(
      parsePackageSizeArgs([
        '--baseline-dir',
        '/baseline',
        '--candidate-dir=/candidate',
        '--platform',
        'darwin',
        '--arch',
        'arm64'
      ])
    ).toEqual({
      'baseline-dir': '/baseline',
      'candidate-dir': '/candidate',
      platform: 'darwin',
      arch: 'arm64'
    })
    expect(() => parsePackageSizeArgs(['--baseline-dir'])).toThrow(/Missing value/)
    expect(() => parsePackageSizeArgs(['--unknown=value'])).toThrow(/Unknown/)
  })

  it('requires pinned and non-negative target budgets', () => {
    expect(() =>
      validateSizeBudgets({
        schemaVersion: 1,
        baselineCommit,
        installerDeltaBudgetsMiB: { 'darwin-arm64': 90 }
      })
    ).not.toThrow()
    expect(() =>
      validateSizeBudgets({
        schemaVersion: 1,
        baselineCommit: 'HEAD',
        installerDeltaBudgetsMiB: { 'darwin-arm64': 90 }
      })
    ).toThrow(/Invalid/)
    expect(() =>
      validateSizeBudgets({
        schemaVersion: 1,
        baselineCommit,
        installerDeltaBudgetsMiB: { 'darwin-arm64': -1 }
      })
    ).toThrow(/Invalid/)
  })

  it('records exact installer bytes and the pinned baseline', async () => {
    await Promise.all([
      writeFile(path.join(baselineDir, 'DeepChat-1.0.0-mac-arm64.zip'), 'baseline'),
      writeFile(path.join(candidateDir, 'DeepChat-1.1.0-mac-arm64.zip'), 'candidate-growth')
    ])
    const report = await compareInstallerDirectories({
      baselineDir,
      candidateDir,
      platform: 'darwin',
      arch: 'arm64',
      candidateCommit: 'a'.repeat(40),
      budgets: {
        baselineCommit,
        installerDeltaBudgetsMiB: { 'darwin-arm64': 90 }
      }
    })

    expect(report).toMatchObject({
      baselineCommit,
      candidateCommit: 'a'.repeat(40),
      baseline: { artifact: 'DeepChat-1.0.0-mac-arm64.zip', bytes: 8 },
      candidate: { artifact: 'DeepChat-1.1.0-mac-arm64.zip', bytes: 16 },
      deltaBytes: 8,
      withinBudget: true
    })
  })

  it('fails closed for ambiguous artifacts and over-budget growth', async () => {
    await Promise.all([
      writeFile(path.join(baselineDir, 'DeepChat-1.0.0-linux-x64.tar.gz'), 'baseline'),
      writeFile(path.join(candidateDir, 'DeepChat-1.1.0-linux-x64.tar.gz'), '')
    ])
    await truncate(path.join(candidateDir, 'DeepChat-1.1.0-linux-x64.tar.gz'), 2 * 1024 * 1024)

    await expect(
      compareInstallerDirectories({
        baselineDir,
        candidateDir,
        platform: 'linux',
        arch: 'x64',
        budgets: {
          baselineCommit,
          installerDeltaBudgetsMiB: { 'linux-x64': 1 }
        }
      })
    ).rejects.toThrow(/exceeded/)

    await writeFile(path.join(candidateDir, 'DeepChat-1.2.0-linux-x64.tar.gz'), 'duplicate')
    await expect(
      compareInstallerDirectories({
        baselineDir,
        candidateDir,
        platform: 'linux',
        arch: 'x64',
        budgets: {
          baselineCommit,
          installerDeltaBudgetsMiB: { 'linux-x64': 115 }
        }
      })
    ).rejects.toThrow(/exactly one/)
  })

  it('persists over-budget measurements before failing the gate', async () => {
    const budgetsPath = path.join(tempDir, 'budgets.json')
    const reportPath = path.join(tempDir, 'report.json')
    await Promise.all([
      writeFile(path.join(baselineDir, 'DeepChat-1.0.0-linux-x64.tar.gz'), 'baseline'),
      writeFile(path.join(candidateDir, 'DeepChat-1.1.0-linux-x64.tar.gz'), ''),
      writeFile(
        budgetsPath,
        JSON.stringify({
          schemaVersion: 1,
          baselineCommit,
          installerDeltaBudgetsMiB: { 'linux-x64': 1 }
        })
      )
    ])
    await truncate(path.join(candidateDir, 'DeepChat-1.1.0-linux-x64.tar.gz'), 2 * 1024 * 1024)

    await expect(
      main([
        '--baseline-dir',
        baselineDir,
        '--candidate-dir',
        candidateDir,
        '--platform',
        'linux',
        '--arch',
        'x64',
        '--budgets-path',
        budgetsPath,
        '--report-path',
        reportPath
      ])
    ).rejects.toThrow(/exceeded/)
    await expect(readFile(reportPath, 'utf8')).resolves.toContain('"withinBudget": false')
  })
})
