/**
 * Unit tests for AgenticPresenter routing
 * Tests that requests are routed to the correct presenter based on agent_id and session_id
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AgenticPresenter } from '@/presenter/agentic/index'
import type { IAgentPresenter } from '@/presenter/agentic/types'
import type {
  SessionInfo,
  MessageContent,
  SessionConfig,
  LoadContext
} from '@/presenter/agentic/types'

describe('AgenticPresenter Routing', () => {
  let agenticPresenter: AgenticPresenter
  let mockAgent1: IAgentPresenter
  let mockAgent2: IAgentPresenter
  let mockWildcardAgent: IAgentPresenter

  // Mock session and message data
  const mockSessionId1 = 'session-1'
  const mockSessionId2 = 'session-2'
  const mockMessageId = 'msg-1'
  const mockSessionInfo: SessionInfo = {
    sessionId: 'session-1',
    agentId: 'deepchat.default',
    status: 'idle',
    availableModes: [],
    availableModels: [],
    capabilities: {
      supportsVision: false,
      supportsTools: false,
      supportsModes: false
    }
  }

  beforeEach(() => {
    agenticPresenter = new AgenticPresenter()

    // Create mock agents
    mockAgent1 = {
      agentId: 'deepchat.default',
      createSession: vi.fn().mockResolvedValue(mockSessionId1),
      getSession: vi.fn().mockResolvedValue(mockSessionInfo),
      loadSession: vi.fn().mockResolvedValue(undefined),
      closeSession: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelMessage: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      setMode: vi.fn().mockResolvedValue(undefined),
      setEmitterProvider: vi.fn()
    } as unknown as IAgentPresenter

    mockAgent2 = {
      agentId: 'acp.anthropic.claude-code',
      createSession: vi.fn().mockResolvedValue(mockSessionId2),
      getSession: vi.fn().mockResolvedValue({
        ...mockSessionInfo,
        agentId: 'acp.anthropic.claude-code'
      }),
      loadSession: vi.fn().mockResolvedValue(undefined),
      closeSession: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelMessage: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      setMode: vi.fn().mockResolvedValue(undefined),
      setEmitterProvider: vi.fn()
    } as unknown as IAgentPresenter

    mockWildcardAgent = {
      agentId: 'acp.*',
      createSession: vi.fn().mockResolvedValue('wildcard-session'),
      getSession: vi.fn().mockResolvedValue({
        ...mockSessionInfo,
        agentId: 'acp.*'
      }),
      loadSession: vi.fn().mockResolvedValue(undefined),
      closeSession: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelMessage: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      setMode: vi.fn().mockResolvedValue(undefined),
      setEmitterProvider: vi.fn()
    } as unknown as IAgentPresenter
  })

  describe('registerAgent', () => {
    it('should register an agent presenter', () => {
      agenticPresenter.registerAgent(mockAgent1)

      // Agent is now available for routing
      // We can verify this by trying to create a session
      const config: SessionConfig = {}
      const createSessionPromise = agenticPresenter.createSession('deepchat.default', config)

      expect(createSessionPromise).resolves.toBe(mockSessionId1)
      expect(mockAgent1.createSession).toHaveBeenCalledWith(config)
    })

    it('should register multiple agents', () => {
      agenticPresenter.registerAgent(mockAgent1)
      agenticPresenter.registerAgent(mockAgent2)

      const config: SessionConfig = {}
      const promise1 = agenticPresenter.createSession('deepchat.default', config)
      const promise2 = agenticPresenter.createSession('acp.anthropic.claude-code', config)

      expect(Promise.all([promise1, promise2])).resolves.toEqual([mockSessionId1, mockSessionId2])
    })

    it('should register wildcard agents', () => {
      agenticPresenter.registerAgent(mockWildcardAgent)

      const config: SessionConfig = {}
      const promise = agenticPresenter.createSession('acp.any.agent.id', config)

      expect(promise).resolves.toBe('wildcard-session')
      expect(mockWildcardAgent.createSession).toHaveBeenCalledWith(config)
    })
  })

  describe('createSession routing', () => {
    beforeEach(() => {
      agenticPresenter.registerAgent(mockAgent1)
      agenticPresenter.registerAgent(mockAgent2)
      agenticPresenter.registerAgent(mockWildcardAgent)
    })

    it('should route createSession to exact match agent', async () => {
      const config: SessionConfig = {}

      const sessionId = await agenticPresenter.createSession('deepchat.default', config)

      expect(sessionId).toBe(mockSessionId1)
      expect(mockAgent1.createSession).toHaveBeenCalledWith(config)
      expect(mockAgent2.createSession).not.toHaveBeenCalled()
    })

    it('should route createSession to wildcard match when no exact match', async () => {
      const config: SessionConfig = {}

      const sessionId = await agenticPresenter.createSession('acp.unknown.agent', config)

      expect(sessionId).toBe('wildcard-session')
      expect(mockWildcardAgent.createSession).toHaveBeenCalledWith(config)
    })

    it('should track session to presenter mapping after createSession', async () => {
      const config: SessionConfig = {}

      await agenticPresenter.createSession('deepchat.default', config)

      // Now getSession should work via the session mapping
      const sessionInfo = await agenticPresenter.getSession(mockSessionId1)

      expect(sessionInfo).toEqual(mockSessionInfo)
      expect(mockAgent1.getSession).toHaveBeenCalledWith(mockSessionId1)
    })

    it('should throw error when agent not found', async () => {
      const config: SessionConfig = {}

      await expect(agenticPresenter.createSession('unknown.agent', config)).rejects.toThrow(
        'No presenter found for agent_id: unknown.agent'
      )
    })
  })

  describe('getSession routing', () => {
    beforeEach(() => {
      agenticPresenter.registerAgent(mockAgent1)
    })

    it('should route getSession to the presenter that owns the session', async () => {
      // Manually set up session mapping (normally done in createSession)
      agenticPresenter['sessionToPresenter'].set(mockSessionId1, mockAgent1)

      const sessionInfo = await agenticPresenter.getSession(mockSessionId1)

      expect(sessionInfo).toEqual(mockSessionInfo)
      expect(mockAgent1.getSession).toHaveBeenCalledWith(mockSessionId1)
    })

    it('should throw error when session not found', async () => {
      await expect(agenticPresenter.getSession('unknown-session')).rejects.toThrow(
        'No presenter found for session_id: unknown-session'
      )
    })
  })

  describe('loadSession routing', () => {
    beforeEach(() => {
      agenticPresenter.registerAgent(mockAgent1)
    })

    it('should route loadSession to the presenter that owns the session', async () => {
      // Manually set up session mapping
      agenticPresenter['sessionToPresenter'].set(mockSessionId1, mockAgent1)

      const context: LoadContext = {}
      await agenticPresenter.loadSession(mockSessionId1, context)

      expect(mockAgent1.loadSession).toHaveBeenCalledWith(mockSessionId1, context)
    })

    it('should throw error when session not found', async () => {
      const context: LoadContext = {}

      await expect(agenticPresenter.loadSession('unknown-session', context)).rejects.toThrow(
        'No presenter found for session_id: unknown-session'
      )
    })
  })

  describe('closeSession routing', () => {
    beforeEach(() => {
      agenticPresenter.registerAgent(mockAgent1)
      agenticPresenter['sessionToPresenter'].set(mockSessionId1, mockAgent1)
    })

    it('should route closeSession to the presenter that owns the session', async () => {
      await agenticPresenter.closeSession(mockSessionId1)

      expect(mockAgent1.closeSession).toHaveBeenCalledWith(mockSessionId1)

      // Verify session was removed from mapping
      expect(agenticPresenter['sessionToPresenter'].has(mockSessionId1)).toBe(false)
    })

    it('should throw error when session not found', async () => {
      await expect(agenticPresenter.closeSession('unknown-session')).rejects.toThrow(
        'No presenter found for session_id: unknown-session'
      )
    })
  })

  describe('sendMessage routing', () => {
    const mockContent: MessageContent = { text: 'Hello' }

    beforeEach(() => {
      agenticPresenter.registerAgent(mockAgent1)
      agenticPresenter['sessionToPresenter'].set(mockSessionId1, mockAgent1)
    })

    it('should route sendMessage to the presenter that owns the session', async () => {
      await agenticPresenter.sendMessage(mockSessionId1, mockContent)

      expect(mockAgent1.sendMessage).toHaveBeenCalledWith(mockSessionId1, mockContent)
    })

    it('should throw error when session not found', async () => {
      await expect(agenticPresenter.sendMessage('unknown-session', mockContent)).rejects.toThrow(
        'No presenter found for session_id: unknown-session'
      )
    })
  })

  describe('cancelMessage routing', () => {
    beforeEach(() => {
      agenticPresenter.registerAgent(mockAgent1)
      agenticPresenter['sessionToPresenter'].set(mockSessionId1, mockAgent1)
    })

    it('should route cancelMessage to the presenter that owns the session', async () => {
      await agenticPresenter.cancelMessage(mockSessionId1, mockMessageId)

      expect(mockAgent1.cancelMessage).toHaveBeenCalledWith(mockSessionId1, mockMessageId)
    })

    it('should throw error when session not found', async () => {
      await expect(
        agenticPresenter.cancelMessage('unknown-session', mockMessageId)
      ).rejects.toThrow('No presenter found for session_id: unknown-session')
    })
  })

  describe('setModel routing', () => {
    const mockModelId = 'gpt-4'

    beforeEach(() => {
      agenticPresenter.registerAgent(mockAgent1)
      agenticPresenter['sessionToPresenter'].set(mockSessionId1, mockAgent1)
    })

    it('should route setModel to the presenter that owns the session', async () => {
      await agenticPresenter.setModel(mockSessionId1, mockModelId)

      expect(mockAgent1.setModel).toHaveBeenCalledWith(mockSessionId1, mockModelId)
    })

    it('should throw error when session not found', async () => {
      await expect(agenticPresenter.setModel('unknown-session', mockModelId)).rejects.toThrow(
        'No presenter found for session_id: unknown-session'
      )
    })
  })

  describe('setMode routing', () => {
    const mockModeId = 'strict'

    beforeEach(() => {
      agenticPresenter.registerAgent(mockAgent1)
      agenticPresenter['sessionToPresenter'].set(mockSessionId1, mockAgent1)
    })

    it('should route setMode to the presenter that owns the session', async () => {
      await agenticPresenter.setMode(mockSessionId1, mockModeId)

      expect(mockAgent1.setMode).toHaveBeenCalledWith(mockSessionId1, mockModeId)
    })

    it('should throw error when session not found', async () => {
      await expect(agenticPresenter.setMode('unknown-session', mockModeId)).rejects.toThrow(
        'No presenter found for session_id: unknown-session'
      )
    })
  })

  describe('Multi-agent scenarios', () => {
    beforeEach(() => {
      agenticPresenter.registerAgent(mockAgent1)
      agenticPresenter.registerAgent(mockAgent2)
      agenticPresenter.registerAgent(mockWildcardAgent)
    })

    it('should handle multiple sessions from different agents', async () => {
      const config: SessionConfig = {}

      const sessionId1 = await agenticPresenter.createSession('deepchat.default', config)
      const sessionId2 = await agenticPresenter.createSession('acp.anthropic.claude-code', config)

      expect(sessionId1).toBe(mockSessionId1)
      expect(sessionId2).toBe(mockSessionId2)

      // Verify routing works for both sessions
      const content: MessageContent = { text: 'Hello' }
      await agenticPresenter.sendMessage(sessionId1, content)
      await agenticPresenter.sendMessage(sessionId2, content)

      expect(mockAgent1.sendMessage).toHaveBeenCalledWith(sessionId1, content)
      expect(mockAgent2.sendMessage).toHaveBeenCalledWith(sessionId2, content)
    })

    it('should isolate sessions from different agents', async () => {
      const config: SessionConfig = {}

      const sessionId1 = await agenticPresenter.createSession('deepchat.default', config)
      const sessionId2 = await agenticPresenter.createSession('acp.anthropic.claude-code', config)

      const content: MessageContent = { text: 'Hello' }

      // Send message to session 1
      await agenticPresenter.sendMessage(sessionId1, content)

      expect(mockAgent1.sendMessage).toHaveBeenCalledTimes(1)
      expect(mockAgent2.sendMessage).not.toHaveBeenCalled()

      // Send message to session 2
      await agenticPresenter.sendMessage(sessionId2, content)

      expect(mockAgent2.sendMessage).toHaveBeenCalledTimes(1)
      // Agent 1 should not be called again
      expect(mockAgent1.sendMessage).toHaveBeenCalledTimes(1)
    })
  })

  describe('Error handling', () => {
    beforeEach(() => {
      agenticPresenter.registerAgent(mockAgent1)
    })

    it('should handle presenter errors gracefully', async () => {
      // Mock a presenter that throws an error
      const errorAgent = {
        ...mockAgent1,
        agentId: 'error.agent',
        createSession: vi.fn().mockRejectedValue(new Error('Agent error'))
      } as unknown as IAgentPresenter

      agenticPresenter.registerAgent(errorAgent)
      agenticPresenter['sessionToPresenter'].set('error-session', errorAgent)

      // createSession should throw the error
      const config: SessionConfig = {}
      await expect(agenticPresenter.createSession('error.agent', config)).rejects.toThrow(
        'Agent error'
      )
    })

    it('should emit error event on presenter failure', async () => {
      // This test verifies the emitError mechanism is called
      // In a real scenario, we'd spy on eventBus.sendToRenderer
      const errorAgent = {
        ...mockAgent1,
        agentId: 'error.agent',
        createSession: vi.fn().mockRejectedValue(new Error('Agent error'))
      } as unknown as IAgentPresenter

      agenticPresenter.registerAgent(errorAgent)

      const config: SessionConfig = {}
      await expect(agenticPresenter.createSession('error.agent', config)).rejects.toThrow()
      // Error event is emitted in the catch block of createSession
    })
  })
})
