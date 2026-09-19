import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

const GATE_TIMEOUT_MS = 120_000
const FIXTURE_PREFIX = 'deepchat-agent-service-contract-gate-'

const desktopRoot = process.cwd()
const repositoryRoot = path.resolve(desktopRoot, '../..')
const gateScriptRelativePath = path.join('scripts', 'typecheck-agent-service-contracts.mjs')
const gateScriptPath = path.join(repositoryRoot, gateScriptRelativePath)
const resolvedNodeModules = realpathSync(path.join(desktopRoot, 'node_modules'))

const scopedTestFile = path.join('test', 'main', 'contracts', 'agentServiceClientContract.test.ts')
const scopedSourceDirectory = path.join('src', 'shared', 'contracts', 'agent-service')

const fixtureTsconfig = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    noEmit: true,
    paths: { '@shared/*': ['./src/shared/*'] }
  },
  include: ['src/**/*.ts', 'test/**/*.ts']
}

const fixtureSource = `export type FixtureRequest = {
  readonly id: string
}

export function acceptFixtureRequest(request: FixtureRequest): string {
  return request.id
}
`

const fixtureContractTest = `import { describe, expect, expectTypeOf, it } from 'vitest'
import { acceptFixtureRequest, type FixtureRequest } from '@shared/contracts/agent-service/client'

describe('agent service client contract', () => {
  it('accepts a fixture request', () => {
    const request: FixtureRequest = { id: 'fixture' }
    const result: string = acceptFixtureRequest(request)

    expectTypeOf(result).toEqualTypeOf<string>()
    expect(result).toBe('fixture')
  })
})
`

const fixtureRoots: string[] = []

describe('agent service contract type gate', () => {
  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) {
      // Only directories this file created in the OS temp dir are removed. The fixture's
      // `node_modules` is a symlink, which `rmSync` unlinks instead of following.
      if (!path.basename(root).startsWith(FIXTURE_PREFIX)) continue
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('passes on the scoped contract surface of this checkout', () => {
    const result = runGate(repositoryRoot, gateScriptRelativePath)

    expect(result.status, gateReport(result)).toBe(0)
    expect(result.stdout).toContain('Agent service contract type gate passed')
    expect(result.stderr).toBe('')
  })

  it('passes on a fixture with a readable scoped root', () => {
    const result = runGate(createFixture().root, gateScriptRelativePath)

    expect(result.status, gateReport(result)).toBe(0)
    expect(result.stdout).toContain('Agent service contract type gate passed')
    expect(result.stderr).toBe('')
  })

  it('rejects a missing scoped root instead of passing with a smaller program', () => {
    const fixture = createFixture()

    // A missing root is an absent file: TypeScript reports it as a file-less TS6053, so a gate that
    // filters file-less diagnostics would compile a smaller program and still exit 0.
    rmSync(fixture.contractTestPath)
    const result = runGate(fixture.root, gateScriptRelativePath)

    expect(result.status, gateReport(result)).toBe(1)
    expect(result.stderr).toContain('are missing')
    expect(normalized(result.stderr)).toContain(normalized(fixture.relativeContractTestFile))
    expect(result.stdout).not.toContain('type gate passed')
  })

  it('rejects a scoped root that exists but cannot be read', (context) => {
    const fixture = createFixture()
    const originalMode = statSync(fixture.contractTestPath).mode & 0o777

    // Existence is not readability: `chmod 000` keeps the root listed by `rootNames` while TypeScript
    // cannot read it, which is the false green the gate has to refuse.
    chmodSync(fixture.contractTestPath, 0o000)
    try {
      context.skip(
        isReadable(fixture.contractTestPath),
        'chmod 000 is not enforced for this process (root or a filesystem without POSIX mode bits)'
      )

      const result = runGate(fixture.root, gateScriptRelativePath)

      expect(result.status, gateReport(result)).toBe(1)
      expect(result.stderr).toContain('cannot be read')
      expect(normalized(result.stderr)).toContain(normalized(fixture.relativeContractTestFile))
      expect(result.stderr).not.toContain(fixture.root)
      expect(result.stdout).not.toContain('type gate passed')
    } finally {
      chmodSync(fixture.contractTestPath, originalMode)
    }
  })

  it('reports a type error inside a scoped source file', () => {
    const fixture = createFixture()
    writeFileSync(
      fixture.sourceFilePath,
      `${fixtureSource}\nexport const fixtureTypeError: number = 'text'\n`
    )
    const result = runGate(fixture.root, gateScriptRelativePath)

    expect(result.status, gateReport(result)).toBe(1)
    expect(result.stderr).toContain('TS2322')
    expect(normalized(result.stderr)).toContain(normalized(fixture.relativeSourceFile))
    expect(result.stdout).not.toContain('type gate passed')
  })

  it('fails when the config cannot be parsed', () => {
    const fixture = createFixture()
    writeFileSync(path.join(fixture.root, 'tsconfig.node.json'), '{ "compilerOptions": {')
    const result = runGate(fixture.root, gateScriptRelativePath)

    expect(result.status, gateReport(result)).toBe(1)
    expect(result.stderr).not.toBe('')
    expect(result.stdout).not.toContain('type gate passed')
  })
})

type Fixture = {
  root: string
  contractTestPath: string
  sourceFilePath: string
  relativeContractTestFile: string
  relativeSourceFile: string
}

// Every fixture is private to this file: the gate runs against a copy of the real script and a minimal
// scoped layout, so this suite never writes to the checkout it is testing. The dependency link is a
// junction so it needs no extra privilege on Windows; off Windows it is a plain symlink.
function createFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), FIXTURE_PREFIX))
  fixtureRoots.push(root)

  const contractTestPath = path.join(root, scopedTestFile)
  const sourceFilePath = path.join(root, scopedSourceDirectory, 'client.ts')

  mkdirSync(path.dirname(contractTestPath), { recursive: true })
  mkdirSync(path.dirname(sourceFilePath), { recursive: true })
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  symlinkSync(resolvedNodeModules, path.join(root, 'node_modules'), 'junction')
  copyFileSync(gateScriptPath, path.join(root, 'scripts', path.basename(gateScriptPath)))
  writeFileSync(path.join(root, 'tsconfig.node.json'), JSON.stringify(fixtureTsconfig, null, 2))
  writeFileSync(sourceFilePath, fixtureSource)
  writeFileSync(contractTestPath, fixtureContractTest)

  return {
    root,
    contractTestPath,
    sourceFilePath,
    relativeContractTestFile: path.relative(root, contractTestPath),
    relativeSourceFile: path.relative(root, sourceFilePath)
  }
}

function runGate(cwd: string, scriptPath: string) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: 'utf8',
    timeout: GATE_TIMEOUT_MS
  })
}

// The gate prints paths from `path.relative`, which separates with `\` on Windows.
function normalized(value: string) {
  return value.replaceAll('\\', '/')
}

function gateReport(result: { status: number | null; stdout: string; stderr: string }) {
  return `gate exit ${result.status}\n--- stdout ---\n${result.stdout}--- stderr ---\n${result.stderr}`
}

function isReadable(filePath: string) {
  try {
    readFileSync(filePath)
    return true
  } catch {
    return false
  }
}
