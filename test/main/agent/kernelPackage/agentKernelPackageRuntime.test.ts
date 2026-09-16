import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// This gate performs real filesystem work (mkdtemp workspace, artifact copy, declaration scan);
// the repo-wide test setup mocks `fs`/`path` for main-process suites, so unmock them here.
vi.unmock('fs')
vi.unmock('path')

/**
 * Stage 2B clean-Node gate for the @deepchat/agent-kernel workspace package.
 *
 * Proves the plan.md Stage 2B acceptance items against the real built artifact — never the
 * in-tree sources or a vitest alias pass:
 * - the package builds with an alias-free, forbidden-import-free emitted closure
 * - the physical @shared copies stay faithful to their src/shared originals
 * - a mkdtemp consumer running a real Node child process imports ONLY the package entry and
 *   completes a two-round tool-continuation turn: provider request, tool admission/execution,
 *   tool result present in the next provider request, final settlement, durable transcript,
 *   and observable event order, with no client callback between rounds
 * - forbidden imports (electron, better-sqlite3, node-pty) fail the consumer even when the
 *   dynamic import rejection is swallowed
 * - the emitted .d.ts closure is consumable by an external tsc --noEmit run
 */

const fixturesDir = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): string => join(fixturesDir, 'fixtures', name)
const repoRoot = resolve(fixturesDir, '../../../..')
const packageDir = join(repoRoot, 'packages', 'agent-kernel')

const VERDICT_SENTINEL = '---AGENT-KERNEL-GATE-VERDICT---'

const FORBIDDEN_SPECIFIER_PATTERNS: RegExp[] = [
  /^(@\/|@shared\/)/,
  /(^|\/)electron(\/|$)/,
  /better-sqlite3/,
  /node-pty/
]

function runNode(script: string, args: string[], options: { cwd: string; timeout: number }) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeout
  })
}

function listFilesRecursive(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...listFilesRecursive(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

function extractVerdict(stdout: string): Record<string, unknown> {
  const sentinelIndex = stdout.lastIndexOf(VERDICT_SENTINEL)
  expect(sentinelIndex, 'consumer verdict sentinel not found in stdout').toBeGreaterThanOrEqual(0)
  const jsonStart = stdout.indexOf('{', sentinelIndex)
  const jsonSlice = stdout.slice(jsonStart)
  const parsed = JSON.parse(jsonSlice) as Record<string, unknown>
  expect(parsed, 'consumer verdict must be a JSON object').toBeTruthy()
  return parsed
}

describe('agent kernel package runtime gate', () => {
  let workspace: string
  let consumerDir: string
  let artifactDistDir: string

  beforeAll(() => {
    const build = runNode(join(repoRoot, 'scripts', 'build-agent-kernel.mjs'), [], {
      cwd: repoRoot,
      timeout: 180_000
    })
    expect(build.status, `kernel build failed:\n${build.stdout}\n${build.stderr}`).toBe(0)

    const fidelity = runNode(
      join(repoRoot, 'scripts', 'check-agent-kernel-shared-fidelity.mjs'),
      [],
      { cwd: repoRoot, timeout: 60_000 }
    )
    expect(fidelity.status, `shared copy fidelity check failed:\n${fidelity.stdout}`).toBe(0)

    workspace = mkdtempSync(join(tmpdir(), 'agent-kernel-gate-'))
    const artifactDir = join(workspace, 'artifact')
    artifactDistDir = join(artifactDir, 'dist')
    cpSync(join(packageDir, 'package.json'), join(artifactDir, 'package.json'))
    cpSync(join(packageDir, 'dist'), artifactDistDir, { recursive: true })

    consumerDir = join(workspace, 'consumer')
    cpSync(join(fixturesDir, 'fixtures'), consumerDir, { recursive: true })
    writeFileSync(
      join(consumerDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'agent-kernel-gate-consumer',
          private: true,
          type: 'module',
          dependencies: {
            '@deepchat/agent-kernel': 'file:../artifact',
            jsonrepair: '^3.15.0',
            nanoid: '^6.0.1',
            tokenx: '2.1.0',
            zod: '^4.5.4'
          },
          devDependencies: {
            '@types/node': '^24.13.3'
          }
        },
        null,
        2
      )}\n`
    )

    const install = spawnSync('pnpm', ['install', '--prefer-offline'], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 240_000
    })
    expect(install.status, `consumer install failed:\n${install.stdout}\n${install.stderr}`).toBe(0)
  }, 420_000)

  it('runs a two-round tool continuation in a clean Node consumer', { timeout: 180_000 }, () => {
    const run = spawnSync(process.execPath, ['--import', './preload.mjs', 'consumer.mjs'], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 150_000
    })
    expect(run.status, `clean-Node consumer failed:\n${run.stdout}\n${run.stderr}`).toBe(0)

    const verdict = extractVerdict(run.stdout)
    expect(verdict.ok, `consumer assertions failed: ${JSON.stringify(verdict.errors)}`).toBe(true)

    const providerRounds = verdict.providerRounds as Array<{
      round: number
      messageCount: number
      toolCount: number
    }>
    expect(providerRounds, 'exactly two provider rounds must run').toHaveLength(2)
    expect(providerRounds[0].toolCount).toBe(1)
    expect(providerRounds[1].messageCount).toBeGreaterThan(providerRounds[0].messageCount)
    expect(verdict.roundTwoHasToolResult, 'round 2 must carry the round-1 tool result').toBe(true)

    expect(verdict.toolExecutions).toEqual([
      { name: 'echo_fixture', arguments: '{"value":"fixture-input"}' }
    ])

    const transcript = verdict.transcript as Array<{
      role: string
      status: string
      blockTypes: string[]
    }>
    expect(transcript).toHaveLength(2)
    expect(transcript[0]).toMatchObject({ role: 'user', status: 'sent' })
    expect(transcript[1]).toMatchObject({
      role: 'assistant',
      status: 'sent',
      blockTypes: expect.arrayContaining(['tool_call', 'content'])
    })

    const tapeKinds = verdict.tapeKinds as string[]
    expect(tapeKinds[0]).toBe('run_started')
    expect(tapeKinds[tapeKinds.length - 1]).toBe('run_terminal')
    expect(tapeKinds.filter((kind) => kind === 'view_manifest')).toHaveLength(2)
    expect(tapeKinds.filter((kind) => kind === 'provider_attempt')).toHaveLength(2)

    const eventNames = verdict.eventNames as string[]
    expect(eventNames[0]).toBe('sessions.status.changed')
    expect(eventNames).toContain('chat.stream.completed')
    expect(eventNames[eventNames.length - 1]).toBe('sessions.updated')

    const hookEventNames = verdict.hookEventNames as string[]
    expect(hookEventNames).toEqual([
      'UserPromptSubmit',
      'SessionStart',
      'PreToolUse',
      'PostToolUse',
      'Stop',
      'SessionEnd'
    ])
  })

  it(
    'fails the process on forbidden imports even when the rejection is swallowed',
    { timeout: 60_000 },
    () => {
      const run = spawnSync(process.execPath, ['--import', './preload.mjs', 'victim.mjs'], {
        cwd: consumerDir,
        encoding: 'utf8',
        timeout: 50_000
      })
      expect(
        run.status,
        `swallowed forbidden import must exit non-zero:\n${run.stdout}\n${run.stderr}`
      ).not.toBe(0)
      expect(run.stderr).toContain('forbidden import intercepted')
    }
  )

  it(
    'emits an alias-free declaration closure consumable by external tsc',
    { timeout: 180_000 },
    () => {
      const declarationFiles = listFilesRecursive(artifactDistDir).filter((file) =>
        file.endsWith('.d.ts')
      )
      expect(declarationFiles.length).toBeGreaterThan(100)

      for (const file of declarationFiles) {
        const relativePath = relative(artifactDistDir, file)
        const specifierMatches =
          readFileSync(file, 'utf8').matchAll(
            /(?:from\s*|import\s*\(\s*|require\s*\(\s*)'([^']+)'|from\s*"([^"]+)"/g
          ) ?? []
        for (const match of specifierMatches) {
          const specifier = match[1] ?? match[2]
          if (!specifier) continue
          const forbidden = FORBIDDEN_SPECIFIER_PATTERNS.some((pattern) => pattern.test(specifier))
          expect(
            forbidden,
            `${relativePath} must not reference forbidden specifier '${specifier}'`
          ).toBe(false)
        }
      }

      const tsc = spawnSync(
        join(repoRoot, 'node_modules', '.bin', 'tsc'),
        ['-p', 'tsconfig.declarations.json'],
        { cwd: consumerDir, encoding: 'utf8', timeout: 150_000 }
      )
      expect(
        tsc.status,
        `external tsc --noEmit consumption failed:\n${tsc.stdout}\n${tsc.stderr}`
      ).toBe(0)
    }
  )
})
