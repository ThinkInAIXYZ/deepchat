import { spawnSync } from 'node:child_process'
import { builtinModules } from 'node:module'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  assertArtifactDependencyClosure,
  buildWorkspaceClosure,
  stageWorkspaceClosure
} from '../../../../scripts/package-artifact.mjs'

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
 * - every private workspace dependency is built and staged strictly from its manifest `files`
 * - a mkdtemp consumer running a real Node child process imports ONLY the package entry and
 *   completes a two-round tool-continuation turn: provider request, tool admission/execution,
 *   tool result present in the next provider request, final settlement, durable transcript,
 *   and observable event order, with no client callback between rounds
 * - forbidden imports (electron, better-sqlite3, node-pty) fail the consumer even when the
 *   dynamic import rejection is swallowed
 * - the emitted .d.ts closure is consumable by an external tsc --noEmit run
 */

const fixturesDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(fixturesDir, '../../../..')
const packageName = '@deepchat/agent-kernel'
const sharedPackageName = '@deepchat/shared'

const VERDICT_SENTINEL = '---AGENT-KERNEL-GATE-VERDICT---'

const FORBIDDEN_SPECIFIER_PATTERNS: RegExp[] = [
  /^(@\/|@shared\/)/,
  /(^|\/)electron(\/|$)/,
  /better-sqlite3/,
  /node-pty/
]

const DECLARATION_SPECIFIER_PATTERN = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)(['"])([^'"]+)\1/g

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

type FixturePackage = {
  directory: string
  manifest: {
    name: string
    version: string
    type: string
    dependencies: Record<string, string>
    exports?: unknown
    scripts?: { build: string }
  }
}

function fixturePackage(
  directory: string,
  name: string,
  dependencies: Record<string, string> = {}
): FixturePackage {
  mkdirSync(directory, { recursive: true })
  const manifest = { name, version: '1.0.0', type: 'module', dependencies }
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest)}\n`)
  return { directory, manifest }
}

describe('package artifact closure validation', () => {
  let workspace: string

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), 'package-artifact-validation-'))
  })

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('rejects unexported workspace subpaths and escaping declaration imports', () => {
    const dependency = fixturePackage(join(workspace, 'dependency'), 'b')
    dependency.manifest.exports = { '.': './dist/index.js', './public/*': './dist/public/*.js' }
    mkdirSync(join(dependency.directory, 'dist', 'public'), { recursive: true })
    writeFileSync(join(dependency.directory, 'dist', 'index.js'), 'export {}\n')
    writeFileSync(join(dependency.directory, 'dist', 'public', 'value.js'), 'export {}\n')

    const importer = fixturePackage(join(workspace, 'importer'), 'a', { b: '^1.0.0' })
    mkdirSync(join(importer.directory, 'dist'), { recursive: true })
    writeFileSync(join(importer.directory, 'dist', 'index.js'), "import 'b/private.js'\n")
    writeFileSync(join(importer.directory, 'dist', 'types.d.ts'), "import '../../escape.js'\n")
    writeFileSync(join(workspace, 'escape.js'), 'export {}\n')

    expect(() =>
      assertArtifactDependencyClosure(
        new Map([
          ['a', importer],
          ['b', dependency]
        ])
      )
    ).toThrow(
      /unexported subpath 'b\/private\.js'.*invalid relative import '\.\.\/\.\.\/escape\.js'/s
    )
  })

  it('accepts exported wildcard subpaths, self exports, and .d.ts relative .js targets', () => {
    const dependency = fixturePackage(join(workspace, 'wildcard-dependency'), 'b')
    dependency.manifest.exports = { './public/*': './dist/public/*.js' }
    mkdirSync(join(dependency.directory, 'dist', 'public'), { recursive: true })
    writeFileSync(join(dependency.directory, 'dist', 'public', 'value.js'), 'export {}\n')

    const importer = fixturePackage(join(workspace, 'wildcard-importer'), 'a', { b: '^1.0.0' })
    mkdirSync(join(importer.directory, 'dist'), { recursive: true })
    importer.manifest.exports = { './self': './dist/types.d.ts' }
    writeFileSync(
      join(importer.directory, 'dist', 'index.d.ts'),
      "export * from './types.js'\nimport 'a/self'\nimport 'b/public/value'\n"
    )
    writeFileSync(join(importer.directory, 'dist', 'types.d.ts'), 'export interface Value {}\n')

    expect(() =>
      assertArtifactDependencyClosure(
        new Map([
          ['a', importer],
          ['b', dependency]
        ])
      )
    ).not.toThrow()
  })

  it('reports workspace dependency cycles before invoking builds', () => {
    const root = join(workspace, 'cycle-workspace')
    const a = fixturePackage(join(root, 'packages', 'a'), 'a', { b: 'workspace:*' })
    const b = fixturePackage(join(root, 'packages', 'b'), 'b', { a: 'workspace:*' })
    a.manifest.scripts = { build: 'true' }
    b.manifest.scripts = { build: 'true' }
    for (const pkg of [a, b]) {
      writeFileSync(join(pkg.directory, 'package.json'), `${JSON.stringify(pkg.manifest)}\n`)
    }

    expect(() => buildWorkspaceClosure(root, 'a')).toThrow(
      'workspace dependency cycle: a -> b -> a'
    )
  })
})

describe('agent kernel package runtime gate', () => {
  let workspace: string
  let consumerDir: string
  let artifactDistDir: string
  let kernelManifest: Record<string, unknown>
  let sharedArtifactDir: string

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), 'agent-kernel-gate-'))
    const staged = stageWorkspaceClosure(repoRoot, packageName, join(workspace, 'artifacts'))
    assertArtifactDependencyClosure(staged)
    const kernel = staged.get(packageName)
    if (!kernel) throw new Error(`${packageName} was not staged`)
    kernelManifest = kernel.manifest
    artifactDistDir = join(kernel.directory, 'dist')
    const shared = staged.get(sharedPackageName)
    if (!shared) throw new Error(`${sharedPackageName} was not staged`)
    sharedArtifactDir = shared.directory

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
            [packageName]: `file:${relative(consumerDir, kernel.directory)}`,
            [sharedPackageName]: `file:${relative(consumerDir, sharedArtifactDir)}`
          },
          devDependencies: {
            '@types/node': '^24.13.3'
          }
        },
        null,
        2
      )}\n`
    )

    const install = spawnSync('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 240_000
    })
    expect(install.status, `consumer install failed:\n${install.stdout}\n${install.stderr}`).toBe(0)
  }, 420_000)

  it('proves real kernel consumers resolve shared logger and schema singletons', () => {
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import logger from '${sharedPackageName}/logger';
         import { AssistantMessageBlockSchema } from '${sharedPackageName}/contracts/common';
         let loggerCalls = 0;
         let arrayReceiver;
         logger.warn = () => { loggerCalls += 1 };
         const array = AssistantMessageBlockSchema.array;
         AssistantMessageBlockSchema.array = function (...args) {
           arrayReceiver = this;
           return array.apply(this, args);
         };
         const { logSlowPreStreamStep } = await import('${packageName}/runtime/preStreamWatchdog');
         await import('${packageName}/contracts/rendererBlocks');
         logSlowPreStreamStep('singleton-session', 'singleton-step', 0);
         if (loggerCalls !== 1 || arrayReceiver !== AssistantMessageBlockSchema) process.exit(1);`
      ],
      { cwd: consumerDir, encoding: 'utf8', timeout: 30_000 }
    )
    expect(probe.status, `shared singleton probe failed:\n${probe.stdout}\n${probe.stderr}`).toBe(0)
    expect(sharedArtifactDir).toContain('@deepchat__shared')
  })

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
    expect(tapeKinds).toEqual([
      'run_started',
      'view_manifest',
      'provider_attempt',
      'view_manifest',
      'provider_attempt',
      'run_terminal'
    ])
    expect(verdict.settledViaCompletionHook, 'turn must settle via onSessionCompleted').toBe(true)

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

      const declaredDependencies = new Set(
        Object.keys(kernelManifest.dependencies as Record<string, string>)
      )
      const allowedExternal = new Set([
        ...declaredDependencies,
        sharedPackageName,
        ...builtinModules
      ])
      const externalSpecifiers = new Set<string>()

      for (const file of declarationFiles) {
        const relativePath = relative(artifactDistDir, file)
        const source = readFileSync(file, 'utf8')
        for (const match of source.matchAll(DECLARATION_SPECIFIER_PATTERN)) {
          const specifier = match[2]
          if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) continue
          const forbidden = FORBIDDEN_SPECIFIER_PATTERNS.some((pattern) => pattern.test(specifier))
          expect(
            forbidden,
            `${relativePath} must not reference forbidden specifier '${specifier}'`
          ).toBe(false)
          if (
            ![...allowedExternal].some(
              (dependency) => specifier === dependency || specifier.startsWith(`${dependency}/`)
            ) &&
            !specifier.startsWith('node:') &&
            !builtinModules.some((moduleName) => specifier.startsWith(`${moduleName}/`))
          ) {
            externalSpecifiers.add(specifier)
          }
        }
      }

      expect(
        externalSpecifiers,
        'declaration closure must not reference packages outside the kernel dependencies'
      ).toEqual(new Set())

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

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true })
  })
})
