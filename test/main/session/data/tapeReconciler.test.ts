import {
  describe,
  expect,
  it,
  vi,
  buildContext,
  toAppSessionId,
  SessionTape,
  appendMessageRecordToTape,
  appendMessageReplacementToTape,
  appendMessageRetractionToTape,
  createTapeTableMock,
  createRecord,
  createTapeService
} from './tapeTestHarness'
import {
  TAPE_TOOL_RESULT_PAYLOAD_HASH_VERSION,
  buildTapeToolResultPayloadHash
} from '@/tape/domain/toolSurfaceFacts'
import { TOOL_SEARCH_AGENT_TOOL_NAME } from '@shared/agentTools'

describe('SessionTape reconciliation and facts', () => {
  it('uses the explicit replacement revision kind instead of the reason text', () => {
    const { table, entries } = createTapeTableMock()
    appendMessageReplacementToTape(
      table as any,
      createRecord({ id: 'record-revision', orderSeq: 7, updatedAt: 300 }),
      { reason: 'compaction_order_shifted', revisionKind: 'record' }
    )
    appendMessageReplacementToTape(
      table as any,
      createRecord({ id: 'order-revision', orderSeq: 7, updatedAt: 300 }),
      { reason: 'test_edit', revisionKind: 'order' }
    )

    expect(entries.find((entry) => entry.source_id === 'record-revision')?.provenance_key).toBe(
      'message:record-revision:revision:300'
    )
    expect(entries.find((entry) => entry.source_id === 'order-revision')?.provenance_key).toBe(
      'message:order-revision:revision:300:order_seq:7'
    )
  })

  it('keeps unkeyed idempotent harness appends distinct like the SQLite store', () => {
    const { table, entries } = createTapeTableMock()
    const input = {
      sessionId: 's1',
      kind: 'event',
      name: 'unkeyed',
      payload: { value: 1 },
      idempotent: true
    }

    table.append(input)
    table.append(input)

    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.entry_id)).toEqual([1, 2])
  })

  it('backfills message and tool facts idempotently before returning tape records', () => {
    const { table, entries } = createTapeTableMock()
    const assistantBlocks = [
      {
        type: 'tool_call',
        status: 'success',
        timestamp: 120,
        tool_call: { id: 'tc1', name: 'search', params: '{"q":"x"}', response: 'result' }
      }
    ]
    const records = [
      createRecord({
        id: 'a1',
        orderSeq: 2,
        role: 'assistant',
        content: JSON.stringify(assistantBlocks),
        createdAt: 120,
        updatedAt: 120
      }),
      createRecord({ id: 'u1', orderSeq: 1 })
    ]
    const messageStore = {
      getMessages: vi.fn().mockReturnValue(records)
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const first = service.ensureSessionTapeReady('s1', messageStore as any)
    const second = service.ensureSessionTapeReady('s1', messageStore as any)

    expect(first.historyRecords.map((record) => record.id)).toEqual(['u1', 'a1'])
    expect(second.historyRecords.map((record) => record.id)).toEqual(['u1', 'a1'])
    expect(records.map((record) => record.id)).toEqual(['a1', 'u1'])
    expect(entries.filter((entry) => entry.kind === 'message')).toHaveLength(2)
    expect(entries.filter((entry) => entry.kind === 'tool_call')).toHaveLength(1)
    expect(entries.filter((entry) => entry.kind === 'tool_result')).toHaveLength(1)
    expect(entries.filter((entry) => entry.name === 'migration/backfill')).toHaveLength(1)
  })

  it('keeps A to B to A tool result revisions effective during backfill', () => {
    const { table, entries } = createTapeTableMock()
    let response = 'response-a'
    let updatedAt = 100
    const messageStore = {
      getMessages: vi.fn(() => [
        createRecord({
          id: 'a1',
          orderSeq: 2,
          role: 'assistant',
          status: 'error',
          content: JSON.stringify([
            {
              type: 'tool_call',
              status: 'error',
              timestamp: 90,
              tool_call: {
                id: 'tc1',
                name: 'search',
                params: '{"q":"x"}',
                response
              }
            }
          ]),
          updatedAt
        })
      ])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    service.ensureSessionTapeReady('s1', messageStore as any)
    response = 'response-b'
    updatedAt = 200
    service.ensureSessionTapeReady('s1', messageStore as any)
    response = 'response-a'
    updatedAt = 300
    service.ensureSessionTapeReady('s1', messageStore as any)

    const resultRows = entries.filter((entry) => entry.kind === 'tool_result')
    expect(resultRows.map((row) => JSON.parse(row.payload_json).response)).toEqual([
      'response-a',
      'response-b',
      'response-a'
    ])
    expect(resultRows.slice(1).every((row) => row.provenance_key.includes(':after_entry:'))).toBe(
      true
    )
    expect(entries.filter((entry) => entry.kind === 'tool_call')).toHaveLength(1)
    expect(service.search('s1', 'response-a', { kinds: ['tool_result'] })).toHaveLength(1)
    expect(service.search('s1', 'response-b', { kinds: ['tool_result'] })).toEqual([])
  })

  it('keeps a reverted live tool result as the latest immutable revision', () => {
    const { table, entries } = createTapeTableMock()
    const record = (response: string, updatedAt: number) =>
      createRecord({
        id: 'a1',
        orderSeq: 2,
        role: 'assistant',
        content: JSON.stringify([
          {
            type: 'tool_call',
            status: 'success',
            timestamp: 90,
            tool_call: {
              id: 'tc1',
              name: 'search',
              params: '{"q":"x"}',
              response
            }
          }
        ]),
        updatedAt
      })

    appendMessageRecordToTape(table as any, record('response-a', 100), 'live')
    appendMessageReplacementToTape(table as any, record('response-b', 200), {
      reason: 'content_repaired',
      revisionKind: 'record'
    })
    appendMessageReplacementToTape(table as any, record('response-a', 300), {
      reason: 'content_repaired',
      revisionKind: 'record'
    })

    const resultRows = entries.filter((entry) => entry.kind === 'tool_result')
    expect(resultRows.map((row) => JSON.parse(row.payload_json).response)).toEqual([
      'response-a',
      'response-b',
      'response-a'
    ])
    expect(JSON.parse(resultRows.at(-1).payload_json).response).toBe('response-a')
  })

  it('keeps status-only and result-name changes as immutable tool revisions', () => {
    const { table, entries } = createTapeTableMock()
    const record = (status: 'success' | 'error', name: string, updatedAt: number) =>
      createRecord({
        id: 'a1',
        orderSeq: 2,
        role: 'assistant',
        content: JSON.stringify([
          {
            type: 'tool_call',
            status,
            timestamp: 90,
            tool_call: {
              id: 'tc1',
              name,
              params: '{"q":"x"}',
              response: 'stable response'
            }
          }
        ]),
        updatedAt
      })

    appendMessageRecordToTape(table as any, record('error', 'search', 100), 'live')
    appendMessageReplacementToTape(table as any, record('success', 'search', 200), {
      reason: 'content_repaired',
      revisionKind: 'record'
    })
    appendMessageReplacementToTape(table as any, record('success', 'lookup', 300), {
      reason: 'content_repaired',
      revisionKind: 'record'
    })

    const callRows = entries.filter((entry) => entry.kind === 'tool_call')
    const resultRows = entries.filter((entry) => entry.kind === 'tool_result')
    expect(callRows.map((row) => JSON.parse(row.meta_json).status)).toEqual([
      'error',
      'success',
      'success'
    ])
    expect(resultRows.map((row) => JSON.parse(row.meta_json).status)).toEqual([
      'error',
      'success',
      'success'
    ])
    expect(resultRows.map((row) => row.name)).toEqual(['search', 'search', 'lookup'])
  })

  it('appends live tool facts through the stable recorder port idempotently', async () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = {
      sessionId: toAppSessionId('s1'),
      messageId: 'a1',
      orderSeq: 2,
      blockIndex: 0,
      block: {
        type: 'tool_call' as const,
        status: 'success' as const,
        timestamp: 120,
        tool_call: { id: 'tc1', name: 'search', params: '{"q":"x"}', response: 'result' }
      },
      provenance: { source: 'tool_call' as const, sourceId: 'a1:tc1', sequence: 0 }
    }

    const first = await service.appendToolFact(input)
    const second = await service.appendToolFact(input)

    expect(second).toEqual(first)
    expect(first.toolResult).toBeNull()
    expect(entries.filter((entry) => entry.kind === 'tool_call')).toHaveLength(1)
    expect(JSON.parse(entries.find((entry) => entry.kind === 'tool_call').meta_json)).toEqual({
      source: 'live',
      role: 'assistant',
      status: 'success',
      reason: 'tool_loop'
    })
  })

  it('returns physical result provenance only for a canonical Tape incarnation', async () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = {
      sessionId: toAppSessionId('s1'),
      messageId: 'a1',
      orderSeq: 2,
      blockIndex: 0,
      block: {
        type: 'tool_call' as const,
        status: 'success' as const,
        timestamp: 120,
        tool_call: {
          id: 'tc1',
          name: TOOL_SEARCH_AGENT_TOOL_NAME,
          params: '{}',
          response: '{"results":[]}'
        }
      },
      provenance: { source: 'tool_result' as const, sourceId: 'a1:tc1', sequence: 0 }
    }

    const receipt = await service.appendToolFact(input)
    const row = entries.find((entry) => entry.entry_id === receipt.entryId)!

    expect(receipt.toolResult).toEqual({
      sessionId: 's1',
      tapeIncarnationId: '00000000-0000-4000-8000-000000000001',
      entryId: row.entry_id,
      payloadHashVersion: TAPE_TOOL_RESULT_PAYLOAD_HASH_VERSION,
      payloadHash: buildTapeToolResultPayloadHash(JSON.parse(row.payload_json))
    })

    const failedInput = {
      ...input,
      block: {
        ...input.block,
        status: 'error' as const,
        tool_call: { ...input.block.tool_call, id: 'tc-failed' }
      },
      provenance: { source: 'tool_result' as const, sourceId: 'a1:tc-failed', sequence: 1 }
    }
    const failedReceipt = await service.appendToolFact(failedInput)
    const idempotentSuccessReceipt = await service.appendToolFact({
      ...failedInput,
      block: { ...failedInput.block, status: 'success' }
    })
    expect(failedReceipt.toolResult).toBeNull()
    expect(idempotentSuccessReceipt.toolResult).toBeNull()
    expect(
      entries.filter(
        (entry) =>
          entry.kind === 'tool_result' && entry.source_id === failedInput.provenance.sourceId
      )
    ).toHaveLength(1)

    const ordinaryResult = await service.appendToolFact({
      ...input,
      block: {
        ...input.block,
        tool_call: { ...input.block.tool_call, id: 'tc2', name: 'ordinary_tool' }
      },
      provenance: { source: 'tool_result', sourceId: 'a1:tc2', sequence: 1 }
    })
    expect(ordinaryResult.toolResult).toBeNull()

    const legacy = createTapeTableMock()
    legacy.table.appendAnchor({
      sessionId: 'legacy',
      name: 'session/start',
      source: { type: 'session', id: 'legacy', seq: 0 },
      state: { owner: 'human' },
      meta: {},
      idempotent: true
    })
    const legacyService = createTapeService(legacy.table)
    const legacyReceipt = await legacyService.appendToolFact({
      ...input,
      sessionId: toAppSessionId('legacy')
    })
    expect(legacyReceipt.toolResult).toBeNull()
    expect(legacy.entries.some((entry) => entry.kind === 'tool_result')).toBe(true)

    const noncanonical = createTapeTableMock()
    noncanonical.table.appendAnchor({
      sessionId: 'noncanonical',
      name: 'legacy/start',
      source: { type: 'session', id: 'noncanonical', seq: 0 },
      state: { owner: 'human' },
      meta: { tapeIncarnationId: '00000000-0000-4000-8000-000000000099' },
      idempotent: true
    })
    const noncanonicalReceipt = await createTapeService(noncanonical.table).appendToolFact({
      ...input,
      sessionId: toAppSessionId('noncanonical')
    })
    expect(noncanonicalReceipt.toolResult).toBeNull()

    const malformed = createTapeTableMock()
    const append = malformed.table.append.getMockImplementation()!
    malformed.table.append.mockImplementation((appendInput: any) => {
      const appended = append(appendInput)
      if (appended.kind === 'tool_result') appended.payload_json = '[]'
      return appended
    })
    const malformedReceipt = await createTapeService(malformed.table).appendToolFact({
      ...input,
      sessionId: toAppSessionId('malformed')
    })
    expect(malformedReceipt.toolResult).toBeNull()

    const malformedMeta = createTapeTableMock()
    const appendWithMalformedMeta = malformedMeta.table.append.getMockImplementation()!
    malformedMeta.table.append.mockImplementation((appendInput: any) => {
      const appended = appendWithMalformedMeta(appendInput)
      if (appended.kind === 'tool_result') appended.meta_json = '[]'
      return appended
    })
    const malformedMetaReceipt = await createTapeService(malformedMeta.table).appendToolFact({
      ...input,
      sessionId: toAppSessionId('malformed-meta')
    })
    expect(malformedMetaReceipt.toolResult).toBeNull()
  })

  it('keeps legacy context builder output stable after tape backfill projection', () => {
    const { table } = createTapeTableMock()
    const records = [
      createRecord({ id: 'u1', orderSeq: 1 }),
      createRecord({
        id: 'a1',
        orderSeq: 2,
        role: 'assistant',
        content: JSON.stringify([
          { type: 'content', content: 'Tool finished', status: 'success', timestamp: 120 },
          {
            type: 'tool_call',
            status: 'success',
            timestamp: 121,
            tool_call: {
              id: 'tc1',
              name: 'example_tool',
              params: '{"foo":"bar"}',
              response: 'All good'
            }
          }
        ]),
        createdAt: 120,
        updatedAt: 121
      })
    ]
    const legacyMessageStore = {
      getMessages: vi.fn().mockReturnValue(records)
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const legacyContext = buildContext(
      's1',
      { text: 'next', files: [] },
      'System',
      10000,
      4096,
      legacyMessageStore as any
    )
    const tapeReady = service.ensureSessionTapeReady('s1', legacyMessageStore as any)
    const tapeOnlyStore = {
      getMessages: vi.fn(() => {
        throw new Error('buildContext must use provided tape history records')
      })
    }
    const tapeContext = buildContext(
      's1',
      { text: 'next', files: [] },
      'System',
      10000,
      4096,
      tapeOnlyStore as any,
      false,
      {
        historyRecords: tapeReady.historyRecords
      }
    )

    expect(tapeContext).toEqual(legacyContext)
    expect(tapeOnlyStore.getMessages).not.toHaveBeenCalled()
  })

  it('rejects handoff anchors without a non-empty summary before writing Tape state', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    expect(() => service.handoff('s1', 'phase_done', { summary: '   ' })).toThrow(
      'Tape handoff requires a non-empty summary.'
    )
    expect(() => service.handoff('s1', 'phase_done', { reason: 'phase complete' } as any)).toThrow(
      'Tape handoff requires a non-empty summary.'
    )

    expect(table.ensureBootstrapAnchor).not.toHaveBeenCalled()
    expect(table.appendAnchor).not.toHaveBeenCalled()
    expect(entries).toEqual([])
  })

  it('migrates legacy session summary into a tape anchor during backfill', () => {
    const { table, entries } = createTapeTableMock()
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([
        createRecord({ id: 'u1', orderSeq: 1 }),
        createRecord({
          id: 'a1',
          orderSeq: 2,
          role: 'assistant',
          content: JSON.stringify([{ type: 'content', content: 'answer', status: 'success' }])
        })
      ])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: {
        getSummaryState: vi.fn().mockReturnValue({
          summary_text: 'legacy compacted state',
          summary_cursor_order_seq: 3,
          summary_updated_at: 200
        })
      }
    } as any)

    service.ensureSessionTapeReady('s1', messageStore as any)

    const summaryAnchor = entries.find((entry) => entry.name === 'compaction/migrated_summary')
    expect(summaryAnchor).toMatchObject({
      kind: 'anchor',
      source_type: 'summary',
      source_id: 'legacy-summary',
      created_at: 200
    })
    expect(JSON.parse(summaryAnchor.payload_json).state).toMatchObject({
      summary: 'legacy compacted state',
      cursorOrderSeq: 3,
      sourceMessageIds: ['u1', 'a1']
    })
  })

  it('keeps pending message records for resume but hides pending tool facts from search', () => {
    const { table } = createTapeTableMock()
    const pendingBlocks = [
      {
        type: 'tool_call',
        status: 'pending',
        timestamp: 100,
        tool_call: {
          id: 'tc1',
          name: 'search',
          params: '{"q":"x"}',
          response: 'pending result'
        }
      }
    ]
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([
        createRecord({
          id: 'a1',
          orderSeq: 1,
          role: 'assistant',
          status: 'pending',
          content: JSON.stringify(pendingBlocks),
          updatedAt: 100
        })
      ])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    service.ensureSessionTapeReady('s1', messageStore as any)

    expect(service.getMessageRecords('s1')).toMatchObject([{ id: 'a1', status: 'pending' }])
    expect(service.search('s1', 'pending result', { kinds: ['tool_result'] })).toEqual([])
  })

  it('lets final assistant facts supersede earlier pending tape facts', () => {
    const { table, entries } = createTapeTableMock()
    const pendingBlocks = [
      {
        type: 'tool_call',
        status: 'pending',
        timestamp: 100,
        tool_call: {
          id: 'tc1',
          name: 'search',
          params: '{"q":"x"}',
          response: 'pending result'
        }
      }
    ]
    const finalBlocks = [
      {
        type: 'tool_call',
        status: 'success',
        timestamp: 200,
        tool_call: {
          id: 'tc1',
          name: 'search',
          params: '{"q":"x"}',
          response: 'final result'
        }
      }
    ]
    const messageStore = {
      getMessages: vi
        .fn()
        .mockReturnValueOnce([
          createRecord({
            id: 'a1',
            orderSeq: 1,
            role: 'assistant',
            status: 'pending',
            content: JSON.stringify(pendingBlocks),
            metadata: JSON.stringify({ totalTokens: 1 }),
            updatedAt: 100
          })
        ])
        .mockReturnValue([
          createRecord({
            id: 'a1',
            orderSeq: 1,
            role: 'assistant',
            status: 'sent',
            content: JSON.stringify(finalBlocks),
            metadata: JSON.stringify({ totalTokens: 7 }),
            updatedAt: 200
          })
        ])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    service.ensureSessionTapeReady('s1', messageStore as any)
    service.ensureSessionTapeReady('s1', messageStore as any)

    expect(service.getMessageRecords('s1')).toMatchObject([
      {
        id: 'a1',
        status: 'sent'
      }
    ])
    const effectiveRecord = service.getMessageRecords('s1')[0]!
    expect(JSON.parse(effectiveRecord.content)[0].tool_call.response).toBe('final result')
    expect(
      entries.filter((entry) => entry.kind === 'message' && entry.name === 'message/assistant')
    ).toHaveLength(2)
    expect(entries.filter((entry) => entry.kind === 'tool_result')).toHaveLength(1)
    const finalToolResult = entries.filter((entry) => entry.kind === 'tool_result').at(-1)!
    expect(JSON.parse(finalToolResult.payload_json).response).toBe('final result')
    expect(service.info('s1').lastTokenUsage).toBe(7)
    expect(service.search('s1', 'pending result', { kinds: ['tool_result'] })).toEqual([])
    expect(service.search('s1', 'final result', { kinds: ['tool_result'] })).toHaveLength(1)
  })

  it('uses effective message facts after replacement and retraction events', () => {
    const { table, entries } = createTapeTableMock()
    const original = createRecord({ id: 'u1', orderSeq: 1 })
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([original])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    service.ensureSessionTapeReady('s1', messageStore as any)
    appendMessageReplacementToTape(
      table as any,
      createRecord({
        id: 'u1',
        orderSeq: 1,
        content: JSON.stringify({
          text: 'edited',
          files: [],
          links: [],
          search: false,
          think: false
        }),
        updatedAt: 300
      }),
      { reason: 'test_edit', revisionKind: 'record' }
    )

    expect(JSON.parse(service.getMessageRecords('s1')[0].content).text).toBe('edited')
    expect(service.search('s1', 'hello', { kinds: ['message'] })).toEqual([])
    expect(service.search('s1', 'edited', { kinds: ['message'] })).toHaveLength(1)
    expect(entries.filter((entry) => entry.kind === 'message')).toHaveLength(2)

    appendMessageRetractionToTape(table as any, service.getMessageRecords('s1')[0], 'test_delete')

    expect(service.getMessageRecords('s1')).toEqual([])
    expect(service.search('s1', 'edited', { kinds: ['message'] })).toEqual([])
  })

  it('appends non-idempotent retractions without generated provenance keys', () => {
    const { table, entries } = createTapeTableMock()
    const record = createRecord({ id: 'u1' })

    appendMessageRetractionToTape(table as any, record, 'first_delete')
    appendMessageRetractionToTape(table as any, record, 'second_delete')

    const retractions = entries.filter((entry) => entry.name === 'message/retracted')
    expect(retractions).toHaveLength(2)
    expect(retractions.map((entry) => entry.provenance_key)).toEqual([null, null])
  })
})
