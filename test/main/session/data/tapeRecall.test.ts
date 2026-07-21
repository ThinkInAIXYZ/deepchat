import {
  performance,
  describe,
  expect,
  it,
  vi,
  SessionTape,
  appendMessageRecordToTape,
  appendMessageReplacementToTape,
  appendMessageRetractionToTape,
  DeepChatTapeEntriesTable,
  DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION,
  DeepChatTapeSearchProjectionTable,
  NewSessionsTable,
  DatabaseCtor,
  sqliteAvailable,
  sqliteSkipReason,
  itIfSqlite,
  createTapeTableMock,
  createRecord,
  createTapeService
} from './tapeTestHarness'

describe('SessionTape recall', () => {
  it('invalidates projections written before atomic generation transitions', () => {
    expect(DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION).toBeGreaterThan(2)
  })

  itIfSqlite('prunes legacy and metadata-orphaned search projections during initialization', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const projection = new DeepChatTapeSearchProjectionTable(db)
      projection.createTable()
      const row = (sessionId: string, searchText: string) => ({
        sessionId,
        entryId: 1,
        kind: 'event' as const,
        name: 'projection/test',
        sourceType: null,
        sourceId: null,
        sourceSeq: null,
        searchText,
        summaryText: searchText,
        refs: {},
        createdAt: 100
      })
      projection.replaceSession('legacy', [row('legacy', 'private legacy text')], 1, 2)
      projection.replaceSession('current', [row('current', 'current text')], 1)
      db.prepare(
        `INSERT INTO deepchat_tape_search_projection (
           session_id,
           entry_id,
           kind,
           name,
           source_type,
           source_id,
           source_seq,
           search_text,
           summary_text,
           refs_json,
           created_at
         )
         VALUES ('orphan', 1, 'event', 'projection/test', NULL, NULL, NULL, ?, ?, '{}', 100)`
      ).run('private orphan text', 'private orphan text')

      const restarted = new DeepChatTapeSearchProjectionTable(db)
      restarted.createTable()

      expect(restarted.getProjectedEntryIds('legacy')).toEqual([])
      expect(restarted.getSessionMeta('legacy')).toBeNull()
      expect(restarted.getProjectedEntryIds('orphan')).toEqual([])
      expect(restarted.getProjectedEntryIds('current')).toEqual([1])
      expect(restarted.isCurrent('current', 1)).toBe(true)
      const ftsExists = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deepchat_tape_search_fts'"
        )
        .get()
      if (ftsExists) {
        expect(
          db
            .prepare(
              `SELECT COUNT(*) AS count
               FROM deepchat_tape_search_fts
               WHERE session_id IN ('legacy', 'orphan')`
            )
            .get()
        ).toEqual({ count: 0 })
        expect(
          db
            .prepare(
              `SELECT COUNT(*) AS count
               FROM deepchat_tape_search_fts
               WHERE session_id = 'current'`
            )
            .get()
        ).toEqual({ count: 1 })
      }
    } finally {
      db.close()
    }
  })

  itIfSqlite('caches FTS capability detection per SQLite connection', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const exec = db.exec.bind(db)
      let probeStatementCount = 0
      const execSpy = vi.spyOn(db, 'exec').mockImplementation(((sql: string) => {
        if (sql.includes('tape_search_fts_probe_')) probeStatementCount += 1
        return exec(sql)
      }) as typeof db.exec)

      new DeepChatTapeSearchProjectionTable(db).createTable()
      const firstDetectionCount = probeStatementCount
      new DeepChatTapeSearchProjectionTable(db).createTable()

      expect(firstDetectionCount).toBeGreaterThan(0)
      expect(probeStatementCount).toBe(firstDetectionCount)
      execSpy.mockRestore()
    } finally {
      vi.restoreAllMocks()
      db.close()
    }
  })

  it('reports info, search, and handoff within one session scope', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([
        createRecord({ id: 'u1' }),
        createRecord({
          id: 'a1',
          orderSeq: 2,
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', content: 'answer', status: 'success', timestamp: 101 }
          ]),
          metadata: JSON.stringify({ totalTokens: 9 }),
          createdAt: 101,
          updatedAt: 101
        })
      ])
    }

    service.ensureSessionTapeReady('s1', messageStore as any)
    service.handoff('s1', 'phase_done', { summary: '  done  ' })
    const handoffAnchor = entries.find((entry) => entry.name === 'handoff/phase_done')

    expect(service.info('s1')).toMatchObject({
      sessionId: 's1',
      anchors: 2,
      lastAnchor: 'handoff/phase_done',
      lastTokenUsage: 9,
      migrationState: 'ready'
    })
    expect(JSON.parse(handoffAnchor.payload_json).state).toMatchObject({
      summary: 'done',
      cursorOrderSeq: 3,
      range: {
        fromOrderSeq: 1,
        toOrderSeq: 2
      },
      sourceMessageIds: ['u1', 'a1']
    })
    expect(service.search('s1', 'hello')).toHaveLength(1)
    expect(
      service.search('s1', 'hello', { kinds: ['message'], start: '1970-01-01T00:00:00.000Z' })
    ).toHaveLength(1)
    expect(service.search('s1', 'hello', { kinds: ['anchor'] })).toHaveLength(0)
    expect(service.search('s1', 'hello', { end: '99' })).toHaveLength(0)
    expect(() => service.search('s1', 'hello', { start: 'not-a-date' })).toThrow(
      'start must be an ISO date/time or millisecond timestamp.'
    )
    expect(service.anchors('s1')).toMatchObject([
      { sessionId: 's1', name: 'session/start' },
      { sessionId: 's1', name: 'handoff/phase_done' }
    ])
    expect(service.anchors('s1', { limit: 1 })).toMatchObject([
      { sessionId: 's1', name: 'handoff/phase_done' }
    ])
    expect(service.search('s2', 'hello')).toHaveLength(0)
  })

  it('returns only effective message DTOs for a requested source span', () => {
    const { table } = createTapeTableMock()
    const first = table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm1', seq: 0 },
      payload: { record: createRecord({ id: 'm1', orderSeq: 1 }) },
      meta: { source: 'live', orderSeq: 1, role: 'user' }
    })
    const second = table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm2', seq: 0 },
      payload: { record: createRecord({ id: 'm2', orderSeq: 2 }) },
      meta: { source: 'live', orderSeq: 2, role: 'user' }
    })
    table.appendEvent({
      sessionId: 's1',
      name: 'message/retracted',
      source: { type: 'message', id: 'm1', seq: 1 },
      data: { messageId: 'm1', reason: 'deleted' }
    })
    const service = new SessionTape({ deepchatTapeEntriesTable: table } as any)

    const span = service.getEffectiveMessageSourceSpan('s1', [first.entry_id, second.entry_id])

    expect(span).toHaveLength(1)
    expect(span[0]).toEqual({
      entryId: second.entry_id,
      record: {
        role: 'user',
        content: createRecord({ id: 'm2', orderSeq: 2 }).content,
        orderSeq: 2
      }
    })
    expect(span[0]).not.toHaveProperty('payload_json')
  })

  it('projects fallback tape search into compact results and bounded context', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm1',
          content: JSON.stringify({ text: 'Run the dev server', files: [], links: [] }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    table.append({
      sessionId: 's1',
      kind: 'tool_result',
      name: 'shell',
      source: { type: 'tool_result', id: 'm1:tc1', seq: 0 },
      payload: {
        messageId: 'm1',
        orderSeq: 2,
        toolCallId: 'tc1',
        command: 'pnpm run dev',
        exitStatus: 1,
        response: 'Command failed with EADDRINUSE in /tmp/deepchat.log'
      },
      meta: { source: 'live', status: 'error' },
      createdAt: 110
    })

    const hits = service.search('s1', 'pnpm run dev', { limit: 5 })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      kind: 'tool_result',
      summary: expect.stringContaining('EADDRINUSE'),
      refs: {
        toolCallId: 'tc1',
        commands: expect.arrayContaining(['pnpm run dev']),
        filePaths: expect.arrayContaining(['/tmp/deepchat.log']),
        errorCodes: expect.arrayContaining(['EADDRINUSE']),
        exitStatus: 1
      }
    })
    expect(hits[0]).not.toHaveProperty('payload')
    expect(hits[0]).not.toHaveProperty('meta')

    const context = service.getContext('s1', [hits[0].entryId], {
      before: 0,
      after: 0,
      maxBytesPerEntry: 12,
      maxTotalBytes: 12
    })
    expect(context.matchedEntryIds).toEqual([hits[0].entryId])
    expect(context.entries[0]).toMatchObject({
      entryId: hits[0].entryId,
      evidence: { truncated: true }
    })
    expect(context.entries[0].evidence.bytes).toBeLessThanOrEqual(12)
    expect(context.entries[0]).not.toHaveProperty('payload')
    expect(context.entries[0]).not.toHaveProperty('meta')

    const exhaustedContext = service.getContext('s1', [hits[0].entryId], {
      before: 0,
      after: 0,
      maxTotalBytes: 0
    })
    expect(exhaustedContext.entries).toEqual([])
    expect(exhaustedContext.matchedEntryIds).toEqual([])
  })

  it('projects user message attachment metadata into search text and refs', () => {
    const { table } = createTapeTableMock()
    const projectionTable = {
      isCurrent: vi.fn().mockReturnValue(false),
      getSessionMeta: vi.fn().mockReturnValue(null),
      getProjectedEntryIds: vi.fn().mockReturnValue([]),
      appendSession: vi.fn(),
      replaceSession: vi.fn(),
      search: vi.fn().mockReturnValue([])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm-file', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm-file',
          content: JSON.stringify({
            text: `Please review the attachment ${'z'.repeat(6_000)}`,
            files: [
              {
                name: 'a.md',
                path: '/tmp/a.md',
                content: 'raw attachment body should not be projected',
                metadata: { fileName: 'workspace-a.md' },
                resolvedRepresentation: {
                  kind: 'ocr_text',
                  text: 'ocr projection marker',
                  tokenCount: 3,
                  truncated: false
                }
              }
            ],
            links: []
          }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })

    service.search('s1', '/tmp/a.md', { limit: 5 })

    expect(projectionTable.replaceSession).toHaveBeenCalledTimes(1)
    const projectedRows = projectionTable.replaceSession.mock.calls[0][1]
    expect(projectedRows[0]).toMatchObject({
      entryId: 1,
      refs: {
        filePaths: expect.arrayContaining(['/tmp/a.md']),
        fileNames: expect.arrayContaining(['a.md', 'workspace-a.md'])
      }
    })
    expect(projectedRows[0].searchText).toContain('/tmp/a.md')
    expect(projectedRows[0].searchText).toContain('a.md')
    expect(projectedRows[0].searchText).toContain('workspace-a.md')
    expect(projectedRows[0].searchText).toContain('ocr projection marker')
    expect(projectedRows[0].searchText).not.toContain('raw attachment body should not be projected')
  })

  it('preserves relative file paths in projected refs', () => {
    const { table } = createTapeTableMock()
    let projectedRows: any[] = []
    const projectionTable = {
      isCurrent: vi.fn().mockReturnValue(false),
      getSessionMeta: vi.fn().mockReturnValue(null),
      getProjectedEntryIds: vi.fn().mockReturnValue([]),
      appendSession: vi.fn(),
      replaceSession: vi.fn((_sessionId: string, rows: any[]) => {
        projectedRows = rows
      }),
      search: vi.fn().mockReturnValue([])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm-relative', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm-relative',
          content: JSON.stringify({
            text: 'Touched src/main/index.ts, ./lib/util.ts, ../shared/types.ts, test/main/foo/bar.ts, /usr/local/bin/deploy, and https://example.com/not-a-file',
            files: [],
            links: []
          }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })

    service.search('s1', 'src/main/index.ts', { limit: 5 })

    expect(projectionTable.replaceSession).toHaveBeenCalledTimes(1)
    const filePaths = projectedRows[0].refs.filePaths
    expect(filePaths).toEqual(
      expect.arrayContaining([
        'src/main/index.ts',
        './lib/util.ts',
        '../shared/types.ts',
        'test/main/foo/bar.ts',
        '/usr/local/bin/deploy'
      ])
    )
    expect(filePaths).not.toContain('/main/index.ts')
    expect(filePaths).not.toContain('/lib/util.ts')
    expect(filePaths).not.toContain('/main/foo/bar.ts')
    expect(filePaths).not.toContain('example.com/not-a-file')
  })

  it('rebuilds old tape projection versions before attachment path search', () => {
    const { table } = createTapeTableMock()
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm-file', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm-file',
          content: JSON.stringify({
            text: 'Please review the migrated attachment',
            files: [
              {
                name: 'legacy.md',
                path: '/tmp/legacy.md',
                content: 'raw migrated body must stay out of projection',
                metadata: { fileName: 'legacy-workspace.md' }
              }
            ],
            links: []
          }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    let storedVersion = 1
    let storedMaxEntryId = 1
    let projectedRows: any[] = [
      {
        sessionId: 's1',
        entryId: 1,
        kind: 'message',
        name: 'message/user',
        sourceType: 'message',
        sourceId: 'm-file',
        sourceSeq: 0,
        searchText: 'message/user Please review the migrated attachment',
        summaryText: 'user: Please review the migrated attachment',
        refs: { messageId: 'm-file' },
        createdAt: 100
      }
    ]
    const projectionTable = {
      isCurrent: vi.fn((_sessionId: string, maxEntryId: number) => {
        return (
          storedVersion === DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION &&
          storedMaxEntryId === maxEntryId
        )
      }),
      getSessionMeta: vi.fn(() => ({
        projectionVersion: storedVersion,
        maxEntryId: storedMaxEntryId
      })),
      getProjectedEntryIds: vi.fn().mockReturnValue([1]),
      appendSession: vi.fn(),
      replaceSession: vi.fn((_sessionId: string, rows: any[], maxEntryId: number) => {
        projectedRows = rows
        storedVersion = DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION
        storedMaxEntryId = maxEntryId
      }),
      search: vi.fn((_sessionId: string, query: string) => {
        return projectedRows
          .filter((row) => row.searchText.includes(query))
          .map((row) => ({
            session_id: row.sessionId,
            entry_id: row.entryId,
            kind: row.kind,
            name: row.name,
            source_type: row.sourceType,
            source_id: row.sourceId,
            source_seq: row.sourceSeq,
            search_text: row.searchText,
            summary_text: row.summaryText,
            refs_json: JSON.stringify(row.refs),
            created_at: row.createdAt,
            score: 1
          }))
      })
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const hits = service.search('s1', '/tmp/legacy.md', { limit: 5 })

    expect(projectionTable.replaceSession).toHaveBeenCalledTimes(1)
    expect(projectionTable.appendSession).not.toHaveBeenCalled()
    expect(hits).toHaveLength(1)
    expect(hits[0].refs).toMatchObject({
      filePaths: expect.arrayContaining(['/tmp/legacy.md']),
      fileNames: expect.arrayContaining(['legacy.md', 'legacy-workspace.md'])
    })
    expect(projectedRows[0].searchText).not.toContain(
      'raw migrated body must stay out of projection'
    )
  })

  it('prioritizes requested tape context entries before window entries under byte caps', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'before-1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'before-1',
          content: JSON.stringify({
            text: 'before entry consumes the tiny byte budget first',
            files: [],
            links: []
          }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'before-2', seq: 0 },
      payload: {
        record: createRecord({
          id: 'before-2',
          content: JSON.stringify({
            text: 'second before entry also appears earlier',
            files: [],
            links: []
          }),
          createdAt: 110,
          updatedAt: 110
        })
      },
      meta: { source: 'live', orderSeq: 2, role: 'user' },
      createdAt: 110
    })
    const target = table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'target', seq: 0 },
      payload: {
        record: createRecord({
          id: 'target',
          content: JSON.stringify({
            text: 'target-ok consumes the available budget',
            files: [],
            links: []
          }),
          createdAt: 120,
          updatedAt: 120
        })
      },
      meta: { source: 'live', orderSeq: 3, role: 'user' },
      createdAt: 120
    })

    const context = service.getContext('s1', [target.entry_id], {
      before: 2,
      after: 0,
      limit: 3,
      maxBytesPerEntry: 18,
      maxTotalBytes: 18
    })

    expect(context.matchedEntryIds).toEqual([target.entry_id])
    expect(context.entries.map((entry) => entry.entryId)).toEqual([target.entry_id])
    expect(context.entries[0].evidence.text).toContain('target-ok')
  })

  it('falls back to the current Tape when the context projection is not current', () => {
    const { table } = createTapeTableMock()
    const entry = table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'current-message', seq: 0 },
      payload: {
        record: createRecord({
          id: 'current-message',
          content: JSON.stringify({ text: 'current generation context', files: [], links: [] })
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' }
    })
    const projectionTable = {
      getByEntryIds: vi.fn(() => [
        {
          session_id: 's1',
          entry_id: entry.entry_id,
          summary_text: 'old private context',
          refs_json: '{"messageId":"old-message"}'
        }
      ]),
      getByEntryIdsIfCurrent: vi.fn().mockReturnValue([])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const context = service.getContext('s1', [entry.entry_id], { before: 0, after: 0 })

    expect(projectionTable.getByEntryIdsIfCurrent).toHaveBeenCalledWith('s1', entry.entry_id, [
      entry.entry_id
    ])
    expect(projectionTable.getByEntryIds).not.toHaveBeenCalled()
    expect(context.entries[0]).toMatchObject({
      summary: expect.stringContaining('current generation context'),
      refs: { messageId: 'current-message' }
    })
    expect(context.entries[0].summary).not.toContain('old private context')
  })

  itIfSqlite('ignores a pre-transition projection version at the same Tape head', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      const projectionTable = new DeepChatTapeSearchProjectionTable(db)
      table.createTable()
      projectionTable.createTable()
      table.append({
        sessionId: 's1',
        kind: 'message',
        name: 'message/user',
        source: { type: 'message', id: 'current-message', seq: 0 },
        payload: {
          record: createRecord({
            id: 'current-message',
            content: JSON.stringify({ text: 'current generation context', files: [], links: [] })
          })
        },
        meta: { source: 'live', orderSeq: 1, role: 'user' }
      })
      projectionTable.replaceSession(
        's1',
        [
          {
            sessionId: 's1',
            entryId: 1,
            kind: 'message',
            name: 'message/user',
            sourceType: 'message',
            sourceId: 'old-message',
            sourceSeq: 0,
            searchText: 'old private context',
            summaryText: 'old private context',
            refs: { messageId: 'old-message' },
            createdAt: 100
          }
        ],
        1,
        2
      )
      const service = new SessionTape({
        deepchatTapeEntriesTable: table,
        deepchatTapeSearchProjectionTable: projectionTable,
        deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
      } as any)

      const context = service.getContext('s1', [1], { before: 0, after: 0 })

      expect(context.entries[0]).toMatchObject({
        entryId: 1,
        summary: expect.stringContaining('current generation context'),
        refs: { messageId: 'current-message' }
      })
      expect(context.entries[0].summary).not.toContain('old private context')
    } finally {
      db.close()
    }
  })

  itIfSqlite('ignores stale same-entry projection context when the Tape head has advanced', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      const projectionTable = new DeepChatTapeSearchProjectionTable(db)
      table.createTable()
      projectionTable.createTable()
      table.append({
        sessionId: 's1',
        kind: 'message',
        name: 'message/user',
        source: { type: 'message', id: 'current-message', seq: 0 },
        payload: {
          record: createRecord({
            id: 'current-message',
            content: JSON.stringify({
              text: 'current generation context',
              files: [],
              links: []
            })
          })
        },
        meta: { source: 'live', orderSeq: 1, role: 'user' }
      })
      projectionTable.replaceSession(
        's1',
        [
          {
            sessionId: 's1',
            entryId: 1,
            kind: 'message',
            name: 'message/user',
            sourceType: 'message',
            sourceId: 'old-message',
            sourceSeq: 0,
            searchText: 'old private context',
            summaryText: 'old private context',
            refs: { messageId: 'old-message' },
            createdAt: 100
          }
        ],
        0
      )
      const service = new SessionTape({
        deepchatTapeEntriesTable: table,
        deepchatTapeSearchProjectionTable: projectionTable,
        deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
      } as any)

      const context = service.getContext('s1', [1], { before: 0, after: 0 })

      expect(context.entries[0]).toMatchObject({
        entryId: 1,
        summary: expect.stringContaining('current generation context'),
        refs: { messageId: 'current-message' }
      })
      expect(context.entries[0].summary).not.toContain('old private context')
    } finally {
      db.close()
    }
  })

  it('binds tape projection LIKE fallback params for single and multi-term queries', () => {
    const all = vi.fn().mockReturnValue([])
    const db = {
      prepare: vi.fn((sql: string) => ({
        all: (...params: unknown[]) => all(sql, params),
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn()
      }))
    }
    const projectionTable = new DeepChatTapeSearchProjectionTable(db as any)
    ;(projectionTable as any).recoverSessionFts = vi.fn()

    projectionTable.search('s1', 'Redis', { limit: 5 })
    expect(all).toHaveBeenLastCalledWith(
      expect.stringContaining('FROM deepchat_tape_search_projection'),
      ['s1', '%Redis%', '%Redis%', '%Redis%', 5]
    )

    projectionTable.search('s1', 'Redis TTL', { limit: 5 })
    expect(all).toHaveBeenLastCalledWith(
      expect.stringContaining('FROM deepchat_tape_search_projection'),
      [
        's1',
        '%Redis TTL%',
        '%Redis TTL%',
        '%Redis TTL%',
        '%Redis%',
        '%Redis%',
        '%Redis%',
        '%TTL%',
        '%TTL%',
        '%TTL%',
        5
      ]
    )

    const oversizedQuery = Array.from({ length: 257 }, (_, index) => `term-${index}`).join(' ')
    projectionTable.search('s1', oversizedQuery, { limit: 5 })
    expect(all).toHaveBeenLastCalledWith(
      expect.stringContaining('FROM deepchat_tape_search_projection'),
      ['s1', `%${oversizedQuery}%`, `%${oversizedQuery}%`, `%${oversizedQuery}%`, 5]
    )
  })

  it('checks projection version and head in the same context row query', () => {
    const reads: Array<{ sql: string; params: unknown[] }> = []
    const projectionTable = new DeepChatTapeSearchProjectionTable({
      prepare: vi.fn((sql: string) => ({
        all: (...params: unknown[]) => {
          reads.push({ sql, params })
          return []
        }
      }))
    } as any)

    projectionTable.getByEntryIdsIfCurrent('s1', 7, [3, 3, 0], 42)

    expect(reads).toHaveLength(1)
    expect(reads[0].sql).toContain('INNER JOIN deepchat_tape_search_projection_meta AS meta')
    expect(reads[0].sql).toContain('meta.projection_version = ?')
    expect(reads[0].sql).toContain('meta.max_entry_id = ?')
    expect(reads[0].params).toEqual([42, 7, 's1', 3])
  })

  it('uses current tape projection without loading full session rows', () => {
    const { table } = createTapeTableMock()
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm1',
          content: JSON.stringify({ text: 'Redis compact marker', files: [], links: [] }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    table.getBySession.mockClear()
    const projectionTable = {
      isCurrent: vi.fn().mockReturnValue(true),
      getSessionMeta: vi.fn(),
      getProjectedEntryIds: vi.fn(),
      appendSession: vi.fn(),
      replaceSession: vi.fn(),
      search: vi.fn().mockReturnValue([
        {
          session_id: 's1',
          entry_id: 1,
          kind: 'message',
          name: 'message/user',
          source_type: 'message',
          source_id: 'm1',
          source_seq: 0,
          search_text: 'Redis compact marker',
          summary_text: 'Redis compact marker',
          refs_json: '{"messageId":"m1"}',
          created_at: 100,
          score: -2
        }
      ])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const hits = service.search('s1', 'Redis compact', { limit: 5 })

    expect(table.getMaxEntryId).toHaveBeenCalledWith('s1')
    expect(table.getBySession).not.toHaveBeenCalled()
    expect(projectionTable.search).toHaveBeenCalledWith(
      's1',
      'Redis compact',
      expect.objectContaining({ limit: 5 })
    )
    expect(projectionTable.appendSession).not.toHaveBeenCalled()
    expect(projectionTable.replaceSession).not.toHaveBeenCalled()
    expect(hits[0]).toMatchObject({
      entryId: 1,
      kind: 'message',
      summary: 'Redis compact marker',
      refs: { messageId: 'm1' },
      score: -2
    })
    expect(hits[0]).not.toHaveProperty('payload')
    expect(hits[0]).not.toHaveProperty('meta')
  })

  it('falls back to effective tape search when projection search throws', () => {
    const { table } = createTapeTableMock()
    const projectionTable = {
      isCurrent: vi.fn().mockReturnValue(true),
      search: vi.fn(() => {
        throw new Error('projection failed')
      })
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm1',
          content: JSON.stringify({ text: 'Redis fallback marker', files: [], links: [] }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })

    const hits = service.search('s1', 'Redis fallback', { limit: 5 })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      kind: 'message',
      summary: expect.stringContaining('Redis fallback')
    })
    expect(hits[0]).not.toHaveProperty('payload')
    expect(hits[0]).not.toHaveProperty('meta')
  })

  it('appends tape projection rows when the previous projection is an effective prefix', () => {
    const { table } = createTapeTableMock()
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm1',
          content: JSON.stringify({ text: 'first redis', files: [], links: [] }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm2', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm2',
          content: JSON.stringify({ text: 'second vue', files: [], links: [] }),
          createdAt: 110,
          updatedAt: 110
        })
      },
      meta: { source: 'live', orderSeq: 2, role: 'user' },
      createdAt: 110
    })
    const projectionTable = {
      isCurrent: vi.fn((_sessionId: string, maxEntryId: number) => maxEntryId === 1),
      getSessionMeta: vi.fn().mockReturnValue({ projectionVersion: 1, maxEntryId: 1 }),
      getProjectedEntryIds: vi.fn().mockReturnValue([1]),
      appendSession: vi.fn(),
      replaceSession: vi.fn(),
      search: vi.fn().mockReturnValue([])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    service.search('s1', 'vue', { limit: 5 })

    expect(projectionTable.appendSession).toHaveBeenCalledTimes(1)
    expect(projectionTable.appendSession.mock.calls[0][1].map((row: any) => row.entryId)).toEqual([
      2
    ])
    expect(projectionTable.replaceSession).not.toHaveBeenCalled()
  })

  it('rebuilds tape projection when projected entry ids are not an effective prefix', () => {
    const { table } = createTapeTableMock()
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm1',
          content: JSON.stringify({ text: 'redis', files: [], links: [] }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    const projectionTable = {
      isCurrent: vi.fn((_sessionId: string, maxEntryId: number) => maxEntryId === 0),
      getSessionMeta: vi.fn().mockReturnValue({ projectionVersion: 1, maxEntryId: 0 }),
      getProjectedEntryIds: vi.fn().mockReturnValue([99]),
      appendSession: vi.fn(),
      replaceSession: vi.fn(),
      search: vi.fn().mockReturnValue([])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    service.search('s1', 'redis', { limit: 5 })

    expect(projectionTable.replaceSession).toHaveBeenCalledTimes(1)
    expect(projectionTable.appendSession).not.toHaveBeenCalled()
  })

  it('does not run LIKE fallback when FTS fills the tape projection search limit', () => {
    const all = vi.fn((sql: string, _params: unknown[]) =>
      sql.includes('deepchat_tape_search_fts')
        ? [
            {
              session_id: 's1',
              entry_id: 1,
              kind: 'message',
              name: 'message/user',
              source_type: 'message',
              source_id: 'm1',
              source_seq: 0,
              search_text: 'Redis TTL',
              summary_text: 'Redis TTL',
              refs_json: '{}',
              created_at: 100,
              score: -1
            }
          ]
        : []
    )
    const db = {
      exec: vi.fn(() => {
        throw new Error('unexpected FTS ensure')
      }),
      prepare: vi.fn((sql: string) => ({
        all: (...params: unknown[]) => all(sql, params),
        get: (..._params: unknown[]) => {
          if (
            sql.includes('deepchat_tape_search_projection_meta') ||
            sql.includes('deepchat_tape_search_fts_meta')
          ) {
            return { projection_version: 1, max_entry_id: 1 }
          }
          return undefined
        },
        run: vi.fn()
      })),
      transaction: vi.fn((callback: () => void) => callback)
    }
    const projectionTable = new DeepChatTapeSearchProjectionTable(db as any)
    ;(projectionTable as any).ftsReady = true

    const hits = projectionTable.search('s1', 'Redis', { limit: 1 })

    expect(hits).toHaveLength(1)
    expect(db.exec).not.toHaveBeenCalled()
    const ftsCall = all.mock.calls.find(([sql]) => String(sql).includes('deepchat_tape_search_fts'))
    expect(String(ftsCall?.[0])).toContain('deepchat_tape_search_fts.session_id = ?')
    expect((ftsCall?.[1] as unknown[]).filter((param) => param === 's1')).toHaveLength(2)
    expect(
      vi.mocked(db.prepare).mock.calls.some(([sql]) => String(sql).includes('NULL AS score'))
    ).toBe(false)
  })

  it('invalidates a failed FTS query and rebuilds the derivative before the next search', () => {
    const projectionRow = {
      session_id: 's1',
      entry_id: 1,
      kind: 'message',
      name: 'message/user',
      source_type: 'message',
      source_id: 'm1',
      source_seq: 0,
      search_text: 'Redis TTL',
      summary_text: 'Redis TTL',
      refs_json: '{}',
      created_at: 100
    }
    let ftsMetaPresent = true
    let shouldFailFtsQuery = true
    let likeQueryCount = 0
    let ftsQueryCount = 0
    const exec = vi.fn()
    const prepare = vi.fn((sql: string) => ({
      all: (..._params: unknown[]) => {
        if (sql.includes('bm25(deepchat_tape_search_fts)')) {
          ftsQueryCount += 1
          if (shouldFailFtsQuery) {
            shouldFailFtsQuery = false
            throw new Error('injected corrupt FTS query')
          }
          return [{ ...projectionRow, score: -1 }]
        }
        if (sql.includes('NULL AS score')) {
          likeQueryCount += 1
          return [{ ...projectionRow, score: null }]
        }
        if (sql.includes('SELECT *') && sql.includes('deepchat_tape_search_projection')) {
          return [projectionRow]
        }
        return []
      },
      get: (..._params: unknown[]) => {
        if (sql.includes('sqlite_master') && sql.includes('deepchat_tape_search_fts_meta')) {
          return { name: 'deepchat_tape_search_fts_meta' }
        }
        if (sql.includes('FROM deepchat_tape_search_projection_meta')) {
          return { projection_version: 1, max_entry_id: 1 }
        }
        if (sql.includes('FROM deepchat_tape_search_fts_meta')) {
          return ftsMetaPresent ? { projection_version: 1, max_entry_id: 1 } : undefined
        }
        if (sql.includes('SELECT rowid')) {
          return { rowid: 1 }
        }
        return undefined
      },
      run: (..._params: unknown[]) => {
        if (sql.includes('DELETE FROM deepchat_tape_search_fts_meta')) {
          ftsMetaPresent = false
        }
        if (sql.includes('INSERT INTO deepchat_tape_search_fts_meta')) {
          ftsMetaPresent = true
        }
      }
    }))
    const projectionTable = new DeepChatTapeSearchProjectionTable({
      exec,
      prepare,
      transaction: (callback: () => void) => callback
    } as any)
    ;(projectionTable as any).ftsReady = true

    expect(projectionTable.search('s1', 'Redis', { limit: 1 })).toMatchObject([
      { entry_id: 1, score: null }
    ])
    expect(projectionTable.hasFtsReadyForTesting()).toBe(false)
    expect(exec).toHaveBeenCalledWith('DROP TABLE IF EXISTS deepchat_tape_search_fts')

    expect(projectionTable.search('s1', 'Redis', { limit: 1 })).toMatchObject([
      { entry_id: 1, score: -1 }
    ])
    expect(projectionTable.hasFtsReadyForTesting()).toBe(true)
    expect(ftsQueryCount).toBe(2)
    expect(likeQueryCount).toBe(1)
    expect(
      exec.mock.calls.some(([sql]) => String(sql).includes('CREATE VIRTUAL TABLE IF NOT EXISTS'))
    ).toBe(true)
  })

  it('queries memory view manifests by agent without expanding session ids', () => {
    const all = vi.fn().mockReturnValue([])
    const db = {
      prepare: vi.fn((sql: string) => ({
        all: (...params: unknown[]) => all(sql, params)
      }))
    }
    const table = new DeepChatTapeEntriesTable(db as any)

    table.listMemoryViewManifestAnchorsByAgent('agent-a', {
      sessionId: 's-1',
      messageId: 'msg-1',
      limit: 7
    })

    expect(all).toHaveBeenCalledWith(
      expect.stringContaining('INNER JOIN new_sessions AS sessions'),
      ['agent-a', 's-1', 'msg-1', 7]
    )
    const sql = String(all.mock.calls[0][0])
    expect(sql).not.toContain(' IN (')
    expect(sql).toContain('sessions.agent_id = ?')
    expect(sql).toContain('tape.session_id = ?')
    expect(sql).toContain("json_extract(tape.meta_json, '$.messageId') = ?")
  })

  it('keeps linked raw search candidate-bounded instead of materializing complete Tapes', () => {
    const all = vi.fn().mockReturnValue([])
    const db = {
      prepare: vi.fn((sql: string) => ({
        all: (...params: unknown[]) => all(sql, params)
      }))
    }
    const table = new DeepChatTapeEntriesTable(db as any)

    table.searchEffectiveSourcesAtHeads(
      [
        { sessionId: 'child-b', maxEntryId: 20 },
        { sessionId: 'child-a', maxEntryId: 10 }
      ],
      'needle',
      { limit: 5 }
    )

    const sql = String(all.mock.calls[0][0])
    const params = all.mock.calls[0][1]
    expect(sql).toContain('FROM deepchat_tape_entries AS candidate')
    expect(sql).toContain('candidate.entry_id <= source.max_entry_id')
    expect(sql).toContain('FROM deepchat_tape_entries AS later_message')
    expect(sql).toContain(
      "typeof(json_extract(later_message.payload_json, '$.record.content')) = 'text'"
    )
    expect(sql).not.toContain('bounded_rows AS')
    expect(params[0]).toBe(
      JSON.stringify([
        { sessionId: 'child-a', maxEntryId: 10 },
        { sessionId: 'child-b', maxEntryId: 20 }
      ])
    )
    expect(params.at(-1)).toBe(5)
  })

  it('reads exact linked projections without invoking FTS recovery or writes', () => {
    const run = vi.fn()
    const exec = vi.fn()
    const reads: Array<{ sql: string; params: unknown[] }> = []
    const prepare = vi.fn((sql: string) => ({
      all: (...params: unknown[]) => {
        reads.push({ sql, params })
        if (sql.includes('deepchat_tape_search_projection_meta AS meta')) {
          return [{ session_id: 'child', max_entry_id: 2 }]
        }
        if (sql.includes('SELECT projection.*, NULL AS score')) {
          return [
            {
              session_id: 'child',
              entry_id: 2,
              kind: 'event',
              name: 'child/result',
              source_type: null,
              source_id: null,
              source_seq: null,
              search_text: 'projection needle',
              summary_text: 'projection needle',
              refs_json: '{}',
              created_at: 100,
              score: null
            }
          ]
        }
        return []
      },
      run
    }))
    const projectionTable = new DeepChatTapeSearchProjectionTable({ prepare, exec } as any)

    const result = projectionTable.searchSourcesReadOnly(
      [{ sessionId: 'child', maxEntryId: 2 }],
      'projection needle',
      { limit: 5 }
    )

    expect(result).toMatchObject({
      coveredSources: [{ sessionId: 'child', maxEntryId: 2 }],
      rows: [{ session_id: 'child', entry_id: 2 }]
    })
    expect(exec).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(prepare.mock.calls.map(([sql]) => String(sql)).join('\n')).not.toContain(
      'deepchat_tape_search_fts_meta'
    )
    expect(
      reads.find((read) => read.sql.includes('SELECT projection.*, NULL AS score'))?.params.at(-1)
    ).toBe(5)
  })

  it('returns no ranked rows when linked projection coverage is only partial', () => {
    const reads: string[] = []
    const prepare = vi.fn((sql: string) => ({
      all: () => {
        reads.push(sql)
        if (sql.includes('deepchat_tape_search_projection_meta AS meta')) {
          return [{ session_id: 'child-a', max_entry_id: 2 }]
        }
        return []
      }
    }))
    const projectionTable = new DeepChatTapeSearchProjectionTable({
      prepare,
      exec: vi.fn()
    } as any)

    const result = projectionTable.searchSourcesReadOnly(
      [
        { sessionId: 'child-a', maxEntryId: 2 },
        { sessionId: 'child-b', maxEntryId: 3 }
      ],
      'projection needle',
      { limit: 5 }
    )

    expect(result).toEqual({
      coveredSources: [{ sessionId: 'child-a', maxEntryId: 2 }],
      rows: []
    })
    expect(
      reads.some((sql) => sql.includes('FROM deepchat_tape_search_projection AS projection'))
    ).toBe(false)
    expect(reads.some((sql) => sql.includes('FROM deepchat_tape_search_fts'))).toBe(false)
  })

  it('uses one LIKE ranking when linked FTS freshness is only partial', () => {
    const reads: Array<{ sql: string; params: unknown[] }> = []
    const prepare = vi.fn((sql: string) => ({
      all: (...params: unknown[]) => {
        reads.push({ sql, params })
        if (sql.includes('deepchat_tape_search_projection_meta AS meta')) {
          return [
            { session_id: 'child-a', max_entry_id: 2 },
            { session_id: 'child-b', max_entry_id: 3 }
          ]
        }
        if (sql.includes('deepchat_tape_search_fts_meta AS meta')) {
          return [{ session_id: 'child-a', max_entry_id: 2 }]
        }
        if (sql.includes('SELECT projection.*, NULL AS score')) {
          return [
            {
              session_id: 'child-b',
              entry_id: 3,
              kind: 'event',
              name: 'child/result',
              source_type: null,
              source_id: null,
              source_seq: null,
              search_text: 'projection needle',
              summary_text: 'projection needle',
              refs_json: '{}',
              created_at: 200,
              score: null
            }
          ]
        }
        return []
      }
    }))
    const projectionTable = new DeepChatTapeSearchProjectionTable({
      prepare,
      exec: vi.fn()
    } as any)
    ;(projectionTable as any).ftsReady = true

    const sources = [
      { sessionId: 'child-a', maxEntryId: 2 },
      { sessionId: 'child-b', maxEntryId: 3 }
    ]
    const result = projectionTable.searchSourcesReadOnly(sources, 'projection needle', { limit: 5 })

    expect(result.rows).toMatchObject([{ session_id: 'child-b', entry_id: 3, score: null }])
    expect(reads.some(({ sql }) => sql.includes('bm25(deepchat_tape_search_fts)'))).toBe(false)
    expect(
      reads.find(({ sql }) => sql.includes('SELECT projection.*, NULL AS score'))?.params[0]
    ).toBe(JSON.stringify(sources))
  })

  itIfSqlite(
    `keeps projected and raw linked multi-term search aligned${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const table = new DeepChatTapeEntriesTable(db)
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        table.createTable()
        projectionTable.createTable()
        table.ensureBootstrapAnchor('child')
        const entry = table.appendEvent({
          sessionId: 'child',
          name: 'child/result',
          data: { text: 'alpha separated by several words before beta' },
          createdAt: 100
        })
        const sources = [{ sessionId: 'child', maxEntryId: entry.entry_id }]
        projectionTable.replaceSession(
          'child',
          [
            {
              sessionId: 'child',
              entryId: entry.entry_id,
              kind: 'event',
              name: 'child/result',
              sourceType: null,
              sourceId: null,
              sourceSeq: null,
              searchText: 'alpha separated by several words before beta',
              summaryText: 'alpha separated by several words before beta',
              refs: {},
              createdAt: 100
            }
          ],
          entry.entry_id
        )

        const projected = projectionTable.searchSourcesReadOnly(sources, 'alpha beta', { limit: 5 })
        const raw = table.searchEffectiveSourcesAtHeads(sources, 'alpha beta', { limit: 5 })

        expect(projected.coveredSources).toEqual(sources)
        expect(raw.map((row) => [row.session_id, row.entry_id])).toEqual(
          projected.rows.map((row) => [row.session_id, row.entry_id])
        )
        expect(raw).toHaveLength(1)
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `queries effective linked sources and context at frozen heads${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const table = new DeepChatTapeEntriesTable(db)
        table.createTable()
        table.ensureBootstrapAnchor('child-a')
        table.ensureBootstrapAnchor('child-b')
        table.appendEvent({
          sessionId: 'child-a',
          name: 'child/result',
          data: { text: 'native linked needle A' },
          createdAt: 100
        })
        table.appendEvent({
          sessionId: 'child-b',
          name: 'child/result',
          data: { text: 'native linked needle B' },
          createdAt: 200
        })
        table.appendEvent({
          sessionId: 'child-a',
          name: 'child/late',
          data: { text: 'native linked needle late' },
          createdAt: 300
        })

        const sources = [
          { sessionId: 'child-a', maxEntryId: 2 },
          { sessionId: 'child-b', maxEntryId: 2 }
        ]
        expect(
          table.searchEffectiveSourcesAtHeads(sources, 'native linked needle', { limit: 1 })
        ).toMatchObject([{ session_id: 'child-b', entry_id: 2 }])
        expect(
          table
            .searchEffectiveSourcesAtHeads(sources, 'native linked needle', { limit: 10 })
            .map((row) => [row.session_id, row.entry_id])
        ).toEqual([
          ['child-b', 2],
          ['child-a', 2]
        ])
        expect(
          table
            .getEffectiveContextRowsAtHead({ sessionId: 'child-a', maxEntryId: 2 }, [2], {
              before: 1,
              after: 5,
              limit: 10
            })
            .map((row) => row.entry_id)
        ).toEqual([2, 1])

        table.ensureBootstrapAnchor('child-message')
        const original = createRecord({
          id: 'linked-message',
          sessionId: 'child-message',
          content: JSON.stringify({ text: 'old linked marker', files: [], links: [] })
        })
        const replacement = {
          ...original,
          content: JSON.stringify({ text: 'new linked marker', files: [], links: [] }),
          updatedAt: 200
        }
        appendMessageRecordToTape(table, original, 'live')
        appendMessageReplacementToTape(table, replacement, 'native_edit')
        const replacementHead = table.getMaxEntryId('child-message')
        expect(
          table.searchEffectiveSourcesAtHeads(
            [{ sessionId: 'child-message', maxEntryId: replacementHead }],
            'old linked marker'
          )
        ).toEqual([])
        const replacementHits = table.searchEffectiveSourcesAtHeads(
          [{ sessionId: 'child-message', maxEntryId: replacementHead }],
          'new linked marker'
        )
        expect(replacementHits).toHaveLength(1)
        expect(
          table
            .getEffectiveContextRowsAtHead(
              { sessionId: 'child-message', maxEntryId: replacementHead },
              [replacementHits[0].entry_id],
              { before: 0, after: 0, limit: 5 }
            )
            .map((row) => row.entry_id)
        ).toEqual([replacementHits[0].entry_id])

        table.append({
          sessionId: 'child-message',
          kind: 'message',
          name: 'message/user',
          source: { type: 'message', id: original.id, seq: 0 },
          provenanceKey: null,
          payload: {
            record: {
              id: original.id,
              sessionId: original.sessionId,
              orderSeq: original.orderSeq,
              role: original.role,
              status: 'sent'
            }
          },
          meta: { source: 'malformed_import' }
        })
        expect(
          table.searchEffectiveSourcesAtHeads(
            [
              {
                sessionId: 'child-message',
                maxEntryId: table.getMaxEntryId('child-message')
              }
            ],
            'new linked marker'
          )
        ).toMatchObject([{ entry_id: replacementHits[0].entry_id }])

        appendMessageRetractionToTape(table, replacement, 'native_delete')
        expect(
          table.searchEffectiveSourcesAtHeads(
            [
              {
                sessionId: 'child-message',
                maxEntryId: table.getMaxEntryId('child-message')
              }
            ],
            'new linked marker'
          )
        ).toEqual([])
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `searches exact frozen projections without repairing a later child tail${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        projectionTable.replaceSession(
          'child',
          [
            {
              sessionId: 'child',
              entryId: 2,
              kind: 'event',
              name: 'child/result',
              sourceType: null,
              sourceId: null,
              sourceSeq: null,
              searchText: 'native frozen projection needle',
              summaryText: 'native frozen projection needle',
              refs: {},
              createdAt: 100
            }
          ],
          2
        )
        const before = db
          .prepare(
            `SELECT projection_version, max_entry_id, updated_at
             FROM deepchat_tape_search_projection_meta
             WHERE session_id = ?`
          )
          .get('child')

        const result = projectionTable.searchSourcesReadOnly(
          [{ sessionId: 'child', maxEntryId: 2 }],
          'native frozen projection needle',
          { limit: 5 }
        )

        expect(result.coveredSources).toEqual([{ sessionId: 'child', maxEntryId: 2 }])
        expect(result.rows).toMatchObject([{ session_id: 'child', entry_id: 2 }])
        expect(
          projectionTable.searchSourcesReadOnly(
            [{ sessionId: 'child', maxEntryId: 3 }],
            'native frozen projection needle',
            { limit: 5 }
          )
        ).toEqual({ rows: [], coveredSources: [] })
        expect(
          db
            .prepare(
              `SELECT projection_version, max_entry_id, updated_at
               FROM deepchat_tape_search_projection_meta
               WHERE session_id = ?`
            )
            .get('child')
        ).toEqual(before)
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `filters stale FTS rows through the base projection after restart${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 2,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'current',
              sourceSeq: 0,
              searchText: 'current Redis marker',
              summaryText: 'current Redis marker',
              refs: { messageId: 'current' },
              createdAt: 200
            }
          ],
          2
        )
        db.prepare(
          `INSERT INTO deepchat_tape_search_fts (
             search_text,
             name,
             session_id,
             entry_id,
             kind,
             source_type,
             source_id,
             source_seq,
             summary_text,
             refs_json,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          'stale removed marker',
          'message/user',
          's1',
          1,
          'message',
          'message',
          'old',
          0,
          'stale removed marker',
          '{"messageId":"old"}',
          100
        )

        const restartedProjectionTable = new DeepChatTapeSearchProjectionTable(db)
        restartedProjectionTable.createTable()

        expect(restartedProjectionTable.isCurrent('s1', 2)).toBe(true)
        expect(restartedProjectionTable.search('s1', 'stale removed marker', { limit: 5 })).toEqual(
          []
        )
        expect(
          restartedProjectionTable.search('s1', 'current Redis marker', { limit: 5 })[0]
        ).toMatchObject({
          entry_id: 2,
          refs_json: '{"messageId":"current"}'
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `recovers same-entry stale FTS after a base-only projection write and restart${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 1,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'm1',
              sourceSeq: 0,
              searchText: 'old durable marker',
              summaryText: 'old durable marker',
              refs: { messageId: 'm1' },
              createdAt: 100
            }
          ],
          1
        )

        projectionTable.disableFtsForTesting()
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 1,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'm1',
              sourceSeq: 0,
              searchText: 'new durable marker',
              summaryText: 'new durable marker',
              refs: { messageId: 'm1' },
              createdAt: 100
            }
          ],
          1
        )
        db.prepare(
          `INSERT INTO deepchat_tape_search_fts (
             search_text,
             name,
             session_id,
             entry_id,
             kind,
             source_type,
             source_id,
             source_seq,
             summary_text,
             refs_json,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          'old durable marker',
          'message/user',
          's1',
          1,
          'message',
          'message',
          'm1',
          0,
          'old durable marker',
          '{"messageId":"m1"}',
          100
        )

        const restartedProjectionTable = new DeepChatTapeSearchProjectionTable(db)
        restartedProjectionTable.createTable()

        expect(restartedProjectionTable.isCurrent('s1', 1)).toBe(true)
        expect(restartedProjectionTable.search('s1', 'old durable marker', { limit: 5 })).toEqual(
          []
        )
        expect(
          restartedProjectionTable.search('s1', 'new durable marker', { limit: 5 })[0]
        ).toMatchObject({
          entry_id: 1,
          search_text: 'new durable marker'
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `rebuilds FTS during append when previous FTS meta is missing after restart${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.disableFtsForTesting()
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 1,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'old',
              sourceSeq: 0,
              searchText: 'old append marker',
              summaryText: 'old append marker',
              refs: { messageId: 'old' },
              createdAt: 100
            }
          ],
          1
        )

        const restartedProjectionTable = new DeepChatTapeSearchProjectionTable(db)
        restartedProjectionTable.createTable()
        restartedProjectionTable.appendSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 2,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'new',
              sourceSeq: 0,
              searchText: 'new append marker',
              summaryText: 'new append marker',
              refs: { messageId: 'new' },
              createdAt: 200
            }
          ],
          2
        )

        expect(restartedProjectionTable.isCurrent('s1', 2)).toBe(true)
        expect(
          restartedProjectionTable.search('s1', 'old append marker', { limit: 1 })[0]
        ).toMatchObject({
          entry_id: 1,
          refs_json: '{"messageId":"old"}'
        })
        expect(
          restartedProjectionTable.search('s1', 'new append marker', { limit: 1 })[0]
        ).toMatchObject({
          entry_id: 2,
          refs_json: '{"messageId":"new"}'
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `rebuilds migrated tape FTS when freshness meta is excluded${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 1,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'old',
              sourceSeq: 0,
              searchText: 'old migrated marker',
              summaryText: 'old migrated marker',
              refs: { messageId: 'old' },
              createdAt: 100
            }
          ],
          1
        )
        db.prepare('DELETE FROM deepchat_tape_search_fts WHERE session_id = ?').run('s1')
        db.prepare('DELETE FROM deepchat_tape_search_fts_meta WHERE session_id = ?').run('s1')

        const migratedProjectionTable = new DeepChatTapeSearchProjectionTable(db)
        migratedProjectionTable.createTable()
        migratedProjectionTable.appendSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 2,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'new',
              sourceSeq: 0,
              searchText: 'new migrated marker',
              summaryText: 'new migrated marker',
              refs: { messageId: 'new' },
              createdAt: 200
            }
          ],
          2
        )

        expect(migratedProjectionTable.isCurrent('s1', 2)).toBe(true)
        expect(
          migratedProjectionTable.search('s1', 'old migrated marker', { limit: 1 })[0]
        ).toMatchObject({
          entry_id: 1,
          refs_json: '{"messageId":"old"}'
        })
        expect(
          migratedProjectionTable.search('s1', 'new migrated marker', { limit: 1 })[0]
        ).toMatchObject({
          entry_id: 2,
          refs_json: '{"messageId":"new"}'
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `keeps common-term FTS searches scoped and bounded on large session sets${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }

        for (let index = 0; index < 180; index += 1) {
          const sessionId = `s-${index}`
          const rows = Array.from({ length: 8 }, (_, offset) => ({
            sessionId,
            entryId: offset + 1,
            kind: 'message' as const,
            name: 'message/user',
            sourceType: 'message' as const,
            sourceId: `m-${index}-${offset}`,
            sourceSeq: offset,
            searchText: `sharedcommon marker session-${index} row-${offset}`,
            summaryText: `sharedcommon marker session-${index} row-${offset}`,
            refs: { messageId: `m-${index}-${offset}` },
            createdAt: index * 10 + offset
          }))
          projectionTable.replaceSession(sessionId, rows, rows.length)
        }

        const planRows = db
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT projection.session_id,
                    projection.entry_id,
                    projection.kind,
                    projection.name,
                    projection.source_type,
                    projection.source_id,
                    projection.source_seq,
                    projection.search_text,
                    projection.summary_text,
                    projection.refs_json,
                    projection.created_at,
                    bm25(deepchat_tape_search_fts) AS score
               FROM deepchat_tape_search_fts
               INNER JOIN deepchat_tape_search_projection AS projection
                 ON projection.session_id = deepchat_tape_search_fts.session_id
                AND projection.entry_id = CAST(deepchat_tape_search_fts.entry_id AS INTEGER)
                AND projection.search_text = deepchat_tape_search_fts.search_text
              WHERE deepchat_tape_search_fts MATCH ?
                AND deepchat_tape_search_fts.session_id = ?
                AND projection.session_id = ?
              ORDER BY score ASC, projection.entry_id DESC
              LIMIT ?`
          )
          .all('"sharedcommon"', 's-42', 's-42', 5) as Array<{ detail: string }>
        const plan = planRows.map((row) => row.detail).join('\n')

        expect(plan).toMatch(/VIRTUAL TABLE INDEX/i)
        expect(plan).toMatch(/SEARCH projection USING (?:COVERING )?INDEX/i)
        expect(plan).not.toMatch(/\bSCAN projection\b/i)

        const startedAt = performance.now()
        const hits = projectionTable.search('s-42', 'sharedcommon', { limit: 5 })
        const elapsedMs = performance.now() - startedAt

        expect(hits).toHaveLength(5)
        expect(hits.every((hit) => hit.session_id === 's-42')).toBe(true)
        expect(elapsedMs).toBeLessThan(1500)
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `does not trust same-entry stale FTS text even when stale FTS meta is current${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 1,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'm1',
              sourceSeq: 0,
              searchText: 'new guarded marker',
              summaryText: 'new guarded marker',
              refs: { messageId: 'm1' },
              createdAt: 100
            }
          ],
          1
        )
        db.prepare('DELETE FROM deepchat_tape_search_fts WHERE session_id = ?').run('s1')
        db.prepare(
          `INSERT INTO deepchat_tape_search_fts (
             search_text,
             name,
             session_id,
             entry_id,
             kind,
             source_type,
             source_id,
             source_seq,
             summary_text,
             refs_json,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          'old guarded marker',
          'message/user',
          's1',
          1,
          'message',
          'message',
          'm1',
          0,
          'old guarded marker',
          '{"messageId":"m1"}',
          100
        )

        const restartedProjectionTable = new DeepChatTapeSearchProjectionTable(db)
        restartedProjectionTable.createTable()

        expect(restartedProjectionTable.isCurrent('s1', 1)).toBe(true)
        expect(restartedProjectionTable.search('s1', 'old guarded marker', { limit: 5 })).toEqual(
          []
        )
        expect(
          restartedProjectionTable.search('s1', 'new guarded marker', { limit: 5 })[0]
        ).toMatchObject({
          entry_id: 1,
          search_text: 'new guarded marker'
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `does not mark a tape projection current when FTS DML fails${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.dropFtsForTesting()
        ;(projectionTable as any).ftsReady = true

        expect(() =>
          projectionTable.replaceSession(
            's1',
            [
              {
                sessionId: 's1',
                entryId: 1,
                kind: 'message',
                name: 'message/user',
                sourceType: 'message',
                sourceId: 'm1',
                sourceSeq: 0,
                searchText: 'Redis TTL',
                summaryText: 'Redis TTL',
                refs: { messageId: 'm1' },
                createdAt: 100
              }
            ],
            1
          )
        ).toThrow()
        expect(projectionTable.isCurrent('s1', 1)).toBe(false)
        expect(projectionTable.getProjectedEntryIds('s1')).toEqual([])
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `filters memory view manifests by message in SQLite before limit${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const table = new DeepChatTapeEntriesTable(db)
        table.createTable()
        table.appendEvent({
          sessionId: 's1',
          name: 'view/assembled',
          data: { ignored: true },
          meta: { messageId: 'msg-old' },
          createdAt: 999
        })
        for (let index = 0; index < 505; index += 1) {
          table.appendAnchor({
            sessionId: 's1',
            name: 'memory/view_assembled',
            state: {
              policyVersion: 1,
              tokenBudget: 1000,
              estimatedTokens: index,
              selected: [`m-${index}`],
              dropped: [],
              queryHash: `hash-${index}`
            },
            meta: { messageId: `msg-${index}` },
            createdAt: index
          })
        }

        const rows = table.listMemoryViewManifestAnchorsBySessions(['s1'], {
          limit: 1,
          messageId: 'msg-0'
        })

        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          kind: 'anchor',
          name: 'memory/view_assembled',
          created_at: 0
        })
        expect(JSON.parse(rows[0].meta_json)).toEqual({ messageId: 'msg-0' })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `queries memory view manifests for large agents without expanding session parameters${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const sessionTable = new NewSessionsTable(db)
        const tapeTable = new DeepChatTapeEntriesTable(db)
        sessionTable.createTable()
        tapeTable.createTable()
        for (let index = 0; index < 1200; index += 1) {
          const sessionId = `s-${index}`
          db.prepare(
            `INSERT INTO new_sessions (
               id,
               agent_id,
               title,
               project_dir,
               is_pinned,
               is_draft,
               active_skills,
               disabled_agent_tools,
               subagent_enabled,
               session_kind,
               parent_session_id,
               subagent_meta_json,
               created_at,
               updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            sessionId,
            'agent-a',
            `Session ${index}`,
            null,
            0,
            0,
            '[]',
            '[]',
            index % 2 === 0 ? 0 : 1,
            index % 2 === 0 ? 'regular' : 'subagent',
            null,
            null,
            index,
            index
          )
          tapeTable.appendAnchor({
            sessionId,
            name: 'memory/view_assembled',
            state: {
              policyVersion: 1,
              tokenBudget: 1000,
              estimatedTokens: index,
              selected: [`m-${index}`],
              dropped: [],
              queryHash: `hash-${index}`
            },
            meta: { messageId: `msg-${index}` },
            createdAt: index
          })
        }
        db.prepare(
          `INSERT INTO new_sessions (
             id,
             agent_id,
             title,
             project_dir,
             is_pinned,
             is_draft,
             active_skills,
             disabled_agent_tools,
             subagent_enabled,
             session_kind,
             parent_session_id,
             subagent_meta_json,
             created_at,
             updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          'other-session',
          'other-agent',
          'Other',
          null,
          0,
          0,
          '[]',
          '[]',
          0,
          'regular',
          null,
          null,
          9999,
          9999
        )
        tapeTable.appendAnchor({
          sessionId: 'other-session',
          name: 'memory/view_assembled',
          state: {
            policyVersion: 1,
            tokenBudget: 1000,
            estimatedTokens: 9999,
            selected: ['other'],
            dropped: [],
            queryHash: 'other'
          },
          meta: { messageId: 'msg-0' },
          createdAt: 9999
        })

        const rows = tapeTable.listMemoryViewManifestAnchorsByAgent('agent-a', {
          messageId: 'msg-0',
          limit: 1
        })

        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          session_id: 's-0',
          kind: 'anchor',
          name: 'memory/view_assembled',
          created_at: 0
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `searches a SQLite tape projection and expands compact context without raw payloads${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const table = new DeepChatTapeEntriesTable(db)
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        table.createTable()
        projectionTable.createTable()
        const service = new SessionTape({
          deepchatTapeEntriesTable: table,
          deepchatTapeSearchProjectionTable: projectionTable,
          deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
        } as any)

        table.append({
          sessionId: 's1',
          kind: 'message',
          name: 'message/user',
          source: { type: 'message', id: 'u1', seq: 0 },
          payload: {
            record: createRecord({
              id: 'u1',
              content: JSON.stringify({
                text: 'Check Redis TTL with /usr/local/bin/deploy --flag and error 42.',
                files: [],
                links: []
              }),
              createdAt: 100,
              updatedAt: 100
            })
          },
          meta: { source: 'live', orderSeq: 1, role: 'user' },
          createdAt: 100
        })
        table.append({
          sessionId: 's1',
          kind: 'tool_result',
          name: 'shell',
          source: { type: 'tool_result', id: 'u1:tc1', seq: 0 },
          payload: {
            messageId: 'u1',
            orderSeq: 2,
            toolCallId: 'tc1',
            exitStatus: 42,
            response: 'Exit code 42 in /tmp/deploy.log'
          },
          meta: { source: 'live', status: 'error' },
          createdAt: 110
        })

        const pathHits = service.search('s1', '/usr/local/bin/deploy', { limit: 5 })
        expect(pathHits).toHaveLength(1)
        expect(pathHits[0]).toMatchObject({
          kind: 'message',
          summary: expect.stringContaining('Redis TTL'),
          refs: {
            messageId: 'u1',
            role: 'user',
            filePaths: expect.arrayContaining(['/usr/local/bin/deploy'])
          }
        })
        expect(pathHits[0]).not.toHaveProperty('payload')
        expect(pathHits[0]).not.toHaveProperty('meta')
        expect(service.search('s1', 'Redis TTL', { limit: 5 }).map((hit) => hit.entryId)).toContain(
          pathHits[0].entryId
        )
        const errorHits = service.search('s1', '42', { kinds: ['tool_result'], limit: 5 })
        expect(errorHits[0]).toMatchObject({
          refs: {
            toolCallId: 'tc1',
            exitStatus: 42
          }
        })
        expect(projectionTable.isCurrent('s1', table.getMaxEntryId('s1'))).toBe(true)

        table.append({
          sessionId: 's1',
          kind: 'message',
          name: 'message/user',
          source: { type: 'message', id: 'u2', seq: 0 },
          payload: {
            record: createRecord({
              id: 'u2',
              orderSeq: 3,
              content: JSON.stringify({ text: 'zoxide marker 简洁', files: [], links: [] }),
              createdAt: 120,
              updatedAt: 120
            })
          },
          meta: { source: 'live', orderSeq: 3, role: 'user' },
          createdAt: 120
        })
        expect(projectionTable.isCurrent('s1', table.getMaxEntryId('s1'))).toBe(false)
        const rebuiltHits = service.search('s1', '简洁', { limit: 5 })
        expect(rebuiltHits.map((hit) => hit.refs?.messageId)).toContain('u2')
        expect(projectionTable.isCurrent('s1', table.getMaxEntryId('s1'))).toBe(true)
        if (projectionTable.hasFtsReadyForTesting()) {
          projectionTable.dropFtsForTesting()
          ;(projectionTable as any).ftsReady = true
          table.append({
            sessionId: 's1',
            kind: 'message',
            name: 'message/user',
            source: { type: 'message', id: 'u3', seq: 0 },
            payload: {
              record: createRecord({
                id: 'u3',
                orderSeq: 4,
                content: JSON.stringify({
                  text: 'fts recovery marker',
                  files: [],
                  links: []
                }),
                createdAt: 130,
                updatedAt: 130
              })
            },
            meta: { source: 'live', orderSeq: 4, role: 'user' },
            createdAt: 130
          })
          const recoveryHits = service.search('s1', 'fts recovery marker', { limit: 5 })
          expect(recoveryHits.map((hit) => hit.refs?.messageId)).toContain('u3')
          expect(projectionTable.isCurrent('s1', table.getMaxEntryId('s1'))).toBe(false)
          expect(projectionTable.hasFtsReadyForTesting()).toBe(false)

          const restoredHits = service.search('s1', 'fts recovery marker', { limit: 5 })
          expect(restoredHits.map((hit) => hit.refs?.messageId)).toContain('u3')
          expect(projectionTable.isCurrent('s1', table.getMaxEntryId('s1'))).toBe(true)
          expect(projectionTable.hasFtsReadyForTesting()).toBe(true)
        }

        const context = service.getContext('s1', [pathHits[0].entryId], {
          before: 0,
          after: 1,
          limit: 2,
          maxBytesPerEntry: 24,
          maxTotalBytes: 24
        })
        expect(context.matchedEntryIds).toEqual([pathHits[0].entryId])
        expect(context.entries[0]).toMatchObject({
          entryId: pathHits[0].entryId,
          summary: expect.stringContaining('Redis TTL'),
          evidence: {
            truncated: true
          }
        })
        expect(context.entries[0].evidence.bytes).toBeLessThanOrEqual(24)
        expect(context.entries[0]).not.toHaveProperty('payload')
        expect(context.entries[0]).not.toHaveProperty('meta')
        const limitedContext = service.getContext(
          's1',
          [pathHits[0].entryId, errorHits[0].entryId],
          {
            before: 0,
            after: 0,
            limit: 1
          }
        )
        expect(limitedContext.entries.map((entry) => entry.entryId)).toEqual([pathHits[0].entryId])
        expect(limitedContext.matchedEntryIds).toEqual([pathHits[0].entryId])
      } finally {
        db.close()
      }
    }
  )
})
