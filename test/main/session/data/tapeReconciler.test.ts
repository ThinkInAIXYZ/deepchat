import {
  describe,
  expect,
  it,
  vi,
  buildContext,
  toAppSessionId,
  SessionTape,
  appendMessageReplacementToTape,
  appendMessageRetractionToTape,
  createTapeTableMock,
  createRecord,
  createTapeService
} from './tapeTestHarness'

describe('SessionTape reconciliation and facts', () => {
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
    expect(entries.filter((entry) => entry.kind === 'tool_call')).toHaveLength(1)
    expect(JSON.parse(entries.find((entry) => entry.kind === 'tool_call').meta_json)).toEqual({
      source: 'live',
      role: 'assistant',
      status: 'success',
      reason: 'tool_loop'
    })
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
      'test_edit'
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
