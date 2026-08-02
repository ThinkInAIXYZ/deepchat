import { afterEach, beforeEach, expect, it } from 'vitest'
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

const DatabaseCtor = Database!
const LiveDelegationDatabaseCtor = databaseModule?.LiveDelegationDatabase!
const LiveDelegationsTableCtor = delegationsModule?.LiveDelegationsTable!
const LiveDelegationTurnsTableCtor = turnsModule?.LiveDelegationTurnsTable!
const LiveDelegationEventsTableCtor = eventsModule?.LiveDelegationEventsTable!
const LiveDelegationRepositoryCtor = repositoryModule?.LiveDelegationRepository!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(
    LiveDelegationDatabaseCtor &&
    LiveDelegationsTableCtor &&
    LiveDelegationTurnsTableCtor &&
    LiveDelegationEventsTableCtor &&
    LiveDelegationRepositoryCtor
  ),
  'Live delegation persistence modules are unavailable'
)

describeIfSqlite('LiveDelegationRepository', () => {
  let db: InstanceType<typeof DatabaseCtor> | null
  let repository: InstanceType<typeof LiveDelegationRepositoryCtor>

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE new_sessions (
        id TEXT PRIMARY KEY,
        session_kind TEXT NOT NULL DEFAULT 'regular',
        parent_session_id TEXT
      );
    `)
    new LiveDelegationsTableCtor(db).createTable()
    new LiveDelegationTurnsTableCtor(db).createTable()
    new LiveDelegationEventsTableCtor(db).createTable()
    repository = new LiveDelegationRepositoryCtor(
      new LiveDelegationDatabaseCtor({ getDatabase: () => db! })
    )
    addSession('parent')
  })

  afterEach(() => {
    db?.close()
    db = null
  })

  function addSession(id: string, parentSessionId: string | null = null): void {
    db!
      .prepare(
        `INSERT INTO new_sessions (id, session_kind, parent_session_id)
         VALUES (?, ?, ?)`
      )
      .run(id, parentSessionId ? 'subagent' : 'regular', parentSessionId)
  }

  function createDelegation() {
    return repository.create({
      id: 'delegation-1',
      initialTurnId: 'turn-1',
      parentSessionId: 'parent',
      slotId: 'reviewer',
      targetAgentId: 'agent-1',
      title: 'Review architecture',
      prompt: 'Review module boundaries.',
      now: 100
    })
  }

  it('persists the thread and initial turn before child binding', () => {
    const created = createDelegation()

    expect(created).toMatchObject({
      delegation: {
        id: 'delegation-1',
        childSessionId: null,
        status: 'queued',
        lastTurnSeq: 1
      },
      turn: {
        id: 'turn-1',
        seq: 1,
        kind: 'initial',
        status: 'queued',
        effectState: 'none',
        effectEvidence: null
      }
    })
    expect(repository.listActiveTurns()).toHaveLength(1)
    expect(() =>
      repository.create({
        id: 'orphan',
        initialTurnId: 'orphan-turn',
        parentSessionId: 'missing',
        slotId: 'reviewer',
        targetAgentId: 'agent-1',
        title: 'Orphan',
        prompt: 'Do work.'
      })
    ).toThrow('parent session does not exist')
  })

  it('binds a child exactly once', () => {
    createDelegation()
    addSession('child-1', 'parent')
    addSession('child-2', 'parent')

    expect(repository.bindChild('delegation-1', 'child-1', 110).childSessionId).toBe('child-1')
    expect(repository.bindChild('delegation-1', 'child-1', 120).childSessionId).toBe('child-1')
    expect(() => repository.bindChild('delegation-1', 'child-2', 130)).toThrow(
      'already bound to another child session'
    )
  })

  it('rejects unrelated children and removes owned history with the parent session', () => {
    createDelegation()
    addSession('other-parent')
    addSession('unrelated-child', 'other-parent')

    expect(() => repository.bindChild('delegation-1', 'unrelated-child', 110)).toThrow(
      'child session is invalid'
    )
    db!.prepare('DELETE FROM new_sessions WHERE id = ?').run('parent')
    expect(repository.get('delegation-1')).toBeNull()
    expect(db!.prepare('SELECT COUNT(*) AS count FROM live_delegation_turns').get()).toEqual({
      count: 0
    })
  })

  it('keeps messages non-triggering until a follow-up consumes them', () => {
    createDelegation()
    repository.markTurnStarted('turn-1', 110)
    repository.finishTurn({
      turnId: 'turn-1',
      status: 'completed',
      summary: 'Initial result',
      now: 120
    })

    const message = repository.createMessage('parent', 'delegation-1', 'Check the cache boundary.')
    expect(message).toMatchObject({ direction: 'parent_to_child', kind: 'message' })
    expect(repository.listTurns('delegation-1')).toHaveLength(1)
    expect(repository.listEvents('parent')).toHaveLength(1)

    const followUp = repository.createFollowUp(
      'parent',
      'delegation-1',
      'turn-2',
      'Re-evaluate the conclusion.',
      130
    )
    expect(followUp.turn).toMatchObject({ seq: 2, kind: 'follow_up', status: 'queued' })
    expect(followUp.turn.prompt).toContain('Check the cache boundary.')
    expect(followUp.turn.prompt).toContain('Re-evaluate the conclusion.')
    expect(() =>
      repository.createFollowUp('parent', 'delegation-1', 'turn-3', 'Overlap', 140)
    ).toThrow('already has an active turn')
  })

  it('persists monotonic tool effect evidence before child execution', () => {
    createDelegation()
    repository.markTurnStarted('turn-1', 110)

    expect(
      repository.recordEffectIntent(
        'turn-1',
        'read',
        {
          toolId: 'read',
          toolCallId: 'call-read',
          source: 'builtin',
          basis: 'reviewed_contract',
          classification: 'read',
          reason: 'Reviewed read-only contract.'
        },
        120
      )
    ).toMatchObject({ turn: { effectState: 'read' } })
    const readRevision = repository.require('delegation-1').revision
    expect(
      repository.recordEffectIntent(
        'turn-1',
        'read',
        {
          toolId: 'glob',
          toolCallId: 'call-glob',
          source: 'builtin',
          basis: 'reviewed_contract',
          classification: 'read',
          reason: 'Reviewed read-only contract.'
        },
        130
      )
    ).toBeNull()
    expect(repository.require('delegation-1').revision).toBe(readRevision)

    repository.recordEffectIntent(
      'turn-1',
      'unknown',
      {
        toolId: 'future_tool',
        toolCallId: 'call-unknown',
        source: 'unknown',
        basis: 'conservative_fallback',
        classification: 'unknown',
        reason: 'No reviewed execution contract.'
      },
      140
    )
    repository.recordEffectIntent(
      'turn-1',
      'write',
      {
        toolId: 'remote_mutation',
        toolCallId: 'call-write',
        source: 'mcp',
        basis: 'conservative_fallback',
        classification: 'write',
        reason: 'Arbitrary MCP tools are conservatively classified as write.'
      },
      150
    )

    expect(repository.requireTurn('turn-1')).toMatchObject({
      effectState: 'write',
      effectEvidence: {
        toolId: 'remote_mutation',
        toolCallId: 'call-write',
        classification: 'write'
      }
    })
    repository.finishTurn({ turnId: 'turn-1', status: 'completed', now: 160 })
    expect(() =>
      repository.recordEffectIntent('turn-1', 'write', {
        toolId: 'exec',
        source: 'shell',
        basis: 'reviewed_contract',
        classification: 'write',
        reason: 'Shell execution may change external state.'
      })
    ).toThrow('could not be persisted before tool execution')
  })

  it('settles once and exposes bounded child-to-parent mailbox events', () => {
    createDelegation()
    repository.markTurnStarted('turn-1', 110)
    const receipt = {
      linkEntry: { sessionId: 'parent', entryId: 3 },
      childSessionId: 'child-1',
      childHeadEntryId: 8,
      childEntryCount: 6,
      outcome: 'completed' as const
    }
    const first = repository.finishTurn({
      turnId: 'turn-1',
      status: 'completed',
      summary: 'Architecture is sound.',
      tapeReceipt: receipt,
      now: 120
    })
    const retry = repository.finishTurn({
      turnId: 'turn-1',
      status: 'failed',
      error: 'late error',
      now: 130
    })

    expect(first.delegation.status).toBe('idle')
    expect(first.turn.tapeReceipt).toEqual(receipt)
    expect(retry.turn.status).toBe('completed')
    expect(repository.listEvents('parent', { after: 0 })).toEqual([
      expect.objectContaining({
        id: 1,
        kind: 'turn_completed',
        content: 'Architecture is sound.'
      })
    ])
    expect(repository.listEvents('parent', { after: 1 })).toEqual([])
  })
})
