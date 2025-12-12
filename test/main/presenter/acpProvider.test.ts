import { describe, it, expect, vi } from 'vitest'
import { AcpProvider } from '../../../src/main/presenter/llmProviderPresenter/providers/acpProvider'

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test')
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
})
