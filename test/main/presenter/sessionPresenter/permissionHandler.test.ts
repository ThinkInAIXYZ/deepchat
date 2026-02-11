import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessage, AssistantMessageBlock } from '@shared/chat'
import type { ILlmProviderPresenter, IMCPPresenter, IToolPresenter } from '@shared/presenter'
import { PermissionHandler } from '@/presenter/agentPresenter/permission/permissionHandler'
import { CommandPermissionService } from '@/presenter/permission'
import { presenter } from '@/presenter'
import type { ThreadHandlerContext } from '@/presenter/searchPresenter/handlers/baseHandler'
import type { StreamGenerationHandler } from '@/presenter/agentPresenter/streaming/streamGenerationHandler'
import type { LLMEventHandler } from '@/presenter/agentPresenter/streaming/llmEventHandler'
import type { MessageManager } from '@/presenter/sessionPresenter/managers/messageManager'
import type { SearchManager } from '@/presenter/searchPresenter/managers/searchManager'
import type { GeneratingMessageState } from '@/presenter/agentPresenter/streaming/types'

const sessionState = vi.hoisted(() => ({
  pendingPermissions: new Map<
    string,
    Array<{
      messageId: string
      toolCallId: string
      permissionType: 'read' | 'write' | 'all' | 'command'
      payload: Record<string, unknown>
    }>
  >(),
  locks: new Map<string, { messageId: string; startedAt: number }>(),
  status: new Map<string, string>(),
  sessions: new Map<string, { id: string }>()
}))

const presenterMock = vi.hoisted(() => ({
  sessionManager: {
    clearPendingPermission: vi.fn((agentId: string) => {
      sessionState.pendingPermissions.delete(agentId)
    }),
    setStatus: vi.fn((agentId: string, status: string) => {
      sessionState.status.set(agentId, status)
    }),
    getStatus: vi.fn((agentId: string) => {
      return (
        (sessionState.status.get(agentId) as
          | 'idle'
          | 'generating'
          | 'waiting_permission'
          | 'waiting_question'
          | null) ?? 'waiting_permission'
      )
    }),
    startLoop: vi.fn().mockResolvedValue(undefined),
    removePendingPermission: vi.fn((agentId: string, messageId: string, toolCallId: string) => {
      const pending = sessionState.pendingPermissions.get(agentId) ?? []
      sessionState.pendingPermissions.set(
        agentId,
        pending.filter((item) => !(item.messageId === messageId && item.toolCallId === toolCallId))
      )
    }),
    addPendingPermission: vi.fn(
      (
        agentId: string,
        permission: {
          messageId: string
          toolCallId: string
          permissionType: 'read' | 'write' | 'all' | 'command'
          payload: Record<string, unknown>
        }
      ) => {
        const pending = sessionState.pendingPermissions.get(agentId) ?? []
        pending.push(permission)
        sessionState.pendingPermissions.set(agentId, pending)
      }
    ),
    getPendingPermissions: vi.fn((agentId: string) => {
      return sessionState.pendingPermissions.get(agentId) ?? []
    }),
    hasPendingPermissions: vi.fn((agentId: string, messageId?: string) => {
      const pending = sessionState.pendingPermissions.get(agentId) ?? []
      if (!messageId) {
        return pending.length > 0
      }
      return pending.some((item) => item.messageId === messageId)
    }),
    acquirePermissionResumeLock: vi.fn((agentId: string, messageId: string) => {
      if (sessionState.locks.get(agentId)?.messageId === messageId) {
        return false
      }
      sessionState.locks.set(agentId, { messageId, startedAt: Date.now() })
      return true
    }),
    getPermissionResumeLock: vi.fn((agentId: string) => {
      return sessionState.locks.get(agentId)
    }),
    releasePermissionResumeLock: vi.fn((agentId: string) => {
      sessionState.locks.delete(agentId)
    }),
    getSessionSync: vi.fn((agentId: string) => {
      return sessionState.sessions.get(agentId) ?? null
    })
  },
  filePermissionService: {
    approve: vi.fn()
  },
  settingsPermissionService: {
    approve: vi.fn()
  }
}))

vi.mock('@/presenter', () => ({
  presenter: presenterMock
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

const createPermissionHandler = (options: {
  message: AssistantMessage
  llmProviderPresenter?: ILlmProviderPresenter
}) => {
  let currentMessage = options.message
  const messageManager = {
    getMessage: vi.fn().mockImplementation(async () => currentMessage),
    editMessage: vi.fn().mockImplementation(async (_id: string, rawContent: string) => {
      const next = JSON.parse(rawContent) as AssistantMessageBlock[]
      currentMessage = {
        ...currentMessage,
        content: next
      }
      return currentMessage
    }),
    handleMessageError: vi.fn()
  } as unknown as MessageManager

  const ctx: ThreadHandlerContext = {
    sqlitePresenter: {} as never,
    messageManager,
    llmProviderPresenter: options.llmProviderPresenter ?? ({} as ILlmProviderPresenter),
    configPresenter: {} as never,
    searchManager: {} as SearchManager
  }

  const generatingMessages = new Map<string, GeneratingMessageState>()
  generatingMessages.set(currentMessage.id, {
    message: currentMessage,
    conversationId: currentMessage.conversationId,
    startTime: Date.now(),
    firstTokenTime: null,
    promptTokens: 0,
    reasoningStartTime: null,
    reasoningEndTime: null,
    lastReasoningTime: null
  })

  const handler = new PermissionHandler(ctx, {
    generatingMessages,
    llmProviderPresenter: options.llmProviderPresenter ?? ({} as ILlmProviderPresenter),
    getMcpPresenter: () =>
      ({
        grantPermission: vi.fn(),
        isServerRunning: vi.fn().mockResolvedValue(true)
      }) as unknown as IMCPPresenter,
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

  return { handler, messageManager, getCurrentMessage: () => currentMessage }
}

describe('PermissionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionState.pendingPermissions.clear()
    sessionState.locks.clear()
    sessionState.status.clear()
    sessionState.sessions.clear()
  })

  describe('ACP permissions', () => {
    it('routes granted permissions through llmProviderPresenter for ACP blocks', async () => {
      const conversationId = 'conv-1'
      const messageId = 'msg-1'
      const toolCallId = 'tool-1'
      sessionState.sessions.set(conversationId, { id: conversationId })

      const permissionBlock = {
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        timestamp: Date.now(),
        content: 'components.messageBlockPermissionRequest.description.write',
        tool_call: { id: toolCallId, name: 'acp-tool' },
        extra: {
          needsUserAction: true,
          providerId: 'acp',
          permissionRequestId: 'req-123',
          permissionRequest: JSON.stringify({ providerId: 'acp', requestId: 'req-123' }),
          permissionType: 'write'
        }
      } as AssistantMessageBlock

      const message = createAssistantMessage([permissionBlock], conversationId, messageId)
      const llmProviderPresenter = {
        resolveAgentPermission: vi.fn().mockResolvedValue(undefined)
      } as unknown as ILlmProviderPresenter

      const { handler } = createPermissionHandler({
        message,
        llmProviderPresenter
      })

      await handler.handlePermissionResponse(messageId, toolCallId, true, 'write', false)

      expect(llmProviderPresenter.resolveAgentPermission).toHaveBeenCalledWith('req-123', true)
      expect(presenter.sessionManager.clearPendingPermission).toHaveBeenCalledWith(conversationId)
      expect(presenter.sessionManager.setStatus).toHaveBeenCalledWith(conversationId, 'generating')
    })

    it('routes denied permissions through llmProviderPresenter for ACP blocks', async () => {
      const conversationId = 'conv-1'
      const messageId = 'msg-1'
      const toolCallId = 'tool-1'
      sessionState.sessions.set(conversationId, { id: conversationId })

      const permissionBlock = {
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        timestamp: Date.now(),
        content: 'components.messageBlockPermissionRequest.description.write',
        tool_call: { id: toolCallId, name: 'acp-tool' },
        extra: {
          needsUserAction: true,
          providerId: 'acp',
          permissionRequestId: 'req-123',
          permissionRequest: JSON.stringify({ providerId: 'acp', requestId: 'req-123' }),
          permissionType: 'write'
        }
      } as AssistantMessageBlock

      const message = createAssistantMessage([permissionBlock], conversationId, messageId)
      const llmProviderPresenter = {
        resolveAgentPermission: vi.fn().mockResolvedValue(undefined)
      } as unknown as ILlmProviderPresenter

      const { handler } = createPermissionHandler({
        message,
        llmProviderPresenter
      })

      await handler.handlePermissionResponse(messageId, toolCallId, false, 'write', false)

      expect(llmProviderPresenter.resolveAgentPermission).toHaveBeenCalledWith('req-123', false)
    })
  })

  describe('Session manager helpers', () => {
    it('stores and filters pending permissions by messageId', () => {
      const sessionManager = presenter.sessionManager as unknown as {
        addPendingPermission: (agentId: string, permission: any) => void
        getPendingPermissions: (agentId: string) => Array<{ toolCallId: string }>
        hasPendingPermissions: (agentId: string, messageId?: string) => boolean
      }

      sessionManager.addPendingPermission('agent-1', {
        messageId: 'msg-1',
        toolCallId: 'tool-1',
        permissionType: 'read',
        payload: {}
      })
      sessionManager.addPendingPermission('agent-1', {
        messageId: 'msg-2',
        toolCallId: 'tool-2',
        permissionType: 'write',
        payload: {}
      })

      const pending = sessionManager.getPendingPermissions('agent-1')
      expect(pending).toHaveLength(2)
      expect(sessionManager.hasPendingPermissions('agent-1', 'msg-1')).toBe(true)
      expect(sessionManager.hasPendingPermissions('agent-1', 'msg-3')).toBe(false)
    })

    it('acquires and releases permission resume lock', () => {
      const sessionManager = presenter.sessionManager as unknown as {
        acquirePermissionResumeLock: (agentId: string, messageId: string) => boolean
        getPermissionResumeLock: (
          agentId: string
        ) => { messageId: string; startedAt: number } | undefined
        releasePermissionResumeLock: (agentId: string) => void
      }

      const firstAcquire = sessionManager.acquirePermissionResumeLock('agent-1', 'msg-1')
      const secondAcquire = sessionManager.acquirePermissionResumeLock('agent-1', 'msg-1')
      const lock = sessionManager.getPermissionResumeLock('agent-1')

      expect(firstAcquire).toBe(true)
      expect(secondAcquire).toBe(false)
      expect(lock?.messageId).toBe('msg-1')
      expect(lock?.startedAt).toBeGreaterThan(0)

      sessionManager.releasePermissionResumeLock('agent-1')
      expect(sessionManager.getPermissionResumeLock('agent-1')).toBeUndefined()
    })
  })

  describe('Permission level hierarchy', () => {
    it('updates same tool-call permission blocks with same or lower required levels', async () => {
      const conversationId = 'conv-2'
      const messageId = 'msg-2'
      const toolCallId = 'tool-1'
      sessionState.sessions.set(conversationId, { id: conversationId })

      const readPermissionBlock: AssistantMessageBlock = {
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        timestamp: Date.now(),
        content: 'Permission required',
        tool_call: {
          id: toolCallId,
          name: 'write_file',
          params: '{"path":"a.txt"}'
        },
        extra: {
          needsUserAction: true,
          serverName: 'mock-server',
          permissionType: 'read'
        }
      }

      const writePermissionBlock: AssistantMessageBlock = {
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        timestamp: Date.now(),
        content: 'Permission required',
        tool_call: {
          id: toolCallId,
          name: 'write_file',
          params: '{"path":"a.txt"}'
        },
        extra: {
          needsUserAction: true,
          serverName: 'mock-server',
          permissionType: 'write'
        }
      }

      const message = createAssistantMessage(
        [readPermissionBlock, writePermissionBlock],
        conversationId,
        messageId
      )
      const { handler, messageManager } = createPermissionHandler({ message })
      vi.spyOn(
        handler as unknown as { resumeToolExecutionAfterPermissions: (...args: any[]) => any },
        'resumeToolExecutionAfterPermissions'
      ).mockResolvedValue(undefined)

      await handler.handlePermissionResponse(messageId, toolCallId, true, 'write', false)

      const updatedContent = JSON.parse(
        (messageManager.editMessage as unknown as { mock: { calls: Array<[string, string]> } }).mock
          .calls[0][1]
      ) as AssistantMessageBlock[]

      const updatedPermissionBlocks = updatedContent.filter(
        (block) => block.type === 'action' && block.action_type === 'tool_call_permission'
      )
      expect(updatedPermissionBlocks).toHaveLength(2)
      expect(updatedPermissionBlocks.every((block) => block.status === 'granted')).toBe(true)
      expect(updatedPermissionBlocks.every((block) => block.extra?.needsUserAction === false)).toBe(
        true
      )
    })
  })
})
