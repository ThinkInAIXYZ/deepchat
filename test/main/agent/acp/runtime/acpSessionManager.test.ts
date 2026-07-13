import { describe, expect, it, vi } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { AcpAgentConfig, AcpSessionEntity, IConfigPresenter } from '@shared/presenter'
import {
  AcpProcessManager,
  type AcpProcessHandle
} from '@/agent/acp/runtime/acpProcessManager'
import { AcpSessionManager } from '@/agent/acp/runtime/acpSessionManager'
import { AcpSessionPersistence } from '@/agent/acp/runtime/acpSessionPersistence'

vi.mock('electron', () => ({
  app: {
    on: vi.fn()
  }
}))

const agent: AcpAgentConfig = { id: 'agent1', name: 'Agent 1', command: 'agent' }
const hooks = () => ({ onSessionUpdate: vi.fn(), onPermission: vi.fn() })

interface HarnessOptions {
  persisted?: boolean
  resumeRejects?: boolean
  loadRejects?: boolean
  getConnectionError?: Error
  unbindError?: Error
  throwingDetach?: boolean
  exitOnRegistration?: boolean
  handles?: AcpProcessHandle[]
}

function createHarness(options: HarnessOptions = {}) {
  const calls: string[] = []
  const updateDisposers: Array<ReturnType<typeof vi.fn>> = []
  const permissionDisposers: Array<ReturnType<typeof vi.fn>> = []
  const exitDisposers: Array<ReturnType<typeof vi.fn>> = []
  const exitHandlers = new Map<string, () => void>()
  let exitedOnRegistration = false
  let persisted: AcpSessionEntity | null = options.persisted
    ? ({ sessionId: 'persisted-session', workdir: '/tmp' } as AcpSessionEntity)
    : null

  const connection = {
    unstable_resumeSession: vi.fn(async () => {
      calls.push('resume')
      if (options.resumeRejects) throw new Error('resume failed')
      return {} as schema.ResumeSessionResponse
    }),
    loadSession: vi.fn(async () => {
      calls.push('load')
      if (options.loadRejects) throw new Error('load failed')
      return {} as schema.LoadSessionResponse
    }),
    newSession: vi.fn(async () => {
      calls.push('new')
      return { sessionId: 'new-session' } as schema.NewSessionResponse
    })
  }
  const defaultHandle = {
    supportsSessionResume: true,
    supportsLoadSession: true,
    connection
  } as unknown as AcpProcessHandle
  const getConnection = vi.fn(async () => {
    if (options.getConnectionError) throw options.getConnectionError
    return options.handles?.shift() ?? defaultHandle
  })
  const unbindProcess = options.unbindError
    ? vi.fn().mockRejectedValue(options.unbindError)
    : vi.fn().mockResolvedValue(undefined)
  const processManager = {
    getConnection,
    bindProcess: vi.fn(),
    unbindProcess,
    registerSessionWorkdir: vi.fn(),
    registerSessionListener: vi.fn((_agentId: string, _sessionId: string) => {
      const dispose =
        options.throwingDetach && updateDisposers.length === 0
          ? vi.fn(() => {
              throw new Error('detach failed')
            })
          : vi.fn()
      updateDisposers.push(dispose)
      return dispose
    }),
    registerPermissionResolver: vi.fn(() => {
      const dispose = vi.fn()
      permissionDisposers.push(dispose)
      return dispose
    }),
    registerProcessExitHandler: vi.fn(
      (_agentId: string, sessionId: string, handler: () => void) => {
        exitHandlers.set(sessionId, handler)
        const dispose = vi.fn(() => {
          if (exitHandlers.get(sessionId) === handler) exitHandlers.delete(sessionId)
        })
        exitDisposers.push(dispose)
        if (options.exitOnRegistration && !exitedOnRegistration) {
          exitedOnRegistration = true
          handler()
        }
        return dispose
      }
    ),
    clearSession: vi.fn((sessionId: string) => exitHandlers.delete(sessionId))
  } as unknown as AcpProcessManager
  const sessionPersistence = {
    resolveWorkdir: (workdir?: string | null) => workdir?.trim() || '/tmp',
    getSessionData: vi.fn(async () => persisted),
    saveSessionData: vi.fn(
      async (
        conversationId: string,
        agentId: string,
        sessionId: string | null,
        workdir: string | null
      ) => {
        persisted = {
          id: 1,
          conversationId,
          agentId,
          sessionId,
          workdir,
          status: 'active',
          metadata: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      }
    ),
    clearSession: vi.fn()
  } as unknown as AcpSessionPersistence
  const configPresenter = {
    getAgentMcpSelections: vi.fn().mockResolvedValue([]),
    getMcpServers: vi.fn().mockResolvedValue({})
  } as unknown as IConfigPresenter
  const manager = new AcpSessionManager({
    providerId: 'acp',
    processManager,
    sessionPersistence,
    configPresenter
  })

  return {
    calls,
    connection,
    clearProcessSession: processManager.clearSession,
    exitDisposers,
    exitHandlers,
    getConnection,
    manager,
    permissionDisposers,
    sessionPersistence,
    unbindProcess,
    updateDisposers
  }
}

describe('AcpSessionManager public error handling', () => {
  it('throws explicit shutdown error when process manager is shutting down', async () => {
    const { manager } = createHarness({
      getConnectionError: new Error(
        '[ACP] Process manager is shutting down, refusing to spawn new process'
      )
    })

    await expect(manager.getOrCreateSession('conv1', agent, hooks(), '/tmp')).rejects.toThrow(
      '[ACP] Cannot create session: process manager is shutting down'
    )
  })

  it('rethrows non-shutdown getConnection errors', async () => {
    const { manager } = createHarness({ getConnectionError: new Error('boom') })
    await expect(manager.getOrCreateSession('conv1', agent, hooks(), '/tmp')).rejects.toThrow('boom')
  })

  it('preserves the initialization error when unbind fails', async () => {
    const harness = createHarness({ unbindError: new Error('cleanup failed') })
    harness.connection.newSession.mockRejectedValueOnce(new Error('init failed'))

    await expect(
      harness.manager.getOrCreateSession('conv1', agent, hooks(), '/tmp')
    ).rejects.toThrow('init failed')
    expect(harness.unbindProcess).toHaveBeenCalledWith('agent1', 'conv1', expect.anything())
  })

  it('continues newSession fallback when persisted-session detach throws', async () => {
    const harness = createHarness({
      persisted: true,
      resumeRejects: true,
      loadRejects: true,
      throwingDetach: true
    })

    const session = await harness.manager.getOrCreateSession('conv1', agent, hooks(), '/tmp')

    expect(harness.updateDisposers[0]).toHaveBeenCalledTimes(1)
    expect(harness.permissionDisposers[0]).toHaveBeenCalledTimes(1)
    expect(session.sessionId).toBe('new-session')
  })
})

describe('AcpSessionManager public restore matrix', () => {
  it.each([
    {
      name: 'resume succeeds',
      persisted: true,
      resumeRejects: false,
      loadRejects: false,
      expected: ['resume']
    },
    {
      name: 'resume falls back to load',
      persisted: true,
      resumeRejects: true,
      loadRejects: false,
      expected: ['resume', 'load']
    },
    {
      name: 'resume and load fall back to new',
      persisted: true,
      resumeRejects: true,
      loadRejects: true,
      expected: ['resume', 'load', 'new']
    },
    {
      name: 'missing persisted session creates new',
      persisted: false,
      resumeRejects: false,
      loadRejects: false,
      expected: ['new']
    }
  ])('$name', async ({ persisted, resumeRejects, loadRejects, expected }) => {
    const harness = createHarness({ persisted, resumeRejects, loadRejects })

    const result = await harness.manager.getOrCreateSession('conv1', agent, hooks(), '/tmp')

    expect(harness.calls).toEqual(expected)
    expect(result.sessionId).toBe(expected.includes('new') ? 'new-session' : 'persisted-session')
  })

  it('invalidates a live record on process exit and restores without reusing the dead connection', async () => {
    const firstConnection = {
      newSession: vi.fn().mockResolvedValue({ sessionId: 'remote-1' })
    }
    const secondCalls: string[] = []
    const secondConnection = {
      unstable_resumeSession: vi.fn(async () => {
        secondCalls.push('resume')
        throw new Error('dead remote')
      }),
      loadSession: vi.fn(async () => {
        secondCalls.push('load')
        throw new Error('missing remote')
      }),
      newSession: vi.fn(async () => {
        secondCalls.push('new')
        return { sessionId: 'remote-2' }
      })
    }
    const harness = createHarness({
      handles: [
        { connection: firstConnection } as unknown as AcpProcessHandle,
        {
          connection: secondConnection,
          supportsSessionResume: true,
          supportsLoadSession: true
        } as unknown as AcpProcessHandle
      ]
    })
    const onProcessExit = vi.fn()

    const first = await harness.manager.getOrCreateSession(
      'conv1',
      agent,
      { ...hooks(), onProcessExit },
      '/tmp'
    )
    const exit = harness.exitHandlers.get('remote-1')
    expect(exit).toBeTypeOf('function')
    harness.exitHandlers.delete('remote-1')
    exit?.()

    expect(harness.manager.getSession('conv1')).toBeNull()
    expect(onProcessExit).toHaveBeenCalledWith('remote-1')
    expect(harness.updateDisposers[0]).toHaveBeenCalledTimes(1)
    expect(harness.permissionDisposers[0]).toHaveBeenCalledTimes(1)
    expect(harness.exitDisposers[0]).toHaveBeenCalledTimes(1)
    expect(harness.clearProcessSession).toHaveBeenCalledWith('remote-1')
    expect(harness.sessionPersistence.clearSession).not.toHaveBeenCalled()

    const restored = await harness.manager.getOrCreateSession('conv1', agent, hooks(), '/tmp')

    expect(restored).not.toBe(first)
    expect(restored.connection).toBe(secondConnection)
    expect(restored.sessionId).toBe('remote-2')
    expect(secondCalls).toEqual(['resume', 'load', 'new'])
    expect(harness.getConnection).toHaveBeenCalledTimes(2)
  })

  it('shares initialization exit failure across concurrent callers and then recovers', async () => {
    const firstConnection = {
      newSession: vi.fn().mockResolvedValue({ sessionId: 'new-session' })
    }
    const secondConnection = {
      unstable_resumeSession: vi.fn().mockResolvedValue({})
    }
    const harness = createHarness({
      exitOnRegistration: true,
      handles: [
        { connection: firstConnection } as unknown as AcpProcessHandle,
        {
          connection: secondConnection,
          supportsSessionResume: true
        } as unknown as AcpProcessHandle
      ]
    })

    const first = harness.manager.getOrCreateSession('conv1', agent, hooks(), '/tmp')
    const second = harness.manager.getOrCreateSession('conv1', agent, hooks(), '/tmp')
    const results = await Promise.allSettled([first, second])

    expect(results[0]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: expect.stringContaining(
          'Process exited while session new-session was initializing'
        )
      })
    })
    expect(results[1].status).toBe('rejected')
    if (results[0].status === 'rejected' && results[1].status === 'rejected') {
      expect(results[1].reason).toBe(results[0].reason)
    }

    expect(harness.manager.getSession('conv1')).toBeNull()
    expect(harness.manager.getSessionById('new-session')).toBeNull()
    expect(harness.clearProcessSession).toHaveBeenCalledWith('new-session')
    expect(harness.updateDisposers[0]).toHaveBeenCalledTimes(1)
    expect(harness.permissionDisposers[0]).toHaveBeenCalledTimes(1)
    expect(harness.exitDisposers[0]).toHaveBeenCalledTimes(1)
    expect(harness.sessionPersistence.clearSession).not.toHaveBeenCalled()

    const restored = await harness.manager.getOrCreateSession('conv1', agent, hooks(), '/tmp')

    expect(restored.connection).toBe(secondConnection)
    expect(restored.sessionId).toBe('new-session')
    expect(secondConnection.unstable_resumeSession).toHaveBeenCalledTimes(1)
    expect(harness.getConnection).toHaveBeenCalledTimes(2)
  })

  it('cancels shared initialization callers and fences a late resume response', async () => {
    let resolveResume!: (response: schema.ResumeSessionResponse) => void
    const resume = new Promise<schema.ResumeSessionResponse>((resolve) => {
      resolveResume = resolve
    })
    const harness = createHarness({ persisted: true })
    harness.connection.unstable_resumeSession.mockImplementation(async () => await resume)
    const controller = new AbortController()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    try {
      const first = harness.manager.getOrCreateSession(
        'conv1',
        agent,
        hooks(),
        '/tmp',
        controller.signal
      )
      await vi.waitFor(() =>
        expect(harness.connection.unstable_resumeSession).toHaveBeenCalledTimes(1)
      )
      const second = harness.manager.getOrCreateSession('conv1', agent, hooks(), '/tmp')

      controller.abort()
      const results = await Promise.allSettled([first, second])

      expect(results[0]).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ name: 'AbortError' })
      })
      expect(results[1].status).toBe('rejected')
      if (results[0].status === 'rejected' && results[1].status === 'rejected') {
        expect(results[1].reason).toBe(results[0].reason)
      }
      await vi.waitFor(() => expect(harness.updateDisposers[0]).toHaveBeenCalledTimes(1))
      expect(harness.permissionDisposers[0]).toHaveBeenCalledTimes(1)
      expect(harness.exitDisposers[0]).toHaveBeenCalledTimes(1)
      expect(harness.manager.listSessions()).toEqual([])
      expect(harness.sessionPersistence.saveSessionData).not.toHaveBeenCalled()

      resolveResume({})
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(harness.manager.listSessions()).toEqual([])
      expect(harness.sessionPersistence.saveSessionData).not.toHaveBeenCalled()
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
