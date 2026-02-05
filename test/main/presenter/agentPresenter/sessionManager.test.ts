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
  it('generates and persists workspace path when not set', async () => {
    const conversation = createConversation({ agentWorkspacePath: null })
    const { manager, sessionPresenter } = createManager(conversation)

    const context = await manager.resolveWorkspaceContext(conversation.id)
    const expected = path.join('C:\\\\temp', 'deepchat-agent', 'workspaces', conversation.id)

    expect(context.agentWorkspacePath).toBe(expected)
    expect(sessionPresenter.updateConversationSettings).toHaveBeenCalledWith(conversation.id, {
      agentWorkspacePath: expected
    })
  })

  it('uses existing workspace path when already set', async () => {
    const existingPath = 'C:\\\\existing-workspace'
    const conversation = createConversation({ agentWorkspacePath: existingPath })
    const { manager, sessionPresenter } = createManager(conversation)

    const context = await manager.resolveWorkspaceContext(conversation.id)

    expect(context.agentWorkspacePath).toBe(existingPath)
    expect(sessionPresenter.updateConversationSettings).not.toHaveBeenCalled()
  })
})
