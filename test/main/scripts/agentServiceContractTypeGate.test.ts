import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

const repositoryRoot = process.cwd()
const gateScript = path.join(repositoryRoot, 'scripts/typecheck-agent-service-contracts.mjs')
const contractTestFile = 'test/main/contracts/agentServiceClientContract.test.ts'

function runGate() {
  return spawnSync(process.execPath, [gateScript], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 120_000
  })
}

describe('agent service contract type gate', () => {
  it('type-checks the scoped contract test surface', () => {
    const result = runGate()

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Agent service contract type gate passed')
  })

  it('fails with the missing relative path instead of passing with a smaller program', () => {
    const contractTestPath = path.join(repositoryRoot, contractTestFile)
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
      expect(result.stderr).toContain(contractTestFile)
      expect(result.stdout).not.toContain('type gate passed')
    } finally {
      writeFileSync(contractTestPath, contractTestSource)
    }

    expect(existsSync(contractTestPath)).toBe(true)
    expect(readFileSync(contractTestPath, 'utf8')).toBe(contractTestSource)
  })
})
