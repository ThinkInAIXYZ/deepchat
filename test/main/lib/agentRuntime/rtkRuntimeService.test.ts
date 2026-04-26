import * as os from 'os'
import * as path from 'path'
import { describe, expect, it, vi } from 'vitest'
import { RtkRuntimeService } from '../../../../src/main/lib/agentRuntime/rtkRuntimeService'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    __esModule: true,
    ...actual,
    default: actual
  }
})

vi.mock('path', async (importOriginal) => {
  return await importOriginal<typeof import('path')>()
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: 'userData' | 'temp') =>
      name === 'userData' ? '/mock/userData' : '/mock/temp'
    )
  }
}))

function createService(runCommand = vi.fn()) {
  const service = new RtkRuntimeService({
    runtimeHelper: {
      initializeRuntimes: vi.fn(),
      refreshRuntimes: vi.fn(),
      replaceWithRuntimeCommand: vi.fn((command: string) => command),
      getRtkRuntimePath: vi.fn().mockReturnValue('/runtime/rtk'),
      prependBundledRuntimeToEnv: vi.fn((env: Record<string, string>) => env)
    },
    getShellEnvironment: vi.fn().mockResolvedValue({ PATH: '/shell/bin' }),
    runCommand,
    getPath: (name) =>
      name === 'userData'
        ? path.join(os.tmpdir(), 'deepchat-rtk-userData')
        : path.join(os.tmpdir(), 'deepchat-rtk-temp')
  })

  ;(service as never).healthState = {
    health: 'healthy',
    checkedAt: Date.now(),
    source: 'bundled',
    failureStage: null,
    failureMessage: null
  }
  ;(service as never).resolvedRuntime = {
    command: '/runtime/rtk',
    source: 'bundled'
  }

  return service
}

function createCommandResult(code: number | null, stdout = '', stderr = '') {
  return {
    code,
    stdout,
    stderr,
    signal: null,
    timedOut: false
  }
}

function createHealthCheckService(runCommand = vi.fn()) {
  return new RtkRuntimeService({
    runtimeHelper: {
      initializeRuntimes: vi.fn(),
      refreshRuntimes: vi.fn(),
      replaceWithRuntimeCommand: vi.fn((command: string) =>
        command === 'rtk' ? '/runtime/rtk/rtk.exe' : command
      ),
      getRtkRuntimePath: vi.fn().mockReturnValue('/runtime/rtk'),
      prependBundledRuntimeToEnv: vi.fn((env: Record<string, string>) => env)
    },
    getShellEnvironment: vi.fn().mockResolvedValue({ PATH: '/shell/bin' }),
    runCommand,
    getPath: (name) =>
      name === 'userData'
        ? path.join(os.tmpdir(), 'deepchat-rtk-userData')
        : path.join(os.tmpdir(), 'deepchat-rtk-temp')
  })
}

function createHealthCheckRunCommand({
  bundledVersion = createCommandResult(0, 'rtk 0.30.0'),
  pathVersion = createCommandResult(0, 'rtk 0.30.0')
}: {
  bundledVersion?: ReturnType<typeof createCommandResult>
  pathVersion?: ReturnType<typeof createCommandResult>
} = {}) {
  return vi.fn(async (command: string, args: string[]) => {
    if (command === '/runtime/rtk/rtk.exe' && args[0] === '--version') {
      return bundledVersion
    }

    if (command === 'rtk' && args[0] === '--version') {
      return pathVersion
    }

    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
  })
}

function expectNoHealthCommandProbes(
  calls: [command: string, args: string[], options?: unknown][]
): void {
  expect(calls.some(([, args]) => args[0] === 'rewrite')).toBe(false)
  expect(calls.some(([, args]) => args[0] === 'read')).toBe(false)
  expect(calls.some(([, args]) => args[0] === 'gain')).toBe(false)
  expect(calls.some(([command]) => command === 'find')).toBe(false)
  expect(calls.some(([command]) => command === 'ls')).toBe(false)
  expect(calls.some(([command]) => command === 'rg')).toBe(false)
}

describe('RtkRuntimeService', () => {
  it('keeps simple find commands eligible for rewrite', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      code: 0,
      stdout: 'rtk find . -name "*.ts"\n',
      stderr: '',
      signal: null,
      timedOut: false
    })
    const service = createService(runCommand)

    const result = await service.prepareShellCommand(
      'find . -name "*.ts"',
      {},
      { getSetting: vi.fn().mockReturnValue(true) }
    )

    expect(runCommand).toHaveBeenCalledWith(
      '/runtime/rtk',
      ['rewrite', 'find . -name "*.ts"'],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: expect.stringContaining('/shell/bin')
        })
      })
    )
    expect(result.originalCommand).toBe('find . -name "*.ts"')
    expect(result.command).toBe('rtk find . -name "*.ts"')
    expect(result.rewritten).toBe(true)
    expect(result.rtkApplied).toBe(true)
    expect(result.rtkMode).toBe('rewrite')
  })

  it('uses rewrite output when RTK reports a missing global hook', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      code: 3,
      stdout: 'rtk git status\n',
      stderr: 'No hook installed\n',
      signal: null,
      timedOut: false
    })
    const service = createService(runCommand)

    const result = await service.prepareShellCommand(
      'git status',
      {},
      { getSetting: vi.fn().mockReturnValue(true) }
    )

    expect(result.originalCommand).toBe('git status')
    expect(result.command).toBe('rtk git status')
    expect(result.rewritten).toBe(true)
    expect(result.rtkApplied).toBe(true)
    expect(result.rtkMode).toBe('rewrite')
  })

  it.each([
    'find . -type f -name "*.ts" -o -name "*.vue"',
    'find . -type f ! -name "*.test.ts"',
    'find . \\( -name "*.ts" -o -name "*.vue" \\)',
    'find . -name "*.ts" -exec cat {} \\;'
  ])('bypasses rewrite for unsupported find shape: %s', async (command) => {
    const runCommand = vi.fn()
    const service = createService(runCommand)

    const result = await service.prepareShellCommand(
      command,
      {},
      { getSetting: vi.fn().mockReturnValue(true) }
    )

    expect(runCommand).not.toHaveBeenCalled()
    expect(result.originalCommand).toBe(command)
    expect(result.command).toBe(command)
    expect(result.rewritten).toBe(false)
    expect(result.rtkApplied).toBe(false)
    expect(result.rtkMode).toBe('bypass')
    expect(result.rtkFallbackReason).toBe(
      'Bypassed RTK rewrite: unsupported find compound predicates or actions'
    )
  })

  it('keeps bundled RTK healthy with version-only startup probes', async () => {
    const runCommand = createHealthCheckRunCommand()
    const service = createHealthCheckService(runCommand)

    const state = await service.startHealthCheck()

    expect(state).toMatchObject({
      health: 'healthy',
      source: 'bundled',
      failureStage: null,
      failureMessage: null
    })
    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      '/runtime/rtk/rtk.exe',
      ['--version'],
      expect.objectContaining({
        env: expect.objectContaining({ PATH: expect.stringContaining('/shell/bin') })
      })
    )
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      'rtk',
      ['--version'],
      expect.objectContaining({
        env: expect.objectContaining({ PATH: expect.stringContaining('/shell/bin') })
      })
    )
    expectNoHealthCommandProbes(runCommand.mock.calls)
  })

  it('does not run rewrite, read, gain, or platform shell commands during health check', async () => {
    const runCommand = createHealthCheckRunCommand()
    const service = createHealthCheckService(runCommand)

    const state = await service.startHealthCheck()

    expect(state.health).toBe('healthy')
    expect(runCommand.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['/runtime/rtk/rtk.exe', ['--version']],
      ['rtk', ['--version']]
    ])
    expectNoHealthCommandProbes(runCommand.mock.calls)
  })

  it('tries system RTK when bundled RTK version check fails', async () => {
    const runCommand = createHealthCheckRunCommand({
      bundledVersion: createCommandResult(1, '', 'bundled version failed'),
      pathVersion: createCommandResult(0, 'rtk 0.30.0')
    })
    const service = createHealthCheckService(runCommand)

    const state = await service.startHealthCheck()

    expect(state).toMatchObject({
      health: 'healthy',
      source: 'system',
      failureStage: null,
      failureMessage: null
    })
    expect(runCommand.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['/runtime/rtk/rtk.exe', ['--version']],
      ['rtk', ['--version']],
      ['rtk', ['--version']]
    ])
    expectNoHealthCommandProbes(runCommand.mock.calls)
  })

  it('marks RTK unhealthy when all version checks fail', async () => {
    const runCommand = createHealthCheckRunCommand({
      bundledVersion: createCommandResult(1, '', 'bundled version failed'),
      pathVersion: createCommandResult(1, '', 'system version failed')
    })
    const service = createHealthCheckService(runCommand)

    const state = await service.startHealthCheck()

    expect(state).toMatchObject({
      health: 'unhealthy',
      source: 'system',
      failureStage: 'version',
      failureMessage: 'system version failed'
    })
    expect(runCommand.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['/runtime/rtk/rtk.exe', ['--version']],
      ['rtk', ['--version']]
    ])
    expectNoHealthCommandProbes(runCommand.mock.calls)
  })
})
