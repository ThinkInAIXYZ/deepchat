import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentInvocationAdmission } from '@/agent/invocationAdmission'
import type { ConversationSessionInfo } from '@/tool/runtimePorts'
import type { SessionRuntimeUpdate } from '@/session/runtimeEvents'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const databaseModule = Database
  ? await import('@/orchestration/data/database').catch(() => null)
  : null
const delegationsModule = Database
  ? await import('@/orchestration/data/tables/liveDelegations').catch(() => null)
  : null
const turnsModule = Database
  ? await import('@/orchestration/data/tables/liveDelegationTurns').catch(() => null)
  : null
const eventsModule = Database
  ? await import('@/orchestration/data/tables/liveDelegationEvents').catch(() => null)
  : null
const repositoryModule = Database
  ? await import('@/orchestration/liveDelegationRepository').catch(() => null)
  : null
const serviceModule = Database
  ? await import('@/orchestration/liveDelegationService').catch(() => null)
  : null

const DatabaseCtor = Database!
const LiveDelegationDatabaseCtor = databaseModule?.LiveDelegationDatabase!
const LiveDelegationsTableCtor = delegationsModule?.LiveDelegationsTable!
const LiveDelegationTurnsTableCtor = turnsModule?.LiveDelegationTurnsTable!
const LiveDelegationEventsTableCtor = eventsModule?.LiveDelegationEventsTable!
const LiveDelegationRepositoryCtor = repositoryModule?.LiveDelegationRepository!
const LiveDelegationServiceCtor = serviceModule?.LiveDelegationService!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(
    LiveDelegationDatabaseCtor &&
    LiveDelegationsTableCtor &&
    LiveDelegationTurnsTableCtor &&
    LiveDelegationEventsTableCtor &&
    LiveDelegationRepositoryCtor &&
    LiveDelegationServiceCtor
  ),
  'Live delegation lifecycle modules are unavailable'
)

describeIfSqlite('LiveDelegationService', () => {
  let db: InstanceType<typeof DatabaseCtor> | null
  let repository: InstanceType<typeof LiveDelegationRepositoryCtor>
  let service: InstanceType<typeof LiveDelegationServiceCtor>
  let harness: ReturnType<typeof createSessionHarness>

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    db.exec(`
      CREATE TABLE new_sessions (
        id TEXT PRIMARY KEY,
        session_kind TEXT NOT NULL DEFAULT 'regular',
        parent_session_id TEXT,
        subagent_meta_json TEXT
      );
    `)
    new LiveDelegationsTableCtor(db).createTable()
    new LiveDelegationTurnsTableCtor(db).createTable()
    new LiveDelegationEventsTableCtor(db).createTable()
    repository = new LiveDelegationRepositoryCtor(
      new LiveDelegationDatabaseCtor({ getDatabase: () => db! })
    )
    harness = createSessionHarness(db)
    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      admission: new AgentInvocationAdmission(2, 10)
    })
    service.start()
  })

  afterEach(async () => {
    await service?.stop()
    db?.close()
    db = null
    vi.restoreAllMocks()
  })

  it('spawns a persistent child and delivers completion through the mailbox', async () => {
    const detail = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review architecture',
      prompt: 'Inspect module boundaries.'
    })
    expect(detail.delegation).toMatchObject({ status: 'queued', childSessionId: null })

    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const delegationId = detail.delegation.id
    const childId = repository.require(delegationId).childSessionId!
    const waiting = service.wait('parent', { after: 0, timeoutMs: 1_000 })
    harness.publish({
      sessionId: childId,
      kind: 'blocks',
      updatedAt: 200,
      responseMarkdown: '## Result\nThe boundary is sound.'
    })
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 201, status: 'idle' })

    await expect(waiting).resolves.toMatchObject({
      timedOut: false,
      events: [
        expect.objectContaining({
          delegationId,
          kind: 'turn_completed',
          contentPreview: '## Result\nThe boundary is sound.',
          contentTruncated: false
        })
      ]
    })
    expect(repository.require(delegationId).status).toBe('idle')
    expect(harness.sessions.linkSubagentTape).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: 'parent',
        childSessionId: childId,
        runId: delegationId,
        outcome: 'completed'
      })
    )
  })

  it('bounds mailbox output without truncating durable completion evidence', async () => {
    const detail = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review architecture',
      prompt: 'Inspect module boundaries.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(detail.delegation.id).childSessionId!
    const fullResult = '证'.repeat(4_000)
    harness.publish({
      sessionId: childId,
      kind: 'blocks',
      updatedAt: 200,
      responseMarkdown: fullResult
    })
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 201, status: 'idle' })

    const result = await service.wait('parent', { after: 0, timeoutMs: 1_000 })

    expect(Buffer.byteLength(result.events[0]!.contentPreview, 'utf8')).toBeLessThanOrEqual(
      2 * 1024
    )
    expect(result.events[0]?.contentTruncated).toBe(true)
    expect(repository.listEvents('parent', { after: 0 })[0]?.content).toBe(fullResult)
  })

  it('keeps send non-triggering and consumes messages only in follow_up', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review architecture',
      prompt: 'Inspect the first design.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 200, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))

    service.send('parent', spawned.delegation.id, 'Also inspect cache invalidation.')
    expect(harness.sessions.sendConversationMessage).toHaveBeenCalledTimes(1)

    await service.followUp(
      'parent',
      spawned.delegation.id,
      'Re-evaluate and return the revised conclusion.'
    )
    await vi.waitFor(() =>
      expect(harness.sessions.sendConversationMessage).toHaveBeenCalledTimes(2)
    )
    const secondHandoff = harness.sessions.sendConversationMessage.mock.calls[1]?.[1]
    expect(secondHandoff).toContain('Also inspect cache invalidation.')
    expect(secondHandoff).toContain('Re-evaluate and return the revised conclusion.')
  })

  it('rejects follow_up while the persistent child is already generating', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review architecture',
      prompt: 'Inspect the first design.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 200, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))

    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 210, status: 'generating' })

    await expect(
      service.followUp('parent', spawned.delegation.id, 'Start a second task.')
    ).rejects.toThrow('while child session is generating')
    expect(repository.listTurns(spawned.delegation.id, 10)).toHaveLength(1)
    expect(harness.sessions.sendConversationMessage).toHaveBeenCalledTimes(1)
  })

  it('allows a later follow_up to recover a child Session from an error state', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review architecture',
      prompt: 'Inspect the first design.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 200, status: 'error' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('failed'))

    await expect(
      service.followUp('parent', spawned.delegation.id, 'Retry with the available evidence.')
    ).resolves.toMatchObject({ delegation: { status: 'queued' } })
    await vi.waitFor(() =>
      expect(harness.sessions.sendConversationMessage).toHaveBeenCalledTimes(2)
    )
  })

  it('interrupts an active turn without accepting a late idle event as completion', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Long review',
      prompt: 'Keep reviewing until interrupted.'
    })
    await vi.waitFor(() =>
      expect(repository.listTurns(spawned.delegation.id, 1)[0]?.status).toBe('running')
    )
    const childId = repository.require(spawned.delegation.id).childSessionId!
    const interrupted = service.interrupt('parent', spawned.delegation.id)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 300, status: 'idle' })

    await expect(interrupted).resolves.toMatchObject({
      delegation: { status: 'interrupted' },
      turns: [expect.objectContaining({ status: 'interrupted' })]
    })
    expect(harness.sessions.linkSubagentTape).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'cancelled' })
    )
  })

  it('reconciles an accepted idle child after restart', async () => {
    await service.stop()
    const created = repository.create({
      id: 'delegation-recovery',
      initialTurnId: 'turn-recovery',
      parentSessionId: 'parent',
      slotId: 'reviewer',
      targetAgentId: 'agent-1',
      title: 'Recover review',
      prompt: 'Complete before restart.',
      now: 100
    })
    harness.addChild('child-recovery', created.delegation.id, 'idle')
    repository.bindChild(created.delegation.id, 'child-recovery', 110)
    repository.markTurnStarted(created.turn.id, 120)
    harness.sessions.getLatestAssistantResponse.mockResolvedValueOnce('Recovered result.')

    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      admission: new AgentInvocationAdmission(2, 10)
    })
    service.start()
    const result = await service.wait('parent', { after: 0, timeoutMs: 1_000 })

    expect(result.events).toEqual([
      expect.objectContaining({
        kind: 'turn_completed',
        contentPreview: 'Recovered result.',
        contentTruncated: false
      })
    ])
    expect(repository.require(created.delegation.id).status).toBe('idle')
  })

  it('treats an idle child without accepted handoff evidence as interrupted', async () => {
    await service.stop()
    const created = repository.create({
      id: 'delegation-crash-window',
      initialTurnId: 'turn-crash-window',
      parentSessionId: 'parent',
      slotId: 'reviewer',
      targetAgentId: 'agent-1',
      title: 'Crash window',
      prompt: 'May not have been sent.',
      now: 100
    })
    harness.addChild('child-crash-window', created.delegation.id, 'idle')

    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      admission: new AgentInvocationAdmission(2, 10)
    })
    service.start()
    const result = await service.wait('parent', { after: 0, timeoutMs: 1_000 })

    expect(result.events).toEqual([expect.objectContaining({ kind: 'turn_interrupted' })])
    expect(harness.sessions.linkSubagentTape).not.toHaveBeenCalled()
  })

  it('isolates one recovery failure so later active children still reconcile', async () => {
    await service.stop()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failed = repository.create({
      id: 'delegation-recovery-failed',
      initialTurnId: 'turn-recovery-failed',
      parentSessionId: 'parent',
      slotId: 'reviewer',
      targetAgentId: 'agent-1',
      title: 'Failed lookup',
      prompt: 'This child lookup fails.',
      now: 100
    })
    const healthy = repository.create({
      id: 'delegation-recovery-healthy',
      initialTurnId: 'turn-recovery-healthy',
      parentSessionId: 'parent',
      slotId: 'reviewer',
      targetAgentId: 'agent-1',
      title: 'Healthy lookup',
      prompt: 'This child should still recover.',
      now: 110
    })
    harness.addChild('child-recovery-failed', failed.delegation.id, 'idle')
    harness.addChild('child-recovery-healthy', healthy.delegation.id, 'idle')
    repository.bindChild(failed.delegation.id, 'child-recovery-failed', 120)
    repository.bindChild(healthy.delegation.id, 'child-recovery-healthy', 120)
    repository.markTurnStarted(failed.turn.id, 130)
    repository.markTurnStarted(healthy.turn.id, 130)
    const resolveSessionInfo =
      harness.sessions.resolveConversationSessionInfo.getMockImplementation()!
    harness.sessions.resolveConversationSessionInfo.mockImplementation(
      async (sessionId: string) => {
        if (sessionId === 'child-recovery-failed') throw new Error('Child lookup failed.')
        return await resolveSessionInfo(sessionId)
      }
    )
    harness.sessions.getLatestAssistantResponse.mockResolvedValue('Recovered healthy result.')

    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      admission: new AgentInvocationAdmission(2, 10)
    })
    service.start()
    await vi.waitFor(() => {
      expect(repository.require(failed.delegation.id).status).toBe('interrupted')
      expect(repository.require(healthy.delegation.id).status).toBe('idle')
    })

    expect((await service.wait('parent', { after: 0, timeoutMs: 0 })).events).toEqual([
      expect.objectContaining({
        delegationId: failed.delegation.id,
        kind: 'turn_interrupted'
      }),
      expect.objectContaining({
        delegationId: healthy.delegation.id,
        kind: 'turn_completed',
        contentPreview: 'Recovered healthy result.'
      })
    ])
    expect(errorSpy).toHaveBeenCalledWith(
      '[LiveDelegationService] Failed to reconcile child turn:',
      expect.objectContaining({ delegationId: failed.delegation.id })
    )
  })
})

function createSessionHarness(db: InstanceType<typeof DatabaseCtor>) {
  const listeners = new Set<(update: SessionRuntimeUpdate) => void>()
  const children = new Map<string, ConversationSessionInfo>()
  const parent = createSessionInfo({
    sessionId: 'parent',
    sessionKind: 'regular',
    parentSessionId: null,
    status: 'idle'
  })
  db.prepare(
    `INSERT INTO new_sessions (id, session_kind, parent_session_id, subagent_meta_json)
     VALUES ('parent', 'regular', NULL, NULL)`
  ).run()

  const addChild = (
    childId: string,
    delegationId: string,
    status: ConversationSessionInfo['status'] = 'idle'
  ) => {
    const child = createSessionInfo({
      sessionId: childId,
      sessionKind: 'subagent',
      parentSessionId: 'parent',
      status,
      subagentMeta: {
        slotId: 'reviewer',
        displayName: 'Reviewer',
        liveDelegation: { delegationId }
      }
    })
    children.set(childId, child)
    db.prepare(
      `INSERT OR IGNORE INTO new_sessions (
         id, session_kind, parent_session_id, subagent_meta_json
       ) VALUES (?, 'subagent', 'parent', ?)`
    ).run(childId, JSON.stringify(child.subagentMeta))
    return child
  }

  const sessions = {
    resolveConversationWorkdir: vi.fn().mockResolvedValue('/repo'),
    resolveConversationSessionInfo: vi.fn(async (sessionId: string) =>
      sessionId === 'parent' ? parent : (children.get(sessionId) ?? null)
    ),
    createSubagentSession: vi.fn(
      async (input: { liveDelegationContext?: { delegationId: string } }) => {
        const delegationId = input.liveDelegationContext?.delegationId ?? 'missing'
        return addChild(`child-${delegationId}`, delegationId, 'idle')
      }
    ),
    linkSubagentTape: vi.fn(async (input: { childSessionId: string; outcome: string }) => ({
      linkEntry: { sessionId: 'parent', entryId: 10 },
      childSessionId: input.childSessionId,
      childHeadEntryId: 20,
      childEntryCount: 8,
      outcome: input.outcome
    })),
    sendConversationMessage: vi.fn().mockResolvedValue(undefined),
    cancelConversation: vi.fn().mockResolvedValue(undefined),
    subscribeSessionRuntimeUpdates: vi.fn((listener: (update: SessionRuntimeUpdate) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    findDelegationChild: vi.fn(
      async (_parentSessionId: string, delegationId: string) =>
        [...children.values()].find(
          (child) => child.subagentMeta?.liveDelegation?.delegationId === delegationId
        ) ?? null
    ),
    getLatestAssistantResponse: vi.fn().mockResolvedValue(null)
  }

  return {
    sessions,
    addChild,
    publish(update: SessionRuntimeUpdate) {
      if (update.kind === 'status' && update.status) {
        const child = children.get(update.sessionId)
        if (child) child.status = update.status
      }
      for (const listener of listeners) listener(update)
    }
  }
}

function createSessionInfo(
  overrides: Partial<ConversationSessionInfo> & Pick<ConversationSessionInfo, 'sessionId'>
): ConversationSessionInfo {
  return {
    sessionId: overrides.sessionId,
    agentId: 'agent-1',
    agentName: 'Agent 1',
    agentType: 'deepchat',
    providerId: 'openai',
    modelId: 'model-1',
    projectDir: '/repo',
    permissionMode: 'default',
    generationSettings: null,
    disabledAgentTools: [],
    activeSkills: [],
    sessionKind: 'regular',
    parentSessionId: null,
    subagentMeta: null,
    subagentCapability: {
      available: true,
      slots: [
        {
          id: 'reviewer',
          targetType: 'self',
          displayName: 'Reviewer',
          description: 'Review a bounded task.'
        }
      ],
      cacheKey: 'reviewer'
    },
    status: 'idle',
    ...overrides
  }
}
