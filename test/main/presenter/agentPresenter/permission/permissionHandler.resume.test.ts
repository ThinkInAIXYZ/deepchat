import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessage, AssistantMessageBlock } from '@shared/chat'
import type { ILlmProviderPresenter, IMCPPresenter, IToolPresenter } from '@shared/presenter'
import { PermissionHandler } from '@/presenter/agentPresenter/permission/permissionHandler'
import type { ThreadHandlerContext } from '@/presenter/searchPresenter/handlers/baseHandler'
import type { MessageManager } from '@/presenter/sessionPresenter/managers/messageManager'
import type { SearchManager } from '@/presenter/searchPresenter/managers/searchManager'
import type { StreamGenerationHandler } from '@/presenter/agentPresenter/streaming/streamGenerationHandler'
import type { LLMEventHandler } from '@/presenter/agentPresenter/streaming/llmEventHandler'
import type { GeneratingMessageState } from '@/presenter/agentPresenter/streaming/types'
import { CommandPermissionService } from '@/presenter/permission'

const presenterMock = vi.hoisted(() => ({
  sessionManager: {
    removePendingPermission: vi.fn(),
    acquirePermissionResumeLock: vi.fn(),
    releasePermissionResumeLock: vi.fn(),
    getPendingPermissions: vi.fn().mockReturnValue([]),
    clearPendingPermission: vi.fn(),
    setStatus: vi.fn()
  },
  filePermissionService: {
    approve: vi.fn()
  }
}))

vi.mock('@/presenter', () => ({
  presenter: presenterMock
}))

describe('PermissionHandler resume behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    presenterMock.sessionManager.acquirePermissionResumeLock.mockReturnValue(true)
  })

  it('resumes all resolved tool calls after the final permission decision', async () => {
    const conversationId = 'conv-resume'
    const messageId = 'msg-resume'
    let content: AssistantMessageBlock[] = [
      {
        type: 'tool_call',
        status: 'loading',
        timestamp: Date.now(),
        tool_call: { id: 'tool-1', name: 'read_file', params: '{}' }
      },
      {
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        timestamp: Date.now(),
        content: 'Permission required',
        tool_call: { id: 'tool-1', name: 'read_file', params: '{}' },
        extra: {
          needsUserAction: true,
          serverName: 'agent-filesystem',
          permissionType: 'read',
          permissionRequest: JSON.stringify({
            toolName: 'read_file',
            serverName: 'agent-filesystem',
            permissionType: 'read',
            description: 'Read access requires approval',
            paths: ['src/a.txt']
          })
        }
      },
      {
        type: 'tool_call',
        status: 'loading',
        timestamp: Date.now(),
        tool_call: { id: 'tool-2', name: 'read_file', params: '{}' }
      },
      {
        type: 'action',
        action_type: 'tool_call_permission',
        status: 'pending',
        timestamp: Date.now(),
        content: 'Permission required',
        tool_call: { id: 'tool-2', name: 'read_file', params: '{}' },
        extra: {
          needsUserAction: true,
          serverName: 'agent-filesystem',
          permissionType: 'read',
          permissionRequest: JSON.stringify({
            toolName: 'read_file',
            serverName: 'agent-filesystem',
            permissionType: 'read',
            description: 'Read access requires approval',
            paths: ['src/b.txt']
          })
        }
      }
    ]

    const getCurrentMessage = (): AssistantMessage =>
      ({
        id: messageId,
        conversationId,
        role: 'assistant',
        content
      }) as AssistantMessage

    const messageManager = {
      getMessage: vi.fn(async () => getCurrentMessage()),
      editMessage: vi.fn(async (_id: string, nextContent: string) => {
        content = JSON.parse(nextContent) as AssistantMessageBlock[]
        return getCurrentMessage()
      }),
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
      message: getCurrentMessage(),
      conversationId,
      startTime: Date.now(),
      firstTokenTime: null,
      promptTokens: 0,
      reasoningStartTime: null,
      reasoningEndTime: null,
      lastReasoningTime: null
    })

    const handler = new PermissionHandler(ctx, {
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

    const resumeSpy = vi
      .spyOn(
        handler as unknown as { resumeToolExecutionAfterPermissions: (...args: any[]) => any },
        'resumeToolExecutionAfterPermissions'
      )
      .mockResolvedValue(undefined)

    await handler.handlePermissionResponse(messageId, 'tool-1', true, 'read', false)
    expect(resumeSpy).not.toHaveBeenCalled()

    await handler.handlePermissionResponse(messageId, 'tool-2', true, 'read', false)
    expect(resumeSpy).toHaveBeenCalledTimes(1)
    expect(resumeSpy).toHaveBeenCalledWith(messageId, true)
    expect(resumeSpy.mock.calls[0][2]).toBeUndefined()
  })
})
