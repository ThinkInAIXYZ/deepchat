import { describe, expect, it, vi } from 'vitest'
import type {
  SessionRecord,
  SessionWithState,
  SubagentTapeLinkInput
} from '@shared/types/agent-interface'
import { SessionAssignment, type SessionAgentAssignmentDependencies } from '@/session/assignment'
import { SessionTurn, type SessionTurnDependencies } from '@/session/turn'
import { AgentLifecycleGate } from '@/agent/lifecycleGate'

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const createSession = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  agentId: 'source',
  title: 'Session',
  projectDir: '/source',
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular',
  parentSessionId: null,
  subagentMeta: null,
  orchestrationPolicy: 'explicit',
  createdAt: 100,
  updatedAt: 200,
  ...overrides
})

const materialize = (session: SessionRecord): SessionWithState => ({
  ...session,
  status: 'idle',
  providerId: 'openai',
  modelId: 'gpt-4'
})

function createHarness(initialSessions: SessionRecord[] = [createSession()]) {
  const records = new Map(initialSessions.map((session) => [session.id, session]))
  const hasMessages = new Map(initialSessions.map((session) => [session.id, true]))
  const pendingInputs = new Map(initialSessions.map((session) => [session.id, [] as unknown[]]))
  const settings = {
    getPermissionMode: vi.fn().mockResolvedValue('full_access'),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    getGenerationSettings: vi.fn().mockResolvedValue(null),
    updateGenerationSettings: vi.fn().mockResolvedValue({ temperature: 0.2 }),
    setProjectDir: vi.fn().mockResolvedValue(undefined)
  }
  const deepchat = {
    setSessionAgentContext: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    getCompactionState: vi.fn(),
    compact: vi.fn()
  }
  const acpFacet = {
    prepare: vi.fn().mockResolvedValue(undefined),
    updateWorkdir: vi.fn().mockResolvedValue('/repo'),
    getModes: vi.fn(),
    setMode: vi.fn(),
    getConfigOptions: vi.fn().mockResolvedValue({ options: [] }),
    setConfigOption: vi.fn().mockResolvedValue({ options: [] }),
    getCommands: vi.fn().mockResolvedValue([{ name: 'test', description: 'Test' }]),
    closeRuntime: vi.fn().mockResolvedValue(undefined)
  }
  const deepchatHandle = {
    kind: 'deepchat',
    snapshot: vi.fn().mockResolvedValue({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4'
    }),
    settings,
    deepchat
  }
  const acpHandle = {
    kind: 'acp',
    snapshot: vi.fn().mockResolvedValue({
      status: 'idle',
      providerId: 'acp',
      modelId: 'claude-acp'
    }),
    settings,
    acp: acpFacet
  }
  const sessions = {
    get: vi.fn((sessionId: string) => records.get(sessionId) ?? null),
    list: vi.fn(
      (filters?: { agentId?: string; parentSessionId?: string; includeSubagents?: boolean }) =>
        [...records.values()].filter((session) => {
          if (filters?.agentId && session.agentId !== filters.agentId) return false
          if (filters?.parentSessionId && session.parentSessionId !== filters.parentSessionId) {
            return false
          }
          return filters?.includeSubagents || session.sessionKind === 'regular'
        })
    ),
    update: vi.fn((sessionId: string, fields: Partial<SessionRecord>) => {
      const session = records.get(sessionId)
      if (session) records.set(sessionId, { ...session, ...fields })
    }),
    updateAgentId: vi.fn((sessionId: string, agentId: string) => {
      const session = records.get(sessionId)
      if (session) records.set(sessionId, { ...session, agentId })
    }),
    getDisabledAgentTools: vi.fn(() => []),
    updateDisabledAgentTools: vi.fn(),
    getOrchestrationPolicy: vi.fn(
      (sessionId: string) => records.get(sessionId)?.orchestrationPolicy ?? 'explicit'
    ),
    updateOrchestrationPolicy: vi.fn(
      (sessionId: string, orchestrationPolicy: 'explicit' | 'proactive') => {
        const session = records.get(sessionId)
        if (session) records.set(sessionId, { ...session, orchestrationPolicy })
      }
    )
  }
  const runtime = {
    getSessionAgentKind: vi.fn((sessionId: string) =>
      records.get(sessionId)?.agentId.includes('acp') ? 'acp' : 'deepchat'
    ),
    resolveSession: vi.fn((sessionId: string) => {
      const session = records.get(sessionId)
      const isAcp = session?.agentId.includes('acp')
      return isAcp
        ? {
            kind: 'acp',
            descriptor: { id: session.agentId, kind: 'acp', source: 'manual' },
            handle: acpHandle
          }
        : {
            kind: 'deepchat',
            descriptor: {
              id: session?.agentId ?? 'source',
              kind: 'deepchat',
              source: 'manual',
              config: {}
            },
            handle: deepchatHandle
          }
    }),
    resolveTransferSource: vi.fn((sessionId: string) => ({
      descriptor: { id: records.get(sessionId)?.agentId ?? 'source', kind: 'deepchat' },
      handle: deepchatHandle,
      facet: {
        hasMessages: vi.fn(async () => hasMessages.get(sessionId) ?? true),
        listPendingInputs: vi.fn(async () => pendingInputs.get(sessionId) ?? [])
      }
    })),
    resolveDeepChatTransferTarget: vi.fn(() => ({
      descriptor: { id: 'target', kind: 'deepchat' },
      facet: { setSessionAgentContext: deepchat.setSessionAgentContext }
    })),
    resolveSubagentFacet: vi.fn(() => ({
      kind: 'deepchat',
      descriptor: { id: 'source', kind: 'deepchat' },
      facet: {
        linkTape: vi.fn((input: SubagentTapeLinkInput) =>
          Promise.resolve({
            linkEntry: { sessionId: input.parentSessionId, entryId: 1 },
            childSessionId: input.childSessionId,
            childHeadEntryId: 2,
            childEntryCount: 2,
            outcome: input.outcome
          })
        )
      }
    }))
  }
  const policy = {
    resolveCreateAssignment: vi.fn(),
    resolveAcpDraftAssignment: vi.fn(),
    resolveSubagentAssignment: vi.fn(),
    resolveTransferTarget: vi.fn(async (_agentId: string, projectDir: string | null) => ({
      agentId: 'target',
      providerId: 'openai',
      modelId: 'gpt-4',
      projectDir: projectDir ?? '/target',
      permissionMode: 'full_access',
      disabledAgentTools: ['write']
    })),
    assertAcpSessionHasWorkdir: vi.fn((providerId: string, projectDir: string | null) => {
      if (providerId === 'acp' && !projectDir) throw new Error('workdir required')
    })
  }
  const projection = {
    materialize: vi.fn(async (sessionId: string) => {
      const session = records.get(sessionId)
      return session ? materialize(session) : null
    }),
    notify: vi.fn()
  }
  const deletion = { deleteSessionTree: vi.fn().mockResolvedValue([]) }
  const environment = { syncPath: vi.fn() }
  const acp = {
    setAcpWorkdir: vi.fn().mockResolvedValue(undefined),
    getAcpSessionConfigOptions: vi.fn().mockResolvedValue({ options: [] }),
    setAcpSessionConfigOption: vi.fn().mockResolvedValue({ options: [] }),
    getAcpSessionCommands: vi.fn().mockResolvedValue([{ name: 'compat', description: 'Compat' }]),
    clearAcpSession: vi.fn().mockResolvedValue(undefined)
  }
  const agentLifecycle = new AgentLifecycleGate()
  const dependencies = {
    sessions,
    runtime,
    policy,
    projection,
    deletion,
    environment,
    acp,
    agentLifecycle
  } as unknown as SessionAgentAssignmentDependencies

  return {
    coordinator: new SessionAssignment(dependencies),
    records,
    hasMessages,
    pendingInputs,
    sessions,
    runtime,
    policy,
    projection,
    deletion,
    environment,
    acp,
    settings,
    deepchat,
    deepchatHandle,
    acpHandle,
    acpFacet,
    agentLifecycle
  }
}

describe('SessionAssignment', () => {
  it('keeps failed transcript and pending checks conservative', async () => {
    const harness = createHarness([
      createSession({ id: 'draft', isDraft: true }),
      createSession({ id: 'pending', isDraft: true })
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    harness.runtime.resolveTransferSource.mockImplementation((sessionId: string) => ({
      handle: harness.deepchatHandle,
      facet: {
        hasMessages:
          sessionId === 'draft'
            ? vi.fn().mockRejectedValue(new Error('transcript failed'))
            : vi.fn().mockResolvedValue(false),
        listPendingInputs:
          sessionId === 'pending'
            ? vi.fn().mockRejectedValue(new Error('pending failed'))
            : vi.fn().mockResolvedValue([])
      }
    }))

    await expect(harness.coordinator.getAgentTransferImpact('source')).resolves.toMatchObject({
      emptyDrafts: 1,
      movableSessions: 1,
      blockedSessions: 1,
      samples: [
        expect.objectContaining({ id: 'draft', blockReason: undefined }),
        expect.objectContaining({ id: 'pending', blockReason: 'pending-input' })
      ]
    })
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('preflights every batch entry before the first transfer mutation', async () => {
    const harness = createHarness([
      createSession({ id: 's1' }),
      createSession({ id: 's2', projectDir: '/blocked' })
    ])
    harness.policy.resolveTransferTarget.mockImplementation(
      async (_agentId: string, projectDir: string | null) => {
        if (projectDir === '/blocked') throw new Error('blocked project')
        return {
          agentId: 'target',
          providerId: 'openai',
          modelId: 'gpt-4',
          projectDir,
          permissionMode: 'full_access',
          disabledAgentTools: []
        }
      }
    )

    await expect(harness.coordinator.moveAgentSessions('source', 'target')).rejects.toThrow(
      'blocked project'
    )
    expect(harness.deepchat.setSessionAgentContext).not.toHaveBeenCalled()
    expect(harness.sessions.updateAgentId).not.toHaveBeenCalled()
  })

  it('reports and publishes completed work when a later transfer fails', async () => {
    const harness = createHarness([createSession({ id: 's1' }), createSession({ id: 's2' })])
    harness.projection.materialize
      .mockImplementationOnce(async () => materialize(harness.records.get('s1')!))
      .mockResolvedValueOnce(null)

    await expect(harness.coordinator.moveAgentSessions('source', 'target')).rejects.toThrow(
      'Failed to build session state after transfer: s2 Partial transfer completed: 1 moved.'
    )
    expect(harness.projection.notify).toHaveBeenCalledWith({
      sessionIds: ['s1'],
      reason: 'updated'
    })
  })

  it('uses the required deletion port for bulk deletion and publishes once', async () => {
    const harness = createHarness([createSession({ id: 'parent' })])
    harness.deletion.deleteSessionTree.mockResolvedValue(['child', 'parent'])

    await expect(harness.coordinator.deleteAgentSessions('source')).resolves.toEqual([
      'child',
      'parent'
    ])
    expect(harness.deletion.deleteSessionTree).toHaveBeenCalledWith('parent')
    expect(harness.projection.notify).toHaveBeenCalledWith({
      sessionIds: ['child', 'parent'],
      reason: 'deleted'
    })
  })

  it('preserves the non-transactional project update order', async () => {
    const harness = createHarness([createSession({ agentId: 'claude-acp' })])
    const order: string[] = []
    harness.sessions.update.mockImplementation(
      (sessionId: string, fields: Partial<SessionRecord>) => {
        order.push('store')
        const session = harness.records.get(sessionId)
        if (session) harness.records.set(sessionId, { ...session, ...fields })
      }
    )
    harness.environment.syncPath.mockImplementation(() => order.push('environment'))
    harness.settings.setProjectDir.mockImplementation(async () => {
      order.push('runtime-setting')
    })
    harness.acpFacet.updateWorkdir.mockImplementation(async () => {
      order.push('acp-workdir')
      return '/next'
    })

    await harness.coordinator.setSessionProjectDir('s1', ' /next ')
    expect(order).toEqual(['store', 'environment', 'runtime-setting', 'acp-workdir'])
  })

  it('falls back to requested model identity when the post-set snapshot is null', async () => {
    const harness = createHarness()
    harness.deepchatHandle.snapshot.mockResolvedValue(null)

    await expect(
      harness.coordinator.setSessionModel('s1', ' openrouter ', ' custom-model ')
    ).resolves.toMatchObject({
      status: 'idle',
      providerId: 'openrouter',
      modelId: 'custom-model'
    })
    expect(harness.deepchat.setModel).toHaveBeenCalledWith('openrouter', 'custom-model')
    expect(harness.projection.materialize).not.toHaveBeenCalled()
    expect(harness.projection.notify).toHaveBeenCalledWith({
      sessionIds: ['s1'],
      reason: 'updated'
    })
  })

  it('does not publish a model update when the post-set snapshot fails', async () => {
    const harness = createHarness()
    harness.deepchatHandle.snapshot.mockRejectedValue(new Error('snapshot failed'))

    await expect(harness.coordinator.setSessionModel('s1', 'openai', 'gpt-5')).rejects.toThrow(
      'snapshot failed'
    )
    expect(harness.deepchat.setModel).toHaveBeenCalledWith('openai', 'gpt-5')
    expect(harness.projection.notify).not.toHaveBeenCalled()
  })

  it('keeps direct ACP models locked before invoking DeepChat model control', async () => {
    const harness = createHarness([createSession({ agentId: 'claude-acp' })])

    await expect(harness.coordinator.setSessionModel('s1', 'openai', 'gpt-5')).rejects.toThrow(
      'ACP session model is locked.'
    )
    expect(harness.deepchat.setModel).not.toHaveBeenCalled()
    expect(harness.projection.notify).not.toHaveBeenCalled()
  })

  it('owns permission, generation, orchestration, and disabled-tool settings', async () => {
    const harness = createHarness()
    harness.sessions.getDisabledAgentTools.mockReturnValue(['read'])
    harness.settings.getGenerationSettings.mockResolvedValue({ temperature: 0.7 })

    await expect(harness.coordinator.getPermissionMode('s1')).resolves.toBe('full_access')
    await harness.coordinator.setPermissionMode('s1', 'auto_approve')
    await expect(harness.coordinator.getSessionGenerationSettings('s1')).resolves.toEqual({
      temperature: 0.7
    })
    await expect(
      harness.coordinator.updateSessionGenerationSettings('s1', { temperature: 0.2 })
    ).resolves.toEqual({ temperature: 0.2 })
    await expect(harness.coordinator.getSessionDisabledAgentTools('s1')).resolves.toEqual(['read'])
    await expect(harness.coordinator.getOrchestrationPolicy('s1')).resolves.toBe('explicit')
    await expect(harness.coordinator.updateOrchestrationPolicy('s1', 'proactive')).resolves.toBe(
      'proactive'
    )
    await expect(
      harness.coordinator.updateSessionDisabledAgentTools('s1', ['find', 'write', 'write'])
    ).resolves.toEqual(['write'])

    expect(harness.settings.setPermissionMode).toHaveBeenCalledWith('auto_approve')
    expect(harness.settings.updateGenerationSettings).toHaveBeenCalledWith({ temperature: 0.2 })
    expect(harness.sessions.updateDisabledAgentTools).toHaveBeenCalledWith('s1', ['write'])
    expect(harness.sessions.updateOrchestrationPolicy).toHaveBeenCalledWith('s1', 'proactive')
  })

  it('rejects proactive collaboration for direct ACP and subagent sessions', async () => {
    const harness = createHarness([
      createSession({ id: 'direct', agentId: 'claude-acp' }),
      createSession({ id: 'child', sessionKind: 'subagent', parentSessionId: 'parent' })
    ])

    await expect(
      harness.coordinator.updateOrchestrationPolicy('direct', 'proactive')
    ).rejects.toThrow('requires a DeepChat session')
    await expect(
      harness.coordinator.updateOrchestrationPolicy('child', 'proactive')
    ).rejects.toThrow('requires a regular parent session')
    expect(harness.sessions.updateOrchestrationPolicy).not.toHaveBeenCalled()
  })

  it('revalidates proactive policy after an admitted Session mutation', async () => {
    const harness = createHarness()
    const mutationStarted = createDeferred<void>()
    const mutationRelease = createDeferred<void>()
    const mutation = harness.coordinator.runWithSessionOperationGate('s1', async () => {
      mutationStarted.resolve(undefined)
      await mutationRelease.promise
      harness.records.set('s1', { ...harness.records.get('s1')!, agentId: 'claude-acp' })
    })
    await mutationStarted.promise

    const policyUpdate = harness.coordinator.updateOrchestrationPolicy('s1', 'proactive')
    await Promise.resolve()
    expect(harness.sessions.updateOrchestrationPolicy).not.toHaveBeenCalled()

    mutationRelease.resolve(undefined)
    await mutation
    await expect(policyUpdate).rejects.toThrow('requires a DeepChat session')
    expect(harness.sessions.updateOrchestrationPolicy).not.toHaveBeenCalled()
  })

  it('routes direct and compatibility ACP commands and config through narrow controls', async () => {
    const harness = createHarness([
      createSession({ id: 'direct', agentId: 'claude-acp' }),
      createSession({ id: 'compat', agentId: 'source' })
    ])
    harness.deepchatHandle.snapshot.mockResolvedValue({
      status: 'idle',
      providerId: 'acp',
      modelId: 'claude-acp'
    })

    await expect(harness.coordinator.getAcpSessionCommands('direct')).resolves.toEqual([
      { name: 'test', description: 'Test' }
    ])
    await expect(harness.coordinator.getAcpSessionCommands('compat')).resolves.toEqual([
      { name: 'compat', description: 'Compat' }
    ])
    await expect(harness.coordinator.getAcpSessionConfigOptions('direct')).resolves.toEqual({
      options: []
    })
    await expect(
      harness.coordinator.setAcpSessionConfigOption('direct', 'mode', 'plan')
    ).resolves.toEqual({ options: [] })
    await expect(harness.coordinator.getAcpSessionConfigOptions('compat')).resolves.toEqual({
      options: []
    })
    await expect(
      harness.coordinator.setAcpSessionConfigOption('compat', 'mode', 'plan')
    ).resolves.toEqual({ options: [] })
    expect(harness.acpFacet.getCommands).toHaveBeenCalledOnce()
    expect(harness.acp.getAcpSessionCommands).toHaveBeenCalledWith('compat')
    expect(harness.acpFacet.getConfigOptions).toHaveBeenCalledOnce()
    expect(harness.acpFacet.setConfigOption).toHaveBeenCalledWith('mode', 'plan')
    expect(harness.acp.getAcpSessionConfigOptions).toHaveBeenCalledWith('compat')
    expect(harness.acp.setAcpSessionConfigOption).toHaveBeenCalledWith('compat', 'mode', 'plan')
  })

  it('preserves transfer mutation order before materializing state', async () => {
    const harness = createHarness()
    const order: string[] = []
    harness.deepchat.setSessionAgentContext.mockImplementation(async () => {
      order.push('runtime-context')
    })
    harness.sessions.updateAgentId.mockImplementation((sessionId: string, agentId: string) => {
      order.push('agent-id')
      const session = harness.records.get(sessionId)
      if (session) harness.records.set(sessionId, { ...session, agentId })
    })
    harness.sessions.update.mockImplementation(
      (sessionId: string, fields: Partial<SessionRecord>) => {
        order.push('session-row')
        const session = harness.records.get(sessionId)
        if (session) harness.records.set(sessionId, { ...session, ...fields })
      }
    )
    harness.sessions.updateDisabledAgentTools.mockImplementation(() => order.push('tools'))
    harness.projection.materialize.mockImplementation(async (sessionId: string) => {
      order.push('materialize')
      return materialize(harness.records.get(sessionId)!)
    })

    await harness.coordinator.moveSessionToAgent('s1', 'target')
    expect(order).toEqual(['runtime-context', 'agent-id', 'session-row', 'tools', 'materialize'])
  })

  it('makes target deletion wait for an admitted Session transfer', async () => {
    const harness = createHarness()
    const runtimeContextStarted = createDeferred<void>()
    const runtimeContextRelease = createDeferred<void>()
    harness.deepchat.setSessionAgentContext.mockImplementation(async () => {
      runtimeContextStarted.resolve(undefined)
      await runtimeContextRelease.promise
    })

    const transfer = harness.coordinator.moveSessionToAgent('s1', 'target')
    await runtimeContextStarted.promise
    let deletionChecked = false
    const deletion = harness.agentLifecycle.runWithAgentDeletion('target', async () => {
      deletionChecked = true
      return [...harness.records.values()].some((session) => session.agentId === 'target')
    })
    await Promise.resolve()

    expect(deletionChecked).toBe(false)
    expect(harness.records.get('s1')?.agentId).toBe('source')

    runtimeContextRelease.resolve(undefined)
    await transfer
    await expect(deletion).resolves.toBe(true)
    expect(harness.records.get('s1')?.agentId).toBe('target')
  })

  it('rejects a Session transfer while target deletion owns the lifecycle fence', async () => {
    const harness = createHarness()
    const deletionStarted = createDeferred<void>()
    const deletionRelease = createDeferred<void>()
    const deletion = harness.agentLifecycle.runWithAgentDeletion('target', async () => {
      deletionStarted.resolve(undefined)
      await deletionRelease.promise
    })
    await deletionStarted.promise

    await expect(harness.coordinator.moveSessionToAgent('s1', 'target')).rejects.toThrow(
      'DeepChat Agent is being deleted: target'
    )
    expect(harness.deepchat.setSessionAgentContext).not.toHaveBeenCalled()
    expect(harness.sessions.updateAgentId).not.toHaveBeenCalled()
    expect(harness.records.get('s1')?.agentId).toBe('source')

    deletionRelease.resolve(undefined)
    await deletion
  })

  it.each([
    {
      name: 'send',
      invoke: (turn: SessionTurn) => turn.sendMessage('s1', 'After transfer'),
      expectedResult: { requestId: 'request-1', messageId: 'message-1' }
    },
    {
      name: 'retry',
      invoke: (turn: SessionTurn) => turn.retryMessage('s1', 'message-1'),
      expectedResult: { requestId: 'request-1', messageId: 'message-1' }
    }
  ])(
    'holds a concurrent $name until transfer runtime and persisted Agent state agree',
    async ({ name, invoke, expectedResult }) => {
      const harness = createHarness()
      let releaseRuntimeContext!: () => void
      let markRuntimeContextStarted!: () => void
      const runtimeContextGate = new Promise<void>((resolve) => {
        releaseRuntimeContext = resolve
      })
      const runtimeContextStarted = new Promise<void>((resolve) => {
        markRuntimeContextStarted = resolve
      })
      harness.deepchat.setSessionAgentContext.mockImplementation(async () => {
        markRuntimeContextStarted()
        await runtimeContextGate
      })

      const pendingRecord = {
        id: 'pending-1',
        sessionId: 's1',
        mode: 'queue' as const,
        state: 'pending' as const,
        payload: { text: 'Pending', files: [] },
        queueOrder: 1,
        claimedAt: null,
        consumedAt: null,
        createdAt: 100,
        updatedAt: 100
      }
      const observedAgentIds: string[] = []
      const send = vi.fn().mockResolvedValue({ requestId: 'request-1', messageId: 'message-1' })
      const prepareRetryMessage = vi.fn().mockResolvedValue({
        content: { text: 'Retry', files: [] },
        projectDir: '/source'
      })
      const resolveSession = vi.fn(() => {
        observedAgentIds.push(harness.records.get('s1')?.agentId ?? 'missing')
        return {
          kind: 'deepchat' as const,
          pending: {
            steerActiveTurn: vi.fn().mockResolvedValue(undefined),
            list: vi.fn().mockResolvedValue([]),
            queue: vi.fn().mockResolvedValue(pendingRecord),
            update: vi.fn().mockResolvedValue(pendingRecord),
            move: vi.fn().mockResolvedValue([pendingRecord]),
            steer: vi.fn().mockResolvedValue({
              ...pendingRecord,
              mode: 'steer' as const,
              state: 'claimed' as const
            }),
            delete: vi.fn().mockResolvedValue(undefined)
          },
          toolInteractions: {
            respond: vi.fn().mockResolvedValue({ resumed: false })
          },
          send,
          cancel: vi.fn().mockResolvedValue(undefined),
          snapshot: vi.fn().mockResolvedValue({
            status: 'idle' as const,
            providerId: 'openai',
            modelId: 'gpt-4',
            permissionMode: 'full_access' as const
          }),
          compaction: {
            getState: vi.fn().mockResolvedValue({
              status: 'idle' as const,
              cursorOrderSeq: 1,
              summaryUpdatedAt: null
            }),
            compact: vi.fn().mockResolvedValue({
              compacted: false,
              state: { status: 'idle' as const, cursorOrderSeq: 1, summaryUpdatedAt: null }
            })
          }
        }
      })
      const turnDependencies: SessionTurnDependencies = {
        sessions: harness.sessions,
        runtime: { resolveSession },
        transcript: {
          hasMessages: vi.fn().mockResolvedValue(true),
          clearMessages: vi.fn().mockResolvedValue(undefined),
          prepareRetryMessage,
          deleteMessage: vi.fn().mockResolvedValue(undefined),
          editUserMessage: vi.fn().mockResolvedValue(null)
        },
        workdir: harness.coordinator,
        projection: {
          notify: vi.fn(),
          scheduleTitleGeneration: vi.fn()
        }
      }
      const turn = new SessionTurn(turnDependencies)

      const transfer = harness.coordinator.moveSessionToAgent('s1', 'target')
      await runtimeContextStarted

      const pendingOperation = invoke(turn)
      expect(resolveSession).not.toHaveBeenCalled()
      expect(prepareRetryMessage).not.toHaveBeenCalled()
      expect(harness.records.get('s1')?.agentId).toBe('source')

      releaseRuntimeContext()
      await transfer
      await expect(pendingOperation).resolves.toEqual(expectedResult)

      expect(observedAgentIds).toEqual(['target'])
      expect(send).toHaveBeenCalledOnce()
      if (name === 'retry') {
        expect(prepareRetryMessage).toHaveBeenCalledWith('s1', 'message-1')
      } else {
        expect(prepareRetryMessage).not.toHaveBeenCalled()
      }
    }
  )

  it('clears compatibility ACP binding only after transfer commit materialization', async () => {
    const harness = createHarness()
    const order: string[] = []
    harness.deepchatHandle.snapshot.mockResolvedValue({
      status: 'idle',
      providerId: 'acp',
      modelId: 'claude-acp'
    })
    harness.projection.materialize.mockImplementation(async (sessionId: string) => {
      order.push('materialize')
      return materialize(harness.records.get(sessionId)!)
    })
    harness.acp.clearAcpSession.mockImplementation(async () => {
      order.push('clear-acp')
    })

    await harness.coordinator.moveSessionToAgent('s1', 'target')
    expect(order).toEqual(['materialize', 'clear-acp'])
    expect(harness.acp.clearAcpSession).toHaveBeenCalledWith('s1')
  })

  it('validates Tape parentage before resolving the runtime facet', async () => {
    const harness = createHarness([
      createSession({ id: 'parent' }),
      createSession({
        id: 'child',
        sessionKind: 'subagent',
        parentSessionId: 'different-parent'
      })
    ])

    await expect(
      harness.coordinator.linkSubagentTape({
        parentSessionId: 'parent',
        childSessionId: 'child',
        runId: 'run',
        taskId: 'task',
        slotId: 'reviewer',
        taskTitle: 'Review',
        outcome: 'completed',
        resultSummary: null
      })
    ).rejects.toThrow('Session child is not a child of parent.')
    expect(harness.runtime.resolveSubagentFacet).not.toHaveBeenCalled()
  })

  it('rejects a regular session even when malformed data gives it a parent', async () => {
    const harness = createHarness([
      createSession({ id: 'parent' }),
      createSession({ id: 'child', sessionKind: 'regular', parentSessionId: 'parent' })
    ])

    await expect(
      harness.coordinator.linkSubagentTape({
        parentSessionId: 'parent',
        childSessionId: 'child',
        runId: 'run',
        taskId: 'task',
        slotId: 'reviewer',
        taskTitle: 'Review',
        outcome: 'completed',
        resultSummary: null
      })
    ).rejects.toThrow('Session child is not a child of parent.')
    expect(harness.runtime.resolveSubagentFacet).not.toHaveBeenCalled()
  })
})
