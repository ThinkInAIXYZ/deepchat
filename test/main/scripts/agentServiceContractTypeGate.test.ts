import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

const repositoryRoot = process.cwd()
const gateScript = path.join(repositoryRoot, 'scripts/typecheck-agent-service-contracts.mjs')
const contractTestFile = path.join('test', 'main', 'contracts', 'agentServiceClientContract.test.ts')
const contractTestPath = path.resolve(repositoryRoot, contractTestFile)

// The gate reports paths relative to the repository root with `/` separators, since `node:path`
// `relative` emits `\` on Windows.
const reportedContractTestFile = contractTestFile.split(path.sep).join('/')

function runGate() {
  return spawnSync(process.execPath, [gateScript], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 120_000
  })
}

function isReadable(filePath: string) {
  try {
    readFileSync(filePath)
    return true
  } catch {
    return false
  }
}

describe('agent service contract type gate', () => {
  it('type-checks the scoped contract test surface', () => {
    const result = runGate()

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Agent service contract type gate passed')
  })

  it('fails with the missing relative path instead of passing with a smaller program', () => {
    const contractTestSource = readFileSync(contractTestPath, 'utf8')

    // The gate builds its program from `rootNames`, so a missing scoped root silently shrinks the
    // program: TypeScript's TS6053 for it carries no file, and the gate's diagnostic filter drops
    // file-less diagnostics. The check this exercises names the absent path instead. The file is
    // tracked, so a killed process is recovered with
    // `git checkout -- test/main/contracts/agentServiceClientContract.test.ts`.
    rmSync(contractTestPath)
    try {
      const result = runGate()

      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain(reportedContractTestFile)
      expect(result.stdout).not.toContain('type gate passed')
    } finally {
      writeFileSync(contractTestPath, contractTestSource)
    }

    expect(existsSync(contractTestPath)).toBe(true)
    expect(readFileSync(contractTestPath, 'utf8')).toBe(contractTestSource)
  })

  it('fails with the relative path when a scoped root exists but cannot be read', (context) => {
    const originalMode = statSync(contractTestPath).mode & 0o777
    const contractTestSource = readFileSync(contractTestPath, 'utf8')

    // Existence is not readability: `chmod 000` keeps the root listed by `rootNames` (`fileExists` is
    // still true) while TypeScript cannot read it, which is the false green this gate has to refuse.
    // The contract test is the root that exposes it — nothing imports it, so no in-scope file carries
    // a diagnostic and the file-less TS6053 is dropped by the filter. Recovery after a killed process:
    // `chmod 644 test/main/contracts/agentServiceClientContract.test.ts`.
    chmodSync(contractTestPath, 0o000)
    try {
      context.skip(
        isReadable(contractTestPath),
        'chmod 000 is not enforced for this process (root or a filesystem without POSIX mode bits)'
      )

      const result = runGate()

      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('cannot be read')
      expect(result.stderr).toContain(reportedContractTestFile)
      expect(result.stderr).not.toContain(repositoryRoot)
      expect(result.stdout).not.toContain('type gate passed')
    } finally {
      chmodSync(contractTestPath, originalMode)
    }

    expect(statSync(contractTestPath).mode & 0o777).toBe(originalMode)
    expect(readFileSync(contractTestPath, 'utf8')).toBe(contractTestSource)
  })
})
