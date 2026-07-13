import { describe, expect, it, vi } from 'vitest'
import type { SessionRecord, SessionWithState } from '@shared/types/agent-interface'
import {
  SessionAgentAssignmentCoordinator,
  type SessionAgentAssignmentDependencies
} from '@/presenter/sessionApplication/agentAssignmentCoordinator'

const createSession = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  agentId: 'source',
  title: 'Session',
  projectDir: '/source',
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular',
  parentSessionId: null,
  subagentEnabled: false,
  subagentMeta: null,
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
    compact: vi.fn(),
    invalidateSystemPromptCache: vi.fn()
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
    updateDisabledAgentTools: vi.fn()
  }
  const runtime = {
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
        mergeTape: vi.fn().mockResolvedValue(undefined),
        discardTape: vi.fn().mockResolvedValue(undefined)
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
      disabledAgentTools: ['write'],
      subagentEnabled: true
    })),
    assertAcpSessionHasWorkdir: vi.fn((providerId: string, projectDir: string | null) => {
      if (providerId === 'acp' && !projectDir) throw new Error('workdir required')
    }),
    normalizeDisabledAgentTools: vi.fn((tools?: string[]) => tools ?? []),
    normalizeActiveSkills: vi.fn((skills?: string[]) => skills ?? [])
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
  const dependencies = {
    sessions,
    runtime,
    policy,
    projection,
    deletion,
    environment,
    acp
  } as unknown as SessionAgentAssignmentDependencies

  return {
    coordinator: new SessionAgentAssignmentCoordinator(dependencies),
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
    acpFacet
  }
}

describe('SessionAgentAssignmentCoordinator', () => {
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
    const harness = createHarness([createSession({ id: 's1' }), createSession({ id: 's2' })])
    harness.policy.resolveTransferTarget.mockImplementation(
      async (_agentId: string, projectDir: string | null) => {
        if (projectDir === '/blocked') throw new Error('blocked project')
        if (
          projectDir === '/source' &&
          harness.policy.resolveTransferTarget.mock.calls.length > 2
        ) {
          throw new Error('blocked project')
        }
        return {
          agentId: 'target',
          providerId: 'openai',
          modelId: 'gpt-4',
          projectDir,
          permissionMode: 'full_access',
          disabledAgentTools: [],
          subagentEnabled: false
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

  it('routes direct and compatibility ACP commands through their narrow controls', async () => {
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
    expect(harness.acpFacet.getCommands).toHaveBeenCalledOnce()
    expect(harness.acp.getAcpSessionCommands).toHaveBeenCalledWith('compat')
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

    await expect(harness.coordinator.mergeSubagentTape('parent', 'child')).rejects.toThrow(
      'Session child is not a child of parent.'
    )
    expect(harness.runtime.resolveSubagentFacet).not.toHaveBeenCalled()
  })
})
