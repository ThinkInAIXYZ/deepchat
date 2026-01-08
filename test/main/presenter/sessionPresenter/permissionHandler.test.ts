import { describe, expect, it, vi } from 'vitest'
import type { AssistantMessage, AssistantMessageBlock } from '@shared/chat'
import type { ILlmProviderPresenter, IMCPPresenter, IToolPresenter } from '@shared/presenter'
import { PermissionHandler } from '@/presenter/agentPresenter/permission/permissionHandler'
import { CommandPermissionService } from '@/presenter/permission'
import type { ThreadHandlerContext } from '@/presenter/searchPresenter/handlers/baseHandler'
import type { StreamGenerationHandler } from '@/presenter/sessionPresenter/streaming/streamGenerationHandler'
import type { LLMEventHandler } from '@/presenter/sessionPresenter/streaming/llmEventHandler'
import type { MessageManager } from '@/presenter/sessionPresenter/managers/messageManager'
import type { SearchManager } from '@/presenter/searchPresenter/managers/searchManager'
import type { GeneratingMessageState } from '@/presenter/sessionPresenter/streaming/types'

vi.mock('@/presenter', () => ({
  presenter: {
    sessionManager: {
      clearPendingPermission: vi.fn(),
      setStatus: vi.fn(),
      startLoop: vi.fn()
    }
  }
}))

const createAssistantMessage = (
  blocks: AssistantMessageBlock[],
  conversationId: string,
  messageId: string
): AssistantMessage => {
  return {
    id: messageId,
    conversationId,
    role: 'assistant',
    content: blocks
  } as AssistantMessage
}

describe('PermissionHandler - ACP permissions', () => {
  const createHandler = (overrides?: {
    generatingState?: Partial<GeneratingMessageState>
    block?: AssistantMessageBlock
    resolveAgentPermission?: ReturnType<typeof vi.fn>
  }) => {
    const conversationId = 'conv-1'
    const messageId = 'msg-1'
    const toolCallId = 'tool-1'
    const permissionRequest = {
      providerId: 'acp',
      requestId: 'req-123'
    }

    const block: AssistantMessageBlock =
      overrides?.block ||
      ({
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        timestamp: Date.now(),
        content: 'components.messageBlockPermissionRequest.description.write',
        tool_call: {
          id: toolCallId,
          name: 'acp-tool'
        },
        extra: {
          needsUserAction: true,
          providerId: 'acp',
          permissionRequestId: permissionRequest.requestId,
          permissionRequest: JSON.stringify(permissionRequest),
          permissionType: 'write'
        }
      } as AssistantMessageBlock)

    const assistantMessage = createAssistantMessage([block], conversationId, messageId)

    const messageManager = {
      getMessage: vi.fn().mockResolvedValue(assistantMessage),
      editMessage: vi.fn().mockResolvedValue(assistantMessage),
      handleMessageError: vi.fn()
    } as unknown as MessageManager

    const llmProviderPresenter = {
      resolveAgentPermission:
        overrides?.resolveAgentPermission || vi.fn().mockResolvedValue(undefined)
    } as unknown as ILlmProviderPresenter

    const ctx: ThreadHandlerContext = {
      sqlitePresenter: {} as never,
      messageManager,
      llmProviderPresenter,
      configPresenter: {} as never,
      searchManager: {} as SearchManager
    }

    const generatingMessages = new Map<string, GeneratingMessageState>()
    generatingMessages.set(messageId, {
      message: assistantMessage,
      conversationId,
      startTime: Date.now(),
      firstTokenTime: null,
      promptTokens: 0,
      reasoningStartTime: null,
      reasoningEndTime: null,
      lastReasoningTime: null,
      ...(overrides?.generatingState || {})
    })

    const permissionHandler = new PermissionHandler(ctx, {
      generatingMessages,
      llmProviderPresenter,
      getMcpPresenter: () => ({ grantPermission: vi.fn() }) as unknown as IMCPPresenter,
      getToolPresenter: () =>
        ({
          getAllToolDefinitions: vi.fn(),
          callTool: vi.fn()
        }) as unknown as IToolPresenter,
      streamGenerationHandler: {} as StreamGenerationHandler,
      llmEventHandler: {} as LLMEventHandler,
      commandPermissionHandler: new CommandPermissionService()
    })

    return {
      handler: permissionHandler,
      block,
      conversationId,
      messageId,
      toolCallId,
      llmProviderPresenter,
      messageManager,
      generatingMessages
    }
  }

  it('routes granted permissions through llmProviderPresenter for ACP blocks', async () => {
    const { handler, messageId, toolCallId, llmProviderPresenter } = createHandler()

    await handler.handlePermissionResponse(messageId, toolCallId, true, 'write', false)

    expect(llmProviderPresenter.resolveAgentPermission).toHaveBeenCalledWith('req-123', true)
  })

  it('routes denied permissions through llmProviderPresenter for ACP blocks', async () => {
    const { handler, messageId, toolCallId, llmProviderPresenter } = createHandler()

    await handler.handlePermissionResponse(messageId, toolCallId, false, 'write', false)

    expect(llmProviderPresenter.resolveAgentPermission).toHaveBeenCalledWith('req-123', false)
  })
})

describe('PermissionHandler - permission block removal', () => {
  const createRemovalHandler = () => {
    const conversationId = 'conv-2'
    const messageId = 'msg-2'
    const toolCallId = 'tool-2'

    const toolCallBlock: AssistantMessageBlock = {
      type: 'tool_call',
      status: 'loading',
      timestamp: Date.now(),
      tool_call: {
        id: toolCallId,
        name: 'writeFile',
        params: '{"path":"/tmp/test.txt"}'
      }
    }

    const permissionBlock: AssistantMessageBlock = {
      type: 'action',
      action_type: 'tool_call_permission',
      status: 'pending',
      timestamp: Date.now(),
      content: 'Permission required',
      tool_call: {
        id: toolCallId,
        name: 'writeFile',
        params: '{"path":"/tmp/test.txt"}',
        server_name: 'filesystem',
        server_description: 'Local file system access'
      },
      extra: {
        needsUserAction: true
      }
    }

    const assistantMessage = createAssistantMessage(
      [toolCallBlock, permissionBlock],
      conversationId,
      messageId
    )
    const generatingMessage = createAssistantMessage(
      [toolCallBlock, permissionBlock],
      conversationId,
      messageId
    )

    const messageManager = {
      getMessage: vi.fn().mockResolvedValue(assistantMessage),
      editMessage: vi.fn().mockResolvedValue(assistantMessage),
      handleMessageError: vi.fn()
    } as unknown as MessageManager

    const ctx: ThreadHandlerContext = {
      sqlitePresenter: {} as never,
      messageManager,
      llmProviderPresenter: {} as never,
      configPresenter: {} as never,
      searchManager: {} as SearchManager
    }

    const generatingMessages = new Map<string, GeneratingMessageState>()
    generatingMessages.set(messageId, {
      message: generatingMessage,
      conversationId,
      startTime: Date.now(),
      firstTokenTime: null,
      promptTokens: 0,
      reasoningStartTime: null,
      reasoningEndTime: null,
      lastReasoningTime: null
    })

    const permissionHandler = new PermissionHandler(ctx, {
      generatingMessages,
      llmProviderPresenter: {} as ILlmProviderPresenter,
      getMcpPresenter: () => ({ grantPermission: vi.fn() }) as unknown as IMCPPresenter,
      getToolPresenter: () =>
        ({
          getAllToolDefinitions: vi.fn(),
          callTool: vi.fn()
        }) as unknown as IToolPresenter,
      streamGenerationHandler: {} as StreamGenerationHandler,
      llmEventHandler: {} as LLMEventHandler,
      commandPermissionHandler: new CommandPermissionService()
    })

    return {
      handler: permissionHandler,
      messageManager,
      generatingMessages,
      messageId,
      toolCallId
    }
  }

  it('removes permission blocks and updates tool_call blocks after resolution', async () => {
    const { handler, messageManager, generatingMessages, messageId, toolCallId } =
      createRemovalHandler()
    vi.spyOn(handler, 'continueAfterPermissionDenied').mockResolvedValue()

    await handler.handlePermissionResponse(messageId, toolCallId, false, 'command', false)

    const updatedContent = JSON.parse(
      (messageManager.editMessage as unknown as { mock: { calls: Array<[string, string]> } }).mock
        .calls[0][1]
    ) as AssistantMessageBlock[]

    const hasPermissionBlock = updatedContent.some(
      (block) => block.type === 'action' && block.action_type === 'tool_call_permission'
    )
    expect(hasPermissionBlock).toBe(false)

    const updatedToolCall = updatedContent.find(
      (block) => block.type === 'tool_call' && block.tool_call?.id === toolCallId
    )
    expect(updatedToolCall?.tool_call?.server_name).toBe('filesystem')

    const generatingContent = generatingMessages.get(messageId)?.message.content ?? []
    const hasGeneratingPermissionBlock = generatingContent.some(
      (block) => block.type === 'action' && block.action_type === 'tool_call_permission'
    )
    expect(hasGeneratingPermissionBlock).toBe(false)

    const generatingToolCall = generatingContent.find(
      (block) => block.type === 'tool_call' && block.tool_call?.id === toolCallId
    )
    expect(generatingToolCall?.tool_call?.server_name).toBe('filesystem')
  })
})
