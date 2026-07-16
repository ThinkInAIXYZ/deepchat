import { beforeEach, describe, it, expect, vi } from 'vitest'
import { AcpProvider } from '../../../src/main/provider/providers/acpProvider'
import { AcpSessionController, LEGACY_MODE_CONFIG_ID } from '@/agent/acp/runtime'
import { AcpPromptController } from '@/agent/acp/client'
import type { AcpConfigState } from '@shared/types/acp'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp')
  }
}))

vi.mock('@/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

describe('AcpProvider runDebugAction error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const agent = { id: 'agent1', name: 'Agent 1' }
  const attachSessionController = (
    provider: any,
    sessionManager: any,
    processManager: any = {},
    persistence: any = {}
  ) => {
    provider.acpRuntime = {
      sessionController: new AcpSessionController(sessionManager, processManager, persistence, {
        modesReady: (input) =>
          publishDeepchatEventMock('sessions.acp.modes.ready', {
            ...input,
            version: Date.now()
          }),
        configOptionsReady: (input) =>
          publishDeepchatEventMock('sessions.acp.configOptions.ready', {
            ...input,
            version: Date.now()
          }),
        commandsReady: (input) =>
          publishDeepchatEventMock('sessions.acp.commands.ready', {
            ...input,
            version: Date.now()
          })
      })
    }
  }
  const createStandaloneProvider = () => {
    let resolveFirstPrompt!: (response: { stopReason: string }) => void
    const prompt = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ stopReason: string }>((resolve) => {
            resolveFirstPrompt = resolve
          })
      )
      .mockResolvedValue({ stopReason: 'end_turn' })
    const cancel = vi.fn().mockResolvedValue(undefined)
    const session = {
      sessionId: 'standalone-session',
      conversationId: 'agent1',
      agentId: 'agent1',
      promptCapabilities: {},
      systemPromptSent: false,
      connection: { prompt, cancel }
    }
    const open = vi.fn().mockResolvedValue(session)
    const clearMappedSession = vi.fn()
    const provider = Object.create(AcpProvider.prototype) as any
    provider.provider = { id: 'acp', name: 'ACP' }
    provider.providerSettings = {
      getModelConfig: vi.fn().mockReturnValue({})
    }
    provider.agentSettings = {
      getAcpEnabled: vi.fn().mockResolvedValue(true),
      getAcpAgents: vi.fn().mockResolvedValue([agent])
    }
    provider.sessionPersistence = {
      getWorkdir: vi.fn().mockResolvedValue('/tmp'),
      startTurn: vi.fn().mockResolvedValue(undefined),
      finishTurn: vi.fn().mockResolvedValue(undefined)
    }
    provider.acpRuntime = {
      sessionController: { open, clearMappedSession }
    }
    provider.promptController = new AcpPromptController()
    provider.messageFormatter = {
      format: vi.fn().mockReturnValue({ blocks: [], includedSystemPrompt: false })
    }
    provider.pendingPermissions = new Map()
    provider.emitRequestTrace = vi.fn().mockResolvedValue(undefined)

    return {
      provider,
      prompt,
      cancel,
      open,
      clearMappedSession,
      resolveFirstPrompt: (response: { stopReason: string }) => resolveFirstPrompt(response)
    }
  }
  const createConfigState = (modelValue = 'gpt-5'): AcpConfigState => ({
    source: 'configOptions',
    options: [
      {
        id: 'model',
        label: 'Model',
        type: 'select',
        category: 'model',
        currentValue: modelValue,
        options: [
          { value: 'gpt-5', label: 'gpt-5' },
          { value: 'gpt-5-mini', label: 'gpt-5-mini' }
        ]
      },
      {
        id: 'safe_edits',
        label: 'Safe Edits',
        type: 'boolean',
        currentValue: true
      }
    ]
  })

  it('keeps the active standalone owner until its cancelled ACP prompt settles', async () => {
    const { provider, prompt, cancel, open, resolveFirstPrompt } = createStandaloneProvider()
    const controller = new AbortController()
    const reason = new DOMException('Memory request aborted', 'AbortError')
    const first = provider.generateText('first', 'agent1', undefined, undefined, {
      signal: controller.signal
    })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())

    const second = provider.generateText('second', 'agent1')
    controller.abort(reason)
    const firstAssertion = expect(first).rejects.toBe(reason)
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())

    expect(open).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledTimes(1)

    resolveFirstPrompt({ stopReason: 'cancelled' })
    await firstAssertion
    await expect(second).resolves.toEqual({ content: '', reasoning_content: '' })

    expect(open).toHaveBeenCalledTimes(2)
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('removes an aborted queued standalone request without opening the shared session', async () => {
    const { provider, prompt, cancel, open, resolveFirstPrompt } = createStandaloneProvider()
    const first = provider.generateText('first', 'agent1')
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    const controller = new AbortController()
    const reason = new DOMException('Queued request aborted', 'AbortError')
    const queued = provider.generateText('queued', 'agent1', undefined, undefined, {
      signal: controller.signal
    })

    controller.abort(reason)

    await expect(queued).rejects.toBe(reason)
    expect(open).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()

    resolveFirstPrompt({ stopReason: 'end_turn' })
    await expect(first).resolves.toEqual({ content: '', reasoning_content: '' })
  })

  it('rejects a pre-aborted standalone request before opening an ACP session', async () => {
    const { provider, prompt, open } = createStandaloneProvider()
    const controller = new AbortController()
    const reason = new DOMException('Already aborted', 'AbortError')
    controller.abort(reason)

    await expect(
      provider.generateText('prompt', 'agent1', undefined, undefined, {
        signal: controller.signal
      })
    ).rejects.toBe(reason)

    expect(open).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('forwards caller cancellation while opening the standalone ACP session', async () => {
    const { provider, prompt, open } = createStandaloneProvider()
    let openSignal: AbortSignal | undefined
    open.mockReset().mockImplementation((_conversationId, _agent, hooks) => {
      openSignal = hooks.signal
      return new Promise((_resolve, reject) => {
        hooks.signal.addEventListener('abort', () => reject(hooks.signal.reason), { once: true })
      })
    })
    const controller = new AbortController()
    const reason = new DOMException('Session open aborted', 'AbortError')

    const generating = provider.generateText('prompt', 'agent1', undefined, undefined, {
      signal: controller.signal
    })
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    expect(openSignal).toBe(controller.signal)
    controller.abort(reason)

    await expect(generating).rejects.toBe(reason)
    expect(prompt).not.toHaveBeenCalled()
  })

  it('returns error result when process manager is shutting down', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.agentSettings = {
      getAcpAgents: vi.fn().mockResolvedValue([agent])
    }
    provider.processManager = {
      getConnection: vi
        .fn()
        .mockRejectedValue(new Error('[ACP] Process manager is shutting down, refusing to spawn'))
    }

    const result = await provider.runDebugAction({
      agentId: 'agent1',
      action: 'initialize',
      workdir: '/tmp'
    } as any)

    expect(result).toEqual({
      status: 'error',
      sessionId: undefined,
      error: 'Process manager is shutting down',
      events: []
    })
  })

  it('rethrows non-shutdown getConnection errors', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.agentSettings = {
      getAcpAgents: vi.fn().mockResolvedValue([agent])
    }
    provider.processManager = {
      getConnection: vi.fn().mockRejectedValue(new Error('boom'))
    }

    await expect(
      provider.runDebugAction({
        agentId: 'agent1',
        action: 'initialize',
        workdir: '/tmp'
      } as any)
    ).rejects.toThrow('boom')
  })

  it('skips warmup when the selected workdir is unavailable', async () => {
    const warmupProcess = vi.fn().mockResolvedValue(undefined)
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.getAgentById = vi.fn().mockResolvedValue(agent)
    provider.sessionPersistence = {
      isWorkdirUsable: vi.fn().mockReturnValue(false)
    }
    provider.processManager = {
      warmupProcess
    }

    await provider.warmupProcess('agent1', '/tmp/missing-workdir')

    expect(provider.sessionPersistence.isWorkdirUsable).toHaveBeenCalledWith('/tmp/missing-workdir')
    expect(warmupProcess).not.toHaveBeenCalled()
  })

  it('does not let undefined debug payload cwd overwrite the resolved workdir', async () => {
    const newSession = vi.fn().mockResolvedValue({ sessionId: 'debug-session' })
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.agentSettings = {
      getAcpAgents: vi.fn().mockResolvedValue([agent])
    }
    provider.processManager = {
      getDebugEvents: vi.fn().mockReturnValue([]),
      registerSessionWorkdir: vi.fn(),
      registerSessionListener: vi.fn().mockReturnValue(() => {}),
      registerPermissionResolver: vi.fn().mockReturnValue(() => {}),
      getConnection: vi.fn().mockResolvedValue({
        workdir: '/tmp/debug-workdir',
        mcpCapabilities: undefined,
        connection: {
          newSession
        },
        status: 'ready',
        agentId: 'agent1'
      })
    }
    provider.sessionManager = {
      resolveMcpServersForAgent: vi.fn().mockResolvedValue([])
    }

    const result = await provider.runDebugAction({
      agentId: 'agent1',
      action: 'newSession',
      webContentsId: 42,
      payload: {
        cwd: undefined,
        mcpServers: []
      }
    } as any)

    expect(result.status).toBe('ok')
    expect(newSession).toHaveBeenCalledWith({
      cwd: '/tmp/debug-workdir',
      mcpServers: []
    })
    expect(publishDeepchatEventMock).toHaveBeenCalledWith(
      'providers.acp.debug.event',
      expect.objectContaining({
        webContentsId: 42,
        agentId: 'agent1',
        event: expect.objectContaining({
          kind: 'request',
          action: 'newSession',
          agentId: 'agent1',
          payload: expect.objectContaining({
            cwd: '/tmp/debug-workdir',
            mcpServers: []
          })
        }),
        version: expect.any(Number)
      })
    )
  })

  it('reports debug initialize state without sending a second initialize request', async () => {
    const initialize = vi.fn()
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.agentSettings = {
      getAcpAgents: vi.fn().mockResolvedValue([agent])
    }
    provider.acpRuntime = {
      toConnectionRef: vi.fn().mockReturnValue({
        id: 'agent1:/tmp/debug-workdir',
        agentId: 'agent1',
        workdir: '/tmp/debug-workdir',
        protocolVersion: '1',
        status: 'ready'
      })
    }
    provider.processManager = {
      getDebugEvents: vi.fn().mockReturnValue([]),
      getConnection: vi.fn().mockResolvedValue({
        workdir: '/tmp/debug-workdir',
        connection: { initialize },
        status: 'ready',
        agentId: 'agent1'
      })
    }
    provider.sessionManager = {
      resolveMcpServersForAgent: vi.fn().mockResolvedValue([])
    }

    const result = await provider.runDebugAction({
      agentId: 'agent1',
      action: 'initialize',
      workdir: '/tmp/debug-workdir'
    } as any)

    expect(result.status).toBe('ok')
    expect(initialize).not.toHaveBeenCalled()
    expect(result.events.at(-1)).toMatchObject({
      kind: 'lifecycle',
      action: 'initialize',
      message: 'Connection is already initialized by the ACP runtime.'
    })
  })

  it('syncs remote sessions when debug session/list requests sync', async () => {
    const sessions = [
      {
        sessionId: 'remote-1',
        cwd: '/tmp/debug-workdir',
        title: 'Remote Session'
      }
    ]
    const listSessions = vi.fn().mockResolvedValue({ sessions, nextCursor: null })
    const syncRemoteSessions = vi.fn().mockResolvedValue({
      imported: 1,
      updated: 0,
      skipped: 0,
      sessions: [{ sessionId: 'remote-1', conversationId: 'conv-1', status: 'imported' }]
    })
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.provider = { id: 'acp', name: 'ACP' }
    provider.agentSettings = {
      getAcpAgents: vi.fn().mockResolvedValue([agent])
    }
    provider.processManager = {
      getDebugEvents: vi.fn().mockReturnValue([]),
      getConnection: vi.fn().mockResolvedValue({
        workdir: '/tmp/debug-workdir',
        supportsSessionList: true,
        connection: {
          listSessions
        },
        status: 'ready',
        agentId: 'agent1'
      })
    }
    provider.sessionPersistence = {
      syncRemoteSessions
    }

    const result = await provider.runDebugAction({
      agentId: 'agent1',
      action: 'sessionList',
      payload: { cwd: '/tmp/debug-workdir', sync: true }
    } as any)

    expect(result.status).toBe('ok')
    expect(listSessions).toHaveBeenCalledWith({
      cwd: '/tmp/debug-workdir',
      cursor: undefined
    })
    expect(syncRemoteSessions).toHaveBeenCalledWith({
      agentId: 'agent1',
      agentName: 'Agent 1',
      providerId: 'acp',
      workdir: '/tmp/debug-workdir',
      sessions
    })
    expect(result.events.at(-1)).toMatchObject({
      kind: 'lifecycle',
      action: 'session/list.sync',
      payload: {
        imported: 1,
        updated: 0,
        skipped: 0
      }
    })
  })

  it('normalizes debug session/list cwd before requesting remote sessions', async () => {
    const sessions = [
      {
        sessionId: 'remote-1',
        cwd: '/tmp/missing-workdir',
        title: 'Remote Session'
      }
    ]
    const listSessions = vi.fn().mockResolvedValue({ sessions, nextCursor: null })
    const syncRemoteSessions = vi.fn().mockResolvedValue({
      imported: 1,
      updated: 0,
      skipped: 0,
      sessions: [{ sessionId: 'remote-1', conversationId: 'conv-1', status: 'imported' }]
    })
    const isWorkdirUsable = vi.fn((workdir: string) => workdir === '/tmp/fallback')
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.provider = { id: 'acp', name: 'ACP' }
    provider.agentSettings = {
      getAcpAgents: vi.fn().mockResolvedValue([agent])
    }
    provider.processManager = {
      getDebugEvents: vi.fn().mockReturnValue([]),
      getConnection: vi.fn().mockResolvedValue({
        workdir: '/tmp/fallback',
        supportsSessionList: true,
        connection: {
          listSessions
        },
        status: 'ready',
        agentId: 'agent1'
      })
    }
    provider.sessionPersistence = {
      isWorkdirUsable,
      syncRemoteSessions
    }

    const result = await provider.runDebugAction({
      agentId: 'agent1',
      action: 'sessionList',
      workdir: '/tmp/missing-from-dialog',
      payload: { cwd: '/tmp/missing-workdir', sync: true }
    } as any)

    expect(result.status).toBe('ok')
    expect(isWorkdirUsable).toHaveBeenCalledWith('/tmp/missing-workdir')
    expect(listSessions).toHaveBeenCalledWith({
      cwd: '/tmp/fallback',
      cursor: undefined
    })
    expect(syncRemoteSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        workdir: '/tmp/fallback',
        sessions
      })
    )
  })

  it('falls back when a cached debug handle workdir becomes unavailable', async () => {
    const sessions = [
      {
        sessionId: 'remote-1',
        cwd: '/tmp/stale-workdir',
        title: 'Remote Session'
      }
    ]
    const listSessions = vi.fn().mockResolvedValue({ sessions, nextCursor: null })
    const syncRemoteSessions = vi.fn().mockResolvedValue({
      imported: 1,
      updated: 0,
      skipped: 0,
      sessions: [{ sessionId: 'remote-1', conversationId: 'conv-1', status: 'imported' }]
    })
    const isWorkdirUsable = vi.fn((workdir: string) => workdir === '/tmp/default-workdir')
    const resolveWorkdir = vi.fn().mockReturnValue('/tmp/default-workdir')
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.provider = { id: 'acp', name: 'ACP' }
    provider.agentSettings = {
      getAcpAgents: vi.fn().mockResolvedValue([agent])
    }
    provider.processManager = {
      getDebugEvents: vi.fn().mockReturnValue([]),
      getConnection: vi.fn().mockResolvedValue({
        workdir: '/tmp/stale-workdir',
        supportsSessionList: true,
        connection: {
          listSessions
        },
        status: 'ready',
        agentId: 'agent1'
      })
    }
    provider.sessionPersistence = {
      isWorkdirUsable,
      resolveWorkdir,
      syncRemoteSessions
    }

    const result = await provider.runDebugAction({
      agentId: 'agent1',
      action: 'sessionList',
      workdir: '/tmp/stale-workdir',
      payload: { sync: true }
    } as any)

    expect(result.status).toBe('ok')
    expect(isWorkdirUsable).toHaveBeenCalledWith('/tmp/stale-workdir')
    expect(resolveWorkdir).toHaveBeenCalledWith('/tmp/stale-workdir')
    expect(listSessions).toHaveBeenCalledWith({
      cwd: '/tmp/default-workdir',
      cursor: undefined
    })
    expect(syncRemoteSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        workdir: '/tmp/default-workdir',
        sessions
      })
    )
  })

  it('binds the forked debug session workdir and listeners', async () => {
    const unstableForkSession = vi.fn().mockResolvedValue({ sessionId: 'forked-session' })
    const registerSessionWorkdir = vi.fn()
    const registerSessionListener = vi.fn().mockReturnValue(() => {})
    const registerPermissionResolver = vi.fn().mockReturnValue(() => {})
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.agentSettings = {
      getAcpAgents: vi.fn().mockResolvedValue([agent])
    }
    provider.processManager = {
      getDebugEvents: vi.fn().mockReturnValue([]),
      registerSessionWorkdir,
      registerSessionListener,
      registerPermissionResolver,
      getConnection: vi.fn().mockResolvedValue({
        workdir: '/tmp/debug-workdir',
        supportsSessionFork: true,
        connection: {
          unstable_forkSession: unstableForkSession
        },
        status: 'ready',
        agentId: 'agent1'
      })
    }
    provider.sessionManager = {
      resolveMcpServersForAgent: vi.fn().mockResolvedValue([])
    }

    const result = await provider.runDebugAction({
      agentId: 'agent1',
      action: 'sessionFork',
      sessionId: 'source-session',
      payload: { cwd: '/tmp/debug-workdir', mcpServers: [] }
    } as any)

    expect(result.status).toBe('ok')
    expect(result.sessionId).toBe('forked-session')
    expect(unstableForkSession).toHaveBeenCalledWith({
      cwd: '/tmp/debug-workdir',
      mcpServers: [],
      sessionId: 'source-session'
    })
    expect(registerSessionWorkdir).toHaveBeenCalledWith('forked-session', '/tmp/debug-workdir')
    expect(registerSessionListener).toHaveBeenCalledWith(
      'agent1',
      'forked-session',
      expect.any(Function)
    )
    expect(registerPermissionResolver).toHaveBeenCalledWith(
      'agent1',
      'forked-session',
      expect.any(Function)
    )
  })

  it('uses real ACP MCP selections for debug sessions', async () => {
    const mcpServers = [{ name: 'fs', command: 'node', args: ['server.js'] }]
    const newSession = vi.fn().mockResolvedValue({ sessionId: 'debug-session' })
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.agentSettings = {
      getAcpAgents: vi.fn().mockResolvedValue([agent])
    }
    provider.processManager = {
      getDebugEvents: vi.fn().mockReturnValue([]),
      registerSessionWorkdir: vi.fn(),
      registerSessionListener: vi.fn().mockReturnValue(() => {}),
      registerPermissionResolver: vi.fn().mockReturnValue(() => {}),
      getConnection: vi.fn().mockResolvedValue({
        workdir: '/tmp/debug-workdir',
        mcpCapabilities: undefined,
        connection: {
          newSession
        },
        status: 'ready',
        agentId: 'agent1'
      })
    }
    provider.sessionManager = {
      resolveMcpServersForAgent: vi.fn().mockResolvedValue(mcpServers)
    }

    const result = await provider.runDebugAction({
      agentId: 'agent1',
      action: 'newSession',
      workdir: '/tmp/debug-workdir'
    } as any)

    expect(result.status).toBe('ok')
    expect(provider.sessionManager.resolveMcpServersForAgent).toHaveBeenCalledWith(
      'agent1',
      undefined
    )
    expect(newSession).toHaveBeenCalledWith({
      cwd: '/tmp/debug-workdir',
      mcpServers
    })
  })

  it('returns cached ACP session commands', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.sessionManager = {
      getSession: vi.fn().mockReturnValue({
        availableCommands: [{ name: 'review', description: 'run review', input: null }]
      })
    }
    attachSessionController(provider, provider.sessionManager)

    const commands = await provider.getSessionCommands('conv-1')
    expect(commands).toEqual([{ name: 'review', description: 'run review', input: null }])
  })

  it('maps execute permissions to command and includes the raw command', () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.provider = { id: 'acp', name: 'ACP' }

    const payload = provider.buildPermissionPayload(
      {
        sessionId: 'session-1',
        toolCall: {
          toolCallId: 'tc-terminal',
          title: 'Terminal',
          kind: 'execute',
          rawInput: { command: 'dir' }
        },
        options: []
      },
      {
        conversationId: 'conv-1',
        agent: {
          id: 'agent1',
          name: 'Claude Agent',
          command: 'claude'
        }
      },
      'req-1'
    )

    expect(payload.permissionType).toBe('command')
    expect(payload.command).toBe('dir')
    expect(payload.description).toBe('components.messageBlockPermissionRequest.description.command')
  })

  it('cancels pending permission requests when they time out', async () => {
    vi.useFakeTimers()

    try {
      const provider = Object.create(AcpProvider.prototype) as any
      provider.publishEvent = publishDeepchatEventMock
      provider.pendingPermissions = new Map()

      const { requestId, promise } = provider.registerPendingPermission(
        {
          sessionId: 'session-1',
          toolCall: {
            toolCallId: 'tc-terminal',
            title: 'Terminal',
            kind: 'execute',
            rawInput: { command: 'dir' }
          },
          options: []
        },
        {
          conversationId: 'conv-1',
          agent: { id: 'agent1', name: 'Claude Agent', command: 'claude' }
        }
      )

      expect(provider.pendingPermissions.has(requestId)).toBe(true)

      await vi.advanceTimersByTimeAsync(60_000)

      await expect(promise).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
      expect(provider.pendingPermissions.has(requestId)).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels pending and late permission requests after caller abort', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.provider = { id: 'acp', name: 'ACP' }
    provider.pendingPermissions = new Map()
    const queue = { push: vi.fn() }
    const params = {
      sessionId: 'session-1',
      toolCall: {
        toolCallId: 'tc-terminal',
        title: 'Terminal',
        kind: 'execute',
        rawInput: { command: 'dir' }
      },
      options: []
    }
    const context = {
      conversationId: 'conv-1',
      agent: { id: 'agent1', name: 'Claude Agent', command: 'claude' }
    }
    const controller = new AbortController()

    const pending = provider.handlePermissionRequest(queue, params, context, controller.signal)
    await vi.waitFor(() => expect(queue.push).toHaveBeenCalledTimes(2))
    controller.abort(new DOMException('Memory request aborted', 'AbortError'))

    await expect(pending).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    expect(provider.pendingPermissions.size).toBe(0)

    const lateQueue = { push: vi.fn() }
    await expect(
      provider.handlePermissionRequest(lateQueue, params, context, controller.signal)
    ).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    expect(lateQueue.push).not.toHaveBeenCalled()
  })

  it('clears pending permission timeout when resolving a request', async () => {
    vi.useFakeTimers()

    try {
      const provider = Object.create(AcpProvider.prototype) as any
      provider.publishEvent = publishDeepchatEventMock
      provider.pendingPermissions = new Map()

      const { requestId, promise } = provider.registerPendingPermission(
        {
          sessionId: 'session-1',
          toolCall: {
            toolCallId: 'tc-terminal',
            title: 'Terminal',
            kind: 'execute',
            rawInput: { command: 'dir' }
          },
          options: [{ optionId: 'allow-1', kind: 'allow_once', name: 'Allow' }]
        },
        {
          conversationId: 'conv-1',
          agent: { id: 'agent1', name: 'Claude Agent', command: 'claude' }
        }
      )

      await provider.resolvePermissionRequest(requestId, true)

      await expect(promise).resolves.toEqual({
        outcome: { outcome: 'selected', optionId: 'allow-1' }
      })
      expect(provider.pendingPermissions.has(requestId)).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns cached process config options from the warm process handle', () => {
    const configState = createConfigState()
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.processManager = {
      getProcessConfigState: vi.fn().mockReturnValue(configState)
    }

    expect(provider.getProcessConfigOptions('agent1', '/tmp/workspace')).toEqual(configState)
    expect(provider.processManager.getProcessConfigState).toHaveBeenCalledWith(
      'agent1',
      '/tmp/workspace'
    )
  })

  it('writes session config options using the full response state and syncs the bound process cache', async () => {
    const initialConfig = createConfigState()
    const updatedConfigOptions = [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        category: 'model',
        currentValue: 'gpt-5-mini',
        options: [
          { value: 'gpt-5', name: 'gpt-5' },
          { value: 'gpt-5-mini', name: 'gpt-5-mini' }
        ]
      },
      {
        id: 'safe_edits',
        name: 'Safe Edits',
        type: 'boolean',
        currentValue: true
      }
    ]
    const session = {
      sessionId: 's-1',
      agentId: 'agent1',
      workdir: '/tmp/workspace',
      configState: initialConfig,
      connection: {
        setSessionConfigOption: vi.fn().mockResolvedValue({
          configOptions: updatedConfigOptions
        })
      }
    }

    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.sessionManager = {
      getSession: vi.fn().mockReturnValue(session)
    }
    provider.processManager = {
      updateBoundProcessConfigState: vi.fn().mockReturnValue(true)
    }
    attachSessionController(provider, provider.sessionManager, provider.processManager)

    const nextState = await provider.setSessionConfigOption('conv-1', 'model', 'gpt-5-mini')

    expect(session.connection.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 's-1',
      configId: 'model',
      value: 'gpt-5-mini'
    })
    expect(nextState).toEqual({
      source: 'configOptions',
      options: [
        {
          id: 'model',
          label: 'Model',
          description: null,
          type: 'select',
          category: 'model',
          currentValue: 'gpt-5-mini',
          options: [
            {
              value: 'gpt-5',
              label: 'gpt-5',
              description: null,
              groupId: null,
              groupLabel: null
            },
            {
              value: 'gpt-5-mini',
              label: 'gpt-5-mini',
              description: null,
              groupId: null,
              groupLabel: null
            }
          ]
        },
        {
          id: 'safe_edits',
          label: 'Safe Edits',
          description: null,
          type: 'boolean',
          category: null,
          currentValue: true
        }
      ]
    })
    expect(session.configState).toEqual(nextState)
    expect(provider.processManager.updateBoundProcessConfigState).toHaveBeenCalledWith(
      'conv-1',
      nextState
    )
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.acp.configOptions.ready', {
      conversationId: 'conv-1',
      agentId: 'agent1',
      workdir: '/tmp/workspace',
      configState: nextState,
      version: expect.any(Number)
    })
  })

  it('preserves legacy mode options when setSessionConfigOption only returns config options', async () => {
    const initialConfig: AcpConfigState = {
      source: 'configOptions',
      options: [
        {
          id: LEGACY_MODE_CONFIG_ID,
          label: 'Mode',
          description: null,
          type: 'select',
          category: 'mode',
          currentValue: 'code',
          options: [
            { value: 'code', label: 'code' },
            { value: 'ask', label: 'ask' }
          ]
        },
        {
          id: 'safe_edits',
          label: 'Safe Edits',
          description: null,
          type: 'boolean',
          category: null,
          currentValue: false
        }
      ]
    }
    const session = {
      sessionId: 's-2',
      agentId: 'agent1',
      workdir: '/tmp/workspace',
      currentModeId: 'code',
      availableModes: [{ id: 'code', name: 'code', description: '' }],
      configState: initialConfig,
      connection: {
        setSessionConfigOption: vi.fn().mockResolvedValue({
          configOptions: [
            {
              id: 'safe_edits',
              name: 'Safe Edits',
              type: 'boolean',
              currentValue: true
            }
          ]
        })
      }
    }

    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.sessionManager = {
      getSession: vi.fn().mockReturnValue(session)
    }
    provider.processManager = {
      updateBoundProcessConfigState: vi.fn().mockReturnValue(true)
    }
    attachSessionController(provider, provider.sessionManager, provider.processManager)

    const nextState = await provider.setSessionConfigOption('conv-2', 'safe_edits', true)

    expect(nextState).toEqual({
      source: 'configOptions',
      options: [
        {
          id: LEGACY_MODE_CONFIG_ID,
          label: 'Mode',
          description: null,
          type: 'select',
          category: 'mode',
          currentValue: 'code',
          options: [
            {
              value: 'code',
              label: 'code'
            },
            {
              value: 'ask',
              label: 'ask'
            }
          ]
        },
        {
          id: 'safe_edits',
          label: 'Safe Edits',
          description: null,
          type: 'boolean',
          category: null,
          currentValue: true
        }
      ]
    })
    expect(session.configState).toEqual(nextState)
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.acp.modes.ready', {
      conversationId: 'conv-2',
      agentId: 'agent1',
      workdir: '/tmp/workspace',
      current: 'code',
      available: [
        { id: 'code', name: 'code', description: '' },
        { id: 'ask', name: 'ask', description: '' }
      ],
      version: expect.any(Number)
    })
  })

  it('cancels the ACP prompt when the model timeout elapses', async () => {
    vi.useFakeTimers()

    try {
      const provider = Object.create(AcpProvider.prototype) as any
      provider.publishEvent = publishDeepchatEventMock
      provider.pendingPermissions = new Map()
      provider.emitRequestTrace = vi.fn().mockResolvedValue(undefined)
      provider.promptController = {
        begin: vi.fn().mockReturnValue({
          id: 'turn-timeout',
          sessionId: 'session-timeout',
          conversationId: 'conv-timeout',
          userMessageId: null,
          startedAt: Date.now()
        }),
        complete: vi.fn(),
        fail: vi.fn().mockReturnValue({
          id: 'turn-timeout',
          completedAt: Date.now()
        })
      }
      provider.sessionPersistence = {
        startTurn: vi.fn().mockResolvedValue(undefined),
        finishTurn: vi.fn().mockResolvedValue(undefined)
      }

      const cancel = vi.fn().mockResolvedValue(undefined)
      let resolvePrompt!: (response: { stopReason: string }) => void
      const prompt = vi.fn().mockImplementation(
        () =>
          new Promise<{ stopReason: string }>((resolve) => {
            resolvePrompt = resolve
          })
      )
      const queue = {
        push: vi.fn(),
        done: vi.fn()
      }

      const runPrompt = provider['runPrompt'](
        {
          sessionId: 'session-timeout',
          conversationId: 'conv-timeout',
          connection: {
            prompt,
            cancel
          }
        },
        [],
        queue,
        { timeout: 25 }
      )

      await vi.advanceTimersByTimeAsync(25)
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
      expect(queue.done).not.toHaveBeenCalled()

      resolvePrompt({ stopReason: 'cancelled' })
      await runPrompt

      expect(cancel).toHaveBeenCalledWith({ sessionId: 'session-timeout' })
      expect(queue.push).toHaveBeenCalledWith({
        type: 'error',
        error_message: 'ACP: Request timed out after 25ms'
      })
      expect(queue.done).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for prompt settlement when caller cancellation throws synchronously', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.pendingPermissions = new Map()
    provider.emitRequestTrace = vi.fn().mockResolvedValue(undefined)
    provider.promptController = {
      begin: vi.fn().mockReturnValue({
        id: 'turn-cancelled',
        sessionId: 'session-cancelled',
        conversationId: 'conv-cancelled',
        userMessageId: null,
        startedAt: Date.now()
      }),
      complete: vi.fn(),
      cancel: vi.fn().mockReturnValue({
        id: 'turn-cancelled',
        completedAt: Date.now()
      }),
      fail: vi.fn()
    }
    provider.sessionPersistence = {
      startTurn: vi.fn().mockResolvedValue(undefined),
      finishTurn: vi.fn().mockResolvedValue(undefined)
    }

    const cancelError = new Error('synchronous cancel failure')
    const cancel = vi.fn(() => {
      throw cancelError
    })
    let resolvePrompt!: (response: { stopReason: string }) => void
    const prompt = vi.fn().mockImplementation(
      () =>
        new Promise<{ stopReason: string }>((resolve) => {
          resolvePrompt = resolve
        })
    )
    const queue = {
      push: vi.fn(),
      done: vi.fn()
    }
    const controller = new AbortController()

    const runPrompt = provider['runPrompt'](
      {
        sessionId: 'session-cancelled',
        conversationId: 'conv-cancelled',
        connection: {
          prompt,
          cancel
        }
      },
      [],
      queue,
      {},
      { signal: controller.signal }
    )

    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    controller.abort(new DOMException('Memory request aborted', 'AbortError'))
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(provider.promptController.cancel).not.toHaveBeenCalled()
    expect(queue.done).not.toHaveBeenCalled()

    resolvePrompt({ stopReason: 'cancelled' })
    await runPrompt

    expect(cancel).toHaveBeenCalledWith({ sessionId: 'session-cancelled' })
    expect(provider.promptController.cancel).toHaveBeenCalledWith('session-cancelled')
    expect(provider.promptController.fail).not.toHaveBeenCalled()
    expect(provider.sessionPersistence.finishTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'turn-cancelled',
        status: 'cancelled',
        stopReason: 'cancelled'
      })
    )
    expect(queue.push).not.toHaveBeenCalled()
    expect(queue.done).toHaveBeenCalledTimes(1)
  })

  it('keeps a prompt failure as the first result when caller abort follows immediately', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.pendingPermissions = new Map()
    provider.emitRequestTrace = vi.fn().mockResolvedValue(undefined)
    provider.promptController = {
      begin: vi.fn().mockReturnValue({
        id: 'turn-prompt-error',
        sessionId: 'session-prompt-error',
        conversationId: 'conv-prompt-error',
        userMessageId: null,
        startedAt: Date.now()
      }),
      complete: vi.fn(),
      cancel: vi.fn(),
      fail: vi.fn().mockReturnValue({
        id: 'turn-prompt-error',
        completedAt: Date.now()
      })
    }
    provider.sessionPersistence = {
      startTurn: vi.fn().mockResolvedValue(undefined),
      finishTurn: vi.fn().mockResolvedValue(undefined)
    }

    let rejectPrompt!: (reason: Error) => void
    const prompt = vi.fn(
      () =>
        new Promise<{ stopReason: string }>((_resolve, reject) => {
          rejectPrompt = reject
        })
    )
    const cancel = vi.fn().mockResolvedValue(undefined)
    const queue = {
      push: vi.fn(),
      done: vi.fn()
    }
    const controller = new AbortController()
    const promptError = new Error('prompt transport failed')

    const runPrompt = provider['runPrompt'](
      {
        sessionId: 'session-prompt-error',
        conversationId: 'conv-prompt-error',
        connection: {
          prompt,
          cancel
        }
      },
      [],
      queue,
      {},
      { signal: controller.signal }
    )

    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    rejectPrompt(promptError)
    controller.abort(new DOMException('late caller abort', 'AbortError'))
    await runPrompt

    expect(cancel).not.toHaveBeenCalled()
    expect(provider.promptController.cancel).not.toHaveBeenCalled()
    expect(provider.promptController.fail).toHaveBeenCalledWith('session-prompt-error')
    expect(provider.sessionPersistence.finishTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'turn-prompt-error',
        status: 'error',
        stopReason: 'error'
      })
    )
    expect(queue.push).toHaveBeenCalledWith({
      type: 'error',
      error_message: 'ACP: prompt transport failed'
    })
    expect(queue.done).toHaveBeenCalledTimes(1)
  })

  it('marks the system prompt as sent only after the ACP prompt succeeds', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.emitRequestTrace = vi.fn().mockResolvedValue(undefined)
    provider.promptController = {
      begin: vi.fn().mockReturnValue({
        id: 'turn-system',
        sessionId: 'session-system',
        conversationId: 'conv-system',
        userMessageId: null,
        startedAt: Date.now()
      }),
      complete: vi.fn().mockReturnValue({
        id: 'turn-system',
        completedAt: Date.now()
      }),
      fail: vi.fn()
    }
    provider.sessionPersistence = {
      startTurn: vi.fn().mockResolvedValue(undefined),
      finishTurn: vi.fn().mockResolvedValue(undefined)
    }

    let resolvePrompt!: (value: { stopReason: string }) => void
    const prompt = vi.fn(
      () =>
        new Promise<{ stopReason: string }>((resolve) => {
          resolvePrompt = resolve
        })
    )
    const queue = {
      push: vi.fn(),
      done: vi.fn()
    }
    const onPromptSucceeded = vi.fn()

    const runPrompt = provider['runPrompt'](
      {
        sessionId: 'session-system',
        conversationId: 'conv-system',
        connection: {
          prompt
        }
      },
      [{ type: 'text', text: 'System instructions:\nBe precise.' }],
      queue,
      {},
      { onPromptSucceeded }
    )

    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    expect(onPromptSucceeded).not.toHaveBeenCalled()

    resolvePrompt({ stopReason: 'end_turn' })
    await runPrompt

    expect(onPromptSucceeded).toHaveBeenCalledTimes(1)
    expect(queue.done).toHaveBeenCalledTimes(1)
  })

  it('keeps prompt dispatch fail-open when trace persistence fails', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.provider = { id: 'acp' }
    provider.promptController = {
      begin: vi.fn().mockReturnValue({
        id: 'turn-trace',
        sessionId: 'session-trace',
        conversationId: 'conv-trace',
        userMessageId: null,
        startedAt: Date.now()
      }),
      complete: vi.fn(),
      fail: vi.fn().mockReturnValue({
        id: 'turn-trace',
        completedAt: Date.now()
      })
    }
    provider.sessionPersistence = {
      startTurn: vi.fn().mockResolvedValue(undefined),
      finishTurn: vi.fn().mockResolvedValue(undefined)
    }

    const prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' })
    const queue = {
      push: vi.fn(),
      done: vi.fn()
    }
    const onPromptSucceeded = vi.fn()
    const persistTrace = vi.fn().mockRejectedValue(new Error('trace failed'))

    await provider['runPrompt'](
      {
        sessionId: 'session-trace',
        conversationId: 'conv-trace',
        connection: {
          prompt
        }
      },
      [{ type: 'text', text: 'System instructions:\nBe precise.' }],
      queue,
      {
        requestTraceContext: {
          enabled: true,
          persist: persistTrace
        }
      },
      { onPromptSucceeded }
    )

    expect(persistTrace).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(onPromptSucceeded).toHaveBeenCalledTimes(1)
    expect(queue.push).toHaveBeenCalledWith({ type: 'stop', stop_reason: 'complete' })
    expect(queue.done).toHaveBeenCalledTimes(1)
  })

  it('awaits turn start persistence before sending the ACP prompt', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.publishEvent = publishDeepchatEventMock
    provider.emitRequestTrace = vi.fn().mockResolvedValue(undefined)
    provider.promptController = {
      begin: vi.fn().mockReturnValue({
        id: 'turn-start',
        sessionId: 'session-start',
        conversationId: 'conv-start',
        userMessageId: null,
        startedAt: Date.now()
      }),
      complete: vi.fn().mockReturnValue({
        id: 'turn-start',
        completedAt: Date.now()
      }),
      fail: vi.fn()
    }

    let resolveStart!: () => void
    const startTurn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve
        })
    )
    const finishTurn = vi.fn().mockResolvedValue(undefined)
    provider.sessionPersistence = {
      startTurn,
      finishTurn
    }

    const prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' })
    const queue = {
      push: vi.fn(),
      done: vi.fn()
    }

    const runPrompt = provider['runPrompt'](
      {
        sessionId: 'session-start',
        conversationId: 'conv-start',
        connection: {
          prompt
        }
      },
      [],
      queue,
      {}
    )

    expect(startTurn).toHaveBeenCalledTimes(1)
    expect(prompt).not.toHaveBeenCalled()

    resolveStart()
    await runPrompt

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(finishTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'turn-start',
        status: 'completed',
        stopReason: 'end_turn'
      })
    )
    expect(queue.done).toHaveBeenCalledTimes(1)
  })
})
