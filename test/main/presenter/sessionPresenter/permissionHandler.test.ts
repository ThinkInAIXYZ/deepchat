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
          callTool: vi.fn(),
          buildToolSystemPrompt: vi.fn()
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
          callTool: vi.fn(),
          buildToolSystemPrompt: vi.fn()
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

  describe('Multi-permission scenarios', () => {
    it('should append multiple pending permissions to session', () => {
      const sessionManager = presenter.sessionManager as unknown as SessionManager
      const agentId = 'test-agent'

      // Add first permission
      sessionManager.addPendingPermission(agentId, {
        messageId: 'msg-1',
        toolCallId: 'tool-1',
        permissionType: 'read',
        payload: { serverName: 'server1' }
      })

      // Add second permission
      sessionManager.addPendingPermission(agentId, {
        messageId: 'msg-1',
        toolCallId: 'tool-2',
        permissionType: 'write',
        payload: { serverName: 'server2' }
      })

      const pendingPermissions = sessionManager.getPendingPermissions(agentId)
      expect(pendingPermissions).toHaveLength(2)
      expect(pendingPermissions?.[0].toolCallId).toBe('tool-1')
      expect(pendingPermissions?.[1].toolCallId).toBe('tool-2')
    })

    it('should check pending permissions by messageId', () => {
      const sessionManager = presenter.sessionManager as unknown as SessionManager
      const agentId = 'test-agent'

      sessionManager.addPendingPermission(agentId, {
        messageId: 'msg-1',
        toolCallId: 'tool-1',
        permissionType: 'read',
        payload: {}
      })
      sessionManager.addPendingPermission(agentId, {
        messageId: 'msg-2',
        toolCallId: 'tool-2',
        permissionType: 'write',
        payload: {}
      })

      expect(sessionManager.hasPendingPermissions(agentId, 'msg-1')).toBe(true)
      expect(sessionManager.hasPendingPermissions(agentId, 'msg-2')).toBe(true)
      expect(sessionManager.hasPendingPermissions(agentId, 'msg-3')).toBe(false)
    })
  })

  describe('Permission resume lock', () => {
    it('should acquire resume lock successfully', () => {
      const sessionManager = presenter.sessionManager as unknown as SessionManager
      const agentId = 'test-agent'

      const acquired = sessionManager.acquirePermissionResumeLock(agentId, 'msg-1')
      expect(acquired).toBe(true)

      const lock = sessionManager.getPermissionResumeLock(agentId)
      expect(lock?.messageId).toBe('msg-1')
      expect(lock?.startedAt).toBeGreaterThan(0)
    })

    it('should reject acquiring lock for same message', () => {
      const sessionManager = presenter.sessionManager as unknown as SessionManager
      const agentId = 'test-agent'

      sessionManager.acquirePermissionResumeLock(agentId, 'msg-1')

      // Should reject acquiring lock for same message
      const acquiredAgain = sessionManager.acquirePermissionResumeLock(agentId, 'msg-1')
      expect(acquiredAgain).toBe(false)
    })

    it('should release resume lock', () => {
      const sessionManager = presenter.sessionManager as unknown as SessionManager
      const agentId = 'test-agent'

      sessionManager.acquirePermissionResumeLock(agentId, 'msg-1')
      expect(sessionManager.getPermissionResumeLock(agentId)).toBeDefined()

      sessionManager.releasePermissionResumeLock(agentId)
      expect(sessionManager.getPermissionResumeLock(agentId)).toBeUndefined()
    })

    it('should allow acquiring lock for different message after release', () => {
      const sessionManager = presenter.sessionManager as unknown as SessionManager
      const agentId = 'test-agent'

      sessionManager.acquirePermissionResumeLock(agentId, 'msg-1')
      sessionManager.releasePermissionResumeLock(agentId)

      const acquiredForNewMessage = sessionManager.acquirePermissionResumeLock(agentId, 'msg-2')
      expect(acquiredForNewMessage).toBe(true)
    })
  })

  describe('Permission level hierarchy', () => {
    it('should update permissions with same or lower permission level', async () => {
      // Setup message with two permissions from same server
      const content: AssistantMessageBlock[] = [
        {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          extra: {
            serverName: 'filesystem',
            permissionType: 'read',
            needsUserAction: true
          },
          tool_call: {
            id: 'tool-1',
            name: 'read_file',
            server_name: 'filesystem'
          }
        },
        {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          extra: {
            serverName: 'filesystem',
            permissionType: 'write',
            needsUserAction: true
          },
          tool_call: {
            id: 'tool-2',
            name: 'write_file',
            server_name: 'filesystem'
          }
        }
      ]

      messageManager.getMessage = vi.fn().mockResolvedValue({
        id: messageId,
        role: 'assistant',
        content,
        conversationId: 'conv-1'
      })

      // Grant 'write' permission - should update both read and write permissions
      // (since write >= read permission level)
      // But actually read has level 1, write has level 2, so write >= read is true
      // So granting 'write' should update both permissions
    })
  })
})
