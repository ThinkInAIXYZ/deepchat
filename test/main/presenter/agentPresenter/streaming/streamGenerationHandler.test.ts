import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamGenerationHandler } from '@/presenter/agentPresenter/streaming/streamGenerationHandler'
import type { ThreadHandlerContext } from '@/presenter/agentPresenter/types/handlerContext'
import type { AgentSessionRuntimePort } from '@/presenter/agentPresenter/session/sessionRuntimePort'
import type { MessageManager } from '@/presenter/sessionPresenter/managers/messageManager'
import type { GeneratingMessageState } from '@/presenter/agentPresenter/streaming/types'

vi.mock('@/presenter/agentPresenter/message/messageBuilder', () => ({
  preparePromptContent: vi.fn().mockResolvedValue({
    finalContent: [{ role: 'user', content: 'hello' }],
    promptTokens: 12
  })
}))

describe('StreamGenerationHandler session runtime wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses injected session runtime for loop start and workspace resolution', async () => {
    const conversationId = 'conv-stream'
    const messageId = 'assistant-1'
    const userMessageId = 'user-1'
    const sessionRuntime = {
      startLoop: vi.fn().mockResolvedValue(undefined),
      resolveWorkspaceContext: vi.fn().mockResolvedValue({
        chatMode: 'agent',
        agentWorkspacePath: 'C:/workspace'
      })
    } as unknown as AgentSessionRuntimePort
    const messageManager = {
      getMessage: vi.fn().mockImplementation(async (id: string) => {
        if (id === userMessageId) {
          return {
            id: userMessageId,
            conversationId,
            role: 'user',
            content: {
              text: 'hello',
              files: []
            }
          }
        }
        throw new Error(`Unexpected message lookup: ${id}`)
      }),
      getMessageHistory: vi.fn().mockResolvedValue([]),
      updateMessageMetadata: vi.fn().mockResolvedValue(undefined)
    } as unknown as MessageManager
    const ctx: ThreadHandlerContext = {
      sqlitePresenter: {
        getConversation: vi.fn().mockResolvedValue({
          id: conversationId,
          settings: {
            providerId: 'mock-provider',
            modelId: 'mock-model',
            temperature: 0.7,
            maxTokens: 1024,
            enabledMcpTools: [],
            thinkingBudget: undefined,
            reasoningEffort: undefined,
            verbosity: undefined,
            contextLength: 2048
          }
        })
      } as any,
      messageManager,
      llmProviderPresenter: {
        startStreamCompletion: vi.fn().mockReturnValue(
          (async function* () {
            yield { type: 'end', data: { eventId: messageId } }
          })()
        )
      } as any,
      configPresenter: {
        getModelConfig: vi.fn().mockReturnValue({
          functionCall: false,
          vision: false,
          type: 'chat'
        }),
        getSetting: vi.fn().mockReturnValue(false)
      } as any,
      sessionRuntime,
      toolPresenter: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([]),
        buildToolSystemPrompt: vi.fn().mockReturnValue(''),
        callTool: vi.fn()
      } as any,
      mcpRuntime: {
        callTool: vi.fn(),
        grantPermission: vi.fn(),
        isServerRunning: vi.fn()
      } as any,
      promptRuntime: {
        getInputChatMode: vi.fn(),
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getActiveSkills: vi.fn(),
        loadSkillContent: vi.fn(),
        getMetadataPrompt: vi.fn(),
        getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([])
      } as any,
      permissionRuntime: {} as any
    }
    const llmEventHandler = {
      handleLLMAgentResponse: vi.fn().mockResolvedValue(undefined),
      handleLLMAgentError: vi.fn().mockResolvedValue(undefined),
      handleLLMAgentEnd: vi.fn().mockResolvedValue(undefined)
    }
    const generatingMessages = new Map<string, GeneratingMessageState>([
      [
        messageId,
        {
          message: {
            id: messageId,
            conversationId,
            role: 'assistant',
            content: [],
            parentId: userMessageId
          } as any,
          conversationId,
          startTime: Date.now(),
          firstTokenTime: null,
          promptTokens: 0,
          reasoningStartTime: null,
          reasoningEndTime: null,
          lastReasoningTime: null
        }
      ]
    ])

    const handler = new StreamGenerationHandler(ctx, {
      generatingMessages,
      llmEventHandler: llmEventHandler as any
    })

    await handler.startStreamCompletion(conversationId, userMessageId)

    expect(sessionRuntime.startLoop).toHaveBeenCalledWith(conversationId, messageId, {
      skipLockAcquisition: true
    })
    expect(sessionRuntime.resolveWorkspaceContext).toHaveBeenCalledWith(
      conversationId,
      'mock-model'
    )
    expect(ctx.llmProviderPresenter.startStreamCompletion).toHaveBeenCalled()
  })
})
