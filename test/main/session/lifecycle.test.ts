import { describe, expect, it, vi } from 'vitest'
import type {
  DeepChatSessionState,
  SessionGenerationSettings,
  SessionRecord,
  SessionWithState
} from '@shared/types/agent-interface'
import { SessionLifecycle, type SessionLifecycleDependencies } from '@/session/lifecycle'

const createRecord = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'existing',
  agentId: 'deepchat',
  title: 'Session',
  projectDir: '/repo',
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular',
  parentSessionId: null,
  subagentMeta: null,
  createdAt: 100,
  updatedAt: 200,
  ...overrides
})

function createHarness(initialSessions: SessionRecord[] = []) {
  const records = new Map(initialSessions.map((session) => [session.id, session]))
  const runtimeSessions = new Map<
    string,
    {
      kind: 'deepchat' | 'acp'
      initialize: ReturnType<typeof vi.fn>
      isInitialized: ReturnType<typeof vi.fn>
      snapshot: ReturnType<typeof vi.fn>
      getGenerationSettings: ReturnType<typeof vi.fn>
      setPermissionMode: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    }
  >()
  const order: string[] = []
  let sequence = 0

  const getRuntime = (sessionId: string) => {
    const existing = runtimeSessions.get(sessionId)
    if (existing) return existing

    let initialized = false
    let state: DeepChatSessionState | null = null
    const kind = records.get(sessionId)?.agentId.startsWith('acp') ? 'acp' : 'deepchat'
    const runtime = {
      kind,
      initialize: vi.fn(
        async (config: {
          providerId: string
          modelId: string
          permissionMode: DeepChatSessionState['permissionMode']
        }) => {
          order.push(`initialize:${sessionId}`)
          initialized = true
          state = {
            status: 'idle',
            providerId: config.providerId,
            modelId: config.modelId,
            permissionMode: config.permissionMode
          }
        }
      ),
      isInitialized: vi.fn(async () => initialized),
      snapshot: vi.fn(async () => state),
      getGenerationSettings: vi.fn(async (): Promise<SessionGenerationSettings | null> => null),
      setPermissionMode: vi.fn(async (permissionMode: DeepChatSessionState['permissionMode']) => {
        if (state) state = { ...state, permissionMode }
      }),
      close: vi.fn(async () => {
        order.push(`close:${sessionId}`)
      })
    }
    runtimeSessions.set(sessionId, runtime)
    return runtime
  }

  const sessions = {
    create: vi.fn(
      (
        agentId: string,
        title: string,
        projectDir: string | null,
        options: {
          isDraft?: boolean
          disabledAgentTools?: string[]
          sessionKind?: SessionRecord['sessionKind']
          parentSessionId?: string | null
          subagentMeta?: SessionRecord['subagentMeta']
          metadata?: SessionRecord['metadata']
        } = {}
      ) => {
        const id = `session-${++sequence}`
        order.push(`create:${id}`)
        records.set(
          id,
          createRecord({
            id,
            agentId,
            title,
            projectDir,
            isDraft: options.isDraft ?? false,
            sessionKind: options.sessionKind ?? 'regular',
            parentSessionId: options.parentSessionId ?? null,
            subagentMeta: options.subagentMeta ?? null,
            metadata: options.metadata ?? null
          })
        )
        return id
      }
    ),
    get: vi.fn((sessionId: string) => records.get(sessionId) ?? null),
    list: vi.fn((filters?: { agentId?: string; projectDir?: string }) =>
      [...records.values()].filter((session) => {
        if (filters?.agentId && session.agentId !== filters.agentId) return false
        if (filters?.projectDir && session.projectDir !== filters.projectDir) return false
        return true
      })
    ),
    delete: vi.fn((sessionId: string) => {
      order.push(`delete:${sessionId}`)
      records.delete(sessionId)
    })
  }
  const runtime = { resolveSession: vi.fn((sessionId: string) => getRuntime(sessionId)) }
  const transcript = {
    hasMessages: vi.fn().mockResolvedValue(false),
    forkSessionFromMessage: vi.fn().mockResolvedValue(undefined)
  }
  const skills = { setActiveSkills: vi.fn().mockResolvedValue(undefined) }
  const assignmentPolicy = {
    resolveCreateAssignment: vi.fn(
      async (input: {
        agentId: string
        providerId?: string
        modelId?: string
        projectDir?: string | null
        permissionMode?: DeepChatSessionState['permissionMode']
        generationSettings?: Partial<SessionGenerationSettings>
        disabledAgentTools?: string[]
      }) => ({
        agentId: input.agentId,
        agentType: input.providerId === 'acp' ? ('acp' as const) : ('deepchat' as const),
        providerId: input.providerId ?? 'openai',
        modelId: input.modelId ?? 'model-1',
        projectDir: input.projectDir === undefined ? '/default' : input.projectDir,
        permissionMode: input.permissionMode ?? ('full_access' as const),
        generationSettings: input.generationSettings,
        disabledAgentTools: input.disabledAgentTools ?? []
      })
    ),
    resolveAcpDraftAssignment: vi.fn(
      (agentId: string, permissionMode?: DeepChatSessionState['permissionMode']) => ({
        agentId: agentId.trim(),
        permissionMode: permissionMode ?? ('full_access' as const)
      })
    ),
    resolveSubagentAssignment: vi.fn(
      async (input: {
        agentId: string
        parentAgentId?: string | null
        targetAgentId?: string | null
        providerId: string
        modelId: string
        permissionMode?: DeepChatSessionState['permissionMode']
        generationSettings?: Partial<SessionGenerationSettings>
        disabledAgentTools?: string[]
        activeSkills?: string[]
      }) => ({
        agentId: input.agentId,
        targetAgentId: input.targetAgentId ?? null,
        providerId: input.providerId,
        modelId: input.modelId,
        permissionMode: input.permissionMode ?? 'full_access',
        generationSettings: input.generationSettings,
        disabledAgentTools: input.disabledAgentTools ?? [],
        activeSkills: input.activeSkills ?? []
      })
    )
  }
  const workdir = {
    assertAcpSessionHasWorkdir: vi.fn(),
    syncAcpSessionWorkdir: vi.fn(async (_providerId: string, sessionId: string) => {
      order.push(`sync:${sessionId}`)
    }),
    prepareDirectAcpSession: vi.fn().mockResolvedValue(undefined),
    clearCompatibilityAcpSession: vi.fn().mockResolvedValue(undefined)
  }
  const initialTurn = {
    startInitialTurn: vi.fn(() => {
      order.push('initial-turn')
    })
  }
  let activeDesktopSessionId: string | null = null
  const desktop = {
    bind: vi.fn((_webContentsId: number, sessionId: string) => {
      activeDesktopSessionId = sessionId
      order.push(`bind:${sessionId}`)
    }),
    unbind: vi.fn(() => {
      activeDesktopSessionId = null
    }),
    getActiveId: vi.fn(() => activeDesktopSessionId)
  }
  const projection = {
    notify: vi.fn((input: { reason?: string; sessionIds?: string[] }) => {
      order.push(`notify:${input.reason}:${input.sessionIds?.join(',')}`)
    }),
    materializeRequired: vi.fn(async (sessionId: string): Promise<SessionWithState> => {
      const record = records.get(sessionId)
      if (!record) throw new Error(`Session not found: ${sessionId}`)
      const state = (await getRuntime(sessionId).snapshot()) as DeepChatSessionState | null
      return {
        ...record,
        status: state?.status ?? 'idle',
        providerId: state?.providerId ?? 'openai',
        modelId: state?.modelId ?? 'model-1'
      }
    })
  }
  const deletion = { deleteSessionTree: vi.fn().mockResolvedValue([]) }
  const permissions = { cloneSessionPermissions: vi.fn() }
  const dependencies = {
    sessions,
    runtime,
    transcript,
    skills,
    assignmentPolicy,
    workdir,
    initialTurn,
    projection,
    desktop,
    deletion,
    permissions
  } as unknown as SessionLifecycleDependencies

  return {
    coordinator: new SessionLifecycle(dependencies),
    records,
    order,
    getRuntime,
    sessions,
    runtime,
    transcript,
    skills,
    assignmentPolicy,
    workdir,
    initialTurn,
    projection,
    desktop,
    deletion,
    permissions
  }
}

describe('SessionLifecycle', () => {
  it('initializes before publication and awaits initial-turn preflight', async () => {
    const harness = createHarness()
    harness.initialTurn.startInitialTurn.mockImplementation(async () => {
      harness.order.push('initial-turn')
      return {
        requestId: null,
        messageId: null,
        attachmentPreparation: { status: 'ready', issues: [], suggestedActions: [] }
      }
    })

    await expect(
      harness.coordinator.createSession(
        {
          agentId: 'deepchat',
          message: 'Hello',
          projectDir: null,
          activeSkills: ['review']
        },
        42
      )
    ).resolves.toMatchObject({
      id: 'session-1',
      title: 'Hello',
      projectDir: null,
      providerId: 'openai',
      modelId: 'model-1'
    })

    expect(harness.assignmentPolicy.resolveCreateAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ projectDir: null, preserveExplicitNullProjectDir: true })
    )
    expect(harness.order).toEqual([
      'create:session-1',
      'initialize:session-1',
      'sync:session-1',
      'bind:session-1',
      'notify:created:session-1',
      'initial-turn'
    ])
    expect(harness.desktop.bind).toHaveBeenCalledWith(42, 'session-1')
    expect(harness.initialTurn.startInitialTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      content: { text: 'Hello', files: [], activeSkills: ['review'] },
      projectDir: null,
      initialTitle: 'Hello',
      fallbackProviderId: 'openai',
      fallbackModelId: 'model-1'
    })
  })

  it('deletes an empty new session when initial attachment preparation is cancelled', async () => {
    const harness = createHarness()
    const controller = new AbortController()
    let preparationStarted!: () => void
    const started = new Promise<void>((resolve) => {
      preparationStarted = resolve
    })
    harness.initialTurn.startInitialTurn.mockImplementationOnce(
      async (input: { signal?: AbortSignal }) => {
        preparationStarted()
        return await new Promise((_, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('Cancelled')
              error.name = 'AbortError'
              reject(error)
            },
            { once: true }
          )
        })
      }
    )
    harness.deletion.deleteSessionTree.mockResolvedValueOnce(['session-1'])

    const creating = harness.coordinator.createSession(
      { agentId: 'deepchat', message: '', files: [{ name: 'scan.png' }] },
      42,
      { signal: controller.signal }
    )
    await started
    controller.abort()

    await expect(creating).rejects.toMatchObject({ name: 'AbortError' })
    expect(harness.transcript.hasMessages).toHaveBeenCalledWith('session-1')
    expect(harness.desktop.unbind).toHaveBeenCalledWith(42)
    expect(harness.deletion.deleteSessionTree).toHaveBeenCalledWith('session-1')
    expect(harness.projection.notify).toHaveBeenCalledWith({
      sessionIds: ['session-1'],
      reason: 'deleted'
    })
  })

  it('preserves a cancelled new session once its user fact exists', async () => {
    const harness = createHarness()
    const controller = new AbortController()
    harness.transcript.hasMessages.mockResolvedValueOnce(true)
    harness.initialTurn.startInitialTurn.mockImplementationOnce(async () => {
      controller.abort()
      controller.signal.throwIfAborted()
    })

    await expect(
      harness.coordinator.createSession(
        { agentId: 'deepchat', message: '', files: [{ name: 'scan.png' }] },
        42,
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(harness.deletion.deleteSessionTree).not.toHaveBeenCalled()
    expect(harness.desktop.unbind).not.toHaveBeenCalled()
  })

  it('preserves the initialization error after rollback cleanup failures', async () => {
    const harness = createHarness()
    const initializationError = new Error('workdir failed')
    const clearError = new Error('compatibility cleanup failed')
    const closeError = new Error('runtime close failed')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    harness.assignmentPolicy.resolveCreateAssignment.mockResolvedValueOnce({
      agentId: 'deepchat',
      agentType: 'acp',
      providerId: 'acp',
      modelId: 'acp-coder',
      projectDir: '/repo',
      permissionMode: 'full_access',
      disabledAgentTools: []
    })
    harness.workdir.syncAcpSessionWorkdir.mockRejectedValueOnce(initializationError)
    harness.workdir.clearCompatibilityAcpSession.mockRejectedValueOnce(clearError)
    harness.getRuntime('session-1').close.mockRejectedValueOnce(closeError)

    await expect(
      harness.coordinator.createSession({ agentId: 'deepchat', message: 'Hello ACP' }, 1)
    ).rejects.toBe(initializationError)

    expect(harness.workdir.clearCompatibilityAcpSession).toHaveBeenCalledWith('session-1')
    expect(harness.getRuntime('session-1').close).toHaveBeenCalledOnce()
    expect(harness.sessions.delete).toHaveBeenCalledWith('session-1')
    expect(harness.records.has('session-1')).toBe(false)
    expect(harness.desktop.bind).not.toHaveBeenCalled()
    expect(harness.projection.notify).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('deletes the failed create row when cleanup cannot resolve its runtime', async () => {
    const harness = createHarness()
    const initializationError = new Error('workdir failed')
    const cleanupError = new Error('cleanup resolve failed')
    const failedRuntime = harness.getRuntime('session-1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    harness.workdir.syncAcpSessionWorkdir.mockRejectedValueOnce(initializationError)
    harness.runtime.resolveSession
      .mockImplementationOnce(() => failedRuntime)
      .mockImplementationOnce(() => {
        throw cleanupError
      })

    await expect(
      harness.coordinator.createSession({ agentId: 'deepchat', message: 'Hello' }, 1)
    ).rejects.toBe(initializationError)

    expect(failedRuntime.close).not.toHaveBeenCalled()
    expect(harness.sessions.delete).toHaveBeenCalledExactlyOnceWith('session-1')
    expect(harness.records.has('session-1')).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      '[SessionLifecycle] Failed to cleanup session runtime after initialization error session-1:',
      cleanupError
    )
    warn.mockRestore()
  })

  it('creates detached sessions without binding a window or starting a turn', async () => {
    const harness = createHarness()
    const metadata = {
      source: 'cron_job' as const,
      cronJobId: 'cron-1',
      cronJobRunId: 'run-1',
      scheduledAt: 100
    }

    await expect(
      harness.coordinator.createDetachedSession({
        title: ' Cron run ',
        projectDir: '/cron',
        activeSkills: ['report'],
        metadata
      })
    ).resolves.toMatchObject({ id: 'session-1', title: 'Cron run', metadata })

    expect(harness.assignmentPolicy.resolveCreateAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ projectDir: '/cron', preserveExplicitNullProjectDir: false })
    )
    expect(harness.sessions.create).toHaveBeenCalledWith(
      'deepchat',
      'Cron run',
      '/cron',
      expect.objectContaining({ metadata })
    )
    expect(harness.skills.setActiveSkills).toHaveBeenCalledWith('session-1', ['report'])
    expect(harness.projection.notify).toHaveBeenCalledWith({
      sessionIds: ['session-1'],
      reason: 'created'
    })
    expect(harness.desktop.bind).not.toHaveBeenCalled()
    expect(harness.initialTurn.startInitialTurn).not.toHaveBeenCalled()
  })

  it('retries subagent initialization once with a fresh row and publishes only success', async () => {
    const harness = createHarness()
    const cleanupError = new Error('cleanup resolve failed')
    const failedRuntime = harness.getRuntime('session-1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    harness.assignmentPolicy.resolveSubagentAssignment.mockResolvedValueOnce({
      agentId: 'acp-reviewer',
      targetAgentId: 'acp-reviewer',
      providerId: 'acp',
      modelId: 'acp-reviewer',
      generationSettings: { systemPrompt: '' },
      disabledAgentTools: [],
      activeSkills: ['review']
    })
    harness.workdir.syncAcpSessionWorkdir
      .mockRejectedValueOnce(new Error('warmup failed'))
      .mockResolvedValueOnce(undefined)
    harness.runtime.resolveSession
      .mockImplementationOnce(() => failedRuntime)
      .mockImplementationOnce(() => {
        throw cleanupError
      })
      .mockImplementation((sessionId: string) => harness.getRuntime(sessionId))

    await expect(
      harness.coordinator.createSubagentSession({
        parentSessionId: 'parent',
        agentId: 'acp-reviewer',
        slotId: 'reviewer',
        displayName: 'Reviewer',
        targetAgentId: 'acp-reviewer',
        projectDir: '/repo',
        providerId: 'openai',
        modelId: 'model-1',
        permissionMode: 'full_access'
      })
    ).resolves.toMatchObject({ id: 'session-2', sessionKind: 'subagent' })

    expect(harness.sessions.create).toHaveBeenCalledTimes(2)
    expect(failedRuntime.close).not.toHaveBeenCalled()
    expect(harness.sessions.delete).toHaveBeenCalledWith('session-1')
    expect(harness.records.has('session-1')).toBe(false)
    expect(harness.records.has('session-2')).toBe(true)
    expect(harness.skills.setActiveSkills).toHaveBeenCalledExactlyOnceWith('session-2', ['review'])
    expect(harness.projection.materializeRequired).toHaveBeenCalledExactlyOnceWith('session-2')
    expect(harness.projection.notify).toHaveBeenCalledExactlyOnceWith({
      sessionIds: ['session-2'],
      reason: 'created'
    })
    expect(warn).toHaveBeenCalledWith(
      '[SessionLifecycle] Failed to cleanup session runtime after initialization error session-1:',
      cleanupError
    )
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('inherits approvals only for self-target subagents', async () => {
    const harness = createHarness()

    await harness.coordinator.createSubagentSession({
      parentSessionId: 'parent',
      parentAgentId: 'deepchat',
      agentId: 'deepchat',
      slotId: 'self',
      displayName: 'Self child',
      targetAgentId: 'deepchat',
      projectDir: '/repo',
      providerId: 'openai',
      modelId: 'model-1',
      permissionMode: 'default'
    })

    expect(harness.permissions.cloneSessionPermissions).toHaveBeenCalledExactlyOnceWith(
      'parent',
      'session-1'
    )

    await harness.coordinator.createSubagentSession({
      parentSessionId: 'parent',
      parentAgentId: 'deepchat',
      agentId: 'reviewer',
      slotId: 'reviewer',
      displayName: 'Reviewer',
      targetAgentId: 'reviewer',
      projectDir: '/repo',
      providerId: 'openai',
      modelId: 'model-1',
      permissionMode: 'default'
    })

    expect(harness.permissions.cloneSessionPermissions).toHaveBeenCalledTimes(1)
  })

  it('reuses an empty ACP draft and synchronizes changed permission state', async () => {
    const draft = createRecord({
      id: 'draft-1',
      agentId: 'acp-coder',
      title: 'New Chat',
      projectDir: '/repo',
      isDraft: true
    })
    const harness = createHarness([draft])
    const runtime = harness.getRuntime('draft-1')
    runtime.isInitialized.mockResolvedValue(true)
    runtime.snapshot.mockResolvedValue({
      status: 'idle',
      providerId: 'acp',
      modelId: 'acp-coder',
      permissionMode: 'default'
    })

    await expect(
      harness.coordinator.ensureAcpDraftSession({
        agentId: 'acp-coder',
        projectDir: '/repo',
        permissionMode: 'full_access'
      })
    ).resolves.toMatchObject({ id: 'draft-1', isDraft: true, providerId: 'acp' })

    expect(harness.sessions.create).not.toHaveBeenCalled()
    expect(runtime.setPermissionMode).toHaveBeenCalledWith('full_access')
    expect(harness.workdir.syncAcpSessionWorkdir).toHaveBeenCalledWith(
      'acp',
      'draft-1',
      'acp-coder',
      '/repo'
    )
    expect(harness.workdir.prepareDirectAcpSession).toHaveBeenCalledWith('draft-1')
    expect(harness.projection.notify).toHaveBeenCalledWith({
      sessionIds: ['draft-1'],
      reason: 'updated'
    })
  })

  it('does not reuse a draft when transcript inspection fails', async () => {
    const harness = createHarness([
      createRecord({
        id: 'draft-1',
        agentId: 'acp-coder',
        projectDir: '/repo',
        isDraft: true
      })
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    harness.transcript.hasMessages.mockRejectedValueOnce(new Error('transcript failed'))

    await expect(
      harness.coordinator.ensureAcpDraftSession({
        agentId: 'acp-coder',
        projectDir: '/repo'
      })
    ).resolves.toMatchObject({ id: 'session-1', isDraft: true })

    expect(harness.sessions.create).toHaveBeenCalledOnce()
    expect(harness.workdir.prepareDirectAcpSession).toHaveBeenCalledWith('session-1')
    expect(harness.projection.notify).toHaveBeenCalledWith({
      sessionIds: ['session-1'],
      reason: 'created'
    })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('deletes a failed fork row and preserves the transcript error when close fails', async () => {
    const harness = createHarness([createRecord({ id: 'source', title: 'Source' })])
    const sourceRuntime = harness.getRuntime('source')
    sourceRuntime.snapshot.mockResolvedValue({
      status: 'idle',
      providerId: 'openai',
      modelId: 'model-1',
      permissionMode: 'default'
    })
    sourceRuntime.getGenerationSettings.mockResolvedValue({
      systemPrompt: 'Keep this',
      temperature: 0.2,
      contextLength: 32000,
      maxTokens: 2048,
      timeout: 60
    })
    const forkError = new Error('fork transcript failed')
    const closeError = new Error('fork runtime close failed')
    harness.transcript.forkSessionFromMessage.mockRejectedValueOnce(forkError)
    harness.getRuntime('session-1').close.mockRejectedValueOnce(closeError)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(harness.coordinator.forkSession('source', 'message-1')).rejects.toBe(forkError)

    expect(harness.transcript.forkSessionFromMessage).toHaveBeenCalledWith(
      'source',
      'session-1',
      'message-1'
    )
    expect(harness.getRuntime('session-1').close).toHaveBeenCalledOnce()
    expect(harness.sessions.delete).toHaveBeenCalledWith('session-1')
    expect(harness.getRuntime('session-1').close.mock.invocationCallOrder[0]).toBeLessThan(
      harness.sessions.delete.mock.invocationCallOrder[0]
    )
    expect(harness.records.has('session-1')).toBe(false)
    expect(harness.projection.notify).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[SessionLifecycle] Failed to cleanup forked session runtime session-1:',
      closeError
    )
    warn.mockRestore()
  })

  it('delegates tree deletion and publishes the transaction result in order', async () => {
    const harness = createHarness()
    harness.deletion.deleteSessionTree.mockResolvedValueOnce(['child', 'parent'])

    await harness.coordinator.deleteSession('parent')

    expect(harness.deletion.deleteSessionTree).toHaveBeenCalledExactlyOnceWith('parent')
    expect(harness.projection.notify).toHaveBeenCalledExactlyOnceWith({
      sessionIds: ['child', 'parent'],
      reason: 'deleted'
    })
  })
})
