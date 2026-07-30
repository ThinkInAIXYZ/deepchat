import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { assertBaselineOutputSafety } from '../../../scripts/generate-architecture-baseline.mjs'

const ROOT = process.cwd()
const CANONICAL_OUTPUT = path.join(ROOT, 'docs/architecture/baselines')
const CANONICAL_AGENT_BASELINE = path.join(
  CANONICAL_OUTPUT,
  'agent-system-layered-runtime-baseline.json'
)

type GeneratedAgentBaseline = {
  schemaVersion: number
  expectedFiles: Record<string, boolean>
  ownerEvidence: Record<string, { declarationCount: number }>
  retiredSurfaces: {
    paths: Record<string, number>
    symbols: Record<string, number>
  }
  dependencyMetrics: Record<string, number | string[]>
}

async function snapshotOutput(outputDir: string): Promise<Record<string, string>> {
  const files = (await readdir(outputDir)).sort()
  return Object.fromEntries(
    await Promise.all(files.map(async (file) => [file, await readFile(path.join(outputDir, file), 'utf8')]))
  )
}

function runGenerator(outputDir: string) {
  return spawnSync(
    process.execPath,
    ['scripts/generate-architecture-baseline.mjs', '--output-dir', outputDir],
    { cwd: ROOT, encoding: 'utf8' }
  )
}

describe('architecture baseline generator', () => {
  it('writes deterministic current-owner evidence only to the requested temp output', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'deepchat-architecture-baseline-'))
    const canonicalBefore = await readFile(CANONICAL_AGENT_BASELINE, 'utf8')

    try {
      const first = runGenerator(outputDir)
      expect(first.status, first.stderr).toBe(0)
      const firstSnapshot = await snapshotOutput(outputDir)

      const second = runGenerator(outputDir)
      expect(second.status, second.stderr).toBe(0)
      expect(await snapshotOutput(outputDir)).toEqual(firstSnapshot)
      expect(await readFile(CANONICAL_AGENT_BASELINE, 'utf8')).toBe(canonicalBefore)
      expect(firstSnapshot['dependency-report.md']).toContain('## renderer-shared')
      expect(firstSnapshot['dependency-report.md']).toContain(
        'notifications/notificationManager.ts'
      )
      expect(firstSnapshot['zero-inbound-candidates.md']).toContain('## renderer-shared')

      const baseline = JSON.parse(
        firstSnapshot['agent-system-layered-runtime-baseline.json']
      ) as GeneratedAgentBaseline
      expect(baseline.schemaVersion).toBe(2)
      expect(Object.values(baseline.expectedFiles)).not.toContain(false)
      expect(
        Object.values(baseline.ownerEvidence).map(
          (evidence) => evidence.declarationCount
        )
      ).not.toContain(0)
      expect(new Set(Object.values(baseline.retiredSurfaces.paths))).toEqual(new Set([0]))
      expect(new Set(Object.values(baseline.retiredSurfaces.symbols))).toEqual(new Set([0]))
      expect(baseline.dependencyMetrics).toMatchObject({
        loopToPresenter: 0,
        loopToSqlite: 0,
        loopToElectron: 0,
        loopToRoutes: 0,
        loopToAcp: 0
      })
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  })

  it('refuses canonical output from a dirty relevant tree but permits temp output', () => {
    expect(() => assertBaselineOutputSafety(CANONICAL_OUTPUT, ['src/main/agent/manager/example.ts']))
      .toThrow('Refusing to update canonical architecture baselines')
    expect(() => assertBaselineOutputSafety(path.join(tmpdir(), 'baseline-output'), ['dirty.ts']))
      .not.toThrow()
  })
})
