import { describe, expect, it, vi } from 'vitest'
import type { DeepChatInternalSessionUpdate } from '@/presenter/deepchatAgentPresenter/internalSessionEvents'
import {
  SubagentOrchestratorTool,
  SUBAGENT_ORCHESTRATOR_TOOL_NAME
} from '@/presenter/toolPresenter/agentTools/subagentOrchestratorTool'
import type { ConversationSessionInfo } from '@/presenter/toolPresenter/runtimePorts'

const buildSessionInfo = (
  overrides: Partial<ConversationSessionInfo> = {}
): ConversationSessionInfo => ({
  sessionId: 'parent-session',
  agentId: 'deepchat',
  agentName: 'DeepChat',
  agentType: 'deepchat',
  providerId: 'openai',
  modelId: 'gpt-4.1',
  projectDir: '/workspace/parent-app',
  permissionMode: 'full_access',
  generationSettings: null,
  disabledAgentTools: [],
  activeSkills: [],
  sessionKind: 'regular',
  parentSessionId: null,
  subagentEnabled: true,
  subagentMeta: null,
  availableSubagentSlots: [
    {
      id: 'reviewer',
      targetType: 'self',
      displayName: 'Reviewer Clone',
      description: 'Review the delegated task.'
    }
  ],
  ...overrides
})

describe('SubagentOrchestratorTool', () => {
  it('includes the parent session workdir in the child handoff', async () => {
    let listener: ((update: DeepChatInternalSessionUpdate) => void) | null = null
    let handoffMessage = ''
    const resolvedWorkdir = '/workspace/resolved-parent-workdir'

    const parentSession = buildSessionInfo({
      projectDir: '/workspace/parent-session-record'
    })
    const childSession = buildSessionInfo({
      sessionId: 'child-session',
      agentName: 'Reviewer Clone',
      projectDir: '/workspace/child-session-record',
      sessionKind: 'subagent',
      parentSessionId: parentSession.sessionId,
      subagentEnabled: false,
      availableSubagentSlots: []
    })
    const resolveConversationWorkdir = vi.fn().mockResolvedValue(resolvedWorkdir)
    const createSubagentSession = vi.fn().mockResolvedValue(childSession)

    const tool = new SubagentOrchestratorTool({
      resolveConversationWorkdir,
      resolveConversationSessionInfo: vi
        .fn()
        .mockImplementation(async (conversationId: string) =>
          conversationId === parentSession.sessionId ? parentSession : childSession
        ),
      createSubagentSession,
      sendConversationMessage: vi.fn(async (conversationId: string, content: string) => {
        handoffMessage = content
        setTimeout(() => {
          listener?.({
            sessionId: conversationId,
            kind: 'blocks',
            updatedAt: Date.now(),
            previewMarkdown: 'Checked auth routes',
            responseMarkdown: 'Checked auth routes\nFound no directory mismatch in code.'
          })
          listener?.({
            sessionId: conversationId,
            kind: 'status',
            updatedAt: Date.now() + 1,
            status: 'idle'
          })
        }, 0)
      }),
      cancelConversation: vi.fn().mockResolvedValue(undefined),
      subscribeDeepChatSessionUpdates: vi.fn((callback) => {
        listener = callback
        return () => {
          listener = null
        }
      }),
      getSkillPresenter: vi.fn(() => ({})),
      getYoBrowserToolHandler: vi.fn(() => ({})),
      getFilePresenter: vi.fn(() => ({
        getMimeType: vi.fn(),
        prepareFileCompletely: vi.fn()
      })),
      getLlmProviderPresenter: vi.fn(() => ({
        generateCompletionStandalone: vi.fn()
      })),
      createSettingsWindow: vi.fn(),
      sendToWindow: vi.fn(),
      getApprovedFilePaths: vi.fn(() => []),
      consumeSettingsApproval: vi.fn(() => false)
    } as any)

    const result = await tool.call(
      {
        mode: 'chain',
        tasks: [
          {
            slotId: 'reviewer',
            title: 'Inspect auth flow',
            prompt:
              'Analyze the auth flow. A previous guess mentioned /workspace/current-project, but verify against the inherited workspace instead.',
            expectedOutput: 'Return concise markdown findings.'
          }
        ]
      },
      parentSession.sessionId,
      {
        toolCallId: `${SUBAGENT_ORCHESTRATOR_TOOL_NAME}-1`
      }
    )

    expect(resolveConversationWorkdir).toHaveBeenCalledWith(parentSession.sessionId)
    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir: resolvedWorkdir
      })
    )
    expect(handoffMessage).toContain('Current Agent Working Directory:')
    expect(handoffMessage).toContain(resolvedWorkdir)
    expect(handoffMessage).not.toContain(parentSession.projectDir as string)
    expect(handoffMessage).not.toContain(childSession.projectDir as string)
    expect(result.content).toContain('Inspect auth flow')
  })
})
