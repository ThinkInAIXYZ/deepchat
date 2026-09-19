import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcpAuthChallenge } from '@shared/types/acp'

const ptyMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  dataListeners: [] as Array<(data: string) => void>,
  exitListeners: [] as Array<(event: { exitCode: number; signal?: number }) => void>,
  write: vi.fn(),
  kill: vi.fn()
}))

vi.mock('node-pty', () => ({
  spawn: ptyMock.spawn
}))

import { AcpAuthService } from '@/agent/acp/auth/acpAuthService'

const terminalChallenge: AcpAuthChallenge = {
  id: 'challenge-1',
  agentId: 'agent-1',
  agentName: 'Agent One',
  workdir: '/workspace',
  methods: [{ id: 'terminal-login', name: 'Terminal login', type: 'terminal' }],
  origin: 'draft_session',
  sessionId: 'session-1'
}

function createHarness(challenge: AcpAuthChallenge = terminalChallenge) {
  const processManager = {
    inspectAuthentication: vi.fn().mockResolvedValue(challenge),
    getAuthChallenge: vi.fn((challengeId: string) => ({ ...challenge, id: challengeId })),
    authenticateAgent: vi.fn().mockResolvedValue(undefined),
    prepareTerminalAuthentication: vi.fn().mockResolvedValue({
      challenge,
      launch: {
        command: '/usr/bin/agent',
        args: ['acp', 'login', '--interactive'],
        env: { BASE: '1', TOKEN_SOURCE: 'terminal' },
        cwd: '/workspace'
      }
    }),
    completeTerminalAuthentication: vi.fn().mockResolvedValue(undefined),
    abandonAuthentication: vi.fn()
  }
  const sendToRenderer = vi.fn()
  let rendererDestroyed: (() => void) | null = null
  const onRendererDestroyed = vi.fn((_webContentsId: number, callback: () => void) => {
    rendererDestroyed = callback
    return vi.fn()
  })
  const service = new AcpAuthService({
    owner: {
      getOrCreate: () => ({ processManager })
    } as never,
    agentSettings: {
      getAcpAgents: vi
        .fn()
        .mockResolvedValue([{ id: 'agent-1', name: 'Agent One', command: 'agent' }])
    },
    sendToRenderer,
    onRendererDestroyed
  })
  return {
    processManager,
    sendToRenderer,
    service,
    destroyRenderer: () => rendererDestroyed?.()
  }
}

describe('AcpAuthService', () => {
  beforeEach(() => {
    ptyMock.dataListeners.length = 0
    ptyMock.exitListeners.length = 0
    ptyMock.spawn.mockReset()
    ptyMock.write.mockReset()
    ptyMock.kill.mockReset()
    ptyMock.spawn.mockImplementation(() => ({
      pid: 123,
      write: ptyMock.write,
      kill: ptyMock.kill,
      onData: (listener: (data: string) => void) => {
        ptyMock.dataListeners.push(listener)
        return { dispose: vi.fn() }
      },
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        ptyMock.exitListeners.push(listener)
        return { dispose: vi.fn() }
      }
    }))
  })

  it('direct-spawns terminal auth and reconnects without calling authenticate', async () => {
    const harness = createHarness()

    const status = await harness.service.start('challenge-1', 'terminal-login', 42)

    expect(status).toMatchObject({ state: 'running', runId: expect.any(String) })
    expect(ptyMock.spawn).toHaveBeenCalledWith(
      '/usr/bin/agent',
      ['acp', 'login', '--interactive'],
      expect.objectContaining({
        cwd: '/workspace',
        env: { BASE: '1', TOKEN_SOURCE: 'terminal' }
      })
    )
    expect(harness.processManager.authenticateAgent).not.toHaveBeenCalled()

    ptyMock.dataListeners[0]?.('login output')
    expect(harness.sendToRenderer).toHaveBeenCalledWith(
      42,
      'acpAuth.output',
      expect.objectContaining({ data: 'login output' })
    )

    ptyMock.exitListeners[0]?.({ exitCode: 0 })
    await vi.waitFor(() =>
      expect(harness.processManager.completeTerminalAuthentication).toHaveBeenCalledWith(
        'challenge-1'
      )
    )
    await vi.waitFor(() =>
      expect(harness.service.getStatus('challenge-1', 42)).toMatchObject({ state: 'succeeded' })
    )
  })

  it('does not reconnect after a non-zero terminal exit', async () => {
    const harness = createHarness()

    await harness.service.start('challenge-1', 'terminal-login', 42)
    ptyMock.exitListeners[0]?.({ exitCode: 7 })

    await vi.waitFor(() =>
      expect(harness.service.getStatus('challenge-1', 42)).toMatchObject({
        state: 'failed',
        error: 'Authentication process exited with code 7'
      })
    )
    expect(harness.processManager.completeTerminalAuthentication).not.toHaveBeenCalled()
    expect(harness.processManager.abandonAuthentication).toHaveBeenCalledWith('challenge-1')
  })

  it('does not reconnect after signal termination', async () => {
    const harness = createHarness()

    await harness.service.start('challenge-1', 'terminal-login', 42)
    ptyMock.exitListeners[0]?.({ exitCode: 0, signal: 15 })

    await vi.waitFor(() =>
      expect(harness.service.getStatus('challenge-1', 42)).toMatchObject({
        state: 'failed',
        error: 'Authentication process terminated by signal 15'
      })
    )
    expect(harness.processManager.completeTerminalAuthentication).not.toHaveBeenCalled()
  })

  it('uses ACP authenticate only for agent-owned methods', async () => {
    const challenge: AcpAuthChallenge = {
      ...terminalChallenge,
      methods: [{ id: 'browser-login', name: 'Browser login', type: 'agent' }]
    }
    const harness = createHarness(challenge)

    await expect(harness.service.start('challenge-1', 'browser-login', 42)).resolves.toMatchObject({
      state: 'succeeded'
    })
    expect(harness.processManager.authenticateAgent).toHaveBeenCalledWith(
      'challenge-1',
      'browser-login',
      expect.any(AbortSignal)
    )
    expect(ptyMock.spawn).not.toHaveBeenCalled()
  })

  it('rejects another renderer and cancels without reconnecting when the owner closes', async () => {
    const harness = createHarness()
    const status = await harness.service.start('challenge-1', 'terminal-login', 42)

    expect(() => harness.service.write(status.runId!, 99, 'input')).toThrow(
      'belongs to another renderer'
    )
    harness.destroyRenderer()
    expect(ptyMock.kill).toHaveBeenCalledOnce()

    ptyMock.exitListeners[0]?.({ exitCode: 0 })
    await vi.waitFor(() =>
      expect(harness.service.getStatus('challenge-1', 42)).toMatchObject({ state: 'cancelled' })
    )
    expect(harness.processManager.completeTerminalAuthentication).not.toHaveBeenCalled()
    expect(harness.processManager.abandonAuthentication).toHaveBeenCalledWith('challenge-1')
  })

  it('keeps authentication status recovery bounded', async () => {
    const harness = createHarness({
      ...terminalChallenge,
      methods: [{ id: 'browser-login', name: 'Browser login', type: 'agent' }]
    })

    for (let index = 0; index <= 100; index += 1) {
      await harness.service.start(`challenge-${index}`, 'browser-login', 42)
    }

    expect(harness.service.getStatus('challenge-0', 42)).toMatchObject({
      challengeId: 'challenge-0',
      state: 'required'
    })
    expect(harness.service.getStatus('challenge-100', 42)).toMatchObject({ state: 'succeeded' })
  })

  it('suppresses status events after shutdown while preserving process cleanup', async () => {
    const harness = createHarness()
    await harness.service.start('challenge-1', 'terminal-login', 42)
    const eventCount = harness.sendToRenderer.mock.calls.length

    harness.service.shutdown()
    ptyMock.exitListeners[0]?.({ exitCode: 0 })

    await vi.waitFor(() =>
      expect(harness.processManager.abandonAuthentication).toHaveBeenCalledWith('challenge-1')
    )
    expect(harness.sendToRenderer).toHaveBeenCalledTimes(eventCount)
  })

  it('binds inspected challenges to the renderer that received them', async () => {
    const harness = createHarness()

    await harness.service.inspect('agent-1', undefined, 42)

    await expect(harness.service.start('challenge-1', 'terminal-login', 99)).rejects.toThrow(
      'owned by another renderer'
    )
    expect(harness.processManager.prepareTerminalAuthentication).not.toHaveBeenCalled()
  })

  it('reports terminal timeouts as failures even when the PTY never exits', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    try {
      await harness.service.start('challenge-1', 'terminal-login', 42)

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 4 * 1000)

      expect(harness.service.getStatus('challenge-1', 42)).toMatchObject({
        state: 'failed',
        error: 'Authentication process timed out'
      })
      expect(harness.processManager.completeTerminalAuthentication).not.toHaveBeenCalled()
    } finally {
      harness.service.shutdown()
      vi.useRealTimers()
    }
  })
})
