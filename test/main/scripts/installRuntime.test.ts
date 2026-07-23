import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    default: actual
  }
})

import {
  buildRuntimeInstallPlan,
  loadRuntimeVersions,
  parseRuntimeInstallArgs,
  runRuntimeInstallPlan
} from '../../../scripts/install-runtime.mjs'

describe('install-runtime', () => {
  it('loads every pinned toolchain version from one manifest', () => {
    expect(loadRuntimeVersions()).toMatchObject({
      tinyRuntimeInjector: '1.2.0',
      node: 'v24.14.1',
      uv: '0.9.18',
      rtk: 'v0.43.0'
    })
    expect(loadRuntimeVersions().nodeArtifacts['darwin-arm64'].executableSha256).toMatch(
      /^[a-f0-9]{64}$/
    )
  })

  it('builds an explicitly versioned plan for supported targets', () => {
    const plan = buildRuntimeInstallPlan({
      platform: 'linux',
      arch: 'x64',
      rootDir: '/repo'
    })

    expect(plan.map(({ type, version }) => ({ type, version }))).toEqual([
      { type: 'uv', version: '0.9.18' },
      { type: 'node', version: 'v24.14.1' },
      { type: 'rtk', version: 'v0.43.0' }
    ])
    for (const step of plan) {
      expect(step.args).toContain('tiny-runtime-injector@1.2.0')
      expect(step.args).toContain('--runtime-version')
      expect(step.args).toContain(step.version)
      expect(step.args).toContain(path.join('/repo', 'runtime', step.type))
    }
  })

  it('preserves the unsupported RTK target exception for Windows arm64', () => {
    const plan = buildRuntimeInstallPlan({ platform: 'win32', arch: 'arm64' })

    expect(plan.map((step) => step.type)).toEqual(['uv', 'node'])
  })

  it.each(['x64', 'arm64'])('builds a Node-only plan for Linux %s', (arch) => {
    const options = parseRuntimeInstallArgs([
      '--platform=linux',
      `--arch=${arch}`,
      '--types',
      'node'
    ])
    const plan = buildRuntimeInstallPlan({
      platform: options.platform,
      arch: options.arch,
      types: options.types,
      rootDir: '/repo'
    })

    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({
      type: 'node',
      platform: 'linux',
      arch,
      executablePath: path.join('/repo', 'runtime', 'node', 'bin', 'node'),
      expectedExecutableSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
  })

  it('accepts an explicit package root for reproducible baseline assets', () => {
    expect(parseRuntimeInstallArgs(['--root-dir', '/baseline'])).toMatchObject({
      'root-dir': '/baseline'
    })
    expect(parseRuntimeInstallArgs(['--root-dir=/baseline'])).toMatchObject({
      'root-dir': '/baseline'
    })
  })

  it('rejects unknown targets and malformed arguments before downloading', () => {
    expect(() => buildRuntimeInstallPlan({ platform: 'freebsd', arch: 'x64' })).toThrow(
      /Unsupported runtime platform/
    )
    expect(() => buildRuntimeInstallPlan({ platform: 'linux', arch: 'ia32' })).toThrow(
      /Unsupported runtime architecture/
    )
    expect(() => parseRuntimeInstallArgs(['--platform'])).toThrow(/Missing value/)
    expect(() => parseRuntimeInstallArgs(['--types', 'node,unknown'])).toThrow(
      /Unsupported runtime type/
    )
    expect(() => parseRuntimeInstallArgs(['--typo', 'linux'])).toThrow(/Unknown/)
  })

  it('stops at the first failed runtime installation', async () => {
    const plan = buildRuntimeInstallPlan({ platform: 'darwin', arch: 'arm64' })
    const spawn = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 2 })
    const verify = vi.fn().mockResolvedValue(undefined)

    await expect(runRuntimeInstallPlan(plan, spawn, verify)).rejects.toThrow(
      /node runtime installation failed/
    )
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(verify).toHaveBeenCalledTimes(1)
  })
})
