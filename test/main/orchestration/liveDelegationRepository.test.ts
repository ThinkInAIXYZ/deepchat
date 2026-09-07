import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DeepChatLegacyTaskEvaluation } from '@shared/types/task-contract'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'
import {
  createLegacyLiveDelegationTaskContractInput,
  createLiveDelegationTaskContractInput
} from '@/orchestration/liveDelegationTaskContract'
import { canonicalJsonStringifyData, hashJsonData } from '@/tape/domain/canonicalJson'

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
const tapeStoreModule = Database
  ? await import('@/tape/infrastructure/sqlite/tapeEntryStore').catch(() => null)
  : null
const taskContractServiceModule = Database
  ? await import('@/tape/application/taskContractService').catch(() => null)
  : null
const taskEvaluationServiceModule = Database
  ? await import('@/tape/application/taskEvaluationService').catch(() => null)
  : null

const DatabaseCtor = Database!
const LiveDelegationDatabaseCtor = databaseModule?.LiveDelegationDatabase!
const LiveDelegationsTableCtor = delegationsModule?.LiveDelegationsTable!
const LiveDelegationTurnsTableCtor = turnsModule?.LiveDelegationTurnsTable!
const LiveDelegationEventsTableCtor = eventsModule?.LiveDelegationEventsTable!
const LiveDelegationRepositoryCtor = repositoryModule?.LiveDelegationRepository!
const LiveDelegationTaskContractErrorCtor = repositoryModule?.LiveDelegationTaskContractError!
const DeepChatContractStoreCtor = tapeStoreModule?.DeepChatContractStore!
const TaskContractServiceCtor = taskContractServiceModule?.TaskContractService!
const TaskEvaluationServiceCtor = taskEvaluationServiceModule?.TaskEvaluationService!
const CONTRACT_SCHEMA_VERSION = delegationsModule?.LIVE_DELEGATION_CONTRACT_DATABASE_SCHEMA_VERSION!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(
    LiveDelegationDatabaseCtor &&
    LiveDelegationsTableCtor &&
    LiveDelegationTurnsTableCtor &&
    LiveDelegationEventsTableCtor &&
    LiveDelegationRepositoryCtor &&
    LiveDelegationTaskContractErrorCtor &&
    DeepChatContractStoreCtor &&
    TaskContractServiceCtor &&
    TaskEvaluationServiceCtor
  ),
  'Live delegation persistence modules are unavailable'
)

describeIfSqlite('LiveDelegationRepository', () => {
  let db: InstanceType<typeof DatabaseCtor> | null
  let repository: InstanceType<typeof LiveDelegationRepositoryCtor>
  let contractStore: InstanceType<typeof DeepChatContractStoreCtor>

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
    contractStore = new DeepChatContractStoreCtor(db)
    contractStore.createTable()
    repository = new LiveDelegationRepositoryCtor(
      new LiveDelegationDatabaseCtor({ getDatabase: () => db! }),
      new TaskContractServiceCtor(() => contractStore),
      new TaskEvaluationServiceCtor(() => contractStore)
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
      taskContract: createLiveDelegationTaskContractInput(null),
      now: 100
    })
  }

  function completeFormattedAnswer(): string {
    return [
      '## Handoff',
      'Use the reviewed conclusion.',
      '## Result',
      'The boundary is sound.',
      '## Evidence',
      'Repository and Tape facts agree.',
      '## Changed Files',
      'None.',
      '## Validation',
      'Focused tests passed.',
      '## Unresolved',
      'None.'
    ].join('\n')
  }

  function buildPreviousHeadEvaluation(
    taskContractHash: string,
    candidateResult: string,
    executionStatus: DeepChatLegacyTaskEvaluation['executionStatus'] = 'completed'
  ): DeepChatLegacyTaskEvaluation {
    const draft = {
      schemaVersion: 1 as const,
      hashVersion: 1 as const,
      evaluatorVersion: 'task-contract-v1' as const,
      turnId: 'turn-1',
      taskContractHash,
      candidate: {
        kind: 'answer' as const,
        sha256: createHash('sha256').update(candidateResult, 'utf8').digest('hex'),
        utf8Bytes: Buffer.byteLength(candidateResult, 'utf8')
      },
      executionStatus,
      verdict: 'passed' as const,
      disposition: 'accepted' as const,
      reasonCodes: [],
      records: [
        {
          requirementId: 'live-delegation-required-sections',
          requirementKind: 'required_sections' as const,
          outcome: 'passed' as const,
          code: 'required_sections_present' as const,
          section: null,
          instancePath: null,
          keyword: null,
          additionalEvidenceCount: 0
        }
      ],
      omittedRecordCount: 0
    }
    return { ...draft, evaluationHash: hashJsonData(draft) }
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
    expect(created.turn).toMatchObject({
      taskContract: {
        taskDescription: {
          delegationId: 'delegation-1',
          turnId: 'turn-1',
          prompt: 'Review module boundaries.'
        }
      },
      taskContractRef: {
        sessionId: 'parent',
        contractHash: created.turn.taskContract?.contractHash
      },
      inheritedTaskContractRef: null
    })
    const frozenFacts = contractStore
      .getBySession('parent')
      .filter((row) => row.name === 'contract/task_frozen')
    expect(frozenFacts).toHaveLength(1)
    expect(JSON.parse(frozenFacts[0]!.payload_json).data.contract).toEqual(
      created.turn.taskContract
    )
    expect(created.turn.taskContractRef?.entryId).toBe(frozenFacts[0]!.entry_id)
    expect(Object.isFrozen(created.turn.taskContract)).toBe(true)
    expect(Object.isFrozen(created.turn.taskContract?.taskHarness.acceptance)).toBe(true)
    expect(() =>
      repository.create({
        id: 'orphan',
        initialTurnId: 'orphan-turn',
        parentSessionId: 'missing',
        slotId: 'reviewer',
        targetAgentId: 'agent-1',
        title: 'Orphan',
        prompt: 'Do work.',
        taskContract: createLiveDelegationTaskContractInput(null)
      })
    ).toThrow('parent session does not exist')
  })

  it('runs dispatch commits outside host transactions and retains them on mutation failure', () => {
    db!.exec('CREATE TABLE journal_receipts (operation_id TEXT PRIMARY KEY)')
    const transactionStates: boolean[] = []
    const commitReceipt = (operationId: string) => () => {
      transactionStates.push(db!.inTransaction)
      db!.prepare('INSERT INTO journal_receipts (operation_id) VALUES (?)').run(operationId)
    }

    repository.create(
      {
        id: 'delegation-receipt',
        initialTurnId: 'turn-receipt',
        parentSessionId: 'parent',
        slotId: 'reviewer',
        targetAgentId: 'agent-1',
        title: 'Commit before mutation',
        prompt: 'Verify transaction ownership.',
        taskContract: createLiveDelegationTaskContractInput(null),
        now: 101
      },
      commitReceipt('receipt-success')
    )

    expect(() =>
      repository.create(
        {
          id: 'delegation-receipt',
          initialTurnId: 'turn-duplicate',
          parentSessionId: 'parent',
          slotId: 'reviewer',
          targetAgentId: 'agent-1',
          title: 'Duplicate mutation',
          prompt: 'Fail after the receipt commits.',
          taskContract: createLiveDelegationTaskContractInput(null),
          now: 102
        },
        commitReceipt('receipt-before-failure')
      )
    ).toThrow()

    expect(transactionStates).toEqual([false, false])
    expect(
      db!.prepare('SELECT operation_id FROM journal_receipts ORDER BY operation_id').all()
    ).toEqual([{ operation_id: 'receipt-before-failure' }, { operation_id: 'receipt-success' }])
  })

  it('does not commit dispatch when delegation preflight rejects the request', () => {
    const beforeMutation = vi.fn()

    expect(() =>
      repository.create(
        {
          id: 'orphan',
          initialTurnId: 'orphan-turn',
          parentSessionId: 'missing',
          slotId: 'reviewer',
          targetAgentId: 'agent-1',
          title: 'Orphan',
          prompt: 'Do work.',
          taskContract: createLiveDelegationTaskContractInput(null)
        },
        beforeMutation
      )
    ).toThrow('parent session does not exist')
    expect(beforeMutation).not.toHaveBeenCalled()
  })

  it('rolls back the parent fact and runtime rows when contract freeze cannot complete', () => {
    const strictWriter = new TaskContractServiceCtor(() => contractStore)
    const failingRepository = new LiveDelegationRepositoryCtor(
      new LiveDelegationDatabaseCtor({ getDatabase: () => db! }),
      {
        freezeParentTaskContract: (
          input: Parameters<typeof strictWriter.freezeParentTaskContract>[0]
        ) => {
          strictWriter.freezeParentTaskContract(input)
          throw new Error('projection write failed')
        },
        ensureParentTaskContract: (input) => strictWriter.ensureParentTaskContract(input),
        ensureChildTaskContract: (input) => strictWriter.ensureChildTaskContract(input)
      },
      new TaskEvaluationServiceCtor(() => contractStore)
    )

    expect(() =>
      failingRepository.create({
        id: 'delegation-rollback',
        initialTurnId: 'turn-rollback',
        parentSessionId: 'parent',
        slotId: 'reviewer',
        targetAgentId: 'agent-1',
        title: 'Rollback contract',
        prompt: 'Do not leave a partial fact.',
        taskContract: createLiveDelegationTaskContractInput(null),
        now: 100
      })
    ).toThrow('projection write failed')
    expect(failingRepository.get('delegation-rollback')).toBeNull()
    expect(contractStore.getBySession('parent')).toEqual([])
  })

  it('rejects a canonical TaskContract projection bound to different turn content', () => {
    createDelegation()
    db!
      .prepare(
        "UPDATE live_delegation_turns SET prompt = 'Corrupted prompt' WHERE turn_id = 'turn-1'"
      )
      .run()

    expect(() => repository.requireTurn('turn-1')).toThrow(LiveDelegationTaskContractErrorCtor)
    expect(() => repository.requireTurn('turn-1')).toThrow(/misbound TaskContract projection/u)
  })

  it('classifies malformed stored TaskContract JSON as a recoverable contract error', () => {
    createDelegation()
    db!.pragma('ignore_check_constraints = ON')
    try {
      db!
        .prepare(
          "UPDATE live_delegation_turns SET task_contract_json = '{' WHERE turn_id = 'turn-1'"
        )
        .run()
    } finally {
      db!.pragma('ignore_check_constraints = OFF')
    }

    expect(() => repository.requireTurn('turn-1')).toThrow(LiveDelegationTaskContractErrorCtor)
    expect(() => repository.requireTurn('turn-1')).toThrow(
      /Stored live delegation TaskContract is malformed/u
    )
  })

  it('migrates nullable contract projections from the orchestration v64 schema', () => {
    const legacyDb = new DatabaseCtor(':memory:')
    try {
      legacyDb.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
        INSERT INTO schema_versions (version, applied_at) VALUES (64, 1);
        CREATE TABLE new_sessions (
          id TEXT PRIMARY KEY,
          session_kind TEXT NOT NULL DEFAULT 'regular',
          parent_session_id TEXT
        );
      `)
      const delegations = new LiveDelegationsTableCtor(legacyDb)
      const turns = new LiveDelegationTurnsTableCtor(legacyDb)
      delegations.createTable()
      turns.createTable()
      legacyDb.prepare("INSERT INTO new_sessions (id) VALUES ('parent')").run()
      legacyDb
        .prepare(
          `INSERT INTO live_delegations (
             delegation_id, parent_session_id, child_session_id, slot_id, target_agent_id, title,
             status, last_turn_seq, last_summary, last_error, created_at, updated_at, revision
           ) VALUES ('legacy', 'parent', NULL, 'reviewer', 'agent-1', 'Legacy',
             'queued', 1, NULL, NULL, 1, 1, 0)`
        )
        .run()
      legacyDb
        .prepare(
          `INSERT INTO live_delegation_turns (
             turn_id, delegation_id, seq, kind, prompt, status, created_at, updated_at
           ) VALUES ('legacy-turn', 'legacy', 1, 'initial', 'Legacy task', 'queued', 1, 1)`
        )
        .run()

      const beforeColumns = new Set(
        (
          legacyDb.prepare('PRAGMA table_info(live_delegation_turns)').all() as Array<{
            name: string
          }>
        ).map((column) => column.name)
      )
      expect(beforeColumns.has('task_contract_json')).toBe(false)
      const migration = turns.getMigrationSQL(CONTRACT_SCHEMA_VERSION)
      expect(migration).toBeTruthy()
      legacyDb.exec(migration!)

      const afterColumns = new Set(
        (
          legacyDb.prepare('PRAGMA table_info(live_delegation_turns)').all() as Array<{
            name: string
          }>
        ).map((column) => column.name)
      )
      expect(
        [
          'task_contract_json',
          'task_contract_ref_json',
          'inherited_task_contract_ref_json',
          'evaluation_json',
          'evaluation_ref_json'
        ].every((column) => afterColumns.has(column))
      ).toBe(true)
      expect(
        legacyDb
          .prepare(
            `SELECT task_contract_json, task_contract_ref_json,
                    inherited_task_contract_ref_json, evaluation_json, evaluation_ref_json
             FROM live_delegation_turns WHERE turn_id = 'legacy-turn'`
          )
          .get()
      ).toEqual({
        task_contract_json: null,
        task_contract_ref_json: null,
        inherited_task_contract_ref_json: null,
        evaluation_json: null,
        evaluation_ref_json: null
      })
      expect(turns.getMigrationSQL(CONTRACT_SCHEMA_VERSION)).toContain('already present')
    } finally {
      legacyDb.close()
    }
  })

  it('enforces parent active capacity atomically for initial and follow-up turns', () => {
    const createActive = (index: number) =>
      repository.create({
        id: `delegation-${index}`,
        initialTurnId: `turn-${index}`,
        parentSessionId: 'parent',
        slotId: 'reviewer',
        targetAgentId: 'agent-1',
        title: `Review ${index}`,
        prompt: `Inspect boundary ${index}.`,
        taskContract: createLiveDelegationTaskContractInput(null),
        now: 100 + index
      })

    for (let index = 1; index <= 5; index += 1) createActive(index)
    expect(() => createActive(6)).toThrow('at most 5 active live delegations')
    expect(db!.prepare('SELECT COUNT(*) AS count FROM live_delegations').get()).toEqual({
      count: 5
    })
    expect(db!.prepare('SELECT COUNT(*) AS count FROM live_delegation_turns').get()).toEqual({
      count: 5
    })

    repository.finishTurn({ turnId: 'turn-1', status: 'completed', now: 120 })
    const replacement = createActive(6)
    repository.finishTurn({ turnId: replacement.turn.id, status: 'completed', now: 130 })
    createActive(7)
    expect(() =>
      repository.createFollowUp(
        'parent',
        replacement.delegation.id,
        'turn-follow-up',
        'Continue the review.',
        createLiveDelegationTaskContractInput(null),
        140
      )
    ).toThrow('at most 5 active live delegations')
    expect(repository.listTurns(replacement.delegation.id)).toHaveLength(1)
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

  it('inherits one canonical TaskContract into the bound child idempotently', () => {
    const created = createDelegation()
    addSession('child-1', 'parent')
    repository.bindChild(created.delegation.id, 'child-1', 110)

    const first = repository.ensureInheritedTaskContract(created.turn.id, 'child-1', 120)
    const second = repository.ensureInheritedTaskContract(created.turn.id, 'child-1', 130)
    const projected = repository.requireTurn(created.turn.id)
    const childFacts = contractStore
      .getBySession('child-1')
      .filter((row) => row.name === 'contract/task_frozen')

    expect(second).toEqual(first)
    expect(first.contract).toEqual(created.turn.taskContract)
    expect(first.localRef.sessionId).toBe('child-1')
    expect(projected.inheritedTaskContractRef).toEqual(first.localRef)
    expect(childFacts).toHaveLength(1)
    expect(JSON.parse(childFacts[0]!.payload_json).data).toMatchObject({
      delivery: 'child_inherited',
      contract: first.contract,
      originRef: projected.taskContractRef,
      supersedesRef: null
    })
    expect(repository.prepareActiveTaskContractContext('child-1', 140)).toEqual(first)
    expect(repository.prepareActiveTaskContractContext('unbound-child', 140)).toBeNull()
  })

  it('re-anchors parent and child references independently after Tape reset', () => {
    const created = createDelegation()
    addSession('child-1', 'parent')
    repository.bindChild(created.delegation.id, 'child-1', 110)
    repository.ensureInheritedTaskContract(created.turn.id, 'child-1', 120)
    const original = repository.requireTurn(created.turn.id)

    contractStore.runInTransaction(() => {
      db!.prepare('DELETE FROM deepchat_tape_entries WHERE session_id = ?').run('parent')
      contractStore.ensureBootstrapAnchor('parent')
    })
    repository.ensureInheritedTaskContract(created.turn.id, 'child-1', 130)
    const parentRecovered = repository.requireTurn(created.turn.id)

    expect(parentRecovered.taskContractRef?.tapeIdentity).not.toBe(
      original.taskContractRef?.tapeIdentity
    )
    expect(parentRecovered.inheritedTaskContractRef).toEqual(original.inheritedTaskContractRef)
    expect(
      JSON.parse(
        contractStore.getBySession('parent').find((row) => row.name === 'contract/task_frozen')!
          .payload_json
      ).data
    ).toMatchObject({
      delivery: 'projection_recovery',
      supersedesRef: original.taskContractRef
    })

    contractStore.runInTransaction(() => {
      db!.prepare('DELETE FROM deepchat_tape_entries WHERE session_id = ?').run('child-1')
      contractStore.ensureBootstrapAnchor('child-1')
    })
    repository.ensureInheritedTaskContract(created.turn.id, 'child-1', 140)
    const childRecovered = repository.requireTurn(created.turn.id)
    const recoveredChildFact = contractStore
      .getBySession('child-1')
      .find((row) => row.name === 'contract/task_frozen')!

    expect(childRecovered.taskContractRef).toEqual(parentRecovered.taskContractRef)
    expect(childRecovered.inheritedTaskContractRef?.tapeIdentity).not.toBe(
      original.inheritedTaskContractRef?.tapeIdentity
    )
    expect(JSON.parse(recoveredChildFact.payload_json).data).toMatchObject({
      delivery: 'projection_recovery',
      originRef: parentRecovered.taskContractRef,
      supersedesRef: original.inheritedTaskContractRef
    })
  })

  it('rolls back a child fact when its runtime reference cannot be projected', () => {
    const created = createDelegation()
    addSession('child-1', 'parent')
    repository.bindChild(created.delegation.id, 'child-1', 110)
    const strictWriter = new TaskContractServiceCtor(() => contractStore)
    const failingRepository = new LiveDelegationRepositoryCtor(
      new LiveDelegationDatabaseCtor({ getDatabase: () => db! }),
      {
        freezeParentTaskContract: (input) => strictWriter.freezeParentTaskContract(input),
        ensureParentTaskContract: (input) => strictWriter.ensureParentTaskContract(input),
        ensureChildTaskContract: (input) => {
          strictWriter.ensureChildTaskContract(input)
          throw new Error('projection write failed')
        }
      },
      new TaskEvaluationServiceCtor(() => contractStore)
    )

    expect(() =>
      failingRepository.ensureInheritedTaskContract(created.turn.id, 'child-1', 120)
    ).toThrow(/Failed to inherit/u)
    expect(contractStore.getBySession('child-1')).toEqual([])
    expect(repository.requireTurn(created.turn.id).inheritedTaskContractRef).toBeNull()
  })

  it('fails closed when the child-local origin fact is corrupted', () => {
    const created = createDelegation()
    addSession('child-1', 'parent')
    repository.bindChild(created.delegation.id, 'child-1', 110)
    repository.ensureInheritedTaskContract(created.turn.id, 'child-1', 120)
    const fact = contractStore
      .getBySession('child-1')
      .find((row) => row.name === 'contract/task_frozen')!
    const payload = JSON.parse(fact.payload_json)
    payload.data.originRef.contractHash = 'f'.repeat(64)
    db!
      .prepare(
        `UPDATE deepchat_tape_entries SET payload_json = ?
         WHERE session_id = ? AND entry_id = ?`
      )
      .run(JSON.stringify(payload), fact.session_id, fact.entry_id)

    expect(() => repository.ensureInheritedTaskContract(created.turn.id, 'child-1', 130)).toThrow(
      /Failed to inherit/u
    )
  })

  it('fails closed when the runtime projection names another child-local entry', () => {
    const created = createDelegation()
    addSession('child-1', 'parent')
    repository.bindChild(created.delegation.id, 'child-1', 110)
    repository.ensureInheritedTaskContract(created.turn.id, 'child-1', 120)
    const currentRef = repository.requireTurn(created.turn.id).inheritedTaskContractRef!
    db!
      .prepare(
        `UPDATE live_delegation_turns SET inherited_task_contract_ref_json = ?
         WHERE turn_id = ?`
      )
      .run(JSON.stringify({ ...currentRef, entryId: currentRef.entryId + 1 }), created.turn.id)

    expect(() => repository.ensureInheritedTaskContract(created.turn.id, 'child-1', 130)).toThrow(
      /Failed to inherit/u
    )
  })

  it('freezes an explicit compatibility contract for a legacy active turn', () => {
    const created = createDelegation()
    contractStore.runInTransaction(() => {
      db!.prepare('DELETE FROM deepchat_tape_entries WHERE session_id = ?').run('parent')
      db!
        .prepare(
          `UPDATE live_delegation_turns
           SET task_contract_json = NULL, task_contract_ref_json = NULL
           WHERE turn_id = ?`
        )
        .run(created.turn.id)
    })

    const recovered = repository.freezeLegacyTaskContract(
      created.turn.id,
      createLegacyLiveDelegationTaskContractInput('/repo'),
      120
    )

    expect(recovered.turn.taskContract).toMatchObject({
      taskConfig: { creationReason: 'legacy_recovery' },
      taskHarness: { acceptance: [] }
    })
    expect(recovered.turn.taskContractRef?.sessionId).toBe('parent')
    expect(recovered.turn.inheritedTaskContractRef).toBeNull()
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
      createLiveDelegationTaskContractInput(null),
      130
    )
    expect(followUp.turn).toMatchObject({ seq: 2, kind: 'follow_up', status: 'queued' })
    expect(followUp.turn.prompt).toContain('Check the cache boundary.')
    expect(followUp.turn.prompt).toContain('Re-evaluate the conclusion.')
    expect(() =>
      repository.createFollowUp(
        'parent',
        'delegation-1',
        'turn-3',
        'Overlap',
        createLiveDelegationTaskContractInput(null),
        140
      )
    ).toThrow('already has an active turn')
  })

  it('never prunes durable child completion events before a parent reads them', () => {
    createDelegation()
    repository.markTurnStarted('turn-1', 110)
    const insert = db!.prepare(
      `INSERT INTO live_delegation_events (
         delegation_id, parent_session_id, direction, kind, content, related_turn_id,
         consumed_by_turn_id, created_at
       ) VALUES ('delegation-1', 'parent', 'child_to_parent', 'turn_completed', ?, NULL, NULL, ?)`
    )
    for (let index = 0; index < 500; index += 1) {
      insert.run(`historical completion ${index}`, index)
    }

    repository.finishTurn({
      turnId: 'turn-1',
      status: 'completed',
      summary: 'Current completion',
      now: 620
    })

    expect(
      db!
        .prepare(
          `SELECT COUNT(*) AS count, MIN(event_id) AS firstEventId
           FROM live_delegation_events
           WHERE parent_session_id = 'parent' AND direction = 'child_to_parent'`
        )
        .get()
    ).toEqual({ count: 501, firstEventId: 1 })
  })

  it('applies atomic UTF-8 backpressure to the pending mailbox', () => {
    createDelegation()
    repository.finishTurn({ turnId: 'turn-1', status: 'completed', summary: 'Done', now: 110 })

    for (let index = 0; index < 4; index += 1) {
      repository.createMessage('parent', 'delegation-1', 'a'.repeat(8 * 1024))
    }
    expect(() => repository.createMessage('parent', 'delegation-1', 'one byte too many')).toThrow(
      'pending mailbox would exceed 32768 UTF-8 bytes'
    )
    expect(
      db!
        .prepare(
          `SELECT COUNT(*) AS count,
                  SUM(length(CAST(content AS BLOB))) AS bytes
           FROM live_delegation_events
           WHERE direction = 'parent_to_child' AND consumed_by_turn_id IS NULL`
        )
        .get()
    ).toEqual({ count: 4, bytes: 32 * 1024 })
    expect(() => repository.createMessage('parent', 'delegation-1', '界'.repeat(2_731))).toThrow(
      '8192 UTF-8 bytes'
    )
  })

  it('consumes legacy mailbox overflow without poisoning every follow-up retry', () => {
    createDelegation()
    repository.finishTurn({ turnId: 'turn-1', status: 'completed', summary: 'Done', now: 110 })
    const insert = db!.prepare(
      `INSERT INTO live_delegation_events (
         delegation_id, parent_session_id, direction, kind, content, related_turn_id,
         consumed_by_turn_id, created_at
       ) VALUES ('delegation-1', 'parent', 'parent_to_child', 'message', ?, NULL, NULL, ?)`
    )
    for (let index = 0; index < 6; index += 1) {
      insert.run(String(index).repeat(8 * 1024), 120 + index)
    }

    const followUp = repository.createFollowUp(
      'parent',
      'delegation-1',
      'turn-2',
      'Continue with the bounded evidence.',
      createLiveDelegationTaskContractInput(null),
      130
    )

    expect(Buffer.byteLength(followUp.turn.prompt, 'utf8')).toBeLessThanOrEqual(64 * 1024)
    expect(followUp.turn.prompt).toContain('host mailbox limits')
    expect(
      db!
        .prepare(
          `SELECT COUNT(*) AS count FROM live_delegation_events
           WHERE direction = 'parent_to_child' AND consumed_by_turn_id IS NULL`
        )
        .get()
    ).toEqual({ count: 0 })
  })

  it('preserves queued messages when the full follow-up task leaves no notice budget', () => {
    createDelegation()
    repository.finishTurn({ turnId: 'turn-1', status: 'completed', summary: 'Done', now: 110 })
    repository.createMessage('parent', 'delegation-1', 'Keep this evidence.')

    expect(() =>
      repository.createFollowUp(
        'parent',
        'delegation-1',
        'turn-2',
        'x'.repeat(64 * 1024),
        createLiveDelegationTaskContractInput(null),
        120
      )
    ).toThrow('leaves no room for queued messages or their recovery notice')
    expect(repository.listTurns('delegation-1')).toHaveLength(1)
    expect(
      db!
        .prepare(
          `SELECT COUNT(*) AS count FROM live_delegation_events
           WHERE direction = 'parent_to_child' AND consumed_by_turn_id IS NULL`
        )
        .get()
    ).toEqual({ count: 1 })
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
    addSession('child-1', 'parent')
    repository.bindChild('delegation-1', 'child-1', 105)
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
      resultRef: {
        schemaVersion: 1,
        childSessionId: 'child-1',
        childMessageId: 'message-1',
        answerSha256: createHash('sha256').update('Architecture is sound.').digest('hex'),
        answerBytes: Buffer.byteLength('Architecture is sound.', 'utf8'),
        answerEstimatedTokens: 5,
        handoffSource: 'final_answer',
        handoffTruncated: false
      },
      tapeReceipt: receipt,
      candidateResult: 'Architecture is sound.',
      now: 120
    })
    const retry = repository.finishTurn({
      turnId: 'turn-1',
      status: 'completed',
      candidateResult: 'Architecture is sound.',
      now: 130
    })

    expect(() =>
      repository.finishTurn({
        turnId: 'turn-1',
        status: 'failed',
        error: 'late error',
        now: 140
      })
    ).toThrow('Terminal evaluation retry conflicts')

    expect(first.delegation.status).toBe('idle')
    expect(first.turn.resultRef).toMatchObject({
      childSessionId: 'child-1',
      childMessageId: 'message-1'
    })
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

  it('atomically projects one canonical evaluation after re-anchoring a reset parent Tape', () => {
    const created = createDelegation()
    repository.markTurnStarted(created.turn.id, 110)
    const originalContractRef = created.turn.taskContractRef!
    contractStore.runInTransaction(() => {
      db!.prepare('DELETE FROM deepchat_tape_entries WHERE session_id = ?').run('parent')
      contractStore.ensureBootstrapAnchor('parent')
    })

    const settled = repository.finishTurn({
      turnId: created.turn.id,
      status: 'completed',
      summary: 'Use the reviewed conclusion.',
      candidateResult: completeFormattedAnswer(),
      now: 120
    })
    const event = repository.listEvents('parent')[0]!
    const facts = contractStore.getBySession('parent')
    const frozenFact = facts.find((entry) => entry.name === 'contract/task_frozen')!
    const evaluatedFact = facts.find((entry) => entry.name === 'contract/evaluated')!
    const evaluatedPayload = JSON.parse(evaluatedFact.payload_json).data

    expect(settled.delegation.status).toBe('idle')
    expect(settled.turn).toMatchObject({
      status: 'completed',
      evaluation: {
        evaluationKind: 'handoff_format',
        formatStatus: 'valid',
        executionStatus: 'completed'
      }
    })
    expect(settled.turn.taskContractRef?.tapeIdentity).not.toBe(originalContractRef.tapeIdentity)
    expect(settled.turn.taskContractRef?.entryId).toBe(frozenFact.entry_id)
    expect(settled.turn.evaluationRef).toMatchObject({
      sessionId: 'parent',
      tapeIdentity: settled.turn.taskContractRef?.tapeIdentity,
      entryId: evaluatedFact.entry_id,
      evaluationHash: settled.turn.evaluation?.evaluationHash
    })
    expect(evaluatedPayload).toEqual({
      schemaVersion: 1,
      evaluation: settled.turn.evaluation,
      taskContractRef: settled.turn.taskContractRef
    })
    expect(event.evaluation).toEqual(settled.turn.evaluation)
    expect(event.evaluationRef).toEqual(settled.turn.evaluationRef)
  })

  it('reads and retries previous-head evaluations without rewriting their Tape binding', () => {
    const created = createDelegation()
    const answer = completeFormattedAnswer()
    const taskContract = created.turn.taskContract!
    const taskContractRef = created.turn.taskContractRef!
    const evaluation = buildPreviousHeadEvaluation(taskContract.contractHash, answer)
    const evaluationRow = contractStore.runInTransaction(() =>
      contractStore.appendContractEvent({
        sessionId: 'parent',
        name: 'contract/evaluated',
        source: { type: 'subagent', id: created.turn.id, seq: created.turn.seq },
        provenanceKey: `contract:evaluated:v1:${created.turn.id}`,
        data: { schemaVersion: 1, evaluation, taskContractRef },
        meta: { protocolVersion: 1 },
        createdAt: 120,
        idempotent: false
      })
    )
    const evaluationRef = {
      schemaVersion: 1 as const,
      sessionId: 'parent',
      tapeIdentity: taskContractRef.tapeIdentity,
      entryId: evaluationRow.entry_id,
      evaluationHash: evaluation.evaluationHash
    }
    const evaluationJson = canonicalJsonStringifyData(evaluation)
    const evaluationRefJson = canonicalJsonStringifyData(evaluationRef)
    db!.transaction(() => {
      db!
        .prepare(
          `UPDATE live_delegation_turns
           SET status = 'completed', result_summary = ?, evaluation_json = ?,
               evaluation_ref_json = ?, updated_at = 120, completed_at = 120
           WHERE turn_id = ?`
        )
        .run('Use the reviewed conclusion.', evaluationJson, evaluationRefJson, created.turn.id)
      db!
        .prepare(
          `UPDATE live_delegations
           SET status = 'idle', last_summary = ?, updated_at = 120, revision = revision + 1
           WHERE delegation_id = ?`
        )
        .run('Use the reviewed conclusion.', created.delegation.id)
      db!
        .prepare(
          `INSERT INTO live_delegation_events (
             delegation_id, parent_session_id, direction, kind, content, related_turn_id,
             evaluation_json, evaluation_ref_json, created_at
           ) VALUES (?, 'parent', 'child_to_parent', 'turn_completed', ?, ?, ?, ?, 120)`
        )
        .run(
          created.delegation.id,
          'Use the reviewed conclusion.',
          created.turn.id,
          evaluationJson,
          evaluationRefJson
        )
    })()

    const before = {
      turn: db!
        .prepare(
          `SELECT evaluation_json, evaluation_ref_json
           FROM live_delegation_turns WHERE turn_id = ?`
        )
        .get(created.turn.id),
      event: db!
        .prepare(
          `SELECT evaluation_json, evaluation_ref_json
           FROM live_delegation_events WHERE related_turn_id = ?`
        )
        .get(created.turn.id),
      fact: contractStore.getByProvenanceKey('parent', `contract:evaluated:v1:${created.turn.id}`)
    }

    expect(repository.requireTurn(created.turn.id)).toMatchObject({
      status: 'completed',
      evaluation,
      evaluationRef
    })
    expect(repository.listEvents('parent')).toEqual([
      expect.objectContaining({ evaluation, evaluationRef })
    ])
    expect(
      repository.finishTurn({
        turnId: created.turn.id,
        status: 'completed',
        candidateResult: answer,
        now: 130
      }).turn
    ).toMatchObject({ evaluation, evaluationRef })
    expect(() =>
      repository.finishTurn({
        turnId: created.turn.id,
        status: 'failed',
        candidateResult: answer,
        now: 140
      })
    ).toThrow('Terminal evaluation retry conflicts')
    expect(() =>
      repository.finishTurn({
        turnId: created.turn.id,
        status: 'completed',
        candidateResult: `${answer}\nchanged`,
        now: 150
      })
    ).toThrow('Terminal evaluation retry conflicts')

    const after = {
      turn: db!
        .prepare(
          `SELECT evaluation_json, evaluation_ref_json
           FROM live_delegation_turns WHERE turn_id = ?`
        )
        .get(created.turn.id),
      event: db!
        .prepare(
          `SELECT evaluation_json, evaluation_ref_json
           FROM live_delegation_events WHERE related_turn_id = ?`
        )
        .get(created.turn.id),
      fact: contractStore.getByProvenanceKey('parent', `contract:evaluated:v1:${created.turn.id}`)
    }
    expect(after).toEqual(before)
    expect(
      contractStore.getBySession('parent').filter((row) => row.name === 'contract/evaluated')
    ).toHaveLength(1)
    expect(repository.listEvents('parent')).toHaveLength(1)

    const followUp = repository.createFollowUp(
      'parent',
      created.delegation.id,
      'turn-2',
      'Check the remaining edge case.',
      createLiveDelegationTaskContractInput(null),
      160
    )
    expect(followUp.turn.taskContract?.taskConfig.predecessorEvaluationRef).toEqual(evaluationRef)
  })

  it('rolls back evaluation fact, terminal projection, and mailbox event together', () => {
    const created = createDelegation()
    repository.markTurnStarted(created.turn.id, 110)
    const strictEvaluationWriter = new TaskEvaluationServiceCtor(() => contractStore)
    const failingRepository = new LiveDelegationRepositoryCtor(
      new LiveDelegationDatabaseCtor({ getDatabase: () => db! }),
      new TaskContractServiceCtor(() => contractStore),
      {
        commitTaskEvaluation: (input) => {
          strictEvaluationWriter.commitTaskEvaluation(input)
          throw new Error('terminal projection failed')
        }
      }
    )

    expect(() =>
      failingRepository.finishTurn({
        turnId: created.turn.id,
        status: 'completed',
        candidateResult: completeFormattedAnswer(),
        now: 120
      })
    ).toThrow('terminal projection failed')

    expect(repository.require(created.delegation.id).status).toBe('running')
    expect(repository.requireTurn(created.turn.id)).toMatchObject({
      status: 'running',
      evaluation: null,
      evaluationRef: null
    })
    expect(repository.listEvents('parent')).toEqual([])
    expect(
      contractStore.getBySession('parent').filter((entry) => entry.name === 'contract/evaluated')
    ).toEqual([])
  })

  it('rejects an evaluation reference from another parent Tape incarnation', () => {
    const created = createDelegation()
    repository.markTurnStarted(created.turn.id, 110)
    const settled = repository.finishTurn({
      turnId: created.turn.id,
      status: 'completed',
      candidateResult: completeFormattedAnswer(),
      now: 120
    })
    const evaluationRef = settled.turn.evaluationRef!
    const conflictingTapeIdentity = `${evaluationRef.tapeIdentity === '0'.repeat(64) ? '1' : '0'}${evaluationRef.tapeIdentity.slice(1)}`
    db!
      .prepare(
        `UPDATE live_delegation_turns
         SET evaluation_ref_json = ?
         WHERE turn_id = ?`
      )
      .run(
        JSON.stringify({ ...evaluationRef, tapeIdentity: conflictingTapeIdentity }),
        created.turn.id
      )

    expect(() => repository.requireTurn(created.turn.id)).toThrow(
      'has a misbound evaluation projection'
    )
  })

  it('rejects a terminal contract projection that has no evaluation', () => {
    const created = createDelegation()
    db!
      .prepare(
        `UPDATE live_delegation_turns
       SET status = 'completed', completed_at = 120, updated_at = 120
       WHERE turn_id = ?`
      )
      .run(created.turn.id)

    expect(() =>
      repository.finishTurn({
        turnId: created.turn.id,
        status: 'completed',
        candidateResult: completeFormattedAnswer(),
        now: 130
      })
    ).toThrow('has no Task evaluation')
  })

  it('binds a follow-up contract to the immediately preceding evaluation', () => {
    const created = createDelegation()
    repository.markTurnStarted(created.turn.id, 110)
    const settled = repository.finishTurn({
      turnId: created.turn.id,
      status: 'completed',
      candidateResult: completeFormattedAnswer(),
      now: 120
    })

    const followUp = repository.createFollowUp(
      'parent',
      created.delegation.id,
      'turn-2',
      'Check the remaining edge case.',
      createLiveDelegationTaskContractInput(null),
      130
    )

    expect(followUp.turn.taskContract?.taskConfig.predecessorEvaluationRef).toEqual(
      settled.turn.evaluationRef
    )
  })
})
