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
      subagentEnabled: false,
      availableSubagentSlots: []
    })
  ),
  sendConversationMessage: vi.fn().mockResolvedValue(undefined),
  cancelConversation: vi.fn().mockResolvedValue(undefined),
  subscribeDeepChatSessionUpdates: vi.fn(() => () => undefined),
  mergeSubagentTape: vi.fn().mockResolvedValue(undefined),
  discardSubagentTape: vi.fn().mockResolvedValue(undefined),
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
        subagentEnabled: false,
        availableSubagentSlots: []
      })
      const cancelConversation = vi.fn().mockResolvedValue(undefined)
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn().mockResolvedValue(childSession),
        cancelConversation
      })
      const tool = new SubagentOrchestratorTool(runtimePort as any)

      const definition = await tool.getToolDefinition(parentSession.sessionId)
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

  it('waits for child cancellation but not tape discard after a deadline', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'slow-cancel-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentEnabled: false,
        availableSubagentSlots: []
      })
      let settleCancellation: (() => void) | undefined
      const cancelConversation = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            settleCancellation = resolve
          })
      )
      const discard = createDeferredPromise<void>()
      const discardSubagentTape = vi.fn(() => discard.promise)
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn().mockResolvedValue(childSession),
        cancelConversation,
        discardSubagentTape
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
      expect(discardSubagentTape).not.toHaveBeenCalled()

      settleCancellation?.()
      await Promise.resolve()
      await Promise.resolve()
      const waited = await tool.call(
        { operation: 'wait', runId, timeoutMs: 0 },
        parentSession.sessionId
      )

      expect(discardSubagentTape).toHaveBeenCalledWith(
        parentSession.sessionId,
        childSession.sessionId,
        expect.objectContaining({ status: 'cancelled' })
      )
      expect((waited.rawData?.toolResult as any).subagentFinal).toBeTruthy()

      discard.resolve(undefined)
      await Promise.resolve()
      await Promise.resolve()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns at the deadline when a completed child tape merge is still blocked', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'blocked-merge-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentEnabled: false,
        availableSubagentSlots: []
      })
      const merge = createDeferredPromise<void>()
      let listener: ((update: DeepChatInternalSessionUpdate) => void) | undefined
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn().mockResolvedValue(childSession),
        subscribeDeepChatSessionUpdates: vi.fn((callback) => {
          listener = callback
          return () => {
            listener = undefined
          }
        }),
        mergeSubagentTape: vi.fn(() => merge.promise)
      })
      const tool = new SubagentOrchestratorTool(runtimePort as any)

      const running = tool.call(
        {
          mode: 'chain',
          runTimeoutMs: 1000,
          tasks: [{ slotId: 'reviewer', title: 'Blocked merge', prompt: 'Finish normally.' }]
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
      expect(runtimePort.mergeSubagentTape).toHaveBeenCalledOnce()

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

      merge.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns at the deadline when an errored child tape discard is still blocked', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'blocked-discard-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentEnabled: false,
        availableSubagentSlots: []
      })
      const discard = createDeferredPromise<void>()
      let listener: ((update: DeepChatInternalSessionUpdate) => void) | undefined
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn().mockResolvedValue(childSession),
        subscribeDeepChatSessionUpdates: vi.fn((callback) => {
          listener = callback
          return () => {
            listener = undefined
          }
        }),
        discardSubagentTape: vi.fn(() => discard.promise)
      })
      const tool = new SubagentOrchestratorTool(runtimePort as any)

      const running = tool.call(
        {
          mode: 'chain',
          runTimeoutMs: 1000,
          tasks: [{ slotId: 'reviewer', title: 'Blocked discard', prompt: 'Fail normally.' }]
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
      expect(runtimePort.discardSubagentTape).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(1000)

      const result = await running
      const finalProgress = JSON.parse((result.rawData?.toolResult as any).subagentFinal)
      expect(finalProgress).toMatchObject({
        status: 'cancelled',
        cancellationReason: 'Run deadline exceeded after 1000ms.'
      })
      expect(finalProgress.tasks[0].status).toBe('error')
      expect(runtimePort.cancelConversation).not.toHaveBeenCalled()

      discard.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('registers cancellation before discarding a child created after the deadline', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'late-deadline-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentEnabled: false,
        availableSubagentSlots: []
      })
      const childCreation = createDeferredPromise<ConversationSessionInfo>()
      const cancellation = createDeferredPromise<void>()
      const cancelConversation = vi.fn(() => cancellation.promise)
      const discardSubagentTape = vi.fn().mockResolvedValue(undefined)
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn(() => childCreation.promise),
        cancelConversation,
        discardSubagentTape
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
      expect(discardSubagentTape).not.toHaveBeenCalled()

      cancellation.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)

      expect(discardSubagentTape).toHaveBeenCalledWith(
        parentSession.sessionId,
        childSession.sessionId,
        expect.objectContaining({ status: 'cancelled' })
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
            subagentEnabled: false,
            availableSubagentSlots: []
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

  it('records completed child sessions as merged tape forks', async () => {
    let listener: ((update: DeepChatInternalSessionUpdate) => void) | null = null
    const parentSession = buildSessionInfo()
    const childSession = buildSessionInfo({
      sessionId: 'child-session',
      agentName: 'Reviewer Clone',
      sessionKind: 'subagent',
      parentSessionId: parentSession.sessionId,
      subagentEnabled: false,
      availableSubagentSlots: []
    })
    const mergeSubagentTape = vi.fn().mockResolvedValue(undefined)
    const discardSubagentTape = vi.fn().mockResolvedValue(undefined)

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
      mergeSubagentTape,
      discardSubagentTape,
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

    expect(mergeSubagentTape).toHaveBeenCalledWith(
      parentSession.sessionId,
      childSession.sessionId,
      expect.objectContaining({
        taskId: 'task-review',
        slotId: 'reviewer',
        status: 'completed',
        title: 'Review task'
      })
    )
    expect(discardSubagentTape).not.toHaveBeenCalled()
  })

  it('leaves subagent tape unfinalized when merge fails so it can be retried', async () => {
    const mergeSubagentTape = vi
      .fn()
      .mockRejectedValueOnce(new Error('merge failed'))
      .mockResolvedValueOnce(undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const tool = new SubagentOrchestratorTool({
      mergeSubagentTape
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
    expect(task.tapeFinalizeError).toBe('merge failed')

    await (tool as any).finalizeTaskTape({
      parentSessionId: 'parent-session',
      runId: 'run-1',
      task
    })

    expect(mergeSubagentTape).toHaveBeenCalledTimes(2)
    expect(task.tapeFinalized).toBe(true)
    expect(task.tapeFinalizeError).toBeUndefined()
    warnSpy.mockRestore()
  })

  it('marks subagent tape finalized when runtime has no tape merge support', async () => {
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

    expect(task.tapeFinalized).toBe(true)
    expect(task.tapeFinalizeError).toBeUndefined()
  })

  it('retries failed subagent tape finalization on terminal wait', async () => {
    let listener: ((update: DeepChatInternalSessionUpdate) => void) | null = null
    const parentSession = buildSessionInfo()
    const childSession = buildSessionInfo({
      sessionId: 'child-session',
      agentName: 'Reviewer Clone',
      sessionKind: 'subagent',
      parentSessionId: parentSession.sessionId,
      subagentEnabled: false,
      availableSubagentSlots: []
    })
    const mergeSubagentTape = vi
      .fn()
      .mockRejectedValueOnce(new Error('merge failed'))
      .mockResolvedValueOnce(undefined)
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
      mergeSubagentTape,
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

    expect(mergeSubagentTape).toHaveBeenCalledTimes(2)
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
      subagentEnabled: false,
      availableSubagentSlots: []
    })
    const mergeSubagentTape = vi.fn().mockRejectedValue(new Error('merge still failed'))
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
      mergeSubagentTape,
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

    expect(mergeSubagentTape).toHaveBeenCalledTimes(2)
    expect(waited.rawData?.isError).toBe(true)
    expect(waited.content).toContain('Tape Finalization: failed: merge still failed')
    expect(waitedProgress.tasks[0]).toMatchObject({
      tapeFinalized: false,
      tapeFinalizeError: 'merge still failed'
    })

    const info = await tool.call({ operation: 'info', runId }, parentSession.sessionId)

    expect(mergeSubagentTape).toHaveBeenCalledTimes(3)
    expect(info.rawData?.isError).toBe(true)

    const logged = await tool.call({ operation: 'log', runId }, parentSession.sessionId)

    expect(mergeSubagentTape).toHaveBeenCalledTimes(4)
    expect(logged.rawData?.isError).toBe(true)
    warnSpy.mockRestore()
  })

  it('rechecks cancellation after a blocked handoff and cancels again before tape discard', async () => {
    vi.useFakeTimers()

    try {
      const parentSession = buildSessionInfo()
      const childSession = buildSessionInfo({
        sessionId: 'blocked-handoff-child',
        sessionKind: 'subagent',
        parentSessionId: parentSession.sessionId,
        subagentEnabled: false,
        availableSubagentSlots: []
      })
      const abortController = new AbortController()
      const handoff = createDeferredPromise<void>()
      const cancellations = [createDeferredPromise<void>(), createDeferredPromise<void>()]
      let cancellationIndex = 0
      const cancelConversation = vi.fn(() => cancellations[cancellationIndex++]!.promise)
      const discardSubagentTape = vi.fn().mockResolvedValue(undefined)
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn().mockResolvedValue(childSession),
        sendConversationMessage: vi.fn(() => handoff.promise),
        cancelConversation,
        discardSubagentTape
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
      expect(discardSubagentTape).not.toHaveBeenCalled()

      handoff.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(cancelConversation).toHaveBeenCalledTimes(2)

      cancellations[0].resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(discardSubagentTape).not.toHaveBeenCalled()

      cancellations[1].resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(discardSubagentTape).toHaveBeenCalledWith(
        parentSession.sessionId,
        childSession.sessionId,
        expect.objectContaining({ status: 'cancelled' })
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
        subagentEnabled: false,
        availableSubagentSlots: []
      })
      const abortController = new AbortController()
      const childCreation = createDeferredPromise<ConversationSessionInfo>()
      const cancellation = createDeferredPromise<void>()
      const cancelConversation = vi.fn(() => cancellation.promise)
      const sendConversationMessage = vi.fn().mockResolvedValue(undefined)
      const discardSubagentTape = vi.fn().mockResolvedValue(undefined)
      const runtimePort = buildRuntimePort(parentSession, {
        createSubagentSession: vi.fn(() => childCreation.promise),
        sendConversationMessage,
        cancelConversation,
        discardSubagentTape
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
      expect(discardSubagentTape).not.toHaveBeenCalled()

      cancellation.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(discardSubagentTape).toHaveBeenCalledWith(
        parentSession.sessionId,
        childSession.sessionId,
        expect.objectContaining({ status: 'cancelled' })
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
