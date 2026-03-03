import { describe, it, expect, vi } from 'vitest'
import { AcpProvider } from '../../../src/main/presenter/llmProviderPresenter/providers/acpProvider'
import { ACP_WORKSPACE_EVENTS } from '../../../src/main/events'
import { eventBus, SendTarget } from '@/eventbus'

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
      ACP_WORKSPACE_EVENTS.SESSION_COMMANDS_READY,
      SendTarget.ALL_WINDOWS,
      {
        conversationId: 'conv-2',
        agentId: 'agent1',
        commands: [{ name: 'review', description: 'run review', input: null }]
      }
    )
  })
})
