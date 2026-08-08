import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentInvocationAdmission } from '@/agent/invocationAdmission'
import { TOOL_EXECUTION } from '@shared/types/mcp'
import {
  LIVE_DELEGATION_MAX_ACTIVE_PER_PARENT,
  LIVE_DELEGATION_MAX_MESSAGE_BYTES
} from '@shared/orchestration/liveDelegation'
import type { ConversationSessionInfo } from '@/tool/runtimePorts'
import type { SessionRuntimeUpdate } from '@/session/runtimeEvents'
import { SessionDeletionGate } from '@/session/deletionGate'
import { LiveDelegationConsentAuthority } from '@/orchestration/liveDelegationConsent'
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
  let deletionGate: SessionDeletionGate
  let admission: AgentInvocationAdmission
  let consentAuthority: LiveDelegationConsentAuthority

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    db.exec(`
      PRAGMA foreign_keys = ON;
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
    deletionGate = new SessionDeletionGate()
    admission = new AgentInvocationAdmission(2, 10)
    consentAuthority = new LiveDelegationConsentAuthority()
    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      safety: harness.safety,
      consent: consentAuthority,
      admission,
      deletionGate
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
    harness.publishAnswer(childId, '## Handoff\nThe boundary is sound.\0', 200)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 201, status: 'idle' })

    await expect(waiting).resolves.toMatchObject({
      timedOut: false,
      events: [
        expect.objectContaining({
          delegationId,
          kind: 'turn_completed',
          contentPreview: '## Handoff\nThe boundary is sound.�',
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

  it('requires a matching explicit-user receipt at the service boundary', async () => {
    harness.parent.orchestrationPolicy = 'explicit'
    const input = {
      slotId: 'reviewer',
      title: 'Review authorization',
      prompt: 'Inspect the authorization boundary.'
    }

    await expect(service.spawn('parent', input)).rejects.toThrow(
      'requires current user confirmation before spawn'
    )
    await expect(
      service.spawn(
        'parent',
        input,
        consentAuthority.issue({
          parentSessionId: 'another-parent',
          operation: 'spawn',
          executionId: 'spawn-1'
        })
      )
    ).rejects.toThrow('authorization is invalid for spawn')
    expect(repository.listByParent('parent')).toEqual([])

    await expect(
      service.spawn(
        'parent',
        input,
        consentAuthority.issue({
          parentSessionId: 'parent',
          operation: 'spawn',
          executionId: 'spawn-1'
        })
      )
    ).resolves.toMatchObject({ delegation: { status: 'queued' } })
  })

  it('claims dispatch only after live delegation authorization and target validation', async () => {
    harness.parent.orchestrationPolicy = 'explicit'
    const input = {
      slotId: 'reviewer',
      title: 'Review dispatch boundary',
      prompt: 'Inspect the final mutation boundary.'
    }
    const beforeMutation = vi.fn(() => {
      expect(repository.listByParent('parent')).toEqual([])
    })

    await expect(service.spawn('parent', input, undefined, beforeMutation)).rejects.toThrow(
      'requires current user confirmation before spawn'
    )
    await expect(
      service.spawn(
        'parent',
        { ...input, slotId: 'missing-slot' },
        consentAuthority.issue({
          parentSessionId: 'parent',
          operation: 'spawn',
          executionId: 'missing-slot'
        }),
        beforeMutation
      )
    ).rejects.toThrow('Subagent slot not found or not enabled')
    expect(beforeMutation).not.toHaveBeenCalled()

    const receipt = consentAuthority.issue({
      parentSessionId: 'parent',
      operation: 'spawn',
      executionId: 'journal-failure'
    })
    const journalError = new Error('journal unavailable')
    const failingCommit = vi.fn(() => {
      throw journalError
    })
    await expect(service.spawn('parent', input, receipt, failingCommit)).rejects.toBe(journalError)
    expect(repository.listByParent('parent')).toEqual([])
    expect(
      consentAuthority.isValid(receipt, { parentSessionId: 'parent', operation: 'spawn' })
    ).toBe(true)

    const validReceipt = consentAuthority.issue({
      parentSessionId: 'parent',
      operation: 'spawn',
      executionId: 'valid-dispatch'
    })
    await expect(
      service.spawn('parent', input, validReceipt, beforeMutation)
    ).resolves.toMatchObject({ delegation: { status: 'queued' } })
    expect(beforeMutation).toHaveBeenCalledOnce()
  })

  it('retains explicit consent when parent capacity rejects persistence', async () => {
    harness.parent.orchestrationPolicy = 'explicit'
    for (let index = 0; index < LIVE_DELEGATION_MAX_ACTIVE_PER_PARENT; index += 1) {
      repository.create({
        id: `occupied-${index}`,
        initialTurnId: `occupied-turn-${index}`,
        parentSessionId: 'parent',
        slotId: 'reviewer',
        targetAgentId: 'deepchat',
        title: `Occupied slot ${index}`,
        prompt: 'Keep this capacity slot occupied.'
      })
    }
    const receipt = consentAuthority.issue({
      parentSessionId: 'parent',
      operation: 'spawn',
      executionId: 'spawn-retry'
    })
    const input = {
      slotId: 'reviewer',
      title: 'Review persistence retry',
      prompt: 'Inspect whether the consent boundary supports a safe retry.'
    }
    const beforeMutation = vi.fn()

    await expect(service.spawn('parent', input, receipt, beforeMutation)).rejects.toThrow(
      `at most ${LIVE_DELEGATION_MAX_ACTIVE_PER_PARENT} active live delegations`
    )
    expect(beforeMutation).not.toHaveBeenCalled()
    expect(
      consentAuthority.isValid(receipt, { parentSessionId: 'parent', operation: 'spawn' })
    ).toBe(true)
    repository.finishTurn({ turnId: 'occupied-turn-0', status: 'completed' })
    await expect(service.spawn('parent', input, receipt, beforeMutation)).resolves.toMatchObject({
      delegation: { status: 'queued' }
    })
    expect(beforeMutation).toHaveBeenCalledOnce()
  })

  it('does not claim dispatch when a mailbox message fails local validation', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review mailbox validation',
      prompt: 'Inspect mailbox boundaries.'
    })
    const beforeMutation = vi.fn()

    expect(() =>
      service.send(
        'parent',
        spawned.delegation.id,
        'x'.repeat(LIVE_DELEGATION_MAX_MESSAGE_BYTES + 1),
        beforeMutation
      )
    ).toThrow(`between 1 and ${LIVE_DELEGATION_MAX_MESSAGE_BYTES} UTF-8 bytes`)
    expect(beforeMutation).not.toHaveBeenCalled()
  })

  it('revalidates consent after follow-up safety work and before persistence', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review policy race',
      prompt: 'Inspect the policy race.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publishAnswer(childId, 'Initial result.', 200)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 201, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))

    const resolveSessionInfo =
      harness.sessions.resolveConversationSessionInfo.getMockImplementation()!
    harness.sessions.resolveConversationSessionInfo.mockImplementation(
      async (sessionId: string) => {
        const result = await resolveSessionInfo(sessionId)
        if (sessionId === childId) harness.parent.orchestrationPolicy = 'explicit'
        return result
      }
    )

    await expect(
      service.followUp('parent', spawned.delegation.id, 'Continue after the policy change.')
    ).rejects.toThrow('requires current user confirmation before follow_up')
    expect(repository.listTurns(spawned.delegation.id)).toHaveLength(1)

    await expect(
      service.followUp(
        'parent',
        spawned.delegation.id,
        'Continue with explicit confirmation.',
        consentAuthority.issue({
          parentSessionId: 'parent',
          operation: 'follow_up',
          executionId: 'follow-up-1'
        })
      )
    ).resolves.toMatchObject({ delegation: { status: 'queued' } })
  })

  it('limits mailbox waits per parent without exhausting process-wide capacity', async () => {
    const parentControllers = Array.from({ length: 5 }, () => new AbortController())
    const parentWaits = parentControllers.map((controller) =>
      service.wait('parent', { timeoutMs: 60_000, signal: controller.signal })
    )

    await expect(service.wait('parent', { timeoutMs: 60_000 })).rejects.toThrow(
      'Too many live delegation waits are active for this session.'
    )
    const otherController = new AbortController()
    const otherWait = service.wait('other-parent', {
      timeoutMs: 60_000,
      signal: otherController.signal
    })

    for (const controller of parentControllers) controller.abort()
    otherController.abort()
    const outcomes = await Promise.allSettled([...parentWaits, otherWait])
    expect(outcomes).toEqual(
      Array.from({ length: 6 }, () => expect.objectContaining({ status: 'rejected' }))
    )
  })

  it('bounds the Handoff while retaining a durable reference to the full answer', async () => {
    const detail = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review architecture',
      prompt: 'Inspect module boundaries.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(detail.delegation.id).childSessionId!
    const fullResult = '证'.repeat(4_000)
    harness.publishAnswer(childId, fullResult, 200)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 201, status: 'idle' })

    const result = await service.wait('parent', { after: 0, timeoutMs: 1_000 })

    expect(Buffer.byteLength(result.events[0]!.contentPreview, 'utf8')).toBeLessThanOrEqual(
      16 * 1024
    )
    expect(result.events[0]?.contentPreview).toContain('Handoff truncated')
    const turn = repository.listTurns(detail.delegation.id, 1)[0]!
    expect(turn.resultRef).toMatchObject({
      childSessionId: childId,
      handoffSource: 'final_answer',
      handoffTruncated: true
    })
    const page = await service.readResult('parent', detail.delegation.id, {
      turnId: turn.id,
      maxTokens: 4_000
    })
    expect(page.text).toBe(fullResult)
    expect(page.done).toBe(true)
  })

  it('settles as failed when durable result persistence rejects the reference', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const finishTurn = repository.finishTurn.bind(repository)
    vi.spyOn(repository, 'finishTurn').mockImplementation((input) => {
      if (input.resultRef) throw new Error('result reference storage failed')
      return finishTurn(input)
    })
    const detail = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review persistence failure',
      prompt: 'Return a result whose reference cannot be stored.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(detail.delegation.id).childSessionId!
    harness.publishAnswer(childId, '## Handoff\nKeep this bounded conclusion.', 200)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 201, status: 'idle' })

    await vi.waitFor(() => expect(repository.require(detail.delegation.id).status).toBe('failed'))
    const turn = repository.listTurns(detail.delegation.id, 1)[0]!
    expect(turn).toMatchObject({
      status: 'failed',
      resultSummary: '## Handoff\nKeep this bounded conclusion.',
      resultRef: null,
      error: expect.stringContaining('Failed to persist child result')
    })
    expect(turn.tapeReceipt).not.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      '[LiveDelegationService] Failed to settle child turn:',
      expect.objectContaining({ turnId: turn.id })
    )
  })

  it('pages the complete verified answer without exposing process output', async () => {
    const detail = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review full evidence',
      prompt: 'Inspect the complete evidence set.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(detail.delegation.id).childSessionId!
    const fullAnswer = [
      '```markdown',
      '## Handoff',
      'This fenced example is not the actual Handoff.',
      '```not-a-closing-fence',
      '## Handoff',
      'This heading is still inside the fenced example.',
      '```',
      '## Handoff',
      'The parent should use the verified conclusion.',
      '## Result',
      `Detailed evidence ${'界😀result '.repeat(3_000)}`
    ]
      .join('\n')
      .trimEnd()
    harness.publishAnswer(childId, fullAnswer, 200, 'message-full-result')
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 201, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(detail.delegation.id).status).toBe('idle'))

    const turn = repository.listTurns(detail.delegation.id, 1)[0]!
    expect(turn.resultSummary).toBe('## Handoff\nThe parent should use the verified conclusion.')
    expect(turn.resultSummary).not.toContain('Detailed evidence')

    let cursor: string | undefined
    let completeAnswer = ''
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const page = await service.readResult('parent', detail.delegation.id, {
        turnId: turn.id,
        ...(cursor ? { cursor } : {}),
        maxTokens: 4_000
      })
      expect(Buffer.byteLength(page.text, 'utf8')).toBeLessThanOrEqual(16 * 1024)
      expect(page.text).not.toContain('\uFFFD')
      completeAnswer += page.text
      if (page.done) {
        cursor = undefined
        break
      }
      cursor = page.nextCursor ?? undefined
    }
    expect(cursor).toBeUndefined()
    expect(completeAnswer).toBe(fullAnswer)

    await expect(
      service.readResult('another-parent', detail.delegation.id, { turnId: turn.id })
    ).rejects.toThrow('does not belong to the current session')
    await expect(
      service.readResult('parent', detail.delegation.id, {
        turnId: turn.id,
        cursor: 'not-a-valid-cursor'
      })
    ).rejects.toThrow('Invalid live delegation result cursor')
    const forgedCursor = Buffer.from(
      JSON.stringify({
        v: 1,
        turnId: turn.id,
        answerSha256: '0'.repeat(64),
        offset: 1
      }),
      'utf8'
    ).toString('base64url')
    await expect(
      service.readResult('parent', detail.delegation.id, {
        turnId: turn.id,
        cursor: forgedCursor
      })
    ).rejects.toThrow('no longer matches the stored result')

    harness.sessions.getAssistantResult.mockResolvedValueOnce({
      messageId: 'message-full-result',
      answerMarkdown: 'mutated answer',
      updatedAt: 400
    })
    await expect(
      service.readResult('parent', detail.delegation.id, { turnId: turn.id })
    ).rejects.toThrow('failed integrity verification')
  })

  it('bounds the combined mailbox payload when several children finish together', async () => {
    for (let index = 0; index < 5; index += 1) {
      const detail = await service.spawn('parent', {
        slotId: 'reviewer',
        title: `Review area ${index}`,
        prompt: `Inspect area ${index}.`
      })
      await vi.waitFor(() =>
        expect(harness.sessions.sendConversationMessage).toHaveBeenCalledTimes(index + 1)
      )
      const childId = repository.require(detail.delegation.id).childSessionId!
      harness.publishAnswer(
        childId,
        `## Handoff\n${String.fromCharCode(97 + index).repeat(10_000)}`,
        200 + index
      )
      harness.publish({
        sessionId: childId,
        kind: 'status',
        updatedAt: 300 + index,
        status: 'idle'
      })
      await vi.waitFor(() => expect(repository.require(detail.delegation.id).status).toBe('idle'))
    }

    const result = await service.wait('parent', { after: 0, timeoutMs: 0 })
    expect(result.events).toHaveLength(5)
    expect(
      result.events.reduce(
        (total, event) => total + Buffer.byteLength(event.contentPreview, 'utf8'),
        0
      )
    ).toBeLessThanOrEqual(32 * 1024)
    expect(result.events.every((event) => event.contentTruncated)).toBe(true)
  })

  it('records child effect intent before tool dispatch', async () => {
    const detail = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Inspect implementation',
      prompt: 'Read the implementation and report risks.'
    })
    await vi.waitFor(() =>
      expect(repository.listTurns(detail.delegation.id, 1)[0]?.status).toBe('running')
    )
    const childId = repository.require(detail.delegation.id).childSessionId!

    await service.beforeToolExecution({
      conversationId: childId,
      toolCallId: 'call-read',
      toolName: 'read',
      source: 'agent',
      reviewedExecution: TOOL_EXECUTION.read.parallel
    })
    expect(repository.listTurns(detail.delegation.id, 1)[0]).toMatchObject({
      effectState: 'read',
      effectEvidence: {
        toolId: 'read',
        toolCallId: 'call-read',
        classification: 'read'
      }
    })

    await service.beforeToolExecution({
      conversationId: childId,
      toolCallId: 'call-mcp',
      toolName: 'remote_search',
      source: 'mcp',
      reviewedExecution: null
    })
    expect(repository.listTurns(detail.delegation.id, 1)[0]?.effectState).toBe('write')
    await expect(
      service.beforeToolExecution({
        conversationId: 'parent',
        toolCallId: 'ordinary-call',
        toolName: 'read',
        source: 'agent',
        reviewedExecution: TOOL_EXECUTION.read.parallel
      })
    ).resolves.toBeUndefined()

    harness.publishAnswer(childId, '## Handoff\nThe implementation evidence is recorded.', 199)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 200, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(detail.delegation.id).status).toBe('idle'))
  })

  it('keeps send non-triggering and consumes messages only in follow_up', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review architecture',
      prompt: 'Inspect the first design.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publishAnswer(childId, '## Handoff\nThe first review is complete.', 199)
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
    harness.publishAnswer(childId, '## Handoff\nThe revised review is complete.', 299)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 300, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))
  })

  it('freezes generation settings while applying live permission and workspace safety', async () => {
    await service.stop()
    admission = new AgentInvocationAdmission(1, 10)
    const blocker = await admission.acquire({ ownerId: 'other-session' })
    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      safety: harness.safety,
      consent: consentAuthority,
      admission,
      deletionGate
    })
    service.start()
    harness.parent.providerId = 'openai'
    harness.parent.modelId = 'model-frozen'
    harness.parent.generationSettings = {
      systemPrompt: 'Frozen prompt',
      temperature: 0.2,
      contextLength: 32_000,
      maxTokens: 4096,
      timeout: 30_000
    }

    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Freeze execution settings',
      prompt: 'Use the accepted execution configuration.'
    })
    harness.parent.providerId = 'anthropic'
    harness.parent.modelId = 'model-later'
    harness.parent.generationSettings!.systemPrompt = 'Changed after scheduling'
    harness.parent.permissionMode = 'full_access'
    harness.parent.projectDir = '/repo-later'
    harness.sessions.resolveConversationWorkdir.mockResolvedValue('/repo-later')
    blocker.release()

    await vi.waitFor(() => expect(harness.sessions.createSubagentSession).toHaveBeenCalledOnce())
    expect(harness.sessions.createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        modelId: 'model-frozen',
        permissionMode: 'full_access',
        projectDir: '/repo-later',
        generationSettings: expect.objectContaining({ systemPrompt: 'Frozen prompt' })
      })
    )
    const childId = repository.require(spawned.delegation.id).childSessionId!
    await expect(
      service.beforeToolAuthorization({
        conversationId: childId,
        toolCallId: 'call-live-safety',
        toolName: 'read',
        source: 'agent',
        reviewedExecution: TOOL_EXECUTION.read.parallel
      })
    ).resolves.toBe('full_access')
    expect(harness.safety.prepareTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parentPermissionMode: 'full_access',
        projectDir: '/repo-later'
      })
    )

    harness.publishAnswer(childId, 'Frozen settings were used.', 200)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 201, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))
  })

  it('restores the child execution snapshot before a queued follow-up starts', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Continue with frozen settings',
      prompt: 'Complete the first turn.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publishAnswer(childId, 'First turn complete.', 200)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 201, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))

    const child = await harness.sessions.resolveConversationSessionInfo(childId)
    child!.generationSettings = {
      systemPrompt: 'Follow-up snapshot',
      temperature: 0.3,
      contextLength: 64_000,
      maxTokens: 8192,
      timeout: 60_000
    }
    const firstBlocker = await admission.acquire({ ownerId: 'other-session-1' })
    const secondBlocker = await admission.acquire({ ownerId: 'other-session-2' })
    const followUp = await service.followUp(
      'parent',
      spawned.delegation.id,
      'Start after admission becomes available.'
    )
    child!.generationSettings!.systemPrompt = 'Changed while queued'
    firstBlocker.release()

    await vi.waitFor(() =>
      expect(harness.safety.prepareTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          childSessionId: childId,
          executionSnapshot: expect.objectContaining({
            generationSettings: expect.objectContaining({ systemPrompt: 'Follow-up snapshot' })
          })
        })
      )
    )
    expect(followUp.delegation.status).toBe('queued')
    secondBlocker.release()
    harness.publishAnswer(childId, 'Follow-up complete.', 300)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 301, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))
  })

  it('captures follow-up settings from the child inside its acceptance gate', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Capture accepted settings',
      prompt: 'Complete the first turn.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publishAnswer(childId, 'First turn complete.', 200)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 201, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))

    const child = await harness.sessions.resolveConversationSessionInfo(childId)
    child!.generationSettings = {
      systemPrompt: 'Accepted prompt',
      temperature: 0.4,
      contextLength: 64_000,
      maxTokens: 8192,
      timeout: 60_000
    }
    const resolveSessionInfo =
      harness.sessions.resolveConversationSessionInfo.getMockImplementation()!
    let childReads = 0
    harness.sessions.resolveConversationSessionInfo.mockImplementation(async (sessionId) => {
      if (sessionId === childId && childReads++ === 0) {
        return {
          ...child!,
          generationSettings: { ...child!.generationSettings!, systemPrompt: 'Stale prompt' }
        }
      }
      return await resolveSessionInfo(sessionId)
    })
    const firstBlocker = await admission.acquire({ ownerId: 'other-session-1' })
    const secondBlocker = await admission.acquire({ ownerId: 'other-session-2' })
    harness.safety.prepareTurn.mockClear()

    await service.followUp('parent', spawned.delegation.id, 'Use the settings accepted now.')
    harness.sessions.resolveConversationSessionInfo.mockImplementation(resolveSessionInfo)
    firstBlocker.release()

    await vi.waitFor(() =>
      expect(harness.safety.prepareTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          executionSnapshot: expect.objectContaining({
            generationSettings: expect.objectContaining({ systemPrompt: 'Accepted prompt' })
          })
        })
      )
    )
    secondBlocker.release()
    harness.publishAnswer(childId, 'Follow-up complete.', 300)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 301, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))
  })

  it('interrupts active work when its configured subagent capability is revoked', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Observe capability revocation',
      prompt: 'Remain active until capability changes.'
    })
    await vi.waitFor(() =>
      expect(repository.listTurns(spawned.delegation.id, 1)[0]?.status).toBe('running')
    )
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.parent.subagentCapability = {
      available: false,
      reason: 'subagents_disabled'
    }

    await expect(
      service.beforeToolAuthorization({
        conversationId: childId,
        toolCallId: 'call-after-revocation',
        toolName: 'read',
        source: 'agent',
        reviewedExecution: TOOL_EXECUTION.read.parallel
      })
    ).rejects.toThrow('unavailable')
    await vi.waitFor(() =>
      expect(repository.require(spawned.delegation.id).status).toBe('interrupted')
    )
    expect(harness.sessions.cancelConversation).toHaveBeenCalledWith(childId)
  })

  it('rejects a tool when permission changes after authorization', async () => {
    harness.parent.permissionMode = 'auto_approve'
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Fence permission revocation',
      prompt: 'Attempt one protected tool call.'
    })
    await vi.waitFor(() =>
      expect(repository.listTurns(spawned.delegation.id, 1)[0]?.status).toBe('running')
    )
    const childId = repository.require(spawned.delegation.id).childSessionId!
    await expect(
      service.beforeToolAuthorization({
        conversationId: childId,
        toolCallId: 'permission-race',
        toolName: 'exec',
        source: 'agent',
        reviewedExecution: TOOL_EXECUTION.write
      })
    ).resolves.toBe('full_access')
    harness.parent.permissionMode = 'default'

    await expect(
      service.beforeToolExecution({
        conversationId: childId,
        toolCallId: 'permission-race',
        toolName: 'exec',
        source: 'agent',
        reviewedExecution: TOOL_EXECUTION.write,
        authorizedPermissionMode: 'full_access'
      })
    ).rejects.toThrow('Permission mode changed before tool dispatch')
    await vi.waitFor(() =>
      expect(repository.require(spawned.delegation.id).status).toBe('interrupted')
    )
    expect(repository.listTurns(spawned.delegation.id, 1)[0]?.effectState).toBe('none')
    expect(harness.sessions.cancelConversation).toHaveBeenCalledWith(childId)
  })

  it('serializes child safety so the latest parent authority converges last', async () => {
    harness.parent.permissionMode = 'full_access'
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Serialize live safety',
      prompt: 'Remain active while authority changes.'
    })
    await vi.waitFor(() =>
      expect(repository.listTurns(spawned.delegation.id, 1)[0]?.status).toBe('running')
    )
    const childId = repository.require(spawned.delegation.id).childSessionId!
    const prepareTurn = harness.safety.prepareTurn.getMockImplementation()!
    let releaseFirst!: () => void
    let notifyFirstEntered!: () => void
    const firstEntered = new Promise<void>((resolve) => {
      notifyFirstEntered = resolve
    })
    harness.safety.prepareTurn.mockClear()
    harness.safety.prepareTurn.mockImplementationOnce(async (input) => {
      notifyFirstEntered()
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      return await prepareTurn(input)
    })

    const firstAuthorization = service.beforeToolAuthorization({
      conversationId: childId,
      toolCallId: 'first-safety-call',
      toolName: 'read',
      source: 'agent',
      reviewedExecution: TOOL_EXECUTION.read.parallel
    })
    await firstEntered
    harness.parent.permissionMode = 'default'
    const secondAuthorization = service.beforeToolAuthorization({
      conversationId: childId,
      toolCallId: 'second-safety-call',
      toolName: 'read',
      source: 'agent',
      reviewedExecution: TOOL_EXECUTION.read.parallel
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(harness.safety.prepareTurn).toHaveBeenCalledOnce()

    releaseFirst()
    await expect(firstAuthorization).resolves.toBe('full_access')
    await expect(secondAuthorization).resolves.toBe('default')
    expect(harness.safety.prepareTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ parentPermissionMode: 'default' })
    )
    expect(await harness.sessions.resolveConversationSessionInfo(childId)).toMatchObject({
      permissionMode: 'default'
    })
  })

  it('rejects revoked waiting work before it queues for another permit', async () => {
    await service.stop()
    admission = new AgentInvocationAdmission(1, 10)
    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      safety: harness.safety,
      consent: consentAuthority,
      admission,
      deletionGate
    })
    service.start()

    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Recheck suspended safety',
      prompt: 'Wait for a user interaction before continuing.'
    })
    await vi.waitFor(() =>
      expect(repository.listTurns(spawned.delegation.id, 1)[0]?.status).toBe('running')
    )
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publish({
      sessionId: childId,
      kind: 'blocks',
      updatedAt: 200,
      waitingInteraction: {
        type: 'permission',
        messageId: 'message-revoked',
        toolCallId: 'permission-call',
        actionBlock: {
          type: 'action',
          content: 'permission',
          status: 'pending',
          timestamp: 200
        }
      }
    })
    await vi.waitFor(() => expect(admission.snapshot()).toMatchObject({ active: 0, pending: 0 }))
    const blocker = await admission.acquire({ ownerId: 'other-session' })
    harness.parent.subagentCapability = {
      available: false,
      reason: 'subagents_disabled'
    }

    await expect(service.beforeInteractionContinuation(childId)).rejects.toThrow('unavailable')
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 0 })
    await vi.waitFor(() =>
      expect(repository.require(spawned.delegation.id).status).toBe('interrupted')
    )
    blocker.release()
  })

  it('projects child permission and question waits without settling the turn', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review guarded files',
      prompt: 'Inspect files that may require permission.'
    })
    await vi.waitFor(() =>
      expect(repository.listTurns(spawned.delegation.id, 1)[0]?.status).toBe('running')
    )
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 200, status: 'generating' })
    harness.publish({
      sessionId: childId,
      kind: 'blocks',
      updatedAt: 210,
      waitingInteraction: {
        type: 'permission',
        messageId: 'message-1',
        toolCallId: 'tool-1',
        actionBlock: {
          type: 'action',
          content: 'permission',
          status: 'pending',
          timestamp: 210
        }
      }
    })
    expect(service.inspect('parent', spawned.delegation.id)).toMatchObject({
      delegation: { status: 'waiting_permission' },
      turns: [expect.objectContaining({ status: 'waiting_permission' })]
    })
    const waitingPermissionRevision = repository.require(spawned.delegation.id).revision

    harness.publish({
      sessionId: childId,
      kind: 'blocks',
      updatedAt: 215,
      waitingInteraction: {
        type: 'permission',
        messageId: 'message-1',
        toolCallId: 'tool-1',
        actionBlock: {
          type: 'action',
          content: 'permission',
          status: 'pending',
          timestamp: 215
        }
      }
    })
    expect(repository.require(spawned.delegation.id).revision).toBe(waitingPermissionRevision)

    await expect(service.beforeInteractionContinuation(childId)).resolves.toBe(true)
    harness.publish({
      sessionId: childId,
      kind: 'blocks',
      updatedAt: 220,
      waitingInteraction: null
    })
    expect(repository.listTurns(spawned.delegation.id, 1)[0]?.status).toBe('running')

    harness.publish({
      sessionId: childId,
      kind: 'blocks',
      updatedAt: 230,
      waitingInteraction: {
        type: 'question',
        messageId: 'message-2',
        toolCallId: 'tool-2',
        actionBlock: {
          type: 'action',
          content: 'question',
          status: 'pending',
          timestamp: 230
        }
      }
    })
    expect(repository.listTurns(spawned.delegation.id, 1)[0]?.status).toBe('waiting_question')
  })

  it('releases a waiting child permit and reacquires before continuation', async () => {
    await service.stop()
    admission = new AgentInvocationAdmission(1, 10)
    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      safety: harness.safety,
      consent: consentAuthority,
      admission,
      deletionGate
    })
    service.start()

    const first = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'First review',
      prompt: 'Wait for permission.'
    })
    await vi.waitFor(() =>
      expect(repository.listTurns(first.delegation.id, 1)[0]?.status).toBe('running')
    )
    const firstChildId = repository.require(first.delegation.id).childSessionId!
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 0 })
    harness.publish({
      sessionId: firstChildId,
      kind: 'status',
      updatedAt: 200,
      status: 'generating'
    })

    harness.publish({
      sessionId: firstChildId,
      kind: 'blocks',
      updatedAt: 210,
      waitingInteraction: {
        type: 'permission',
        messageId: 'message-first',
        toolCallId: 'tool-first',
        actionBlock: {
          type: 'action',
          content: 'permission',
          status: 'pending',
          timestamp: 210
        }
      }
    })
    expect(admission.snapshot()).toMatchObject({ active: 0, pending: 0 })

    const second = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Second review',
      prompt: 'Use the released permit.'
    })
    await vi.waitFor(() =>
      expect(repository.listTurns(second.delegation.id, 1)[0]?.status).toBe('running')
    )
    const secondChildId = repository.require(second.delegation.id).childSessionId!
    const continuation = service.beforeInteractionContinuation(firstChildId)
    await vi.waitFor(() => expect(admission.snapshot().pending).toBe(1))

    harness.publishAnswer(secondChildId, 'Second result.', 220)
    harness.publish({
      sessionId: secondChildId,
      kind: 'status',
      updatedAt: 221,
      status: 'idle'
    })
    await expect(continuation).resolves.toBe(true)
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 0 })

    harness.publish({
      sessionId: firstChildId,
      kind: 'blocks',
      updatedAt: 230,
      waitingInteraction: null
    })
    expect(repository.requireTurn(first.turns[0]!.id).status).toBe('running')
    harness.publishAnswer(firstChildId, 'First result.', 240)
    harness.publish({ sessionId: firstChildId, kind: 'status', updatedAt: 241, status: 'idle' })
    await vi.waitFor(() => expect(admission.snapshot().active).toBe(0))
  })

  it('keeps a recovered turn live when waiting suspends a queued lease', async () => {
    await service.stop()
    const created = repository.create({
      id: 'delegation-recovered-wait',
      initialTurnId: 'turn-recovered-wait',
      parentSessionId: 'parent',
      slotId: 'reviewer',
      targetAgentId: 'agent-1',
      title: 'Recovered wait',
      prompt: 'Wait while admission is occupied.',
      now: 100
    })
    harness.addChild('child-recovered-wait', created.delegation.id, 'generating')
    repository.bindChild(created.delegation.id, 'child-recovered-wait', 110)
    repository.markTurnStarted(created.turn.id, 120)
    admission = new AgentInvocationAdmission(1, 10)
    const blocker = await admission.acquire({ ownerId: 'other-session' })
    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      safety: harness.safety,
      consent: consentAuthority,
      admission,
      deletionGate
    })
    service.start()
    await vi.waitFor(() => expect(admission.snapshot().pending).toBe(1))

    harness.publish({
      sessionId: 'child-recovered-wait',
      kind: 'blocks',
      updatedAt: 130,
      waitingInteraction: {
        type: 'question',
        messageId: 'message-recovered',
        toolCallId: 'tool-recovered',
        actionBlock: {
          type: 'action',
          content: 'question',
          status: 'pending',
          timestamp: 130
        }
      }
    })
    await vi.waitFor(() => expect(admission.snapshot().pending).toBe(0))
    expect(repository.requireTurn(created.turn.id).status).toBe('waiting_question')

    blocker.release()
    await expect(service.beforeInteractionContinuation('child-recovered-wait')).resolves.toBe(true)
    harness.publish({
      sessionId: 'child-recovered-wait',
      kind: 'blocks',
      updatedAt: 140,
      waitingInteraction: null
    })
    harness.publishAnswer('child-recovered-wait', 'Recovered result.', 150)
    harness.publish({
      sessionId: 'child-recovered-wait',
      kind: 'status',
      updatedAt: 151,
      status: 'idle'
    })
    await vi.waitFor(() => expect(repository.require(created.delegation.id).status).toBe('idle'))
  })

  it('rejects follow_up while the persistent child is already generating', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review architecture',
      prompt: 'Inspect the first design.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publishAnswer(childId, '## Handoff\nThe first review is complete.', 199)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 200, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))

    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 210, status: 'generating' })
    const beforeMutation = vi.fn()

    await expect(
      service.followUp(
        'parent',
        spawned.delegation.id,
        'Start a second task.',
        undefined,
        beforeMutation
      )
    ).rejects.toThrow('while child session is generating')
    expect(beforeMutation).not.toHaveBeenCalled()
    expect(repository.listTurns(spawned.delegation.id, 10)).toHaveLength(1)
    expect(harness.sessions.sendConversationMessage).toHaveBeenCalledTimes(1)
  })

  it('rejects follow_up after the bound child enters deletion', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Review architecture',
      prompt: 'Inspect the first design.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publishAnswer(childId, '## Handoff\nThe first review is complete.', 199)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 200, status: 'idle' })
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))

    let releaseDeletion!: () => void
    const deleting = deletionGate.runWithSessionDeletion(
      childId,
      async () =>
        await new Promise<void>((resolve) => {
          releaseDeletion = resolve
        })
    )

    await expect(
      service.followUp('parent', spawned.delegation.id, 'Start a task during child deletion.')
    ).rejects.toThrow(`Session is being deleted: ${childId}`)
    expect(repository.listTurns(spawned.delegation.id, 10)).toHaveLength(1)

    releaseDeletion()
    await deleting
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
    const beforeMutation = vi.fn()
    const interrupted = service.interrupt('parent', spawned.delegation.id, beforeMutation)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 300, status: 'idle' })

    await expect(interrupted).resolves.toMatchObject({
      delegation: { status: 'interrupted' },
      turns: [expect.objectContaining({ status: 'interrupted' })]
    })
    expect(harness.sessions.linkSubagentTape).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'cancelled' })
    )
    expect(beforeMutation).toHaveBeenCalledOnce()

    const terminalMutation = vi.fn()
    await expect(
      service.interrupt('parent', spawned.delegation.id, terminalMutation)
    ).resolves.toMatchObject({ delegation: { status: 'interrupted' } })
    expect(terminalMutation).not.toHaveBeenCalled()
  })

  it('interrupts active work before deleting its parent or bound child Session', async () => {
    const childDeletion = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Delete child review',
      prompt: 'Remain active until the child is deleted.'
    })
    await vi.waitFor(() =>
      expect(harness.sessions.sendConversationMessage).toHaveBeenCalledTimes(1)
    )
    const firstChildId = repository.require(childDeletion.delegation.id).childSessionId!

    await service.prepareSessionDeletion(firstChildId)

    expect(repository.require(childDeletion.delegation.id)).toMatchObject({
      status: 'interrupted',
      lastError: 'Interrupted because a related Session was deleted.'
    })
    expect(harness.sessions.cancelConversation).toHaveBeenCalledWith(firstChildId)

    const parentDeletion = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Delete parent review',
      prompt: 'Remain active until the parent is deleted.'
    })
    await vi.waitFor(() =>
      expect(harness.sessions.sendConversationMessage).toHaveBeenCalledTimes(2)
    )
    const secondChildId = repository.require(parentDeletion.delegation.id).childSessionId!

    await service.prepareSessionDeletion('parent')

    expect(repository.require(parentDeletion.delegation.id)).toMatchObject({
      status: 'interrupted',
      lastError: 'Interrupted because a related Session was deleted.'
    })
    expect(harness.sessions.cancelConversation).toHaveBeenCalledWith(secondChildId)
    expect(repository.countActiveByParent('parent')).toBe(0)
  })

  it('fences post-drain spawns while deleting a parent Session', async () => {
    const resolveSessionInfo =
      harness.sessions.resolveConversationSessionInfo.getMockImplementation()!
    let resolveParent!: (parent: ConversationSessionInfo | null) => void
    harness.sessions.resolveConversationSessionInfo.mockImplementationOnce(
      async () =>
        await new Promise<ConversationSessionInfo | null>((resolve) => {
          resolveParent = resolve
        })
    )
    const spawning = service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Race parent deletion',
      prompt: 'Do not create work after the parent deletion fence.'
    })
    await vi.waitFor(() =>
      expect(harness.sessions.resolveConversationSessionInfo).toHaveBeenCalledWith('parent')
    )

    let notifyDeletionEntered!: () => void
    const deletionEntered = new Promise<void>((resolve) => {
      notifyDeletionEntered = resolve
    })
    let releaseDeletion!: () => void
    let didEnterDeletion = false
    const deleting = deletionGate.runWithSessionDeletion('parent', async () => {
      didEnterDeletion = true
      notifyDeletionEntered()
      await service.prepareSessionDeletion('parent')
      await new Promise<void>((resolve) => {
        releaseDeletion = resolve
      })
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(didEnterDeletion).toBe(false)

    resolveParent(await resolveSessionInfo('parent'))
    const spawned = await spawning
    await deletionEntered
    await vi.waitFor(() =>
      expect(repository.require(spawned.delegation.id).status).toBe('interrupted')
    )
    await expect(
      service.spawn('parent', {
        slotId: 'reviewer',
        title: 'Late spawn',
        prompt: 'This must be rejected.'
      })
    ).rejects.toThrow('Session is being deleted: parent')
    expect(repository.countActiveByParent('parent')).toBe(0)

    await vi.waitFor(() => expect(releaseDeletion).toBeTypeOf('function'))
    releaseDeletion()
    await deleting
  })

  it('publishes write-ahead running state before handoff delivery resolves', async () => {
    await service.stop()
    let resolveHandoff!: () => void
    harness.sessions.sendConversationMessage.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          resolveHandoff = resolve
        })
    )
    const publishedStatuses: string[] = []
    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      safety: harness.safety,
      consent: consentAuthority,
      admission: new AgentInvocationAdmission(2, 10),
      deletionGate,
      onChanged: (_parentSessionId, delegationId) => {
        publishedStatuses.push(repository.require(delegationId).status)
      }
    })
    service.start()

    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Slow handoff',
      prompt: 'Wait for delivery.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())

    expect(repository.require(spawned.delegation.id).status).toBe('running')
    expect(publishedStatuses.filter((status) => status === 'running')).toHaveLength(1)

    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publishAnswer(childId, 'Delivered result.', 300)
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 301, status: 'idle' })
    expect(repository.require(spawned.delegation.id).status).toBe('running')

    resolveHandoff()
    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('idle'))
    expect(publishedStatuses.filter((status) => status === 'running')).toHaveLength(1)
  })

  it('settles a write-ahead turn when handoff delivery fails', async () => {
    harness.sessions.sendConversationMessage.mockRejectedValueOnce(new Error('handoff failed'))
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Failed handoff',
      prompt: 'Fail before child execution starts.'
    })

    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('failed'))

    expect(repository.requireTurn(spawned.turns[0]!.id)).toMatchObject({
      status: 'failed',
      error: 'handoff failed'
    })
    expect(repository.countActiveByParent('parent')).toBe(0)
    expect(harness.sessions.linkSubagentTape).not.toHaveBeenCalled()
  })

  it('drains an in-flight child handoff before interrupt returns', async () => {
    let resolveHandoff!: () => void
    harness.sessions.sendConversationMessage.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          resolveHandoff = resolve
        })
    )
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Interrupt child handoff',
      prompt: 'Do not start after the parent interruption.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(spawned.delegation.id).childSessionId!
    expect(repository.requireTurn(spawned.turns[0]!.id).startedAt).not.toBeNull()

    let interruptResolved = false
    const interrupted = service.interrupt('parent', spawned.delegation.id).then((detail) => {
      interruptResolved = true
      return detail
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(interruptResolved).toBe(false)

    resolveHandoff()
    await expect(interrupted).resolves.toMatchObject({
      delegation: { status: 'interrupted' },
      turns: [expect.objectContaining({ status: 'interrupted' })]
    })
    expect(repository.requireTurn(spawned.turns[0]!.id).startedAt).not.toBeNull()
    expect(harness.sessions.cancelConversation).toHaveBeenCalledWith(childId)
    expect(harness.sessions.linkSubagentTape).toHaveBeenCalledWith(
      expect.objectContaining({ childSessionId: childId, outcome: 'cancelled' })
    )
  })

  it('binds and cancels a child that finishes creation after interrupt', async () => {
    let resolveCreation!: (child: ConversationSessionInfo | null) => void
    harness.sessions.createSubagentSession.mockImplementationOnce(
      async () =>
        await new Promise<ConversationSessionInfo | null>((resolve) => {
          resolveCreation = resolve
        })
    )
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Interrupt child creation',
      prompt: 'Do not outlive this interrupted turn.'
    })
    await vi.waitFor(() => expect(harness.sessions.createSubagentSession).toHaveBeenCalledOnce())

    let interruptResolved = false
    const interrupted = service.interrupt('parent', spawned.delegation.id).then((detail) => {
      interruptResolved = true
      return detail
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(interruptResolved).toBe(false)

    const child = harness.addChild('child-created-after-interrupt', spawned.delegation.id, 'idle')
    resolveCreation(child)

    await expect(interrupted).resolves.toMatchObject({
      delegation: {
        childSessionId: child.sessionId,
        status: 'interrupted'
      },
      turns: [expect.objectContaining({ status: 'interrupted' })]
    })
    expect(harness.sessions.cancelConversation).toHaveBeenCalledWith(child.sessionId)
    expect(harness.sessions.sendConversationMessage).not.toHaveBeenCalled()
  })

  it('binds and cancels a recovered child when interrupt races child lookup', async () => {
    let resolveLookup!: (child: ConversationSessionInfo | null) => void
    harness.sessions.findDelegationChild.mockImplementationOnce(
      async () =>
        await new Promise<ConversationSessionInfo | null>((resolve) => {
          resolveLookup = resolve
        })
    )
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Interrupt child lookup',
      prompt: 'Recover an existing child without leaving it active.'
    })
    await vi.waitFor(() => expect(harness.sessions.findDelegationChild).toHaveBeenCalledOnce())

    let interruptResolved = false
    const interrupted = service.interrupt('parent', spawned.delegation.id).then((detail) => {
      interruptResolved = true
      return detail
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(interruptResolved).toBe(false)

    const child = harness.addChild('child-found-after-interrupt', spawned.delegation.id, 'idle')
    resolveLookup(child)

    await expect(interrupted).resolves.toMatchObject({
      delegation: {
        childSessionId: child.sessionId,
        status: 'interrupted'
      },
      turns: [expect.objectContaining({ status: 'interrupted' })]
    })
    expect(harness.sessions.cancelConversation).toHaveBeenCalledWith(child.sessionId)
    expect(harness.sessions.createSubagentSession).not.toHaveBeenCalled()
    expect(harness.sessions.sendConversationMessage).not.toHaveBeenCalled()
  })

  it('drains and cancels child creation before service stop returns', async () => {
    let resolveCreation!: (child: ConversationSessionInfo | null) => void
    harness.sessions.createSubagentSession.mockImplementationOnce(
      async () =>
        await new Promise<ConversationSessionInfo | null>((resolve) => {
          resolveCreation = resolve
        })
    )
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Stop during child creation',
      prompt: 'Do not outlive service shutdown.'
    })
    await vi.waitFor(() => expect(harness.sessions.createSubagentSession).toHaveBeenCalledOnce())

    let stopResolved = false
    const stopping = service.stop().then(() => {
      stopResolved = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(stopResolved).toBe(false)

    const child = harness.addChild('child-created-during-stop', spawned.delegation.id, 'idle')
    resolveCreation(child)
    await stopping

    expect(repository.require(spawned.delegation.id)).toMatchObject({
      childSessionId: child.sessionId,
      status: 'interrupted'
    })
    expect(harness.sessions.cancelConversation).toHaveBeenCalledWith(child.sessionId)
    expect(harness.sessions.sendConversationMessage).not.toHaveBeenCalled()
  })

  it('rechecks durable mailbox events after registering a waiter', async () => {
    const created = repository.create({
      id: 'delegation-wait-race',
      initialTurnId: 'turn-wait-race',
      parentSessionId: 'parent',
      slotId: 'reviewer',
      targetAgentId: 'agent-1',
      title: 'Close waiter race',
      prompt: 'Complete between the first read and waiter registration.',
      now: 100
    })
    const listEvents = repository.listEvents.bind(repository)
    let injected = false
    vi.spyOn(repository, 'listEvents').mockImplementation((parentSessionId, options) => {
      const events = listEvents(parentSessionId, options)
      if (!injected) {
        injected = true
        repository.finishTurn({
          turnId: created.turn.id,
          status: 'completed',
          summary: 'Committed before waiter registration.',
          now: 110
        })
      }
      return events
    })

    let resolved = false
    const waiting = service.wait('parent', { after: 0, timeoutMs: 1_000 }).then((result) => {
      resolved = true
      return result
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(resolved).toBe(true)
    await expect(waiting).resolves.toMatchObject({
      timedOut: false,
      events: [
        expect.objectContaining({
          kind: 'turn_completed',
          contentPreview: 'Committed before waiter registration.'
        })
      ]
    })
  })

  it('fails a completed child turn that has no final answer', async () => {
    const spawned = await service.spawn('parent', {
      slotId: 'reviewer',
      title: 'Require final answer',
      prompt: 'Return a canonical conclusion.'
    })
    await vi.waitFor(() => expect(harness.sessions.sendConversationMessage).toHaveBeenCalledOnce())
    const childId = repository.require(spawned.delegation.id).childSessionId!
    harness.publish({ sessionId: childId, kind: 'status', updatedAt: 200, status: 'idle' })

    await vi.waitFor(() => expect(repository.require(spawned.delegation.id).status).toBe('failed'))
    expect(repository.requireTurn(spawned.turns[0]!.id)).toMatchObject({
      status: 'failed',
      resultSummary: null,
      resultRef: null,
      error: 'Child session completed without a final answer.'
    })
    expect(harness.sessions.linkSubagentTape).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error', resultSummary: null })
    )
    await expect(service.wait('parent', { after: 0, timeoutMs: 0 })).resolves.toMatchObject({
      events: [
        expect.objectContaining({
          kind: 'turn_failed',
          contentPreview: 'Child session completed without a final answer.'
        })
      ]
    })
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
    harness.setAssistantResult('child-recovery', 'Recovered result.', 'recovered-message')

    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      safety: harness.safety,
      consent: consentAuthority,
      admission: new AgentInvocationAdmission(2, 10),
      deletionGate
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

  it('does not reuse an older child answer while recovering a later turn', async () => {
    await service.stop()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const created = repository.create({
      id: 'delegation-stale-result',
      initialTurnId: 'turn-stale-result',
      parentSessionId: 'parent',
      slotId: 'reviewer',
      targetAgentId: 'agent-1',
      title: 'Recover without answer',
      prompt: 'Complete after an older child answer.',
      now: 100
    })
    harness.addChild('child-stale-result', created.delegation.id, 'idle')
    repository.bindChild(created.delegation.id, 'child-stale-result', 110)
    repository.markTurnStarted(created.turn.id, 200)
    harness.setAssistantResult('child-stale-result', 'Older answer.', 'older-message', 150)

    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      safety: harness.safety,
      consent: consentAuthority,
      admission: new AgentInvocationAdmission(2, 10),
      deletionGate
    })
    service.start()
    await vi.waitFor(() => expect(repository.require(created.delegation.id).status).toBe('failed'))

    expect(repository.requireTurn(created.turn.id)).toMatchObject({
      status: 'failed',
      resultSummary: null,
      resultRef: null,
      error: 'Child session completed without a final answer.'
    })
    expect(warnSpy).toHaveBeenCalledWith(
      '[LiveDelegationService] Ignored a stale recovered child result:',
      expect.objectContaining({ turnId: created.turn.id })
    )
  })

  it('indexes active child effects synchronously before restart reconciliation', async () => {
    await service.stop()
    const created = repository.create({
      id: 'delegation-effect-recovery',
      initialTurnId: 'turn-effect-recovery',
      parentSessionId: 'parent',
      slotId: 'reviewer',
      targetAgentId: 'agent-1',
      title: 'Recover effect boundary',
      prompt: 'Continue after restart.',
      now: 100
    })
    harness.addChild('child-effect-recovery', created.delegation.id, 'generating')
    repository.bindChild(created.delegation.id, 'child-effect-recovery', 110)
    repository.markTurnStarted(created.turn.id, 120)

    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      safety: harness.safety,
      consent: consentAuthority,
      admission: new AgentInvocationAdmission(2, 10),
      deletionGate
    })
    service.start()
    await service.beforeToolExecution({
      conversationId: 'child-effect-recovery',
      toolCallId: 'call-after-restart',
      toolName: 'read',
      source: 'agent',
      reviewedExecution: TOOL_EXECUTION.read.parallel
    })

    expect(repository.requireTurn(created.turn.id).effectState).toBe('read')
  })

  it('does not revive a turn interrupted while restart reconciliation is awaiting the child', async () => {
    await service.stop()
    const created = repository.create({
      id: 'delegation-interrupt-recovery',
      initialTurnId: 'turn-interrupt-recovery',
      parentSessionId: 'parent',
      slotId: 'reviewer',
      targetAgentId: 'agent-1',
      title: 'Interrupt recovery',
      prompt: 'Remain stopped after interruption.',
      now: 100
    })
    harness.addChild('child-interrupt-recovery', created.delegation.id, 'generating')
    repository.bindChild(created.delegation.id, 'child-interrupt-recovery', 110)
    repository.markTurnStarted(created.turn.id, 120)
    let resolveLookup: ((child: ConversationSessionInfo | null) => void) | null = null
    harness.sessions.resolveConversationSessionInfo.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLookup = resolve
        })
    )
    const onChanged = vi.fn()

    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      safety: harness.safety,
      consent: consentAuthority,
      admission: new AgentInvocationAdmission(2, 10),
      deletionGate,
      onChanged
    })
    service.start()
    await expect(service.interrupt('parent', created.delegation.id)).resolves.toMatchObject({
      delegation: { status: 'interrupted' }
    })
    resolveLookup?.(
      await harness.sessions.resolveConversationSessionInfo('child-interrupt-recovery')
    )
    await vi.waitFor(() =>
      expect(repository.requireTurn(created.turn.id).status).toBe('interrupted')
    )

    expect(onChanged).toHaveBeenCalledWith('parent', created.delegation.id)
    expect(harness.sessions.cancelConversation).toHaveBeenCalledWith('child-interrupt-recovery')
    await expect(
      service.beforeToolExecution({
        conversationId: 'child-interrupt-recovery',
        toolCallId: 'call-after-interrupt',
        toolName: 'read',
        source: 'agent',
        reviewedExecution: TOOL_EXECUTION.read.parallel
      })
    ).resolves.toBeUndefined()
    expect(repository.requireTurn(created.turn.id).effectState).toBe('none')
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
      safety: harness.safety,
      consent: consentAuthority,
      admission: new AgentInvocationAdmission(2, 10),
      deletionGate
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
    harness.setAssistantResult(
      'child-recovery-healthy',
      'Recovered healthy result.',
      'healthy-message'
    )

    service = new LiveDelegationServiceCtor({
      repository,
      sessions: harness.sessions,
      safety: harness.safety,
      consent: consentAuthority,
      admission: new AgentInvocationAdmission(2, 10),
      deletionGate
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
  const assistantResults = new Map<
    string,
    Map<string, { messageId: string; answerMarkdown: string; updatedAt: number }>
  >()
  const parent = createSessionInfo({
    sessionId: 'parent',
    sessionKind: 'regular',
    parentSessionId: null,
    orchestrationPolicy: 'proactive',
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
    getAssistantResult: vi.fn(async (sessionId: string, messageId?: string) => {
      const results = assistantResults.get(sessionId)
      if (!results) return null
      if (messageId) return results.get(messageId) ?? null
      return [...results.values()].at(-1) ?? null
    })
  }

  const safety = {
    prepareTurn: vi.fn(
      async (input: {
        childSessionId: string
        parentPermissionMode: ConversationSessionInfo['permissionMode']
        projectDir: string | null
        executionSnapshot: {
          providerId: string
          modelId: string
          generationSettings: ConversationSessionInfo['generationSettings']
        } | null
      }) => {
        const child = children.get(input.childSessionId)
        if (!child) return null
        if (input.executionSnapshot) {
          child.providerId = input.executionSnapshot.providerId
          child.modelId = input.executionSnapshot.modelId
          child.generationSettings = input.executionSnapshot.generationSettings
            ? structuredClone(input.executionSnapshot.generationSettings)
            : null
        }
        child.permissionMode = input.parentPermissionMode
        child.projectDir = input.projectDir
        return child
      }
    )
  }

  const setAssistantResult = (
    childId: string,
    answerMarkdown: string,
    messageId: string,
    updatedAt = Date.now()
  ) => {
    const results = assistantResults.get(childId) ?? new Map()
    results.set(messageId, { messageId, answerMarkdown, updatedAt })
    assistantResults.set(childId, results)
  }

  const publish = (update: SessionRuntimeUpdate) => {
    if (update.kind === 'status' && update.status) {
      const child = children.get(update.sessionId)
      if (child) child.status = update.status
    }
    for (const listener of listeners) listener(update)
  }

  return {
    sessions,
    safety,
    parent,
    addChild,
    setAssistantResult,
    publishAnswer(
      childId: string,
      answerMarkdown: string,
      updatedAt: number,
      messageId = `message-${updatedAt}`
    ) {
      setAssistantResult(childId, answerMarkdown, messageId, updatedAt)
      publish({
        sessionId: childId,
        kind: 'blocks',
        updatedAt,
        messageId,
        responseMarkdown: `tool trace that must not become the result\n${answerMarkdown}`,
        deliverySegments: [
          {
            key: `${messageId}:process`,
            kind: 'process',
            text: 'read: tool trace that must not become the result',
            sourceMessageId: messageId
          },
          {
            key: `${messageId}:answer`,
            kind: 'answer',
            text: answerMarkdown,
            sourceMessageId: messageId
          }
        ]
      })
    },
    publish
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
    orchestrationPolicy: 'explicit',
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
