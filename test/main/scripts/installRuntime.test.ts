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
    expect(loadRuntimeVersions()).toEqual({
      tinyRuntimeInjector: '1.2.0',
      node: 'v24.14.1',
      uv: '0.9.18',
      rtk: 'v0.43.0'
    })
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

  it('rejects unknown targets and malformed arguments before downloading', () => {
    expect(() => buildRuntimeInstallPlan({ platform: 'freebsd', arch: 'x64' })).toThrow(
      /Unsupported runtime platform/
    )
    expect(() => buildRuntimeInstallPlan({ platform: 'linux', arch: 'ia32' })).toThrow(
      /Unsupported runtime architecture/
    )
    expect(() => parseRuntimeInstallArgs(['--platform'])).toThrow(/Missing value/)
    expect(() => parseRuntimeInstallArgs(['--typo', 'linux'])).toThrow(/Unknown/)
  })

  it('stops at the first failed runtime installation', () => {
    const plan = buildRuntimeInstallPlan({ platform: 'darwin', arch: 'arm64' })
    const spawn = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 2 })

    expect(() => runRuntimeInstallPlan(plan, spawn)).toThrow(/node runtime installation failed/)
    expect(spawn).toHaveBeenCalledTimes(2)
  })
})
