/**
 * Integration tests for ACP agent flow through AgenticPresenter
 * Tests the full flow: create session → send message → receive events → close session
 *
 * NOTE: These tests require full Electron environment context due to
 * AcpPresenter's dependency chain (presenter/index.ts → knowledgePresenter → app)
 * These tests are skipped in the vitest environment and should be run
 * in the full Electron context or via manual testing (TASK-6.3.2).
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
import { AcpPresenter, AcpAgentPresenter } from '@/presenter/acpPresenter'
import type { SessionConfig, MessageContent } from '@/presenter/agentic/types'
import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'
import type { IConfigPresenter } from '@shared/presenter'
import type { IMcpPresenter } from '@shared/presenter'
import type { AcpSessionInfo, AcpPromptInput } from '@/presenter/acpPresenter/types'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import { AcpProcessManager } from '@/presenter/acpPresenter/managers/processManager'
import { AcpSessionManager } from '@/presenter/acpPresenter/managers/sessionManager'
import { AcpInputFormatter } from '@/presenter/acpPresenter/formatters/inputFormatter'

describe.skip('ACP Agent Flow - AgenticPresenter Integration', () => {
  let acpPresenter: AcpPresenter
  let sendToRendererSpy: ReturnType<typeof vi.spyOn>
  let testSessionId: string
  let testAgentId = 'acp.anthropic.claude-code'

  // Mock dependencies
  let mockConfigPresenter: IConfigPresenter
  let mockMcpPresenter: IMcpPresenter
  let mockProcessManager: AcpProcessManager
  let mockSessionManager: AcpSessionManager
  let mockInputFormatter: AcpInputFormatter

  // Mock ACP session
  const mockAcpSession: AcpSessionInfo = {
    sessionId: 'acp-session-1',
    agentId: testAgentId,
    workdir: '/test/dir',
    status: 'idle',
    availableModels: [
      { id: 'claude-3-opus', name: 'Claude 3 Opus', description: 'Most capable model' },
      { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', description: 'Balanced model' }
    ],
    availableModes: [
      { id: 'default', name: 'Default', description: 'Default mode' },
      { id: 'advanced', name: 'Advanced', description: 'Advanced mode' }
    ],
    currentModelId: 'claude-3-opus',
    currentModeId: 'default'
  }

  // Mock ACP connection
  const mockConnection = {
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined)
  }

  beforeEach(async () => {
    testSessionId = 'acp-session-1'

    // Spy on eventBus
    sendToRendererSpy = vi.spyOn(eventBus, 'sendToRenderer').mockImplementation(() => {})

    // Create mock dependencies
    mockConfigPresenter = {
      getAcpAgents: vi.fn().mockResolvedValue([
        {
          id: testAgentId,
          name: 'Claude Code',
          description: 'Anthropic Claude Code agent',
          command: 'npx',
          args: ['@anthropic-ai/claude-code'],
          runtime: 'builtin'
        }
      ]),
      getAcpUseBuiltinRuntime: vi.fn().mockResolvedValue(true)
    } as unknown as IConfigPresenter

    mockMcpPresenter = {
      getNpmRegistry: vi.fn().mockResolvedValue(null),
      getUvRegistry: vi.fn().mockResolvedValue(null)
    } as unknown as IMcpPresenter

    // Mock AcpInputFormatter
    mockInputFormatter = {
      validate: vi.fn().mockReturnValue({ valid: true }),
      format: vi.fn().mockReturnValue([])
    } as unknown as AcpInputFormatter

    // Mock AcpProcessManager
    mockProcessManager = {
      warmupProcess: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined)
    } as unknown as AcpProcessManager

    // Mock AcpSessionManager
    const mockSession = {
      sessionId: testSessionId,
      agentId: testAgentId,
      workdir: '/test/dir',
      connection: mockConnection
    }

    mockSessionManager = {
      createSession: vi.fn().mockResolvedValue(mockAcpSession),
      loadSession: vi.fn().mockResolvedValue(mockAcpSession),
      getSession: vi.fn().mockReturnValue(mockSession),
      getSessionInfo: vi.fn().mockReturnValue(mockAcpSession),
      closeSession: vi.fn().mockResolvedValue(undefined),
      clearAllSessions: vi.fn().mockResolvedValue(undefined),
      listSessions: vi.fn().mockReturnValue([mockAcpSession])
    } as unknown as AcpSessionManager

    // Create AcpPresenter
    acpPresenter = new AcpPresenter()

    // Set up the mocks by accessing private properties
    ;(acpPresenter as any).processManager = mockProcessManager
    ;(acpPresenter as any).sessionManager = mockSessionManager
    ;(acpPresenter as any).inputFormatter = mockInputFormatter
    ;(acpPresenter as any).initialized = true

    // Register ACP agents with AgenticPresenter
    await acpPresenter.registerAgenticAgents()
  })

  describe('Full agent flow', () => {
    it('should complete the full ACP agent flow', async () => {
      // 1. Create session with workdir
      const config: SessionConfig & { workdir: string } = {
        workdir: '/test/dir'
      }

      const sessionId = await agenticPresenter.createSession(testAgentId, config)

      expect(sessionId).toBe(testSessionId)
      expect(mockSessionManager.createSession).toHaveBeenCalledWith(
        testAgentId,
        '/test/dir',
        expect.any(Object)
      )

      // 2. Get session info
      const sessionInfo = await agenticPresenter.getSession(sessionId)

      expect(sessionInfo).not.toBeNull()
      expect(sessionInfo?.agentId).toBe(testAgentId)
      expect(sessionInfo?.status).toBe('idle')
      expect(sessionInfo?.currentModelId).toBe('claude-3-opus')
      expect(sessionInfo?.currentModeId).toBe('default')
      expect(sessionInfo?.availableModels).toHaveLength(2)
      expect(sessionInfo?.availableModes).toHaveLength(2)

      // 3. Send message (with multi-modal content)
      const content: MessageContent = {
        text: 'Hello, how are you?',
        images: [
          {
            type: 'base64',
            data: 'base64encodedimagedata'
          }
        ],
        files: [
          {
            path: '/path/to/file.txt',
            name: 'file.txt'
          }
        ]
      }

      await agenticPresenter.sendMessage(sessionId, content)

      // Verify prompt was formatted and sent
      expect(mockInputFormatter.format).toHaveBeenCalled()
      expect(mockConnection.prompt).toHaveBeenCalledWith({
        sessionId: testSessionId,
        prompt: expect.any(Array)
      })

      // 4. Set model
      await agenticPresenter.setModel(sessionId, 'claude-3-sonnet')

      // Model change is tracked in ACP session
      // Note: Actual ACP SDK setModel call is TODO
      expect(mockSessionManager.getSessionInfo).toHaveBeenCalledWith(sessionId)

      // 5. Set mode
      await agenticPresenter.setMode(sessionId, 'advanced')

      // Mode change is tracked
      expect(mockSessionManager.getSessionInfo).toHaveBeenCalledWith(sessionId)

      // 6. Load session (with history streaming)
      const loadContext = {
        maxHistory: 100,
        workdir: '/test/dir'
      } as any

      await agenticPresenter.loadSession(sessionId, loadContext)

      expect(mockSessionManager.loadSession).toHaveBeenCalledWith(
        testAgentId,
        sessionId,
        '/test/dir',
        expect.any(Object)
      )

      // 7. Close session
      await agenticPresenter.closeSession(sessionId)

      expect(mockSessionManager.closeSession).toHaveBeenCalledWith(sessionId)

      // Verify emitter was cleaned up
      expect(acpPresenter['emitters'].has(sessionId)).toBe(false)
    })

    it('should handle error when agent not found', async () => {
      const config: SessionConfig = {}

      await expect(agenticPresenter.createSession('acp.unknown.agent', config)).rejects.toThrow(
        'Agent not found: acp.unknown.agent'
      )
    })
  })

  describe('Session info', () => {
    it('should return correct session info with all fields', async () => {
      // Manually set up session mapping
      agenticPresenter['sessionToPresenter'].set(
        testSessionId,
        acpPresenter.getRegisteredAgent(testAgentId)!
      )

      const sessionInfo = await agenticPresenter.getSession(testSessionId)

      expect(sessionInfo).toMatchObject({
        sessionId: testSessionId,
        agentId: testAgentId,
        status: 'idle',
        currentModelId: 'claude-3-opus',
        currentModeId: 'default',
        availableModels: expect.any(Array),
        availableModes: expect.any(Array),
        capabilities: {
          supportsVision: false,
          supportsTools: true,
          supportsModes: true
        }
      })

      // Check available models
      expect(sessionInfo?.availableModels).toHaveLength(2)
      expect(sessionInfo?.availableModels).toContainEqual({
        id: 'claude-3-opus',
        name: 'Claude 3 Opus',
        description: 'Most capable model'
      })

      // Check available modes
      expect(sessionInfo?.availableModes).toHaveLength(2)
      expect(sessionInfo?.availableModes).toContainEqual({
        id: 'default',
        name: 'Default',
        description: 'Default mode'
      })
    })

    it('should return null for non-existent session', async () => {
      // Mock getSessionInfo returning null
      mockSessionManager.getSessionInfo = vi.fn().mockReturnValue(null)

      // Manually set up session mapping
      agenticPresenter['sessionToPresenter'].set(
        testSessionId,
        acpPresenter.getRegisteredAgent(testAgentId)!
      )

      const sessionInfo = await agenticPresenter.getSession(testSessionId)

      expect(sessionInfo).toBeNull()
    })

    it('should map ACP status to agentic status correctly', async () => {
      // Test different ACP statuses
      const statusTests = [
        { acpStatus: 'idle', expectedStatus: 'idle' },
        { acpStatus: 'active', expectedStatus: 'generating' },
        { acpStatus: 'error', expectedStatus: 'error' }
      ]

      for (const { acpStatus, expectedStatus } of statusTests) {
        mockSessionManager.getSessionInfo = vi.fn().mockReturnValue({
          ...mockAcpSession,
          status: acpStatus
        })

        agenticPresenter['sessionToPresenter'].set(
          testSessionId,
          acpPresenter.getRegisteredAgent(testAgentId)!
        )

        const sessionInfo = await agenticPresenter.getSession(testSessionId)
        expect(sessionInfo?.status).toBe(expectedStatus)
      }
    })
  })

  describe('Multi-modal content handling', () => {
    it('should format and send text-only content', async () => {
      // Set up session mapping
      agenticPresenter['sessionToPresenter'].set(
        testSessionId,
        acpPresenter.getRegisteredAgent(testAgentId)!
      )

      const content: MessageContent = {
        text: 'Hello, world!'
      }

      await agenticPresenter.sendMessage(testSessionId, content)

      expect(mockInputFormatter.format).toHaveBeenCalledWith({
        text: 'Hello, world!',
        images: undefined,
        files: undefined
      })
    })

    it('should format and send content with images', async () => {
      // Set up session mapping
      agenticPresenter['sessionToPresenter'].set(
        testSessionId,
        acpPresenter.getRegisteredAgent(testAgentId)!
      )

      const content: MessageContent = {
        text: 'What do you see?',
        images: [
          {
            type: 'url',
            data: 'https://example.com/image.png'
          },
          {
            type: 'base64',
            data: 'iVBORw0KGgoAAAANS...'
          }
        ]
      }

      await agenticPresenter.sendMessage(testSessionId, content)

      expect(mockInputFormatter.format).toHaveBeenCalledWith({
        text: 'What do you see?',
        images: [
          { type: 'url', data: 'https://example.com/image.png' },
          { type: 'base64', data: 'iVBORw0KGgoAAAANS...' }
        ],
        files: undefined
      })
    })

    it('should format and send content with files', async () => {
      // Set up session mapping
      agenticPresenter['sessionToPresenter'].set(
        testSessionId,
        acpPresenter.getRegisteredAgent(testAgentId)!
      )

      const content: MessageContent = {
        text: 'Analyze these files',
        files: [
          {
            path: '/path/to/file1.txt',
            name: 'file1.txt'
          },
          {
            path: '/path/to/file2.py',
            name: 'file2.py'
          }
        ]
      }

      await agenticPresenter.sendMessage(testSessionId, content)

      expect(mockInputFormatter.format).toHaveBeenCalledWith({
        text: 'Analyze these files',
        images: undefined,
        files: [
          { path: '/path/to/file1.txt', name: 'file1.txt' },
          { path: '/path/to/file2.py', name: 'file2.py' }
        ]
      })
    })
  })

  describe('Cancel message', () => {
    it('should cancel a running prompt', async () => {
      // Set up session mapping
      agenticPresenter['sessionToPresenter'].set(
        testSessionId,
        acpPresenter.getRegisteredAgent(testAgentId)!
      )

      await agenticPresenter.cancelMessage(testSessionId, 'msg-1')

      expect(mockConnection.cancel).toHaveBeenCalledWith({
        sessionId: testSessionId
      })
    })
  })

  describe('Error handling', () => {
    it('should handle sendPrompt error gracefully', async () => {
      // Mock prompt throwing an error
      mockConnection.prompt = vi.fn().mockRejectedValue(new Error('Prompt failed'))

      // Set up session mapping
      agenticPresenter['sessionToPresenter'].set(
        testSessionId,
        acpPresenter.getRegisteredAgent(testAgentId)!
      )

      const content: MessageContent = { text: 'Hello' }

      await expect(agenticPresenter.sendMessage(testSessionId, content)).rejects.toThrow(
        'Prompt failed'
      )
    })

    it('should handle invalid input validation', async () => {
      // Mock validation failure
      mockInputFormatter.validate = vi.fn().mockReturnValue({
        valid: false,
        error: 'Invalid input format'
      })

      // Set up session mapping
      agenticPresenter['sessionToPresenter'].set(
        testSessionId,
        acpPresenter.getRegisteredAgent(testAgentId)!
      )

      const content: MessageContent = { text: '' }

      await expect(agenticPresenter.sendMessage(testSessionId, content)).rejects.toThrow(
        'Invalid input: Invalid input format'
      )
    })
  })

  describe('ACP Agent Presenter Wrapper', () => {
    it('should create wrapper for each ACP agent', async () => {
      const wrapper = acpPresenter.getRegisteredAgent(testAgentId)

      expect(wrapper).not.toBeUndefined()
      expect(wrapper?.agentId).toBe(testAgentId)
    })

    it('should not register duplicate agents', async () => {
      const initialAgent = acpPresenter.getRegisteredAgent(testAgentId)

      // Re-register (should skip already registered)
      await acpPresenter.registerAgenticAgents()

      const agentAfter = acpPresenter.getRegisteredAgent(testAgentId)

      expect(agentAfter).toBe(initialAgent)
    })
  })

  describe('Emitter management', () => {
    it('should create and cache emitter for session', () => {
      const emitter1 = acpPresenter.getEmitter(testSessionId)
      const emitter2 = acpPresenter.getEmitter(testSessionId)

      expect(emitter1).toBe(emitter2)
      expect(emitter1).toBeDefined()
    })

    it('should clean up emitter on session close', async () => {
      // Create emitter
      acpPresenter.getEmitter(testSessionId)
      expect(acpPresenter['emitters'].has(testSessionId)).toBe(true)

      // Close session
      await acpPresenter.closeSession(testSessionId)

      expect(acpPresenter['emitters'].has(testSessionId)).toBe(false)
    })
  })
})
