import { describe, expect, it, vi } from 'vitest'
import { installRuntimes, parseArgs } from '../../../scripts/install-optional-runtimes.mjs'

describe('install-optional-runtimes', () => {
  it('continues and marks failures as skipped in best-effort mode', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, signal: null, error: null })
      .mockResolvedValueOnce({ exitCode: 0, signal: null, error: null })

    const result = await installRuntimes({
      platform: 'win32',
      arch: 'arm64',
      rootDir: '/tmp/deepchat-runtime',
      runtimes: ['uv', 'node'],
      bestEffort: true,
      uvVersion: '0.9.18',
      summaryPath: '/tmp/runtime-summary.json',
      runCommand,
      ensureDir: vi.fn().mockResolvedValue(undefined),
      writeSummary: vi.fn().mockResolvedValue(undefined)
    })

    expect(result.exitCode).toBe(0)
    expect(result.summary.runtimes.map((item) => item.status)).toEqual(['skipped', 'installed'])
    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  it('stops on the first failure in strict mode', async () => {
    const runCommand = vi.fn().mockResolvedValue({ exitCode: 1, signal: null, error: null })

    const result = await installRuntimes({
      platform: 'win32',
      arch: 'x64',
      rootDir: '/tmp/deepchat-runtime',
      runtimes: ['uv', 'node'],
      bestEffort: false,
      uvVersion: '0.9.18',
      summaryPath: null,
      runCommand,
      ensureDir: vi.fn().mockResolvedValue(undefined),
      writeSummary: vi.fn().mockResolvedValue(undefined)
    })

    expect(result.exitCode).toBe(1)
    expect(result.summary.runtimes.map((item) => item.status)).toEqual(['failed'])
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('parses platform, arch, runtime list, and best-effort options', () => {
    expect(
      parseArgs([
        '--platform',
        'win32',
        '--arch',
        'arm64',
        '--types',
        'uv,node',
        '--best-effort',
        '--summary',
        'build/runtime.json'
      ])
    ).toMatchObject({
      platform: 'win32',
      arch: 'arm64',
      runtimes: ['uv', 'node'],
      bestEffort: true,
      summaryPath: 'build/runtime.json'
    })
  })
})
