import { describe, it, expect, vi } from 'vitest'
import { AcpProvider } from '../../../src/main/presenter/llmProviderPresenter/providers/acpProvider'
import { ACP_WORKSPACE_EVENTS } from '../../../src/main/events'
import { eventBus, SendTarget } from '@/eventbus'
import type { AcpConfigState } from '../../../src/shared/types/presenters'

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp')
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    sendToRenderer: vi.fn(),
    emit: vi.fn(),
    send: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
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

describe('AcpProvider runDebugAction error handling', () => {
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

  it('prepares ACP session without prompt and emits ready events', async () => {
    const configState = createConfigState()
    const provider = Object.create(AcpProvider.prototype) as any
    provider.getAgentById = vi.fn().mockResolvedValue({ id: 'agent1', name: 'Agent 1' })
    provider.sessionPersistence = {
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
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
      ACP_WORKSPACE_EVENTS.SESSION_MODES_READY,
      SendTarget.ALL_WINDOWS,
      {
        conversationId: 'conv-2',
        agentId: 'agent1',
        workdir: '/tmp/workspace',
        current: 'default',
        available: [{ id: 'default', name: 'Default', description: '' }]
      }
    )
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
      ACP_WORKSPACE_EVENTS.SESSION_CONFIG_OPTIONS_READY,
      SendTarget.ALL_WINDOWS,
      {
        conversationId: 'conv-2',
        agentId: 'agent1',
        workdir: '/tmp/workspace',
        configState
      }
    )
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
      ACP_WORKSPACE_EVENTS.SESSION_COMMANDS_READY,
      SendTarget.ALL_WINDOWS,
      {
        conversationId: 'conv-2',
        agentId: 'agent1',
        commands: [{ name: 'review', description: 'run review', input: null }]
      }
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

    expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
      ACP_WORKSPACE_EVENTS.SESSION_MODES_READY,
      SendTarget.ALL_WINDOWS,
      {
        conversationId: 'conv-b',
        agentId: 'agent1',
        workdir: '/tmp/workspace',
        current: 'default',
        available: [{ id: 'default', name: 'Default', description: '' }]
      }
    )
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
    expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
      ACP_WORKSPACE_EVENTS.SESSION_CONFIG_OPTIONS_READY,
      SendTarget.ALL_WINDOWS,
      {
        conversationId: 'conv-1',
        agentId: 'agent1',
        workdir: '/tmp/workspace',
        configState: nextState
      }
    )
  })
})
