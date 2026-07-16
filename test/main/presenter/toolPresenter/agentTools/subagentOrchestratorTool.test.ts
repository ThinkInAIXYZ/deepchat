import { describe, expect, it, vi } from 'vitest'
import type { DeepChatInternalSessionUpdate } from '@/presenter/agentRuntimePresenter/internalSessionEvents'
import {
  SubagentOrchestratorTool,
  SUBAGENT_ORCHESTRATOR_TOOL_NAME
} from '@/presenter/toolPresenter/agentTools/subagentOrchestratorTool'
import type { ConversationSessionInfo } from '@/presenter/toolPresenter/runtimePorts'
import type { SubagentTapeLinkInput, SubagentTapeLinkReceipt } from '@shared/types/agent-interface'
import { resolveDeepChatSubagentCapability } from '@shared/lib/deepchatSubagents'

const parentSubagentCapability = resolveDeepChatSubagentCapability({
  agentType: 'deepchat',
  sessionKind: 'regular',
  agentPolicyEnabled: true,
  slots: [
    {
      id: 'reviewer',
      targetType: 'self',
      displayName: 'Reviewer Clone',
      description: 'Review the delegated task.'
    }
  ]
})
const childSubagentCapability = resolveDeepChatSubagentCapability({
  agentType: 'deepchat',
  sessionKind: 'subagent',
  agentPolicyEnabled: true,
  slots: parentSubagentCapability.available ? parentSubagentCapability.slots : []
})

const buildTapeLinkReceipt = (input: SubagentTapeLinkInput): SubagentTapeLinkReceipt => ({
  linkEntry: { sessionId: input.parentSessionId, entryId: 1 },
  childSessionId: input.childSessionId,
  childHeadEntryId: 2,
  childEntryCount: 2,
  outcome: input.outcome
})

const createTapeLinkMock = () =>
  vi.fn(async (input: SubagentTapeLinkInput) => buildTapeLinkReceipt(input))

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
  subagentMeta: null,
  subagentCapability: parentSubagentCapability,
  ...overrides
})

const buildRuntimePort = (
  parentSession: ConversationSessionInfo,
  overrides: Record<string, unknown> = {}
) => ({
  resolveConversationWorkdir: vi.fn().mockResolvedValue(parentSession.projectDir),
  resolveConversationSessionInfo: vi.fn().mockResolvedValue(parentSession),
  createSubagentSession: vi.fn().mockImplementation(async () =>
    buildSessionInfo({
      sessionId: 'child-session',
      sessionKind: 'subagent',
      parentSessionId: parentSession.sessionId,
      subagentCapability: childSubagentCapability
    })
  ),
  sendConversationMessage: vi.fn().mockResolvedValue(undefined),
  cancelConversation: vi.fn().mockResolvedValue(undefined),
  subscribeDeepChatSessionUpdates: vi.fn(() => () => undefined),
  linkSubagentTape: createTapeLinkMock(),
  getSkillPresenter: vi.fn(() => ({})),
  getYoBrowserToolHandler: vi.fn(() => ({})),
  getFilePresenter: vi.fn(() => ({
    getMimeType: vi.fn(),
    prepareFileCompletely: vi.fn()
  })),
  getLlmProviderPresenter: vi.fn(() => ({
    executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
    generateCompletionStandalone: vi.fn(),
    generateImageStandalone: vi.fn()
  })),
  createSettingsWindow: vi.fn(),
  sendToWindow: vi.fn(),
  getApprovedFilePaths: vi.fn(() => []),
  consumeSettingsApproval: vi.fn(() => false),
  ...overrides
})

const createDeferredPromise = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return { promise, resolve }
}

describe('SubagentOrchestratorTool', () => {
  it('distinguishes explicit requests from proactive delegation guidance', () => {
    const tool = new SubagentOrchestratorTool(buildRuntimePort(buildSessionInfo()) as any)
    const definition = tool.getToolDefinition(parentSubagentCapability)
    const description = definition?.function.description ?? ''

    expect(description).toContain('use them when requested and available')
    expect(description).toContain('For proactive delegation')
    expect(description).toContain('Do not proactively delegate simple')
  })

  it('fails closed when the Agent policy changes after tool definition', async () => {
    const currentParent = buildSessionInfo({
      subagentCapability: resolveDeepChatSubagentCapability({
        agentType: 'deepchat',
        sessionKind: 'regular',
        agentPolicyEnabled: false,
        slots: parentSubagentCapability.available ? parentSubagentCapability.slots : []
      })
    })
    const runtimePort = buildRuntimePort(currentParent)
    const tool = new SubagentOrchestratorTool(runtimePort as any)

    expect(tool.getToolDefinition(parentSubagentCapability)).not.toBeNull()
    await expect(
      tool.call(
        {
          mode: 'parallel',
          tasks: [{ slotId: 'reviewer', title: 'Review', prompt: 'Review the change.' }]
        },
        currentParent.sessionId
      )
    ).rejects.toThrow('(policy_disabled)')
    expect(runtimePort.createSubagentSession).not.toHaveBeenCalled()
  })

  it('keeps an admitted run on its start-time capability snapshot', async () => {
    let currentParent = buildSessionInfo()
    const childSession = buildSessionInfo({
      sessionId: 'admitted-child',
      sessionKind: 'subagent',
      parentSessionId: currentParent.sessionId,
      subagentCapability: childSubagentCapability
    })
    let listener: ((update: DeepChatInternalSessionUpdate) => void) | null = null
    const resolveConversationSessionInfo = vi.fn(async () => currentParent)
    const sendConversationMessage = vi.fn().mockResolvedValue(undefined)
    const cancelConversation = vi.fn().mockResolvedValue(undefined)
    const runtimePort = buildRuntimePort(currentParent, {
      resolveConversationSessionInfo,
      createSubagentSession: vi.fn().mockResolvedValue(childSession),
      sendConversationMessage,
      cancelConversation,
      subscribeDeepChatSessionUpdates: vi.fn((callback) => {
        listener = callback
        return () => {
          listener = null
        }
      })
    })
    const tool = new SubagentOrchestratorTool(runtimePort as any)

    const running = tool.call(
      {
        mode: 'parallel',
        tasks: [{ slotId: 'reviewer', title: 'Review', prompt: 'Review the change.' }]
      },
      currentParent.sessionId
    )
    await vi.waitFor(() => expect(sendConversationMessage).toHaveBeenCalled())

    currentParent = buildSessionInfo({
      subagentCapability: resolveDeepChatSubagentCapability({
        agentType: 'deepchat',
        sessionKind: 'regular',
        agentPolicyEnabled: false,
        slots: parentSubagentCapability.available ? parentSubagentCapability.slots : []
      })
    })
    listener?.({
      sessionId: childSession.sessionId,
      kind: 'blocks',
      updatedAt: Date.now(),
      previewMarkdown: 'Review complete.',
      responseMarkdown: 'Review complete.'
    })
    listener?.({
      sessionId: childSession.sessionId,
      kind: 'status',
      updatedAt: Date.now() + 1,
      status: 'idle'
    })

    await expect(running).resolves.toEqual(
      expect.objectContaining({ content: expect.stringContaining('Review complete.') })
    )
    expect(resolveConversationSessionInfo).toHaveBeenCalledTimes(1)
    expect(cancelConversation).not.toHaveBeenCalled()
  })

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
      subagentCapability: childSubagentCapability
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
        generateCompletionStandalone: vi.fn(),
        generateImageStandalone: vi.fn()
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
        projectDir: resolvedWorkdir,
        parentAgentId: parentSession.agentId
      })
    )
    expect(handoffMessage).toContain('Current Agent Working Directory:')
    expect(handoffMessage).toContain(resolvedWorkdir)
    expect(handoffMessage).not.toContain('Slot Description:')
    expect(handoffMessage).not.toContain('Review the delegated task.')
    expect(handoffMessage).not.toContain(parentSession.projectDir as string)
    expect(handoffMessage).not.toContain(childSession.projectDir as string)
    expect(handoffMessage).toContain('## Result')
    expect(handoffMessage).toContain('## Evidence')
    expect(handoffMessage).toContain('## Changed Files')
    expect(handoffMessage).toContain('## Validation')
    expect(handoffMessage).toContain('## Unresolved')
    expect(handoffMessage).toContain('Use `None` as the section content')
    expect(handoffMessage).toContain('Additional Requirements:')
    expect(handoffMessage).toContain('Return concise markdown findings.')
    expect(result.content).toContain('Inspect auth flow')
  })

  it('enforces and serializes a run deadline independently of wait timeout', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'))

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'deadline-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentCapability: childSubagentCapability
      })
      const cancelConversation = vi.fn().mockResolvedValue(undefined)
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn().mockResolvedValue(childSession),
        cancelConversation
      })
      const tool = new SubagentOrchestratorTool(runtimePort as any)

      const definition = tool.getToolDefinition(parentSession.subagentCapability)
      const runTimeoutProperty = (definition?.function.parameters as any).properties.runTimeoutMs
      expect(runTimeoutProperty).toMatchObject({
        type: 'number',
        minimum: 1000,
        maximum: 1800000
      })

      await expect(
        tool.call(
          {
            mode: 'parallel',
            background: true,
            runTimeoutMs: 999,
            tasks: [{ slotId: 'reviewer', title: 'Invalid', prompt: 'Do not start.' }]
          },
          parentSession.sessionId
        )
      ).rejects.toThrow()

      const started = await tool.call(
        {
          mode: 'parallel',
          background: true,
          runTimeoutMs: 1200,
          tasks: [{ slotId: 'reviewer', title: 'Deadline task', prompt: 'Keep running.' }]
        },
        parentSession.sessionId
      )
      const startedProgress = JSON.parse((started.rawData?.toolResult as any).subagentProgress)

      expect(startedProgress).toMatchObject({
        runTimeoutMs: 1200,
        deadlineAt: Date.now() + 1200
      })
      expect(startedProgress.cancellationReason).toBeUndefined()

      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1200)

      const info = await tool.call(
        { operation: 'info', runId: startedProgress.runId },
        parentSession.sessionId
      )
      const deadlineProgress = JSON.parse((info.rawData?.toolResult as any).subagentProgress)

      expect(deadlineProgress).toMatchObject({
        status: 'cancelled',
        cancellationReason: 'Run deadline exceeded after 1200ms.',
        runTimeoutMs: 1200,
        deadlineAt: Date.now()
      })
      expect(deadlineProgress.tasks[0]).toMatchObject({
        status: 'cancelled',
        resultSummary: 'Run deadline exceeded after 1200ms.'
      })
      expect(cancelConversation).toHaveBeenCalledWith(childSession.sessionId)

      const waited = await tool.call(
        { operation: 'wait', runId: startedProgress.runId, timeoutMs: 0 },
        parentSession.sessionId
      )
      expect((waited.rawData?.toolResult as any).subagentFinal).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for child cancellation but not a blocked Tape link after a deadline', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'slow-cancel-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentCapability: childSubagentCapability
      })
      let settleCancellation: (() => void) | undefined
      const cancelConversation = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            settleCancellation = resolve
          })
      )
      const link = createDeferredPromise<SubagentTapeLinkReceipt>()
      let linkInput: SubagentTapeLinkInput | undefined
      const linkSubagentTape = vi.fn((input: SubagentTapeLinkInput) => {
        linkInput = input
        return link.promise
      })
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn().mockResolvedValue(childSession),
        cancelConversation,
        linkSubagentTape
      })
      const tool = new SubagentOrchestratorTool(runtimePort as any)

      const started = await tool.call(
        {
          mode: 'parallel',
          background: true,
          runTimeoutMs: 1000,
          tasks: [{ slotId: 'reviewer', title: 'Slow cancellation', prompt: 'Keep running.' }]
        },
        parentSession.sessionId
      )
      const runId = JSON.parse((started.rawData?.toolResult as any).subagentProgress).runId
      await Promise.resolve()
      await Promise.resolve()

      await vi.advanceTimersByTimeAsync(1000)
      const info = await tool.call({ operation: 'info', runId }, parentSession.sessionId)
      expect(JSON.parse((info.rawData?.toolResult as any).subagentProgress).status).toBe(
        'cancelled'
      )
      expect(cancelConversation).toHaveBeenCalledWith(childSession.sessionId)
      expect(linkSubagentTape).not.toHaveBeenCalled()

      settleCancellation?.()
      await Promise.resolve()
      await Promise.resolve()
      const waited = await tool.call(
        { operation: 'wait', runId, timeoutMs: 0 },
        parentSession.sessionId
      )

      expect(linkSubagentTape).toHaveBeenCalledWith(
        expect.objectContaining({
          parentSessionId: parentSession.sessionId,
          childSessionId: childSession.sessionId,
          outcome: 'cancelled'
        })
      )
      expect((waited.rawData?.toolResult as any).subagentFinal).toBeTruthy()

      link.resolve(buildTapeLinkReceipt(linkInput!))
      await Promise.resolve()
      await Promise.resolve()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns at the deadline when a completed child Tape link is still blocked', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'blocked-completed-link-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentCapability: childSubagentCapability
      })
      const link = createDeferredPromise<SubagentTapeLinkReceipt>()
      let linkInput: SubagentTapeLinkInput | undefined
      let listener: ((update: DeepChatInternalSessionUpdate) => void) | undefined
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn().mockResolvedValue(childSession),
        subscribeDeepChatSessionUpdates: vi.fn((callback) => {
          listener = callback
          return () => {
            listener = undefined
          }
        }),
        linkSubagentTape: vi.fn((input: SubagentTapeLinkInput) => {
          linkInput = input
          return link.promise
        })
      })
      const tool = new SubagentOrchestratorTool(runtimePort as any)

      const running = tool.call(
        {
          mode: 'chain',
          runTimeoutMs: 1000,
          tasks: [{ slotId: 'reviewer', title: 'Blocked link', prompt: 'Finish normally.' }]
        },
        parentSession.sessionId
      )
      await vi.advanceTimersByTimeAsync(0)
      listener?.({
        sessionId: childSession.sessionId,
        kind: 'status',
        updatedAt: Date.now(),
        status: 'idle'
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(runtimePort.linkSubagentTape).toHaveBeenCalledOnce()
      expect(runtimePort.linkSubagentTape).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'completed' })
      )

      await vi.advanceTimersByTimeAsync(1000)

      const result = await running
      const finalProgress = JSON.parse((result.rawData?.toolResult as any).subagentFinal)
      expect(finalProgress).toMatchObject({
        status: 'cancelled',
        cancellationReason: 'Run deadline exceeded after 1000ms.'
      })
      expect(finalProgress.tasks[0].status).toBe('completed')
      expect(runtimePort.cancelConversation).not.toHaveBeenCalled()

      await expect(
        tool.call({ operation: 'info', runId: finalProgress.runId }, parentSession.sessionId)
      ).resolves.toBeTruthy()
      await expect(
        tool.call(
          { operation: 'wait', runId: finalProgress.runId, timeoutMs: 0 },
          parentSession.sessionId
        )
      ).resolves.toBeTruthy()

      link.resolve(buildTapeLinkReceipt(linkInput!))
      await vi.advanceTimersByTimeAsync(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns at the deadline when an errored child Tape link is still blocked', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'blocked-error-link-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentCapability: childSubagentCapability
      })
      const link = createDeferredPromise<SubagentTapeLinkReceipt>()
      let linkInput: SubagentTapeLinkInput | undefined
      let listener: ((update: DeepChatInternalSessionUpdate) => void) | undefined
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn().mockResolvedValue(childSession),
        subscribeDeepChatSessionUpdates: vi.fn((callback) => {
          listener = callback
          return () => {
            listener = undefined
          }
        }),
        linkSubagentTape: vi.fn((input: SubagentTapeLinkInput) => {
          linkInput = input
          return link.promise
        })
      })
      const tool = new SubagentOrchestratorTool(runtimePort as any)

      const running = tool.call(
        {
          mode: 'chain',
          runTimeoutMs: 1000,
          tasks: [{ slotId: 'reviewer', title: 'Blocked link', prompt: 'Fail normally.' }]
        },
        parentSession.sessionId
      )
      await vi.advanceTimersByTimeAsync(0)
      listener?.({
        sessionId: childSession.sessionId,
        kind: 'status',
        updatedAt: Date.now(),
        status: 'error'
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(runtimePort.linkSubagentTape).toHaveBeenCalledOnce()
      expect(runtimePort.linkSubagentTape).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'error' })
      )

      await vi.advanceTimersByTimeAsync(1000)

      const result = await running
      const finalProgress = JSON.parse((result.rawData?.toolResult as any).subagentFinal)
      expect(finalProgress).toMatchObject({
        status: 'cancelled',
        cancellationReason: 'Run deadline exceeded after 1000ms.'
      })
      expect(finalProgress.tasks[0].status).toBe('error')
      expect(runtimePort.cancelConversation).not.toHaveBeenCalled()

      link.resolve(buildTapeLinkReceipt(linkInput!))
      await vi.advanceTimersByTimeAsync(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('registers cancellation before linking a child created after the deadline', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'late-deadline-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentCapability: childSubagentCapability
      })
      const childCreation = createDeferredPromise<ConversationSessionInfo>()
      const cancellation = createDeferredPromise<void>()
      const cancelConversation = vi.fn(() => cancellation.promise)
      const linkSubagentTape = createTapeLinkMock()
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn(() => childCreation.promise),
        cancelConversation,
        linkSubagentTape
      })
      const tool = new SubagentOrchestratorTool(runtimePort as any)

      const started = await tool.call(
        {
          mode: 'parallel',
          background: true,
          runTimeoutMs: 1000,
          tasks: [{ slotId: 'reviewer', title: 'Late child', prompt: 'Start after timeout.' }]
        },
        parentSession.sessionId
      )
      const runId = JSON.parse((started.rawData?.toolResult as any).subagentProgress).runId

      await vi.advanceTimersByTimeAsync(1000)
      childCreation.resolve(childSession)
      await vi.advanceTimersByTimeAsync(0)

      expect(cancelConversation).toHaveBeenCalledWith(childSession.sessionId)
      await tool.call({ operation: 'info', runId }, parentSession.sessionId)
      expect(linkSubagentTape).not.toHaveBeenCalled()

      cancellation.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)

      expect(linkSubagentTape).toHaveBeenCalledWith(
        expect.objectContaining({
          parentSessionId: parentSession.sessionId,
          childSessionId: childSession.sessionId,
          outcome: 'cancelled'
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('limits each parent session to three active runs and frees capacity on cancellation', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      let childIndex = 0
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn().mockImplementation(async () => {
          childIndex += 1
          return buildSessionInfo({
            sessionId: `active-child-${childIndex}`,
            sessionKind: 'subagent',
            parentSessionId: parentSession.sessionId,
            subagentCapability: childSubagentCapability
          })
        })
      })
      const tool = new SubagentOrchestratorTool(runtimePort as any)
      const startRun = () =>
        tool.call(
          {
            mode: 'parallel',
            background: true,
            tasks: [{ slotId: 'reviewer', title: 'Active task', prompt: 'Keep running.' }]
          },
          parentSession.sessionId
        )

      const attempts = await Promise.all(
        Array.from({ length: 4 }, async () => {
          try {
            return { result: await startRun(), error: null }
          } catch (error) {
            return { result: null, error }
          }
        })
      )
      const startedRuns = attempts.filter((attempt) => attempt.result !== null)
      const rejectedRuns = attempts.filter((attempt) => attempt.error !== null)

      expect(startedRuns).toHaveLength(3)
      expect(rejectedRuns).toHaveLength(1)
      expect(rejectedRuns[0]?.error).toEqual(
        expect.objectContaining({
          message: 'A parent session can have at most 3 active subagent runs.'
        })
      )

      const activeRunIds = startedRuns.map(
        ({ result }) => JSON.parse((result?.rawData?.toolResult as any).subagentProgress).runId
      )

      await tool.call({ operation: 'kill', runId: activeRunIds[0] }, parentSession.sessionId)
      const replacement = await startRun()
      activeRunIds.push(JSON.parse((replacement.rawData?.toolResult as any).subagentProgress).runId)

      for (const runId of activeRunIds.slice(1)) {
        await tool.call({ operation: 'kill', runId }, parentSession.sessionId)
      }
      await Promise.resolve()
      await Promise.resolve()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts background runs and supports list, info, and kill operations', async () => {
    const parentSession = buildSessionInfo()
    const childSession = buildSessionInfo({
      sessionId: 'child-session',
      agentName: 'Reviewer Clone',
      sessionKind: 'subagent',
      parentSessionId: parentSession.sessionId,
      subagentCapability: childSubagentCapability
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
        generateCompletionStandalone: vi.fn(),
        generateImageStandalone: vi.fn()
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

  it('records completed child sessions as finalized Tape links', async () => {
    let listener: ((update: DeepChatInternalSessionUpdate) => void) | null = null
    const parentSession = buildSessionInfo()
    const childSession = buildSessionInfo({
      sessionId: 'child-session',
      agentName: 'Reviewer Clone',
      sessionKind: 'subagent',
      parentSessionId: parentSession.sessionId,
      subagentCapability: childSubagentCapability
    })
    const linkSubagentTape = createTapeLinkMock()

    const tool = new SubagentOrchestratorTool({
      resolveConversationWorkdir: vi.fn().mockResolvedValue(parentSession.projectDir),
      resolveConversationSessionInfo: vi.fn().mockResolvedValue(parentSession),
      createSubagentSession: vi.fn().mockResolvedValue(childSession),
      sendConversationMessage: vi.fn(async (conversationId: string) => {
        setTimeout(() => {
          listener?.({
            sessionId: conversationId,
            kind: 'blocks',
            updatedAt: Date.now(),
            previewMarkdown: 'Completed review',
            responseMarkdown: 'Completed review\nNo issues found.'
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
      linkSubagentTape,
      getSkillPresenter: vi.fn(() => ({})),
      getYoBrowserToolHandler: vi.fn(() => ({})),
      getFilePresenter: vi.fn(() => ({
        getMimeType: vi.fn(),
        prepareFileCompletely: vi.fn()
      })),
      getLlmProviderPresenter: vi.fn(() => ({
        executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
        generateCompletionStandalone: vi.fn(),
        generateImageStandalone: vi.fn()
      })),
      createSettingsWindow: vi.fn(),
      sendToWindow: vi.fn(),
      getApprovedFilePaths: vi.fn(() => []),
      consumeSettingsApproval: vi.fn(() => false)
    } as any)

    await tool.call(
      {
        mode: 'chain',
        tasks: [
          {
            id: 'task-review',
            slotId: 'reviewer',
            title: 'Review task',
            prompt: 'Review the current change.'
          }
        ]
      },
      parentSession.sessionId
    )

    expect(linkSubagentTape).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: parentSession.sessionId,
        childSessionId: childSession.sessionId,
        taskId: 'task-review',
        slotId: 'reviewer',
        outcome: 'completed',
        taskTitle: 'Review task'
      })
    )
  })

  it('leaves a subagent Tape unfinalized when linking fails so it can be retried', async () => {
    const linkSubagentTape = vi
      .fn()
      .mockRejectedValueOnce(new Error('link failed'))
      .mockImplementationOnce(async (input: SubagentTapeLinkInput) => buildTapeLinkReceipt(input))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const tool = new SubagentOrchestratorTool({
      linkSubagentTape
    } as any)
    const task = {
      sessionId: 'child-session',
      tapeFinalized: false,
      taskId: 'task-review',
      slotId: 'reviewer',
      title: 'Review task',
      status: 'completed',
      resultSummary: 'Done'
    }

    await (tool as any).finalizeTaskTape({
      parentSessionId: 'parent-session',
      runId: 'run-1',
      task
    })
    expect(task.tapeFinalized).toBe(false)
    expect(task.tapeFinalizeError).toBe('link failed')

    await (tool as any).finalizeTaskTape({
      parentSessionId: 'parent-session',
      runId: 'run-1',
      task
    })

    expect(linkSubagentTape).toHaveBeenCalledTimes(2)
    expect(task.tapeFinalized).toBe(true)
    expect(task.tapeFinalizeError).toBeUndefined()
    warnSpy.mockRestore()
  })

  it('preserves the runtime port receiver while linking a finalized Tape', async () => {
    const runtimePort = {
      async linkSubagentTape(input: SubagentTapeLinkInput) {
        expect(this).toBe(runtimePort)
        return buildTapeLinkReceipt(input)
      }
    }
    const tool = new SubagentOrchestratorTool(runtimePort as any)
    const task = {
      sessionId: 'child-session',
      tapeFinalized: false,
      taskId: 'task-review',
      slotId: 'reviewer',
      title: 'Review task',
      status: 'completed',
      resultSummary: 'Done'
    }

    await (tool as any).finalizeTaskTape({
      parentSessionId: 'parent-session',
      runId: 'run-1',
      task
    })

    expect(task.tapeFinalized).toBe(true)
    expect(task.tapeFinalizeError).toBeUndefined()
  })

  it('keeps a subagent Tape unfinalized when the runtime has no link capability', async () => {
    const tool = new SubagentOrchestratorTool({} as any)
    const task = {
      sessionId: 'child-session',
      tapeFinalized: false,
      taskId: 'task-review',
      slotId: 'reviewer',
      title: 'Review task',
      status: 'completed',
      resultSummary: 'Done'
    }

    await (tool as any).finalizeTaskTape({
      parentSessionId: 'parent-session',
      runId: 'run-1',
      task
    })

    expect(task.tapeFinalized).toBe(false)
    expect(task.tapeFinalizeError).toBe('Subagent Tape link capability is unavailable.')
  })

  it('rejects a link receipt that does not match the finalized child', async () => {
    const linkSubagentTape = vi.fn(async (input: SubagentTapeLinkInput) => ({
      ...buildTapeLinkReceipt(input),
      childSessionId: 'different-child'
    }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const tool = new SubagentOrchestratorTool({ linkSubagentTape } as any)
    const task = {
      sessionId: 'child-session',
      tapeFinalized: false,
      taskId: 'task-review',
      slotId: 'reviewer',
      title: 'Review task',
      status: 'completed',
      resultSummary: 'Done'
    }

    await (tool as any).finalizeTaskTape({
      parentSessionId: 'parent-session',
      runId: 'run-1',
      task
    })

    expect(task.tapeFinalized).toBe(false)
    expect(task.tapeFinalizeError).toBe(
      'Subagent Tape link receipt does not match the finalized task.'
    )
    warnSpy.mockRestore()
  })

  it('reconciles early completion and retries its link while a sibling remains active', async () => {
    let listener: ((update: DeepChatInternalSessionUpdate) => void) | null = null
    let childIndex = 0
    const parentSession = buildSessionInfo()
    const childSessions = ['completed-child', 'active-child'].map((sessionId) =>
      buildSessionInfo({
        sessionId,
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentCapability: childSubagentCapability
      })
    )
    const earlyHandoff = createDeferredPromise<void>()
    const retryLink = createDeferredPromise<SubagentTapeLinkReceipt>()
    let retryInput: SubagentTapeLinkInput | undefined
    const linkSubagentTape = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient link failure'))
      .mockImplementationOnce((input: SubagentTapeLinkInput) => {
        retryInput = input
        return retryLink.promise
      })
      .mockImplementation(async (input: SubagentTapeLinkInput) => buildTapeLinkReceipt(input))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const runtimePort = buildRuntimePort(parentSession, {
      createSubagentSession: vi.fn(async () => childSessions[childIndex++]!),
      sendConversationMessage: vi.fn((sessionId: string) =>
        sessionId === childSessions[0].sessionId ? earlyHandoff.promise : Promise.resolve()
      ),
      subscribeDeepChatSessionUpdates: vi.fn((callback) => {
        listener = callback
        return () => {
          listener = null
        }
      }),
      linkSubagentTape
    })
    const tool = new SubagentOrchestratorTool(runtimePort as any)

    const started = await tool.call(
      {
        mode: 'parallel',
        background: true,
        tasks: [
          { slotId: 'reviewer', title: 'Finish first', prompt: 'Complete immediately.' },
          { slotId: 'reviewer', title: 'Stay active', prompt: 'Keep running.' }
        ]
      },
      parentSession.sessionId
    )
    const runId = JSON.parse((started.rawData?.toolResult as any).subagentProgress).runId

    for (
      let index = 0;
      index < 20 && runtimePort.sendConversationMessage.mock.calls.length < 2;
      index += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    listener?.({
      sessionId: childSessions[0].sessionId,
      kind: 'status',
      updatedAt: Date.now(),
      status: 'idle'
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(linkSubagentTape).not.toHaveBeenCalled()
    earlyHandoff.resolve(undefined)
    for (let index = 0; index < 20 && linkSubagentTape.mock.calls.length < 1; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(linkSubagentTape).toHaveBeenCalledTimes(1)
    let infoSettled = false
    const infoPromise = tool
      .call({ operation: 'info', runId }, parentSession.sessionId)
      .then((result) => {
        infoSettled = true
        return result
      })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(linkSubagentTape).toHaveBeenCalledTimes(2)
    expect(infoSettled).toBe(true)
    retryLink.resolve(buildTapeLinkReceipt(retryInput!))
    await infoPromise
    await new Promise((resolve) => setTimeout(resolve, 0))
    const refreshed = await tool.call({ operation: 'info', runId }, parentSession.sessionId)
    const progress = JSON.parse((refreshed.rawData?.toolResult as any).subagentProgress)
    expect(progress.status).toBe('running')
    expect(progress.tasks).toMatchObject([
      { sessionId: 'completed-child', status: 'completed', tapeFinalized: true },
      { sessionId: 'active-child', status: 'running', tapeFinalized: false }
    ])

    await tool.call({ operation: 'kill', runId }, parentSession.sessionId)
    await tool.call({ operation: 'wait', runId, timeoutMs: 1000 }, parentSession.sessionId)
    warnSpy.mockRestore()
  })

  it('retries failed subagent tape finalization on terminal wait', async () => {
    let listener: ((update: DeepChatInternalSessionUpdate) => void) | null = null
    const parentSession = buildSessionInfo()
    const childSession = buildSessionInfo({
      sessionId: 'child-session',
      agentName: 'Reviewer Clone',
      sessionKind: 'subagent',
      parentSessionId: parentSession.sessionId,
      subagentCapability: childSubagentCapability
    })
    const linkSubagentTape = vi
      .fn()
      .mockRejectedValueOnce(new Error('link failed'))
      .mockImplementationOnce(async (input: SubagentTapeLinkInput) => buildTapeLinkReceipt(input))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const tool = new SubagentOrchestratorTool({
      resolveConversationWorkdir: vi.fn().mockResolvedValue(parentSession.projectDir),
      resolveConversationSessionInfo: vi.fn().mockResolvedValue(parentSession),
      createSubagentSession: vi.fn().mockResolvedValue(childSession),
      sendConversationMessage: vi.fn(async (conversationId: string) => {
        setTimeout(() => {
          listener?.({
            sessionId: conversationId,
            kind: 'blocks',
            updatedAt: Date.now(),
            previewMarkdown: 'Completed review',
            responseMarkdown: 'Completed review\nNo issues found.'
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
      linkSubagentTape,
      getSkillPresenter: vi.fn(() => ({})),
      getYoBrowserToolHandler: vi.fn(() => ({})),
      getFilePresenter: vi.fn(() => ({
        getMimeType: vi.fn(),
        prepareFileCompletely: vi.fn()
      })),
      getLlmProviderPresenter: vi.fn(() => ({
        executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
        generateCompletionStandalone: vi.fn(),
        generateImageStandalone: vi.fn()
      })),
      createSettingsWindow: vi.fn(),
      sendToWindow: vi.fn(),
      getApprovedFilePaths: vi.fn(() => []),
      consumeSettingsApproval: vi.fn(() => false)
    } as any)

    const started = await tool.call(
      {
        mode: 'chain',
        background: true,
        tasks: [
          {
            id: 'task-review',
            slotId: 'reviewer',
            title: 'Review task',
            prompt: 'Review the current change.'
          }
        ]
      },
      parentSession.sessionId
    )
    const runId = JSON.parse((started.rawData?.toolResult as any).subagentProgress).runId

    const waited = await tool.call(
      { operation: 'wait', runId, timeoutMs: 1000 },
      parentSession.sessionId
    )
    const finalProgress = JSON.parse((waited.rawData?.toolResult as any).subagentFinal)

    expect(linkSubagentTape).toHaveBeenCalledTimes(2)
    expect(waited.rawData?.isError).toBe(false)
    expect(waited.content).not.toContain('Tape Finalization: failed')
    expect(finalProgress.tasks[0]).toMatchObject({
      tapeFinalized: true
    })
    expect(finalProgress.tasks[0].tapeFinalizeError).toBeUndefined()
    warnSpy.mockRestore()
  })

  it('exposes persistent subagent tape finalization failures and keeps retrying', async () => {
    let listener: ((update: DeepChatInternalSessionUpdate) => void) | null = null
    const parentSession = buildSessionInfo()
    const childSession = buildSessionInfo({
      sessionId: 'child-session',
      agentName: 'Reviewer Clone',
      sessionKind: 'subagent',
      parentSessionId: parentSession.sessionId,
      subagentCapability: childSubagentCapability
    })
    const linkSubagentTape = vi.fn().mockRejectedValue(new Error('link still failed'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const tool = new SubagentOrchestratorTool({
      resolveConversationWorkdir: vi.fn().mockResolvedValue(parentSession.projectDir),
      resolveConversationSessionInfo: vi.fn().mockResolvedValue(parentSession),
      createSubagentSession: vi.fn().mockResolvedValue(childSession),
      sendConversationMessage: vi.fn(async (conversationId: string) => {
        setTimeout(() => {
          listener?.({
            sessionId: conversationId,
            kind: 'blocks',
            updatedAt: Date.now(),
            previewMarkdown: 'Completed review',
            responseMarkdown: 'Completed review\nNo issues found.'
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
      linkSubagentTape,
      getSkillPresenter: vi.fn(() => ({})),
      getYoBrowserToolHandler: vi.fn(() => ({})),
      getFilePresenter: vi.fn(() => ({
        getMimeType: vi.fn(),
        prepareFileCompletely: vi.fn()
      })),
      getLlmProviderPresenter: vi.fn(() => ({
        executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
        generateCompletionStandalone: vi.fn(),
        generateImageStandalone: vi.fn()
      })),
      createSettingsWindow: vi.fn(),
      sendToWindow: vi.fn(),
      getApprovedFilePaths: vi.fn(() => []),
      consumeSettingsApproval: vi.fn(() => false)
    } as any)

    const started = await tool.call(
      {
        mode: 'chain',
        background: true,
        tasks: [
          {
            id: 'task-review',
            slotId: 'reviewer',
            title: 'Review task',
            prompt: 'Review the current change.'
          }
        ]
      },
      parentSession.sessionId
    )
    const runId = JSON.parse((started.rawData?.toolResult as any).subagentProgress).runId

    const waited = await tool.call(
      { operation: 'wait', runId, timeoutMs: 1000 },
      parentSession.sessionId
    )
    const waitedProgress = JSON.parse((waited.rawData?.toolResult as any).subagentFinal)

    expect(linkSubagentTape).toHaveBeenCalledTimes(2)
    expect(waited.rawData?.isError).toBe(true)
    expect(waited.content).toContain('Tape Finalization: failed: link still failed')
    expect(waitedProgress.tasks[0]).toMatchObject({
      tapeFinalized: false,
      tapeFinalizeError: 'link still failed'
    })

    const info = await tool.call({ operation: 'info', runId }, parentSession.sessionId)

    expect(linkSubagentTape).toHaveBeenCalledTimes(3)
    expect(info.rawData?.isError).toBe(true)

    const logged = await tool.call({ operation: 'log', runId }, parentSession.sessionId)

    expect(linkSubagentTape).toHaveBeenCalledTimes(4)
    expect(logged.rawData?.isError).toBe(true)
    warnSpy.mockRestore()
  })

  it('rechecks cancellation after a blocked handoff before linking the Tape', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'blocked-handoff-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentCapability: childSubagentCapability
      })
      const abortController = new AbortController()
      const handoff = createDeferredPromise<void>()
      const cancellations = [createDeferredPromise<void>(), createDeferredPromise<void>()]
      let cancellationIndex = 0
      const cancelConversation = vi.fn(() => cancellations[cancellationIndex++]!.promise)
      const linkSubagentTape = createTapeLinkMock()
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn().mockResolvedValue(childSession),
        sendConversationMessage: vi.fn(() => handoff.promise),
        cancelConversation,
        linkSubagentTape
      })
      const tool = new SubagentOrchestratorTool(runtimePort as any)

      const runPromise = tool.call(
        {
          mode: 'chain',
          tasks: [
            {
              slotId: 'reviewer',
              title: 'Abort blocked handoff',
              prompt: 'Do not wait for this handoff to settle.'
            }
          ]
        },
        parentSession.sessionId,
        { signal: abortController.signal }
      )

      await vi.advanceTimersByTimeAsync(0)
      expect(runtimePort.sendConversationMessage).toHaveBeenCalledWith(
        childSession.sessionId,
        expect.any(String)
      )

      abortController.abort()
      await expect(runPromise).rejects.toThrow('subagent_orchestrator cancelled.')
      expect(cancelConversation).toHaveBeenCalledTimes(1)
      expect(linkSubagentTape).not.toHaveBeenCalled()

      handoff.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(cancelConversation).toHaveBeenCalledTimes(2)

      cancellations[0].resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(linkSubagentTape).not.toHaveBeenCalled()

      cancellations[1].resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(linkSubagentTape).toHaveBeenCalledWith(
        expect.objectContaining({
          parentSessionId: parentSession.sessionId,
          childSessionId: childSession.sessionId,
          outcome: 'cancelled'
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('observes foreground cancellation while child creation is blocked and cleans up later', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'late-created-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentCapability: childSubagentCapability
      })
      const abortController = new AbortController()
      const childCreation = createDeferredPromise<ConversationSessionInfo>()
      const cancellation = createDeferredPromise<void>()
      const cancelConversation = vi.fn(() => cancellation.promise)
      const sendConversationMessage = vi.fn().mockResolvedValue(undefined)
      const linkSubagentTape = createTapeLinkMock()
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn(() => childCreation.promise),
        sendConversationMessage,
        cancelConversation,
        linkSubagentTape
      })
      const tool = new SubagentOrchestratorTool(runtimePort as any)

      const runPromise = tool.call(
        {
          mode: 'chain',
          tasks: [
            {
              slotId: 'reviewer',
              title: 'Abort before creation',
              prompt: 'Return cancellation before child creation finishes.'
            }
          ]
        },
        parentSession.sessionId,
        { signal: abortController.signal }
      )

      await vi.advanceTimersByTimeAsync(0)
      expect(runtimePort.createSubagentSession).toHaveBeenCalledTimes(1)

      abortController.abort()
      await expect(runPromise).rejects.toThrow('subagent_orchestrator cancelled.')
      expect(cancelConversation).not.toHaveBeenCalled()

      childCreation.resolve(childSession)
      await vi.advanceTimersByTimeAsync(0)
      expect(sendConversationMessage).not.toHaveBeenCalled()
      expect(cancelConversation).toHaveBeenCalledWith(childSession.sessionId)
      expect(linkSubagentTape).not.toHaveBeenCalled()

      cancellation.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(linkSubagentTape).toHaveBeenCalledWith(
        expect.objectContaining({
          parentSessionId: parentSession.sessionId,
          childSessionId: childSession.sessionId,
          outcome: 'cancelled'
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns cancellation while the parent workdir lookup remains blocked', async () => {
    const parentSession = buildSessionInfo()
    const workdir = createDeferredPromise<string | null>()
    const abortController = new AbortController()
    const runtimePort = buildRuntimePort(parentSession, {
      resolveConversationWorkdir: vi.fn(() => workdir.promise)
    })
    const tool = new SubagentOrchestratorTool(runtimePort as any)

    const running = tool.call(
      {
        mode: 'chain',
        tasks: [
          {
            slotId: 'reviewer',
            title: 'Blocked parent lookup',
            prompt: 'Do not start after cancellation.'
          }
        ]
      },
      parentSession.sessionId,
      { signal: abortController.signal }
    )
    await vi.waitFor(() => expect(runtimePort.resolveConversationWorkdir).toHaveBeenCalledOnce())

    abortController.abort()

    await expect(running).rejects.toThrow('subagent_orchestrator cancelled.')
    expect(runtimePort.createSubagentSession).not.toHaveBeenCalled()
    workdir.resolve(parentSession.projectDir)
  })

  it('clears a wait timeout when run completion wins the race', async () => {
    vi.useFakeTimers()

    try {
      const tool = new SubagentOrchestratorTool({} as any)
      await (tool as any).waitForRunCompletion({ completion: Promise.resolve() }, 300000)

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
