import { beforeEach, describe, it, expect, vi } from 'vitest'
import { AcpProvider } from '../../../src/main/presenter/llmProviderPresenter/providers/acpProvider'
import { LEGACY_MODE_CONFIG_ID } from '../../../src/main/presenter/llmProviderPresenter/acp'
import { eventBus } from '@/eventbus'
import type { AcpConfigState } from '../../../src/shared/types/presenters'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp')
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    emit: vi.fn(),
    send: vi.fn()
  }
}))

vi.mock('@/presenter', () => ({
  presenter: {
    mcpPresenter: {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn().mockResolvedValue({ content: '', rawData: {} })
    }
  }
}))

vi.mock('@/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

describe('AcpProvider runDebugAction error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const agent = { id: 'agent1', name: 'Agent 1' }
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

  it('returns error result when process manager is shutting down', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.configPresenter = {
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
    provider.configPresenter = {
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
    provider.configPresenter = {
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
    expect(eventBus.send).not.toHaveBeenCalled()
  })

  it('reports debug initialize state without sending a second initialize request', async () => {
    const initialize = vi.fn()
    const provider = Object.create(AcpProvider.prototype) as any
    provider.configPresenter = {
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
    provider.provider = { id: 'acp', name: 'ACP' }
    provider.configPresenter = {
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
    provider.provider = { id: 'acp', name: 'ACP' }
    provider.configPresenter = {
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
    provider.provider = { id: 'acp', name: 'ACP' }
    provider.configPresenter = {
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
    provider.configPresenter = {
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
    provider.configPresenter = {
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
    provider.sessionManager = {
      getSession: vi.fn().mockReturnValue({
        availableCommands: [{ name: 'review', description: 'run review', input: null }]
      })
    }

    const commands = await provider.getSessionCommands('conv-1')
    expect(commands).toEqual([{ name: 'review', description: 'run review', input: null }])
  })

  it('maps execute permissions to command and includes the raw command', () => {
    const provider = Object.create(AcpProvider.prototype) as any
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

  it('prepares ACP session without prompt and emits ready events', async () => {
    const configState = createConfigState()
    const provider = Object.create(AcpProvider.prototype) as any
    provider.getAgentById = vi.fn().mockResolvedValue({ id: 'agent1', name: 'Agent 1' })
    provider.sessionPersistence = {
      isWorkdirUsable: vi.fn().mockReturnValue(true),
      resolveWorkdir: vi.fn((workdir) => workdir),
      updateWorkdir: vi.fn().mockResolvedValue(undefined)
    }
    provider.sessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({
        workdir: '/tmp/workspace',
        currentModeId: 'default',
        availableModes: [{ id: 'default', name: 'Default', description: '' }],
        configState,
        availableCommands: [{ name: 'review', description: 'run review', input: null }]
      })
    }

    await provider.prepareSession('conv-2', 'agent1', '/tmp/workspace')

    expect(provider.sessionPersistence.updateWorkdir).toHaveBeenCalledWith(
      'conv-2',
      'agent1',
      '/tmp/workspace'
    )
    expect(provider.sessionManager.getOrCreateSession).toHaveBeenCalledWith(
      'conv-2',
      { id: 'agent1', name: 'Agent 1' },
      expect.objectContaining({
        onSessionUpdate: expect.any(Function),
        onPermission: expect.any(Function)
      }),
      '/tmp/workspace'
    )
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.acp.modes.ready', {
      conversationId: 'conv-2',
      agentId: 'agent1',
      workdir: '/tmp/workspace',
      current: 'default',
      available: [{ id: 'default', name: 'Default', description: '' }],
      version: expect.any(Number)
    })
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.acp.configOptions.ready', {
      conversationId: 'conv-2',
      agentId: 'agent1',
      workdir: '/tmp/workspace',
      configState,
      version: expect.any(Number)
    })
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.acp.commands.ready', {
      conversationId: 'conv-2',
      agentId: 'agent1',
      commands: [{ name: 'review', description: 'run review', input: null }],
      version: expect.any(Number)
    })
  })

  it('falls back when prepareSession receives an unavailable workdir', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.getAgentById = vi.fn().mockResolvedValue({ id: 'agent1', name: 'Agent 1' })
    provider.sessionPersistence = {
      isWorkdirUsable: vi.fn().mockReturnValue(false),
      resolveWorkdir: vi.fn().mockReturnValue('/tmp/fallback'),
      updateWorkdir: vi.fn().mockResolvedValue(undefined)
    }
    provider.sessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({
        workdir: '/tmp/fallback',
        currentModeId: undefined,
        availableModes: undefined,
        configState: null,
        availableCommands: []
      })
    }

    await provider.prepareSession('conv-2', 'agent1', '/tmp/missing-workspace')

    expect(provider.sessionPersistence.updateWorkdir).toHaveBeenCalledWith('conv-2', 'agent1', null)
    expect(provider.sessionManager.getOrCreateSession).toHaveBeenCalledWith(
      'conv-2',
      { id: 'agent1', name: 'Agent 1' },
      expect.any(Object),
      '/tmp/fallback'
    )
  })

  it('updates mode on bound handle by conversation id', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    const setSessionMode = vi.fn().mockResolvedValue(undefined)
    provider.sessionManager = {
      getSession: vi.fn().mockReturnValue({
        sessionId: 's-1',
        agentId: 'agent1',
        workdir: '/tmp/workspace',
        currentModeId: 'default',
        availableModes: [{ id: 'default', name: 'Default', description: '' }],
        connection: { setSessionMode }
      })
    }
    provider.processManager = {
      updateBoundProcessMode: vi.fn().mockReturnValue(true)
    }

    await provider.setSessionMode('conv-a', 'default')

    expect(setSessionMode).toHaveBeenCalledWith({ sessionId: 's-1', modeId: 'default' })
    expect(provider.processManager.updateBoundProcessMode).toHaveBeenCalledWith('conv-a', 'default')
  })

  it('still emits mode event when bound handle is unavailable', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.sessionManager = {
      getSession: vi.fn().mockReturnValue({
        sessionId: 's-2',
        agentId: 'agent1',
        workdir: '/tmp/workspace',
        currentModeId: 'default',
        availableModes: [{ id: 'default', name: 'Default', description: '' }],
        connection: { setSessionMode: vi.fn().mockResolvedValue(undefined) }
      })
    }
    provider.processManager = {
      updateBoundProcessMode: vi.fn().mockReturnValue(false)
    }

    await provider.setSessionMode('conv-b', 'default')

    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.acp.modes.ready', {
      conversationId: 'conv-b',
      agentId: 'agent1',
      workdir: '/tmp/workspace',
      current: 'default',
      available: [{ id: 'default', name: 'Default', description: '' }],
      version: expect.any(Number)
    })
  })

  it('returns cached process config options from the warm process handle', () => {
    const configState = createConfigState()
    const provider = Object.create(AcpProvider.prototype) as any
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
    provider.sessionManager = {
      getSession: vi.fn().mockReturnValue(session)
    }
    provider.processManager = {
      updateBoundProcessConfigState: vi.fn().mockReturnValue(true)
    }

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
    provider.sessionManager = {
      getSession: vi.fn().mockReturnValue(session)
    }
    provider.processManager = {
      updateBoundProcessConfigState: vi.fn().mockReturnValue(true)
    }
    provider.emitSessionModesReady = vi.fn()
    provider.emitSessionConfigOptionsReady = vi.fn()

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
    expect(provider.emitSessionModesReady).toHaveBeenCalledWith(
      'conv-2',
      'agent1',
      '/tmp/workspace',
      'code',
      [
        { id: 'code', name: 'code', description: '' },
        { id: 'ask', name: 'ask', description: '' }
      ]
    )
  })

  it('cancels the ACP prompt when the model timeout elapses', async () => {
    vi.useFakeTimers()

    try {
      const provider = Object.create(AcpProvider.prototype) as any
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
      const prompt = vi.fn().mockImplementation(() => new Promise(() => {}))
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

  it('marks the system prompt as sent only after the ACP prompt succeeds', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
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

  it('does not mark the system prompt when prompt dispatch fails first', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
    provider.emitRequestTrace = vi.fn().mockRejectedValue(new Error('trace failed'))
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
      {},
      { onPromptSucceeded }
    )

    expect(prompt).not.toHaveBeenCalled()
    expect(onPromptSucceeded).not.toHaveBeenCalled()
    expect(queue.push).toHaveBeenCalledWith({
      type: 'error',
      error_message: 'ACP: trace failed'
    })
    expect(queue.done).toHaveBeenCalledTimes(1)
  })

  it('awaits turn start persistence before sending the ACP prompt', async () => {
    const provider = Object.create(AcpProvider.prototype) as any
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
