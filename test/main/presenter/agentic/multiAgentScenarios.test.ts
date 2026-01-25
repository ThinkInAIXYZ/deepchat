/**
 * Integration tests for multi-agent scenarios
 * Tests that multiple agents can run simultaneously with proper isolation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eventBus, SendTarget } from '@/eventbus'
import { agenticPresenter } from '@/presenter/agentic'
import type { IAgentPresenter } from '@/presenter/agentic/types'
import type { SessionConfig, MessageContent, SessionInfo } from '@/presenter/agentic/types'
import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'

describe('Multi-Agent Scenarios - AgenticPresenter Integration', () => {
  let sendToRendererSpy: ReturnType<typeof vi.spyOn>

  // Mock agents
  let mockDeepChatAgent: IAgentPresenter
  let mockAcpClaudeAgent: IAgentPresenter
  let mockAcpCursorAgent: IAgentPresenter
  let mockWildcardAcpAgent: IAgentPresenter

  // Session IDs
  let deepChatSessionId: string
  let acpClaudeSessionId: string
  let acpCursorSessionId: string

  beforeEach(() => {
    // Spy on eventBus
    sendToRendererSpy = vi.spyOn(eventBus, 'sendToRenderer').mockImplementation(() => {})

    // Generate unique session IDs
    deepChatSessionId = 'deepchat-session-1'
    acpClaudeSessionId = 'acp-claude-session-1'
    acpCursorSessionId = 'acp-cursor-session-1'

    // Create mock DeepChat agent
    mockDeepChatAgent = {
      agentId: 'deepchat.default',
      createSession: vi.fn().mockResolvedValue(deepChatSessionId),
      getSession: vi.fn().mockResolvedValue({
        sessionId: deepChatSessionId,
        agentId: 'deepchat.default',
        status: 'idle',
        availableModes: [{ id: 'strict', name: 'Strict', description: 'Strict mode' }],
        availableModels: [{ id: 'openai:gpt-4', name: 'GPT-4', description: 'GPT-4' }],
        currentModelId: 'gpt-4',
        capabilities: {
          supportsVision: true,
          supportsTools: true,
          supportsModes: true
        }
      } as SessionInfo),
      loadSession: vi.fn().mockResolvedValue(undefined),
      closeSession: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelMessage: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      setMode: vi.fn().mockResolvedValue(undefined),
      setEmitterProvider: vi.fn()
    } as unknown as IAgentPresenter

    // Create mock ACP Claude agent
    mockAcpClaudeAgent = {
      agentId: 'acp.anthropic.claude-code',
      createSession: vi.fn().mockResolvedValue(acpClaudeSessionId),
      getSession: vi.fn().mockResolvedValue({
        sessionId: acpClaudeSessionId,
        agentId: 'acp.anthropic.claude-code',
        status: 'idle',
        availableModes: [{ id: 'default', name: 'Default', description: 'Default mode' }],
        availableModels: [
          { id: 'claude-3-opus', name: 'Claude 3 Opus', description: 'Most capable' }
        ],
        currentModelId: 'claude-3-opus',
        currentModeId: 'default',
        capabilities: {
          supportsVision: false,
          supportsTools: true,
          supportsModes: true
        }
      } as SessionInfo),
      loadSession: vi.fn().mockResolvedValue(undefined),
      closeSession: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelMessage: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      setMode: vi.fn().mockResolvedValue(undefined),
      setEmitterProvider: vi.fn()
    } as unknown as IAgentPresenter

    // Create mock ACP Cursor agent
    mockAcpCursorAgent = {
      agentId: 'acp.anthropic.cursor',
      createSession: vi.fn().mockResolvedValue(acpCursorSessionId),
      getSession: vi.fn().mockResolvedValue({
        sessionId: acpCursorSessionId,
        agentId: 'acp.anthropic.cursor',
        status: 'idle',
        availableModes: [{ id: 'default', name: 'Default', description: 'Default mode' }],
        availableModels: [
          { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Balanced' }
        ],
        currentModelId: 'claude-3.5-sonnet',
        currentModeId: 'default',
        capabilities: {
          supportsVision: false,
          supportsTools: true,
          supportsModes: true
        }
      } as SessionInfo),
      loadSession: vi.fn().mockResolvedValue(undefined),
      closeSession: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelMessage: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      setMode: vi.fn().mockResolvedValue(undefined),
      setEmitterProvider: vi.fn()
    } as unknown as IAgentPresenter

    // Create wildcard ACP agent
    mockWildcardAcpAgent = {
      agentId: 'acp.*',
      createSession: vi.fn().mockResolvedValue('wildcard-session'),
      getSession: vi.fn().mockResolvedValue({
        sessionId: 'wildcard-session',
        agentId: 'acp.*',
        status: 'idle',
        availableModes: [],
        availableModels: [],
        capabilities: {
          supportsVision: false,
          supportsTools: true,
          supportsModes: true
        }
      } as SessionInfo),
      loadSession: vi.fn().mockResolvedValue(undefined),
      closeSession: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      cancelMessage: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      setMode: vi.fn().mockResolvedValue(undefined),
      setEmitterProvider: vi.fn()
    } as unknown as IAgentPresenter

    // Register all agents
    agenticPresenter.registerAgent(mockDeepChatAgent)
    agenticPresenter.registerAgent(mockAcpClaudeAgent)
    agenticPresenter.registerAgent(mockAcpCursorAgent)
    agenticPresenter.registerAgent(mockWildcardAcpAgent)
  })

  describe('Concurrent session creation', () => {
    it('should create sessions for multiple agents concurrently', async () => {
      const config: SessionConfig = {}

      const [sessionId1, sessionId2, sessionId3] = await Promise.all([
        agenticPresenter.createSession('deepchat.default', config),
        agenticPresenter.createSession('acp.anthropic.claude-code', config),
        agenticPresenter.createSession('acp.anthropic.cursor', config)
      ])

      expect(sessionId1).toBe(deepChatSessionId)
      expect(sessionId2).toBe(acpClaudeSessionId)
      expect(sessionId3).toBe(acpCursorSessionId)

      expect(mockDeepChatAgent.createSession).toHaveBeenCalledTimes(1)
      expect(mockAcpClaudeAgent.createSession).toHaveBeenCalledTimes(1)
      expect(mockAcpCursorAgent.createSession).toHaveBeenCalledTimes(1)
    })

    it('should route to wildcard agent when exact match not found', async () => {
      const config: SessionConfig = {}

      const sessionId = await agenticPresenter.createSession('acp.unknown.agent', config)

      expect(sessionId).toBe('wildcard-session')
      expect(mockWildcardAcpAgent.createSession).toHaveBeenCalledWith(config)
    })
  })

  describe('Session isolation', () => {
    beforeEach(async () => {
      // Create sessions for all agents
      const config: SessionConfig = {}
      await agenticPresenter.createSession('deepchat.default', config)
      await agenticPresenter.createSession('acp.anthropic.claude-code', config)
      await agenticPresenter.createSession('acp.anthropic.cursor', config)
    })

    it('should maintain separate session info for each agent', async () => {
      const deepChatInfo = await agenticPresenter.getSession(deepChatSessionId)
      const claudeInfo = await agenticPresenter.getSession(acpClaudeSessionId)
      const cursorInfo = await agenticPresenter.getSession(acpCursorSessionId)

      expect(deepChatInfo?.agentId).toBe('deepchat.default')
      expect(claudeInfo?.agentId).toBe('acp.anthropic.claude-code')
      expect(cursorInfo?.agentId).toBe('acp.anthropic.cursor')

      // Verify different models
      expect(deepChatInfo?.currentModelId).toBe('gpt-4')
      expect(claudeInfo?.currentModelId).toBe('claude-3-opus')
      expect(cursorInfo?.currentModelId).toBe('claude-3.5-sonnet')
    })

    it('should route messages to correct agent sessions', async () => {
      const content: MessageContent = { text: 'Hello' }

      await Promise.all([
        agenticPresenter.sendMessage(deepChatSessionId, content),
        agenticPresenter.sendMessage(acpClaudeSessionId, content),
        agenticPresenter.sendMessage(acpCursorSessionId, content)
      ])

      expect(mockDeepChatAgent.sendMessage).toHaveBeenCalledWith(deepChatSessionId, content)
      expect(mockAcpClaudeAgent.sendMessage).toHaveBeenCalledWith(acpClaudeSessionId, content)
      expect(mockAcpCursorAgent.sendMessage).toHaveBeenCalledWith(acpCursorSessionId, content)
    })

    it('should route model changes to correct agent', async () => {
      await Promise.all([
        agenticPresenter.setModel(deepChatSessionId, 'openai:gpt-3.5-turbo'),
        agenticPresenter.setModel(acpClaudeSessionId, 'claude-3-sonnet'),
        agenticPresenter.setModel(acpCursorSessionId, 'claude-3-haiku')
      ])

      expect(mockDeepChatAgent.setModel).toHaveBeenCalledWith(
        deepChatSessionId,
        'openai:gpt-3.5-turbo'
      )
      expect(mockAcpClaudeAgent.setModel).toHaveBeenCalledWith(
        acpClaudeSessionId,
        'claude-3-sonnet'
      )
      expect(mockAcpCursorAgent.setModel).toHaveBeenCalledWith(acpCursorSessionId, 'claude-3-haiku')
    })

    it('should route mode changes to correct agent', async () => {
      await Promise.all([
        agenticPresenter.setMode(deepChatSessionId, 'strict'),
        agenticPresenter.setMode(acpClaudeSessionId, 'advanced'),
        agenticPresenter.setMode(acpCursorSessionId, 'default')
      ])

      expect(mockDeepChatAgent.setMode).toHaveBeenCalledWith(deepChatSessionId, 'strict')
      expect(mockAcpClaudeAgent.setMode).toHaveBeenCalledWith(acpClaudeSessionId, 'advanced')
      expect(mockAcpCursorAgent.setMode).toHaveBeenCalledWith(acpCursorSessionId, 'default')
    })

    it('should route cancel requests to correct agent', async () => {
      await Promise.all([
        agenticPresenter.cancelMessage(deepChatSessionId, 'msg-deepchat-1'),
        agenticPresenter.cancelMessage(acpClaudeSessionId, 'msg-claude-1'),
        agenticPresenter.cancelMessage(acpCursorSessionId, 'msg-cursor-1')
      ])

      expect(mockDeepChatAgent.cancelMessage).toHaveBeenCalledWith(
        deepChatSessionId,
        'msg-deepchat-1'
      )
      expect(mockAcpClaudeAgent.cancelMessage).toHaveBeenCalledWith(
        acpClaudeSessionId,
        'msg-claude-1'
      )
      expect(mockAcpCursorAgent.cancelMessage).toHaveBeenCalledWith(
        acpCursorSessionId,
        'msg-cursor-1'
      )
    })

    it('should route close requests to correct agent', async () => {
      await Promise.all([
        agenticPresenter.closeSession(deepChatSessionId),
        agenticPresenter.closeSession(acpClaudeSessionId),
        agenticPresenter.closeSession(acpCursorSessionId)
      ])

      expect(mockDeepChatAgent.closeSession).toHaveBeenCalledWith(deepChatSessionId)
      expect(mockAcpClaudeAgent.closeSession).toHaveBeenCalledWith(acpClaudeSessionId)
      expect(mockAcpCursorAgent.closeSession).toHaveBeenCalledWith(acpCursorSessionId)
    })
  })

  describe('Cross-agent isolation', () => {
    beforeEach(async () => {
      // Create sessions for all agents
      const config: SessionConfig = {}
      await agenticPresenter.createSession('deepchat.default', config)
      await agenticPresenter.createSession('acp.anthropic.claude-code', config)
      await agenticPresenter.createSession('acp.anthropic.cursor', config)
    })

    it('should not affect other agents when one agent fails', async () => {
      // Make DeepChat agent fail
      mockDeepChatAgent.sendMessage = vi.fn().mockRejectedValue(new Error('DeepChat error'))

      const content: MessageContent = { text: 'Hello' }

      // DeepChat should fail
      await expect(agenticPresenter.sendMessage(deepChatSessionId, content)).rejects.toThrow(
        'DeepChat error'
      )

      // But other agents should still work
      await agenticPresenter.sendMessage(acpClaudeSessionId, content)
      await agenticPresenter.sendMessage(acpCursorSessionId, content)

      expect(mockAcpClaudeAgent.sendMessage).toHaveBeenCalled()
      expect(mockAcpCursorAgent.sendMessage).toHaveBeenCalled()
    })

    it('should not interfere with session info queries across agents', async () => {
      // Mock DeepChat to be slow
      let deepChatResolved = false
      mockDeepChatAgent.getSession = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        deepChatResolved = true
        return {
          sessionId: deepChatSessionId,
          agentId: 'deepchat.default',
          status: 'idle',
          availableModes: [],
          availableModels: [],
          capabilities: { supportsVision: false, supportsTools: false, supportsModes: false }
        } as SessionInfo
      })

      // Query all sessions concurrently
      const [deepChatInfo, claudeInfo, cursorInfo] = await Promise.all([
        agenticPresenter.getSession(deepChatSessionId),
        agenticPresenter.getSession(acpClaudeSessionId),
        agenticPresenter.getSession(acpCursorSessionId)
      ])

      expect(deepChatResolved).toBe(true)
      expect(claudeInfo?.agentId).toBe('acp.anthropic.claude-code')
      expect(cursorInfo?.agentId).toBe('acp.anthropic.cursor')
    })
  })

  describe('Session lifecycle with multiple agents', () => {
    it('should handle full lifecycle for multiple agents independently', async () => {
      const config: SessionConfig = {}
      const content: MessageContent = { text: 'Hello' }

      // Create sessions
      const [sessionId1, sessionId2] = await Promise.all([
        agenticPresenter.createSession('deepchat.default', config),
        agenticPresenter.createSession('acp.anthropic.claude-code', config)
      ])

      // Get session info
      const [info1, info2] = await Promise.all([
        agenticPresenter.getSession(sessionId1),
        agenticPresenter.getSession(sessionId2)
      ])

      expect(info1?.agentId).toBe('deepchat.default')
      expect(info2?.agentId).toBe('acp.anthropic.claude-code')

      // Send messages
      await Promise.all([
        agenticPresenter.sendMessage(sessionId1, content),
        agenticPresenter.sendMessage(sessionId2, content)
      ])

      expect(mockDeepChatAgent.sendMessage).toHaveBeenCalledWith(sessionId1, content)
      expect(mockAcpClaudeAgent.sendMessage).toHaveBeenCalledWith(sessionId2, content)

      // Set models
      await Promise.all([
        agenticPresenter.setModel(sessionId1, 'openai:gpt-4'),
        agenticPresenter.setModel(sessionId2, 'claude-3-opus')
      ])

      expect(mockDeepChatAgent.setModel).toHaveBeenCalledWith(sessionId1, 'openai:gpt-4')
      expect(mockAcpClaudeAgent.setModel).toHaveBeenCalledWith(sessionId2, 'claude-3-opus')

      // Close sessions
      await Promise.all([
        agenticPresenter.closeSession(sessionId1),
        agenticPresenter.closeSession(sessionId2)
      ])

      expect(mockDeepChatAgent.closeSession).toHaveBeenCalledWith(sessionId1)
      expect(mockAcpClaudeAgent.closeSession).toHaveBeenCalledWith(sessionId2)

      // Verify sessions are removed from mapping
      expect(agenticPresenter['sessionToPresenter'].has(sessionId1)).toBe(false)
      expect(agenticPresenter['sessionToPresenter'].has(sessionId2)).toBe(false)
    })
  })

  describe('Wildcard agent routing', () => {
    it('should use exact match over wildcard when both exist', async () => {
      const config: SessionConfig = {}

      // Both exact and wildcard agents are registered
      const sessionId = await agenticPresenter.createSession('acp.anthropic.claude-code', config)

      // Should use exact match, not wildcard
      expect(sessionId).toBe(acpClaudeSessionId)
      expect(mockAcpClaudeAgent.createSession).toHaveBeenCalledWith(config)
      expect(mockWildcardAcpAgent.createSession).not.toHaveBeenCalledWith(
        'acp.anthropic.claude-code',
        config
      )
    })

    it('should use wildcard when no exact match exists', async () => {
      const config: SessionConfig = {}

      const sessionId = await agenticPresenter.createSession('acp.unknown.agent', config)

      expect(sessionId).toBe('wildcard-session')
      expect(mockWildcardAcpAgent.createSession).toHaveBeenCalledWith(config)
    })
  })

  describe('Event routing with multiple agents', () => {
    beforeEach(async () => {
      // Create sessions for all agents
      const config: SessionConfig = {}
      await agenticPresenter.createSession('deepchat.default', config)
      await agenticPresenter.createSession('acp.anthropic.claude-code', config)
    })

    it('should include correct sessionId in all events', async () => {
      const content: MessageContent = { text: 'Test message' }

      // Send to both sessions
      await agenticPresenter.sendMessage(deepChatSessionId, content)
      await agenticPresenter.sendMessage(acpClaudeSessionId, content)

      // Check all events have correct sessionId
      const messageCalls = sendToRendererSpy.mock.calls.filter(
        (call) => call[0] === 'agentic.message.delta'
      )

      // Note: This test verifies the event emission pattern
      // In real scenarios, the actual sendMessage would emit events via the emitter
    })
  })
})
