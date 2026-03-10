import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NewMessageManager } from '@/presenter/newAgentPresenter/messageManager'
import type { AgentRegistry } from '@/presenter/newAgentPresenter/agentRegistry'
import type { NewSessionManager } from '@/presenter/newAgentPresenter/sessionManager'
import type { ChatMessageRecord } from '@shared/types/agent-interface'

const mockMessage: ChatMessageRecord = {
  id: 'm1',
  sessionId: 's1',
  orderSeq: 1,
  role: 'user',
  content: '{"text":"hello"}',
  status: 'sent',
  isContextEdge: 0,
  metadata: '{}',
  createdAt: 1000,
  updatedAt: 1000
}

function createMocks() {
  const mockAgent = {
    getMessages: vi.fn().mockResolvedValue([mockMessage]),
    getMessageIds: vi.fn().mockResolvedValue(['m1']),
    getMessage: vi.fn().mockResolvedValue(mockMessage),
    initSession: vi.fn(),
    destroySession: vi.fn(),
    getSessionState: vi.fn(),
    processMessage: vi.fn(),
    cancelGeneration: vi.fn()
  }

  const agentRegistry = {
    resolve: vi.fn().mockReturnValue(mockAgent),
    getAll: vi
      .fn()
      .mockReturnValue([{ id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true }])
  } as unknown as AgentRegistry

  const sessionManager = {
    get: vi.fn().mockReturnValue({
      id: 's1',
      agentId: 'deepchat',
      title: 'Test',
      projectDir: null,
      isPinned: false,
      createdAt: 1000,
      updatedAt: 1000
    })
  } as unknown as NewSessionManager

  return { mockAgent, agentRegistry, sessionManager }
}

describe('NewMessageManager', () => {
  let mocks: ReturnType<typeof createMocks>
  let manager: NewMessageManager

  beforeEach(() => {
    mocks = createMocks()
    manager = new NewMessageManager(mocks.agentRegistry, mocks.sessionManager)
  })

  describe('getMessages', () => {
    it('resolves agent from session and delegates', async () => {
      const result = await manager.getMessages('s1')
      expect(mocks.sessionManager.get).toHaveBeenCalledWith('s1')
      expect(mocks.agentRegistry.resolve).toHaveBeenCalledWith('deepchat')
      expect(result).toEqual([mockMessage])
    })

    it('throws if session not found', async () => {
      ;(mocks.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue(null)
      await expect(manager.getMessages('missing')).rejects.toThrow('Session not found: missing')
    })
  })

  describe('getMessageIds', () => {
    it('resolves agent and delegates', async () => {
      const result = await manager.getMessageIds('s1')
      expect(result).toEqual(['m1'])
    })

    it('throws if session not found', async () => {
      ;(mocks.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue(null)
      await expect(manager.getMessageIds('missing')).rejects.toThrow('Session not found: missing')
    })
  })

  describe('getMessage', () => {
    it('iterates agents and returns first match', async () => {
      const result = await manager.getMessage('m1')
      expect(result).toEqual(mockMessage)
    })

    it('returns null when no agent has the message', async () => {
      mocks.mockAgent.getMessage.mockResolvedValue(null)
      const result = await manager.getMessage('missing')
      expect(result).toBeNull()
    })
  })
})
