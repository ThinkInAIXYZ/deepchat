/**
 * Integration tests for DeepChat agent flow through AgenticPresenter
 * Tests the full flow: create session → send message → receive events → close session
 *
 * NOTE: These tests require full Electron environment context due to
 * AgentPresenter's dependency chain (presenter/index.ts → knowledgePresenter → app)
 * These tests are skipped in the vitest environment and should be run
 * in the full Electron context or via manual testing (TASK-6.3.1).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock upgradePresenter to avoid autoUpdater Electron dependency
vi.mock('@/presenter/upgradePresenter', () => ({
  upgradePresenter: {
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn()
  }
}))

// Mock Electron app
vi.mock('electron', () => ({
  default: {
    getAppPath: vi.fn(() => '/test/path')
  }
}))

import { eventBus, SendTarget } from '@/eventbus'
import { agenticPresenter } from '@/presenter/agentic'
import { AgentPresenter } from '@/presenter/agentPresenter'
import type { SessionConfig, MessageContent } from '@/presenter/agentic/types'
import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'
import type {
  IConfigPresenter,
  ILlmProviderPresenter,
  ISessionPresenter,
  ISQLitePresenter
} from '@shared/presenter'
import type { SessionManager } from '@/presenter/agentPresenter/session/sessionManager'
import { CommandPermissionService } from '@/presenter/agentPresenter/permission/commandPermissionService'
import { MessageManager } from '@/presenter/sessionPresenter/managers/messageManager'
import type { CONVERSATION } from '@shared/chat'

describe.skip('DeepChat Agent Flow - AgenticPresenter Integration', () => {
  let agentPresenter: AgentPresenter
  let sendToRendererSpy: ReturnType<typeof vi.spyOn>
  let testSessionId: string

  // Mock dependencies
  let mockSessionPresenter: ISessionPresenter
  let mockSessionManager: SessionManager
  let mockSqlitePresenter: ISQLitePresenter
  let mockLlmProviderPresenter: ILlmProviderPresenter
  let mockConfigPresenter: IConfigPresenter
  let mockCommandPermissionService: CommandPermissionService
  let mockMessageManager: MessageManager

  beforeEach(async () => {
    // Spy on eventBus
    sendToRendererSpy = vi.spyOn(eventBus, 'sendToRenderer').mockImplementation(() => {})

    // Create mock dependencies
    mockSessionPresenter = {
      getConversation: vi.fn().mockResolvedValue({
        id: 'conv-1',
        title: 'Test Chat',
        is_new: 1,
        settings: {
          providerId: 'openai',
          modelId: 'gpt-4'
        },
        updatedAt: Date.now()
      } as CONVERSATION),
      createConversation: vi.fn().mockResolvedValue('conv-1'),
      updateConversationSettings: vi.fn().mockResolvedValue(undefined),
      findTabForConversation: vi.fn().mockResolvedValue(1),
      clearActiveThread: vi.fn().mockResolvedValue(undefined),
      getActiveConversationId: vi.fn().mockReturnValue('conv-1'),
      getActiveConversation: vi.fn().mockResolvedValue({
        id: 'conv-1'
      } as CONVERSATION),
      getActiveTabId: vi.fn().mockResolvedValue(1),
      generateTitle: vi.fn().mockResolvedValue('Generated Title'),
      renameConversation: vi.fn().mockResolvedValue(undefined)
    } as unknown as ISessionPresenter

    mockSqlitePresenter = {
      getConversation: vi.fn().mockResolvedValue({
        id: 'conv-1',
        title: 'Test Chat',
        is_new: 1,
        settings: {
          providerId: 'openai',
          modelId: 'gpt-4'
        },
        updatedAt: Date.now()
      } as CONVERSATION),
      updateConversation: vi.fn().mockResolvedValue(undefined)
    } as unknown as ISQLitePresenter

    mockConfigPresenter = {
      getProviderModels: vi.fn().mockReturnValue([
        { id: 'gpt-4', name: 'GPT-4', description: 'GPT-4 model' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'GPT-3.5 Turbo model' }
      ]),
      getModelConfig: vi.fn().mockReturnValue({ vision: false }),
      getAcpUseBuiltinRuntime: vi.fn().mockResolvedValue(true)
    } as unknown as IConfigPresenter

    mockLlmProviderPresenter = {
      stopStream: vi.fn().mockResolvedValue(undefined)
    } as unknown as ILlmProviderPresenter

    mockSessionManager = {
      getSession: vi.fn().mockReturnValue({
        status: 'idle',
        resolved: {
          status: 'idle'
        }
      }),
      getSessionSync: vi.fn().mockReturnValue({
        status: 'idle',
        resolved: {
          status: 'idle'
        }
      }),
      startLoop: vi.fn().mockResolvedValue(undefined),
      clearPendingPermission: vi.fn().mockResolvedValue(undefined)
    } as unknown as SessionManager

    mockCommandPermissionService = {
      clearConversation: vi.fn().mockResolvedValue(undefined)
    } as unknown as CommandPermissionService

    mockMessageManager = {
      sendMessage: vi.fn().mockResolvedValue({
        id: 'msg-1',
        role: 'user',
        content: '[]',
        timestamp: Date.now()
      }),
      getMessageThread: vi.fn().mockResolvedValue({
        list: []
      }),
      updateMessageStatus: vi.fn().mockResolvedValue(undefined),
      editMessage: vi.fn().mockResolvedValue(undefined)
    } as unknown as MessageManager

    // Create AgentPresenter with mocks
    agentPresenter = new AgentPresenter({
      sessionPresenter: mockSessionPresenter,
      sessionManager: mockSessionManager,
      sqlitePresenter: mockSqlitePresenter,
      llmProviderPresenter: mockLlmProviderPresenter,
      configPresenter: mockConfigPresenter,
      commandPermissionService: mockCommandPermissionService,
      messageManager: mockMessageManager
    })

    // AgentPresenter is automatically registered with agenticPresenter in constructor
    testSessionId = 'conv-1'
  })

  describe('Full agent flow', () => {
    it('should complete the full DeepChat agent flow', async () => {
      // 1. Create session
      const config: SessionConfig = {
        modelId: 'openai:gpt-4'
      }

      const sessionId = await agenticPresenter.createSession('deepchat.default', config)

      expect(sessionId).toBe('conv-1')
      expect(mockSessionPresenter.createConversation).toHaveBeenCalled()

      // Verify SESSION_CREATED event was emitted
      const createEventCalls = sendToRendererSpy.mock.calls.filter(
        (call) => call[0] === 'agentic.session.created'
      )
      expect(createEventCalls.length).toBeGreaterThan(0)
      expect(createEventCalls[0][2]).toMatchObject({
        sessionId: 'conv-1',
        agentId: 'deepchat.default'
      })

      // 2. Get session info
      const sessionInfo = await agenticPresenter.getSession(sessionId)

      expect(sessionInfo).not.toBeNull()
      expect(sessionInfo?.agentId).toBe('deepchat.default')
      expect(sessionInfo?.currentModelId).toBe('gpt-4')
      expect(sessionInfo?.availableModels).toHaveLength(2)

      // 3. Send message
      const content: MessageContent = {
        text: 'Hello, how are you?'
      }

      // Mock tab lookup for sendMessage
      mockSessionPresenter.findTabForConversation = vi.fn().mockResolvedValue(1)

      await agenticPresenter.sendMessage(sessionId, content)

      // Verify message was sent through AgentPresenter
      expect(mockSessionPresenter.findTabForConversation).toHaveBeenCalledWith(sessionId)
      expect(mockMessageManager.sendMessage).toHaveBeenCalled()

      // 4. Set model
      await agenticPresenter.setModel(sessionId, 'openai:gpt-3.5-turbo')

      expect(mockSessionPresenter.updateConversationSettings).toHaveBeenCalledWith(sessionId, {
        providerId: 'openai',
        modelId: 'gpt-3.5-turbo'
      })

      // 5. Set mode
      await agenticPresenter.setMode(sessionId, 'strict')

      // Mode is stored in AgentPresenter's sessionModes map
      // Verify by checking getSession
      const updatedSessionInfo = await agenticPresenter.getSession(sessionId)
      expect(updatedSessionInfo?.currentModeId).toBe('strict')

      // 6. Load session
      const loadContext = {
        maxHistory: 100,
        includeSystemMessages: true
      }

      await agenticPresenter.loadSession(sessionId, loadContext)

      // For DeepChat, loading is implicit - should not throw
      expect(mockSqlitePresenter.getConversation).toHaveBeenCalledWith(sessionId)

      // 7. Close session
      await agenticPresenter.closeSession(sessionId)

      expect(mockSessionPresenter.clearActiveThread).toHaveBeenCalled()
      expect(mockCommandPermissionService.clearConversation).toHaveBeenCalled()

      // Verify SESSION_CLOSED event was emitted
      const closeEventCalls = sendToRendererSpy.mock.calls.filter(
        (call) => call[0] === 'agentic.session.closed'
      )
      expect(closeEventCalls.length).toBeGreaterThan(0)
      expect(closeEventCalls[0][2]).toMatchObject({
        sessionId: 'conv-1'
      })
    })

    it('should handle error when session not active for sendMessage', async () => {
      const content: MessageContent = { text: 'Hello' }

      // Mock tab lookup returning null (session not active)
      mockSessionPresenter.findTabForConversation = vi.fn().mockResolvedValue(null)

      await expect(agenticPresenter.sendMessage(testSessionId, content)).rejects.toThrow(
        'Session not active'
      )
    })

    it('should handle error when agent not found', async () => {
      const config: SessionConfig = {}

      await expect(agenticPresenter.createSession('unknown.agent', config)).rejects.toThrow(
        'No presenter found for agent_id: unknown.agent'
      )
    })
  })

  describe('Session info', () => {
    it('should return correct session info with all fields', async () => {
      const sessionInfo = await agenticPresenter.getSession(testSessionId)

      expect(sessionInfo).toMatchObject({
        sessionId: testSessionId,
        agentId: 'deepchat.default',
        status: 'idle',
        currentModelId: 'gpt-4',
        availableModels: expect.any(Array),
        availableModes: expect.any(Array),
        capabilities: {
          supportsVision: false,
          supportsTools: true,
          supportsModes: true
        }
      })

      // Check available modes
      expect(sessionInfo?.availableModes).toHaveLength(3)
      expect(sessionInfo?.availableModes).toContainEqual({
        id: 'strict',
        name: 'Strict',
        description: expect.any(String)
      })
      expect(sessionInfo?.availableModes).toContainEqual({
        id: 'balanced',
        name: 'Balanced',
        description: expect.any(String)
      })
      expect(sessionInfo?.availableModes).toContainEqual({
        id: 'permissive',
        name: 'Permissive',
        description: expect.any(String)
      })

      // Check available models
      expect(sessionInfo?.availableModels).toHaveLength(2)
      expect(sessionInfo?.availableModels).toContainEqual({
        id: 'openai:gpt-4',
        name: 'GPT-4',
        description: 'GPT-4 model'
      })
    })

    it('should return null for non-existent session', async () => {
      // Mock getConversation returning null
      mockSqlitePresenter.getConversation = vi.fn().mockResolvedValue(null)

      const sessionInfo = await agenticPresenter.getSession('non-existent-session')

      expect(sessionInfo).toBeNull()
    })
  })

  describe('Model and mode management', () => {
    it('should parse modelId with provider prefix', async () => {
      await agenticPresenter.setModel(testSessionId, 'openai:gpt-4')

      expect(mockSessionPresenter.updateConversationSettings).toHaveBeenCalledWith(testSessionId, {
        providerId: 'openai',
        modelId: 'gpt-4'
      })
    })

    it('should handle modelId without provider prefix', async () => {
      await agenticPresenter.setModel(testSessionId, 'gpt-4')

      expect(mockSessionPresenter.updateConversationSettings).toHaveBeenCalledWith(testSessionId, {
        providerId: undefined,
        modelId: 'gpt-4'
      })
    })

    it('should store mode for session', async () => {
      await agenticPresenter.setMode(testSessionId, 'balanced')

      const sessionInfo = await agenticPresenter.getSession(testSessionId)
      expect(sessionInfo?.currentModeId).toBe('balanced')
    })
  })

  describe('Error handling', () => {
    it('should emit ERROR event on createSession failure', async () => {
      // Mock createConversation throwing an error
      mockSessionPresenter.createConversation = vi
        .fn()
        .mockRejectedValue(new Error('Failed to create conversation'))

      const config: SessionConfig = {}

      await expect(agenticPresenter.createSession('deepchat.default', config)).rejects.toThrow(
        'Failed to create conversation'
      )

      // Verify ERROR event was emitted
      const errorEventCalls = sendToRendererSpy.mock.calls.filter(
        (call) => call[0] === 'agentic.error'
      )
      expect(errorEventCalls.length).toBeGreaterThan(0)
    })

    it('should emit ERROR event on sendMessage failure', async () => {
      // Mock sendMessage throwing an error
      mockSessionPresenter.findTabForConversation = vi.fn().mockResolvedValue(1)
      mockMessageManager.sendMessage = vi
        .fn()
        .mockRejectedValue(new Error('Failed to send message'))

      const content: MessageContent = { text: 'Hello' }

      await expect(agenticPresenter.sendMessage(testSessionId, content)).rejects.toThrow(
        'Failed to send message'
      )

      // Verify ERROR event was emitted
      const errorEventCalls = sendToRendererSpy.mock.calls.filter(
        (call) => call[0] === 'agentic.error'
      )
      expect(errorEventCalls.length).toBeGreaterThan(0)
    })
  })

  describe('AgentPresenter registration', () => {
    it('should register AgentPresenter with AgenticPresenter', () => {
      // AgentPresenter is registered in constructor
      // Verify by checking that we can create a session with its agentId
      const config: SessionConfig = {}

      expect(agenticPresenter.createSession('deepchat.default', config)).resolves.toBeDefined()
    })
  })
})
