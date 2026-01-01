import { describe, expect, it, vi } from 'vitest'
import path from 'path'
import { SessionManager } from '@/presenter/agentPresenter/session/sessionManager'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\\\temp'
  }
}))

const baseSettings = {
  providerId: 'provider-1',
  modelId: 'model-1',
  chatMode: 'chat' as const,
  enabledMcpTools: [],
  acpWorkdirMap: {},
  agentWorkspacePath: null
}

const createConversation = (overrides?: Partial<typeof baseSettings>) => ({
  id: 'conv-1',
  settings: {
    ...baseSettings,
    ...(overrides ?? {})
  }
})

const createManager = (conversation: ReturnType<typeof createConversation>) => {
  const sessionPresenter = {
    getConversation: vi.fn().mockResolvedValue(conversation),
    updateConversationSettings: vi.fn().mockResolvedValue(undefined)
  } as any
  const configPresenter = {
    getSetting: vi.fn().mockReturnValue('chat'),
    getModelDefaultConfig: vi.fn().mockReturnValue({
      maxTokens: 0,
      contextLength: 0,
      vision: false,
      functionCall: true,
      reasoning: false,
      type: 'chat'
    })
  } as any

  return {
    manager: new SessionManager({ configPresenter, sessionPresenter }),
    sessionPresenter,
    configPresenter
  }
}

describe('SessionManager', () => {
  it('returns chat mode without workspace when conversation is chat', async () => {
    const conversation = createConversation({ chatMode: 'chat' })
    const { manager } = createManager(conversation)

    const context = await manager.resolveWorkspaceContext(
      conversation.id,
      conversation.settings.modelId
    )

    expect(context.chatMode).toBe('chat')
    expect(context.agentWorkspacePath).toBeNull()
  })

  it('generates and persists workspace path for agent mode', async () => {
    const conversation = createConversation({ chatMode: 'agent', agentWorkspacePath: null })
    const { manager, sessionPresenter } = createManager(conversation)

    const context = await manager.resolveWorkspaceContext(
      conversation.id,
      conversation.settings.modelId
    )
    const expected = path.join('C:\\\\temp', 'deepchat-agent', 'workspaces', conversation.id)

    expect(context.chatMode).toBe('agent')
    expect(context.agentWorkspacePath).toBe(expected)
    expect(sessionPresenter.updateConversationSettings).toHaveBeenCalledWith(conversation.id, {
      agentWorkspacePath: expected
    })
  })

  it('uses ACP workdir map for acp agent mode', async () => {
    const conversation = createConversation({
      chatMode: 'acp agent',
      acpWorkdirMap: { 'model-1': 'C:\\\\acp-workdir' }
    })
    const { manager, sessionPresenter } = createManager(conversation)

    const context = await manager.resolveWorkspaceContext(
      conversation.id,
      conversation.settings.modelId
    )

    expect(context.chatMode).toBe('acp agent')
    expect(context.agentWorkspacePath).toBe('C:\\\\acp-workdir')
    expect(sessionPresenter.updateConversationSettings).not.toHaveBeenCalled()
  })
})
