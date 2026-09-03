import {
  DatabaseCtor,
  DeepChatExecutionJournalStore,
  SqliteTapeLifecycleAdapter,
  createRecord,
  createTapeTableMock,
  describe,
  expect,
  itIfSqlite,
  vi
} from './tapeTestHarness'
import { SUMMARY_ANCHOR_NAMES, TAPE_INCARNATION_META_KEY } from '@/tape/domain/entry'
import { hashSkillEffectiveContent } from '@/tape/domain/skillMaterialization'
import { ExecutionJournalService } from '@/tape/application/executionJournalService'
import { TapeSkillMaterializationService } from '@/tape/application/skillMaterializationService'
import { DeepChatContractStore } from '@/tape/infrastructure/sqlite/tapeEntryStore'

/**
 * `createTapeTableMock` is a second implementation of the Tape entry store. Every method it
 * implements with its own logic is exercised here against the SQLite store on identical input,
 * so a store change that is not mirrored in the mock fails in CI instead of silently letting
 * mock-backed suites drift from production semantics.
 */

type MockTable = ReturnType<typeof createTapeTableMock>['table']
type Store = DeepChatExecutionJournalStore | MockTable

const SESSION = 's1'
const OTHER_SESSION = 's2'

function openStores() {
  const db = new DatabaseCtor(':memory:')
  const real = new DeepChatExecutionJournalStore(db)
  real.createTable()
  const { table: mock } = createTapeTableMock()
  // Appends without an explicit `createdAt` stamp `Date.now()` on both sides.
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
  return {
    real,
    mock,
    // The Contract writer is a sibling store class over the same table.
    realContract: new DeepChatContractStore(db),
    realLifecycle: new SqliteTapeLifecycleAdapter(db),
    close: () => {
      clock.mockRestore()
      db.close()
    }
  }
}

/** Parses JSON columns and masks the random bootstrap incarnation so rows compare by content. */
function normalize(value: unknown): unknown {
  if (value instanceof Map) return normalize([...value.entries()])
  if (value !== null && typeof value === 'object' && Symbol.iterator in value) {
    return [...(value as Iterable<unknown>)].map(normalize)
  }
  if (value === null || typeof value !== 'object') return value
  const row = value as Record<string, unknown>
  if (typeof row.payload_json !== 'string' || typeof row.meta_json !== 'string') return value
  const maskIncarnation = (json: string) => {
    const parsed = JSON.parse(json) as Record<string, unknown>
    if (typeof parsed[TAPE_INCARNATION_META_KEY] === 'string') {
      parsed[TAPE_INCARNATION_META_KEY] = '<incarnation>'
    }
    return parsed
  }
  return {
    ...row,
    payload_json: maskIncarnation(row.payload_json),
    meta_json: maskIncarnation(row.meta_json)
  }
}

function expectParity(
  stores: { real: Store; mock: Store },
  reads: Record<string, (store: Store) => unknown>
) {
  for (const [label, read] of Object.entries(reads)) {
    expect(normalize(read(stores.mock)), label).toEqual(normalize(read(stores.real)))
  }
}

/**
 * `ensureBootstrapAnchor` mints a random incarnation on each side; content-addressed facts
 * (skill materialization) hash it, so the shared fixture pins the bootstrap explicitly and lets
 * the store's own bootstrap become a no-op.
 */
function bootstrap(store: Store, sessionId: string, incarnation: string) {
  store.appendAnchor({
    sessionId,
    name: 'session/start',
    source: { type: 'session', id: sessionId, seq: 0 },
    state: { owner: 'human' },
    meta: { [TAPE_INCARNATION_META_KEY]: incarnation },
    idempotent: true
  })
  store.ensureBootstrapAnchor(sessionId)
}

function seedConversation(store: Store) {
  bootstrap(store, SESSION, '00000000-0000-4000-8000-000000000001')
  store.append({
    sessionId: SESSION,
    kind: 'message',
    name: 'message/user',
    source: { type: 'message', id: 'm1', seq: 0 },
    payload: { record: createRecord({ id: 'm1', orderSeq: 1 }) },
    meta: { status: 'sent' },
    createdAt: 100,
    idempotent: true
  })
  store.append({
    sessionId: SESSION,
    kind: 'tool_call',
    name: 'read_file',
    source: { type: 'assistant_block', id: 'tc1', seq: 0 },
    payload: { arguments: { path: '/tmp/a' } },
    meta: { messageId: 'a1' },
    createdAt: 110
  })
  store.append({
    sessionId: SESSION,
    kind: 'tool_result',
    name: 'read_file',
    source: { type: 'assistant_block', id: 'tc1', seq: 1 },
    payload: { response: 'Alpha Needle content' },
    meta: { messageId: 'a1', status: 'success' },
    createdAt: 120
  })
  store.append({
    sessionId: SESSION,
    kind: 'message',
    name: 'message/assistant',
    source: { type: 'message', id: 'a1', seq: 0 },
    payload: { record: createRecord({ id: 'a1', orderSeq: 2, role: 'assistant' }) },
    meta: { status: 'sent' },
    createdAt: 130
  })
  store.appendEvent({
    sessionId: SESSION,
    name: 'view/assembled',
    source: { type: 'runtime_event', id: 'a1', seq: 1 },
    data: { requestSeq: 1, marker: 'manifest one' },
    createdAt: 131
  })
  store.appendEvent({
    sessionId: SESSION,
    name: 'view/assembled',
    source: { type: 'runtime_event', id: 'a1', seq: 2 },
    data: { requestSeq: 2, marker: 'manifest two' },
    createdAt: 132
  })
  store.append({
    sessionId: SESSION,
    kind: 'message',
    name: 'message/user',
    source: { type: 'message', id: 'm2', seq: 0 },
    payload: { record: createRecord({ id: 'm2', orderSeq: 3 }) },
    meta: { status: 'sent' },
    createdAt: 140
  })
  store.appendEvent({
    sessionId: SESSION,
    name: 'message/retracted',
    source: { type: 'message', id: 'm2', seq: 0 },
    data: { reason: 'user_delete' },
    createdAt: 150
  })
  store.appendAnchor({
    sessionId: SESSION,
    name: 'compaction/auto',
    source: { type: 'runtime_event', id: 'compact-1', seq: 0 },
    state: { cursorOrderSeq: 2 },
    createdAt: 160
  })
  store.appendAnchor({
    sessionId: SESSION,
    name: 'handoff/plan',
    source: { type: 'runtime_event', id: 'handoff-1', seq: 0 },
    state: { phase: 'implement' },
    createdAt: 170
  })
  store.appendEvent({
    sessionId: SESSION,
    name: 'subagent/tape_linked',
    source: { type: 'subagent', id: 'child-1', seq: 0 },
    data: { childSessionId: 'child-1', frozenHeadEntryId: 4 },
    createdAt: 180
  })
  store.appendProviderAttemptEvent({
    sessionId: SESSION,
    name: 'provider/attempt_completed',
    source: { type: 'runtime_event', id: 'a1', seq: 1 },
    data: { schemaVersion: 2, messageId: 'a1', requestSeq: 1, physicalAttempt: 1 },
    createdAt: 190
  })
  store.appendToolSurfaceEvent({
    sessionId: SESSION,
    name: 'view/tool_surface',
    source: { type: 'runtime_event', id: 'a1', seq: 1 },
    data: { surfaceHash: 'f'.repeat(64) },
    createdAt: 191
  })
  store.appendCompactionModelCallEvent({
    sessionId: SESSION,
    name: 'compaction/model_call_completed',
    source: { type: 'runtime_event', id: 'compact-1', seq: 0 },
    data: { usage: { totalTokens: 12 } },
    createdAt: 192
  })
  // The strict materialization writer is the only producer of `context` rows.
  const fixtureHash = hashSkillEffectiveContent('fixture')
  new TapeSkillMaterializationService({
    getSkillMaterializationStore: () => store as DeepChatExecutionJournalStore
  }).materializeSkillContexts([
    {
      sessionId: SESSION,
      expectedTapeIncarnationId: store.getBootstrapIncarnation(SESSION)!,
      agentId: 'agent-1',
      sourceType: 'builtin',
      sourceId: 'skill-1',
      skillName: 'contract-fixture',
      effectiveContent: 'hidden skill Needle',
      builderVersion: 'test-builder',
      renderedManifestHash: fixtureHash,
      scriptInventoryHash: fixtureHash,
      executionPackage: {
        files: [],
        executables: [],
        runtimePolicy: { python: 'auto', node: 'auto' },
        environmentBindingId: null
      }
    }
  ])

  bootstrap(store, OTHER_SESSION, '00000000-0000-4000-8000-000000000002')
  store.append({
    sessionId: OTHER_SESSION,
    kind: 'message',
    name: 'message/user',
    source: { type: 'message', id: 'other-1', seq: 0 },
    payload: { record: createRecord({ id: 'other-1', sessionId: OTHER_SESSION }) },
    meta: { status: 'sent' },
    createdAt: 200
  })
}

describe('Tape table mock contract', () => {
  itIfSqlite('appends rows with the same ids, provenance keys and idempotency', () => {
    const stores = openStores()
    try {
      for (const store of [stores.real, stores.mock]) seedConversation(store)

      expectParity(stores, {
        session: (store) => store.getBySession(SESSION),
        otherSession: (store) => store.getBySession(OTHER_SESSION),
        unknownSession: (store) => store.getBySession('missing'),
        byEntryId: (store) => store.getByEntryId(SESSION, 3),
        missingEntryId: (store) => store.getByEntryId(SESSION, 999),
        byEntryIds: (store) => store.getByEntryIds(SESSION, [2, 4, 999]),
        provenanceHit: (store) =>
          store.getByProvenanceKey(SESSION, 'message:m1:0:message:message/user'),
        provenanceMiss: (store) =>
          store.getByProvenanceKey(SESSION, 'message:m1:0:message:missing'),
        maxEntryId: (store) => store.getMaxEntryId(SESSION),
        maxEntryIdExcludingContext: (store) => store.getMaxEntryIdExcludingContext(SESSION),
        maxEntryIdUnknown: (store) => store.getMaxEntryId('missing'),
        maxEntryIdsBySessions: (store) =>
          store.getMaxEntryIdsBySessions([SESSION, OTHER_SESSION, 'missing']),
        firstEntries: (store) => store.getFirstEntriesBySessions([OTHER_SESSION, SESSION, SESSION]),
        count: (store) => store.countBySession(SESSION),
        anchorCount: (store) => store.countAnchorsBySession(SESSION),
        countAfter: (store) => store.countEntriesAfter(SESSION, 5)
      })

      const duplicate = {
        sessionId: SESSION,
        kind: 'message' as const,
        name: 'message/user',
        source: { type: 'message' as const, id: 'm1', seq: 0 },
        payload: { record: { changed: true } },
        createdAt: 999,
        idempotent: true
      }
      expectParity(stores, {
        idempotentReplay: (store) => store.append(duplicate),
        sessionAfterReplay: (store) => store.getBySession(SESSION)
      })
    } finally {
      stores.close()
    }
  })

  itIfSqlite('bootstraps and reads anchors identically', () => {
    const stores = openStores()
    try {
      for (const store of [stores.real, stores.mock]) {
        seedConversation(store)
        // An empty session gets a fresh `session/start` with a store-minted incarnation.
        store.ensureBootstrapAnchor('fresh')
        // A session whose first anchor is not `session/start` is already bootstrapped.
        store.appendAnchor({
          sessionId: 'anchored',
          name: 'compaction/manual',
          source: { type: 'runtime_event', id: 'manual', seq: 0 },
          state: {},
          createdAt: 300
        })
        store.ensureBootstrapAnchor('anchored')
        for (const [index, name] of SUMMARY_ANCHOR_NAMES.entries()) {
          store.appendAnchor({
            sessionId: 'summaries',
            name,
            source: { type: 'runtime_event', id: `summary-${index}`, seq: 0 },
            state: { index },
            createdAt: 400 + index
          })
        }
      }

      expectParity(stores, {
        incarnation: (store) => store.getBootstrapIncarnation(SESSION),
        freshIncarnationShape: (store) => typeof store.getBootstrapIncarnation('fresh'),
        freshSession: (store) => store.getBySession('fresh'),
        incarnationMissing: (store) => store.getBootstrapIncarnation('missing'),
        incarnationWithoutSessionStart: (store) => store.getBootstrapIncarnation('anchored'),
        anchoredSession: (store) => store.getBySession('anchored'),
        latestAnchor: (store) => store.getLatestAnchor(SESSION),
        latestAnchorMissing: (store) => store.getLatestAnchor('missing'),
        anchors: (store) => store.getAnchors(SESSION),
        anchorsLimited: (store) => store.getAnchors(SESSION, 2),
        anchorsClampedLow: (store) => store.getAnchors(SESSION, 0),
        latestSummaryAnchor: (store) => store.getLatestSummaryAnchor(SESSION),
        latestSummaryAnchorAcrossNames: (store) => store.getLatestSummaryAnchor('summaries'),
        latestSummaryAnchorMissing: (store) => store.getLatestSummaryAnchor(OTHER_SESSION)
      })
    } finally {
      stores.close()
    }
  })

  itIfSqlite('rejects appends that cross a namespace boundary with the same errors', () => {
    const stores = openStores()
    try {
      const outcome = (run: () => unknown) => {
        try {
          run()
          return 'accepted'
        } catch (error) {
          return String(error)
        }
      }
      const reserved = [
        { kind: 'event', name: 'execution/run_started' },
        { kind: 'event', name: 'contract/task_frozen' },
        { kind: 'event', name: 'view/tool_surface' },
        { kind: 'event', name: 'view/programmatic_tool_surface' },
        { kind: 'context', name: 'skill/materialized' },
        { kind: 'context', name: 'anything' },
        { kind: 'event', name: 'provider/attempt_completed' },
        { kind: 'event', name: 'compaction/model_call_completed' }
      ] as const
      const sameRejection = (label: string, real: () => unknown, mock: () => unknown) => {
        const rejection = outcome(real)
        expect(outcome(mock), label).toBe(rejection)
        expect(rejection, label).not.toBe('accepted')
      }
      for (const { kind, name } of reserved) {
        const input = { sessionId: SESSION, kind, name, payload: {} }
        sameRejection(
          `generic append of ${kind}:${name}`,
          () => stores.real.append(input),
          () => stores.mock.append(input)
        )
      }
      // A strict writer may not step outside its own facts either.
      const foreign = { sessionId: SESSION, name: 'view/assembled', data: {} } as never
      sameRejection(
        'journal writer',
        () => stores.real.appendExecutionJournalEvent(foreign),
        () => stores.mock.appendExecutionJournalEvent(foreign)
      )
      sameRejection(
        'contract writer',
        () => stores.realContract.appendContractEvent(foreign),
        () => stores.mock.appendContractEvent(foreign)
      )
      sameRejection(
        'tool-surface writer',
        () => stores.real.appendToolSurfaceEvent(foreign),
        () => stores.mock.appendToolSurfaceEvent(foreign)
      )
      sameRejection(
        'provider-attempt writer',
        () => stores.real.appendProviderAttemptEvent(foreign),
        () => stores.mock.appendProviderAttemptEvent(foreign)
      )
      sameRejection(
        'compaction-usage writer',
        () => stores.real.appendCompactionModelCallEvent(foreign),
        () => stores.mock.appendCompactionModelCallEvent(foreign)
      )
      expectParity(stores, { session: (store) => store.getBySession(SESSION) })
    } finally {
      stores.close()
    }
  })

  itIfSqlite('reads events, message sources and effective-view inputs identically', () => {
    const stores = openStores()
    try {
      for (const store of [stores.real, stores.mock]) seedConversation(store)

      expectParity(stores, {
        eventsBySource: (store) =>
          store.getEventsBySource(SESSION, 'view/assembled', 'runtime_event', 'a1', 2),
        latestEventBySource: (store) =>
          store.getLatestEventBySource(SESSION, 'view/assembled', 'runtime_event', 'a1', 1),
        latestEventMissing: (store) =>
          store.getLatestEventBySource(SESSION, 'view/assembled', 'runtime_event', 'a1', 9),
        eventsBySourceId: (store) =>
          store.getEventsBySourceId(SESSION, 'view/assembled', 'runtime_event', 'a1'),
        maxEventSourceSeq: (store) =>
          store.getMaxEventSourceSeq(SESSION, 'view/assembled', 'runtime_event', 'a1'),
        maxEventSourceSeqMissing: (store) =>
          store.getMaxEventSourceSeq(SESSION, 'view/assembled', 'runtime_event', 'nope'),
        viewManifestsByMessage: (store) => store.getViewManifestEventsByMessage(SESSION, 'a1'),
        messageSources: (store) => store.getMessageSourceEntries(SESSION, 'm2'),
        messageSourcesMissing: (store) => store.getMessageSourceEntries(SESSION, 'nope'),
        excludingContext: (store) => store.getBySessionExcludingContext(SESSION),
        effectiveViewInputs: (store) => store.getEffectiveViewInputRows(SESSION),
        lineage: (store) => store.getSubagentLineageEvents(SESSION),
        effectiveSearchAtHeads: (store) =>
          store.searchEffectiveSourcesAtHeads(
            [
              { sessionId: SESSION, maxEntryId: store.getMaxEntryId(SESSION) },
              { sessionId: OTHER_SESSION, maxEntryId: store.getMaxEntryId(OTHER_SESSION) }
            ],
            'hello'
          ),
        effectiveSearchBelowHead: (store) =>
          store.searchEffectiveSourcesAtHeads([{ sessionId: SESSION, maxEntryId: 3 }], 'needle'),
        effectiveContextWindow: (store) =>
          store.getEffectiveContextRowsAtHead(
            { sessionId: SESSION, maxEntryId: store.getMaxEntryId(SESSION) },
            [2],
            { before: 1, after: 3, limit: 10 }
          ),
        effectiveContextRetracted: (store) =>
          store.getEffectiveContextRowsAtHead(
            { sessionId: SESSION, maxEntryId: store.getMaxEntryId(SESSION) },
            [8],
            { before: 0, after: 0, limit: 10 }
          )
      })
    } finally {
      stores.close()
    }
  })

  itIfSqlite('searches raw entries with the same predicate, filters and ordering', () => {
    const stores = openStores()
    try {
      for (const store of [stores.real, stores.mock]) seedConversation(store)

      expectParity(stores, {
        phrase: (store) => store.search(SESSION, 'Needle'),
        caseInsensitive: (store) => store.search(SESSION, 'needle'),
        tokensAcrossFields: (store) => store.search(SESSION, 'alpha content'),
        tokensPartialMiss: (store) => store.search(SESSION, 'alpha missing-token'),
        kindsFilter: (store) => store.search(SESSION, 'manifest', { kinds: ['event'] }),
        kindsExcluding: (store) => store.search(SESSION, 'manifest', { kinds: ['message'] }),
        createdAtWindow: (store) =>
          store.search(SESSION, 'manifest', { startCreatedAt: 132, endCreatedAt: 132 }),
        limit: (store) => store.search(SESSION, 'a1', { limit: 2 }),
        emptyQuery: (store) => store.search(SESSION, '   '),
        noMatch: (store) => store.search(SESSION, 'definitely-absent'),
        contextHidden: (store) => store.search(SESSION, 'hidden skill')
      })
    } finally {
      stores.close()
    }
  })

  itIfSqlite('rolls back nested transactions to the same state', () => {
    const stores = openStores()
    try {
      const run = (store: Store) => {
        store.ensureBootstrapAnchor(SESSION)
        const outcome: string[] = []
        store.runInTransaction(() => {
          store.appendEvent({
            sessionId: SESSION,
            name: 'outer/kept',
            source: { type: 'runtime_event', id: 'outer', seq: 0 },
            data: {},
            createdAt: 1
          })
          try {
            store.runInTransaction(() => {
              store.appendEvent({
                sessionId: SESSION,
                name: 'inner/rolled_back',
                source: { type: 'runtime_event', id: 'inner', seq: 0 },
                data: {},
                createdAt: 2
              })
              throw new Error('inner failure')
            })
          } catch (error) {
            outcome.push(String(error))
          }
          outcome.push(`inTransaction=${store.isInTransaction()}`)
        })
        outcome.push(`afterCommit=${store.isInTransaction()}`)
        try {
          store.runInTransaction(() => {
            store.appendEvent({
              sessionId: SESSION,
              name: 'outer/rolled_back',
              source: { type: 'runtime_event', id: 'outer-2', seq: 0 },
              data: {},
              createdAt: 3
            })
            throw new Error('outer failure')
          })
        } catch (error) {
          outcome.push(String(error))
        }
        return outcome
      }

      expectParity(stores, {
        outcome: run,
        session: (store) => store.getBySession(SESSION)
      })
    } finally {
      stores.close()
    }
  })

  itIfSqlite('recovers execution journal runs and nested operations identically', () => {
    const stores = openStores()
    try {
      const RUNS = {
        open: '11111111-1111-4111-8111-111111111111',
        nested: '22222222-2222-4222-8222-222222222222',
        closed: '33333333-3333-4333-8333-333333333333'
      }
      const drive = (store: Store) => {
        const journal = new ExecutionJournalService(() => store as DeepChatExecutionJournalStore)
        const start = (runId: string, messageId: string, createdAt: number) =>
          journal.commitRunStarted({
            sessionId: SESSION,
            runId,
            messageId,
            runKind: 'loop',
            createdAt
          })
        const dispatch = (runId: string, messageId: string, createdAt: number) =>
          journal.commitDispatch({
            sessionId: SESSION,
            messageId,
            operation: { runId, requestSeq: 1, providerToolCallId: 'call_0' },
            toolName: 'write',
            toolSource: 'agent',
            normalizedArguments: { path: '/tmp/file' },
            target: { serverName: 'agent-filesystem', originalName: 'write' },
            createdAt
          })

        // Two unterminated runs interleave so the recovery order across runs is part of the
        // contract, not an artifact of one run finishing before the next starts.
        start(RUNS.open, 'assistant-open', 100)
        start(RUNS.nested, 'assistant-nested', 200)
        dispatch(RUNS.open, 'assistant-open', 110)
        dispatch(RUNS.nested, 'assistant-nested', 210)
        for (const childOrdinal of [0, 1]) {
          journal.commitNestedDispatch({
            sessionId: SESSION,
            messageId: 'assistant-nested',
            operation: {
              kind: 'nested',
              runId: RUNS.nested,
              requestSeq: 1,
              providerToolCallId: 'call_0',
              childOrdinal
            },
            toolName: 'search',
            toolSource: 'mcp',
            normalizedArguments: { query: `child ${childOrdinal}` },
            target: { serverName: 'search-server', originalName: 'search' },
            definitionHash: '1'.repeat(64),
            capabilityHash: '2'.repeat(64),
            createdAt: 220 + childOrdinal
          })
        }
        journal.commitNestedToolOutcome({
          sessionId: SESSION,
          messageId: 'assistant-nested',
          operation: {
            kind: 'nested',
            runId: RUNS.nested,
            requestSeq: 1,
            providerToolCallId: 'call_0',
            childOrdinal: 0
          },
          isError: false,
          responseText: 'child result',
          createdAt: 230
        })

        start(RUNS.closed, 'assistant-closed', 300)
        dispatch(RUNS.closed, 'assistant-closed', 310)
        journal.commitToolOutcome({
          sessionId: SESSION,
          messageId: 'assistant-closed',
          operation: { runId: RUNS.closed, requestSeq: 1, providerToolCallId: 'call_0' },
          isError: false,
          responseText: 'written',
          createdAt: 320
        })
        journal.commitRunTerminal({
          sessionId: SESSION,
          runId: RUNS.closed,
          messageId: 'assistant-closed',
          outcome: 'completed',
          stopReason: 'end_turn',
          createdAt: 330
        })
      }
      for (const store of [stores.real, stores.mock]) drive(store)

      const parentKey = (store: Store) =>
        store
          .getBySession(SESSION)
          .find(
            (row) =>
              row.name === 'execution/dispatch_committed' &&
              row.source_id === RUNS.nested &&
              row.provenance_key?.startsWith('execution:v1:operation:')
          )!
          .provenance_key!.split(':')[3]

      expectParity(stores, {
        unterminated: (store) => store.listUnterminatedRunEvents(),
        nestedForRun: (store) => store.listNestedOperationEventsForRun(SESSION, RUNS.nested),
        nestedForRunWithoutChildren: (store) =>
          store.listNestedOperationEventsForRun(SESSION, RUNS.open),
        nestedForMessage: (store) =>
          store.listNestedOperationEventsForMessage(SESSION, 'assistant-nested', 10),
        nestedForMessageLimited: (store) =>
          store.listNestedOperationEventsForMessage(SESSION, 'assistant-nested', 1),
        nestedForParent: (store) =>
          store.listNestedOperationEventsForParent(
            SESSION,
            RUNS.nested,
            1,
            'call_0',
            parentKey(store)
          ),
        messageIdsWithNested: (store) =>
          store.listMessageIdsWithNestedOperationEvents(SESSION, [
            'assistant-open',
            'assistant-nested',
            'assistant-closed'
          ])
      })
    } finally {
      stores.close()
    }
  })

  itIfSqlite('deletes a session without touching its neighbours', () => {
    const stores = openStores()
    try {
      for (const store of [stores.real, stores.mock]) seedConversation(store)
      stores.realLifecycle.deleteBySession(SESSION)
      stores.mock.deleteBySession(SESSION)
      expectParity(stores, {
        deleted: (store) => store.getBySession(SESSION),
        neighbour: (store) => store.getBySession(OTHER_SESSION)
      })
    } finally {
      stores.close()
    }
  })
})
