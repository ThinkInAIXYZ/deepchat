import { describe, expect, it, vi } from 'vitest'
import { RtkRuntimeService } from '../../../../src/main/lib/agentRuntime/rtkRuntimeService'

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
    getPath: (name) => (name === 'userData' ? '/mock/userData' : '/mock/temp')
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
        env: expect.objectContaining({ PATH: '/shell/bin' })
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
})
