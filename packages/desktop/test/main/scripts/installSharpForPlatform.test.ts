import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

describe('install-sharp-for-platform', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-install-sharp-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it.each([
    ['x64', ['current', 'x64', 'wasm32']],
    ['arm64', ['current', 'arm64', 'wasm32']]
  ])('includes the target Linux %s CPU for optional native packages', async (arch, expectedCpu) => {
    const workspacePath = path.join(tmpDir, 'pnpm-workspace.yaml')
    await writeFile(workspacePath, "publicHoistPattern:\n  - '@img/sharp-*'\n")

    execFileSync(process.execPath, [path.join(process.cwd(), 'scripts/install-sharp-for-platform.js')], {
      cwd: tmpDir,
      env: {
        ...process.env,
        TARGET_OS: 'linux',
        TARGET_ARCH: arch
      },
      stdio: 'pipe'
    })

    const workspaceConfig = parse(await readFile(workspacePath, 'utf8'))

    expect(workspaceConfig.supportedArchitectures).toEqual({
      os: ['current', 'linux'],
      cpu: expectedCpu,
      libc: ['glibc']
    })
  })
})
