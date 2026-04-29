import { describe, expect, it, vi } from 'vitest'
import type { DeepChatInternalSessionUpdate } from '@/presenter/agentRuntimePresenter/internalSessionEvents'
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
        executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
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
    expect(handoffMessage).not.toContain('Slot Description:')
    expect(handoffMessage).not.toContain('Review the delegated task.')
    expect(handoffMessage).not.toContain(parentSession.projectDir as string)
    expect(handoffMessage).not.toContain(childSession.projectDir as string)
    expect(result.content).toContain('Inspect auth flow')
  })

  it('starts background runs and supports list, info, and kill operations', async () => {
    const parentSession = buildSessionInfo()
    const childSession = buildSessionInfo({
      sessionId: 'child-session',
      agentName: 'Reviewer Clone',
      sessionKind: 'subagent',
      parentSessionId: parentSession.sessionId,
      subagentEnabled: false,
      availableSubagentSlots: []
    })
    const createSubagentSession = vi.fn().mockResolvedValue(childSession)
    const cancelConversation = vi.fn().mockResolvedValue(undefined)

    const tool = new SubagentOrchestratorTool({
      resolveConversationWorkdir: vi.fn().mockResolvedValue(parentSession.projectDir),
      resolveConversationSessionInfo: vi.fn().mockResolvedValue(parentSession),
      createSubagentSession,
      sendConversationMessage: vi.fn().mockResolvedValue(undefined),
      cancelConversation,
      subscribeDeepChatSessionUpdates: vi.fn(() => () => undefined),
      getSkillPresenter: vi.fn(() => ({})),
      getYoBrowserToolHandler: vi.fn(() => ({})),
      getFilePresenter: vi.fn(() => ({
        getMimeType: vi.fn(),
        prepareFileCompletely: vi.fn()
      })),
      getLlmProviderPresenter: vi.fn(() => ({
        executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
        generateCompletionStandalone: vi.fn()
      })),
      createSettingsWindow: vi.fn(),
      sendToWindow: vi.fn(),
      getApprovedFilePaths: vi.fn(() => []),
      consumeSettingsApproval: vi.fn(() => false)
    } as any)

    const started = await tool.call(
      {
        mode: 'parallel',
        background: true,
        tasks: [
          {
            slotId: 'reviewer',
            title: 'Keep running',
            prompt: 'Stay active until cancelled.'
          }
        ]
      },
      parentSession.sessionId
    )
    const progress = JSON.parse((started.rawData?.toolResult as any).subagentProgress)
    const runId = progress.runId

    expect(started.content).toContain('Subagent run started')
    expect(runId).toMatch(/\S+/)

    for (let index = 0; index < 10 && createSubagentSession.mock.calls.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const listed = await tool.call({ operation: 'list' }, parentSession.sessionId)
    expect(listed.content).toContain(runId)

    const info = await tool.call({ operation: 'info', runId }, parentSession.sessionId)
    expect(info.content).toContain('Keep running')

    const killed = await tool.call({ operation: 'kill', runId }, parentSession.sessionId)
    expect(killed.content).toContain('cancelled')
    expect(cancelConversation).toHaveBeenCalledWith(childSession.sessionId)
  })
})
