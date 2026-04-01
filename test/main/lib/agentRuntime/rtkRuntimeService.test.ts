import * as fs from 'fs'
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

function createGainOutput(): string {
  return JSON.stringify({
    summary: {
      total_commands: 1,
      total_input: 10,
      total_output: 2,
      total_saved: 8,
      avg_savings_pct: 80,
      total_time_ms: 100,
      avg_time_ms: 100
    },
    daily: []
  })
}

function createHealthCheckService(tempRoot: string, runCommand = vi.fn()) {
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
    getPath: () => tempRoot
  })
}

function createHealthCheckRunCommand() {
  return vi.fn(async (command: string, args: string[]) => {
    if (args[0] === 'ls') {
      return createCommandResult(
        1,
        '',
        "Failed to resolve 'ls' via PATH, falling back to direct exec: Binary 'ls' not found on PATH"
      )
    }

    if (command === '/runtime/rtk/rtk.exe' && args[0] === '--version') {
      return createCommandResult(0, 'rtk 0.30.0')
    }

    if (command === '/runtime/rtk/rtk.exe' && args[0] === 'rewrite' && args[1] === 'git status') {
      return createCommandResult(0, 'rtk git status\n')
    }

    if (command === 'rtk' && args[0] === '--version') {
      return createCommandResult(0, 'rtk 0.30.0')
    }

    if (command === '/runtime/rtk/rtk.exe' && args[0] === 'read') {
      const smokeFilePath = args[1]
      expect(path.basename(smokeFilePath)).toBe('health.txt')
      expect(fs.readFileSync(smokeFilePath, 'utf-8')).toBe('ok')
      return createCommandResult(0, 'ok')
    }

    if (
      command === '/runtime/rtk/rtk.exe' &&
      args[0] === 'gain' &&
      args[1] === '--all' &&
      args[2] === '--format' &&
      args[3] === 'json'
    ) {
      return createCommandResult(0, createGainOutput())
    }

    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
  })
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

  it('uses rtk read for the smoke check', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-rtk-health-test-'))
    const runCommand = createHealthCheckRunCommand()
    const service = createHealthCheckService(tempRoot, runCommand)

    try {
      const state = await service.startHealthCheck()
      const smokeCall = runCommand.mock.calls.find(([, args]) => args[0] === 'read')

      expect(state).toMatchObject({
        health: 'healthy',
        source: 'bundled',
        failureStage: null,
        failureMessage: null
      })
      expect(smokeCall).toBeDefined()
      expect(smokeCall?.[1][1]).toContain('health.txt')
      expect(runCommand.mock.calls.some(([, args]) => args[0] === 'ls')).toBe(false)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('keeps bundled RTK healthy when ls is unavailable on Windows', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-rtk-health-test-'))
    const runCommand = createHealthCheckRunCommand()
    const service = createHealthCheckService(tempRoot, runCommand)

    try {
      const state = await service.startHealthCheck()

      expect(state.health).toBe('healthy')
      expect(state.source).toBe('bundled')
      expect(runCommand.mock.calls.some(([, args]) => args[0] === 'ls')).toBe(false)
      expect(runCommand.mock.calls.some(([, args]) => args[0] === 'read')).toBe(true)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
