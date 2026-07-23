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

const baselineCommit = '86aa66e8788db604877c17255259283b535cecd0'

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

  it('pins Linux installer and runtime budgets for both architectures', async () => {
    const budgets = JSON.parse(
      await readFile(path.resolve('resources/light-ocr-size-budgets.json'), 'utf8')
    ) as {
      baselineCommit: string
      componentBudgetsMiB: {
        otherRuntimeCompressedByTarget: Record<string, number>
      }
      installerDeltaBudgetsMiB: Record<string, number>
    }

    expect(budgets.baselineCommit).toBe(baselineCommit)
    expect(budgets.componentBudgetsMiB.otherRuntimeCompressedByTarget).toMatchObject({
      'linux-arm64': 32,
      'linux-x64': 32
    })
    expect(budgets.installerDeltaBudgetsMiB).toMatchObject({
      'linux-arm64': 90,
      'linux-x64': 90
    })
  })

  it('signs only the macOS baseline CUA plugin before packaging', async () => {
    const action = await readFile(
      path.resolve('.github/actions/light-ocr-package-size/action.yml'),
      'utf8'
    )
    const applicationStep = action.match(
      /- name: Build baseline application(?<step>[\s\S]*?)- name: Bundle baseline CUA plugin/
    )?.groups?.step
    const cuaStep = action.match(
      /- name: Bundle baseline CUA plugin(?<step>[\s\S]*?)- name: Bundle baseline Feishu plugin/
    )?.groups?.step
    const feishuStep = action.match(
      /- name: Bundle baseline Feishu plugin(?<step>[\s\S]*?)- name: Package baseline installer/
    )?.groups?.step

    expect(applicationStep).toBeDefined()
    expect(applicationStep).not.toContain('CSC_LINK:')
    expect(applicationStep).not.toContain('CSC_KEY_PASSWORD:')
    expect(cuaStep).toBeDefined()
    expect(cuaStep).toContain('CSC_LINK: ${{ inputs.csc-link }}')
    expect(cuaStep).toContain('CSC_KEY_PASSWORD: ${{ inputs.csc-key-password }}')
    expect(cuaStep).toContain(
      "build_for_release: ${{ inputs.platform == 'darwin' && '2' || '' }}"
    )
    expect(cuaStep?.indexOf('build_for_release:')).toBeLessThan(
      cuaStep?.indexOf('pnpm --dir .ocr-size-base run plugin:bundle') ?? -1
    )
    expect(feishuStep).toBeDefined()
    expect(feishuStep).not.toContain('CSC_LINK:')
    expect(feishuStep).not.toContain('CSC_KEY_PASSWORD:')
  })

  it('installs baseline runtimes and skips CUA only for Linux arm64', async () => {
    const action = await readFile(
      path.resolve('.github/actions/light-ocr-package-size/action.yml'),
      'utf8'
    )
    const runtimeStep = action.match(
      /- name: Install baseline bundled runtimes(?<step>[\s\S]*?)- name: Build baseline application/
    )?.groups?.step
    const cuaStep = action.match(
      /- name: Bundle baseline CUA plugin(?<step>[\s\S]*?)- name: Bundle baseline Feishu plugin/
    )?.groups?.step

    expect(runtimeStep).toBeDefined()
    expect(runtimeStep).not.toContain("if: inputs.platform != 'linux'")
    expect(runtimeStep).toContain('--root-dir .ocr-size-base')
    expect(cuaStep).toContain("if: inputs.platform != 'linux' || inputs.arch != 'arm64'")
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

  it('compares Windows arm64 installers against their target budget', async () => {
    await Promise.all([
      writeFile(path.join(baselineDir, 'DeepChat-1.0.0-windows-arm64.exe'), 'baseline'),
      writeFile(path.join(candidateDir, 'DeepChat-1.1.0-windows-arm64.exe'), 'candidate-growth')
    ])

    await expect(
      compareInstallerDirectories({
        baselineDir,
        candidateDir,
        platform: 'win32',
        arch: 'arm64',
        budgets: {
          baselineCommit,
          installerDeltaBudgetsMiB: { 'win32-arm64': 90 }
        }
      })
    ).resolves.toMatchObject({
      target: { platform: 'win32', arch: 'arm64' },
      baseline: { artifact: 'DeepChat-1.0.0-windows-arm64.exe' },
      candidate: { artifact: 'DeepChat-1.1.0-windows-arm64.exe' },
      withinBudget: true
    })
  })

  it('compares Linux arm64 archives against their target budget', async () => {
    await Promise.all([
      writeFile(path.join(baselineDir, 'DeepChat-1.0.0-linux-arm64.tar.gz'), 'baseline'),
      writeFile(path.join(candidateDir, 'DeepChat-1.1.0-linux-arm64.tar.gz'), 'candidate-growth')
    ])

    await expect(
      compareInstallerDirectories({
        baselineDir,
        candidateDir,
        platform: 'linux',
        arch: 'arm64',
        budgets: {
          baselineCommit,
          installerDeltaBudgetsMiB: { 'linux-arm64': 90 }
        }
      })
    ).resolves.toMatchObject({
      target: { platform: 'linux', arch: 'arm64' },
      baseline: { artifact: 'DeepChat-1.0.0-linux-arm64.tar.gz' },
      candidate: { artifact: 'DeepChat-1.1.0-linux-arm64.tar.gz' },
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
