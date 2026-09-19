import {
  describe,
  expect,
  it,
  vi,
  SessionTape,
  DeepChatTapeEntriesTable,
  DatabaseCtor,
  itIfSqlite,
  createTapeTableMock,
  createLinkedTapeService,
  createSubagentLinkInput,
  SqliteTapeLifecycleAdapter
} from './tapeTestHarness'

describe('SessionTape lineage', () => {
  it('links a frozen subagent Tape without copying child entries and retries idempotently', () => {
    const { table, entries } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' },
      { id: 'child-2', session_kind: 'subagent', parent_session_id: 'parent' }
    ])

    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({ sessionId: 'child', name: 'child/result', data: { text: 'done' } })
    const input = {
      parentSessionId: 'parent',
      childSessionId: 'child',
      runId: 'run-1',
      taskId: 'task-1',
      slotId: 'reviewer',
      taskTitle: 'Review',
      outcome: 'completed' as const,
      resultSummary: 'Done'
    }
    const first = service.linkSubagentTape(input)
    table.appendEvent({ sessionId: 'child', name: 'child/late', data: { text: 'late' } })
    const retry = service.linkSubagentTape(input)
    const normalizedRetry = service.linkSubagentTape({
      ...input,
      slotId: ' reviewer ',
      taskTitle: '  Review  ',
      resultSummary: '  Done  '
    })

    expect(first).toEqual({
      linkEntry: { sessionId: 'parent', entryId: 2 },
      childSessionId: 'child',
      childHeadEntryId: 2,
      childEntryCount: 2,
      outcome: 'completed'
    })
    expect(retry).toEqual(first)
    expect(normalizedRetry).toEqual(first)
    const links = entries.filter(
      (entry) => entry.session_id === 'parent' && entry.name === 'subagent/tape_linked'
    )
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      source_type: 'subagent',
      source_id: 'child',
      source_seq: 2
    })
    expect(JSON.parse(links[0].payload_json).data).toMatchObject({
      linkVersion: 2,
      childTapeIdentity: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    expect(
      entries.some((entry) => entry.session_id === 'parent' && entry.name === 'child/result')
    ).toBe(false)
    expect(() => service.linkSubagentTape({ ...input, outcome: 'error' })).toThrow(
      'Subagent Tape link conflicts with finalized task run-1/task-1.'
    )
    expect(() => service.linkSubagentTape({ ...input, slotId: 'writer' })).toThrow(
      'Subagent Tape link conflicts with finalized task run-1/task-1.'
    )
    expect(() => service.linkSubagentTape({ ...input, taskTitle: 'Write' })).toThrow(
      'Subagent Tape link conflicts with finalized task run-1/task-1.'
    )
    expect(() => service.linkSubagentTape({ ...input, resultSummary: 'Changed' })).toThrow(
      'Subagent Tape link conflicts with finalized task run-1/task-1.'
    )

    table.ensureBootstrapAnchor('child-2')
    expect(
      service.linkSubagentTape({
        ...input,
        childSessionId: 'child-2',
        outcome: 'error'
      })
    ).toMatchObject({
      childSessionId: 'child-2',
      outcome: 'error'
    })
    expect(
      entries.filter(
        (entry) => entry.session_id === 'parent' && entry.name === 'subagent/tape_linked'
      )
    ).toHaveLength(2)
  })

  it('rejects a stored subagent link whose task identity no longer matches its provenance', () => {
    const { table, entries } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    const input = createSubagentLinkInput('parent', 'child')
    service.linkSubagentTape(input)

    const link = entries.find(
      (entry) => entry.session_id === 'parent' && entry.name === 'subagent/tape_linked'
    )
    if (!link) {
      throw new Error('Expected subagent Tape link fixture.')
    }
    const payload = JSON.parse(link.payload_json) as {
      data?: Record<string, unknown>
    }
    link.payload_json = JSON.stringify({
      ...payload,
      data: { ...payload.data, runId: 'different-run' }
    })

    expect(() => service.linkSubagentTape(input)).toThrow(
      /Stored subagent Tape link receipt is malformed/
    )
    expect(() => service.getContext('parent', [1], { sourceSessionId: 'child' })).toThrowError(
      /not an authorized direct child/
    )
  })

  it('keeps a version-one link readable while its original unmarked Tape remains present', () => {
    const { table, entries } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/result',
      data: { text: 'version one compatibility marker' }
    })
    const input = createSubagentLinkInput('parent', 'child')
    const receipt = service.linkSubagentTape(input)
    const link = entries.find(
      (entry) => entry.session_id === 'parent' && entry.name === 'subagent/tape_linked'
    )!
    const payload = JSON.parse(link.payload_json)
    payload.data.linkVersion = 1
    delete payload.data.childTapeIdentity
    link.payload_json = JSON.stringify(payload)
    entries.find((entry) => entry.session_id === 'child' && entry.entry_id === 1)!.meta_json = '{}'

    expect(service.linkSubagentTape(input)).toEqual(receipt)
    expect(
      service.search('parent', 'version one compatibility marker', {
        scope: 'linked_subagents'
      })
    ).toMatchObject([{ sessionId: 'child', entryId: 2 }])
  })

  it('fails closed when a version-one link points at malformed incarnation metadata', () => {
    const { table, entries } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/result',
      data: { text: 'malformed incarnation metadata marker' }
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))
    const link = entries.find(
      (entry) => entry.session_id === 'parent' && entry.name === 'subagent/tape_linked'
    )!
    const payload = JSON.parse(link.payload_json)
    payload.data.linkVersion = 1
    delete payload.data.childTapeIdentity
    link.payload_json = JSON.stringify(payload)
    entries.find((entry) => entry.session_id === 'child' && entry.entry_id === 1)!.meta_json = '{'

    expect(() =>
      service.search('parent', 'malformed incarnation metadata marker', {
        scope: 'linked_subagents'
      })
    ).toThrowError(/Linked Tape child is unavailable/)
  })

  it('searches direct linked children at frozen heads with one global limit', () => {
    const { table } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child-a', session_kind: 'subagent', parent_session_id: 'parent' },
      { id: 'child-b', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child-a')
    table.ensureBootstrapAnchor('child-b')
    table.appendEvent({
      sessionId: 'parent',
      name: 'parent/note',
      data: { text: 'shared needle from parent' },
      createdAt: 150
    })
    table.appendEvent({
      sessionId: 'child-a',
      name: 'child/result',
      data: { text: 'shared needle from A' },
      createdAt: 100
    })
    table.appendEvent({
      sessionId: 'child-b',
      name: 'child/result',
      data: { text: 'shared needle from B' },
      createdAt: 200
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child-a'))
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child-b'))
    table.appendEvent({
      sessionId: 'child-a',
      name: 'child/late',
      data: { text: 'shared needle after cutoff' },
      createdAt: 300
    })

    table.ensureBootstrapAnchor.mockClear()
    table.append.mockClear()
    const limited = service.search('parent', 'shared needle', {
      scope: 'linked_subagents',
      limit: 1
    })
    const all = service.search('parent', 'shared needle', {
      scope: 'linked_subagents',
      limit: 10
    })
    const combined = service.search('parent', 'shared needle', {
      scope: 'current_and_linked',
      limit: 10
    })

    expect(limited).toMatchObject([{ sessionId: 'child-b', entryId: 2 }])
    expect(all.map((result) => [result.sessionId, result.entryId])).toEqual([
      ['child-b', 2],
      ['child-a', 2]
    ])
    expect(combined.map((result) => [result.sessionId, result.entryId])).toEqual([
      ['child-b', 2],
      ['parent', 2],
      ['child-a', 2]
    ])
    expect(table.searchEffectiveSourcesAtHeads).toHaveBeenCalledWith(
      [
        { sessionId: 'child-a', maxEntryId: 2 },
        { sessionId: 'child-b', maxEntryId: 2 }
      ],
      'shared needle',
      expect.objectContaining({ limit: 1 })
    )
    expect(table.ensureBootstrapAnchor).not.toHaveBeenCalled()
    expect(table.append).not.toHaveBeenCalled()
  })

  it('falls back all linked sources together when projection coverage is partial', () => {
    const { table } = createTapeTableMock()
    const projectionTable = {
      searchSourcesReadOnly: vi.fn(() => ({
        coveredSources: [{ sessionId: 'child-a', maxEntryId: 2 }],
        rows: [
          {
            session_id: 'child-a',
            entry_id: 2,
            kind: 'event',
            name: 'child/result',
            source_type: null,
            source_id: null,
            source_seq: null,
            search_text: 'shared partial needle',
            summary_text: 'shared partial needle from A',
            refs_json: '{}',
            created_at: 100,
            score: -100
          }
        ]
      }))
    }
    const { service } = createLinkedTapeService(
      table,
      [
        { id: 'parent', session_kind: 'regular', parent_session_id: null },
        { id: 'child-a', session_kind: 'subagent', parent_session_id: 'parent' },
        { id: 'child-b', session_kind: 'subagent', parent_session_id: 'parent' }
      ],
      projectionTable
    )
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child-a')
    table.ensureBootstrapAnchor('child-b')
    table.appendEvent({
      sessionId: 'child-a',
      name: 'child/result',
      data: { text: 'shared partial needle from A' },
      createdAt: 100
    })
    table.appendEvent({
      sessionId: 'child-b',
      name: 'child/result',
      data: { text: 'shared partial needle from B' },
      createdAt: 200
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child-a'))
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child-b'))
    table.searchEffectiveSourcesAtHeads.mockClear()

    const hits = service.search('parent', 'shared partial needle', {
      scope: 'linked_subagents',
      limit: 1
    })

    expect(hits).toMatchObject([{ sessionId: 'child-b', entryId: 2 }])
    expect(table.searchEffectiveSourcesAtHeads).toHaveBeenCalledWith(
      [
        { sessionId: 'child-a', maxEntryId: 2 },
        { sessionId: 'child-b', maxEntryId: 2 }
      ],
      'shared partial needle',
      expect.objectContaining({ limit: 1 })
    )
  })

  it('uses an exact frozen projection read-only after the child appends a late tail', () => {
    const { table } = createTapeTableMock()
    const projectionTable = {
      searchSourcesReadOnly: vi.fn((sources: any[]) => ({
        coveredSources: sources,
        rows: [
          {
            session_id: 'child',
            entry_id: 2,
            kind: 'event',
            name: 'child/result',
            source_type: null,
            source_id: null,
            source_seq: null,
            search_text: 'frozen projection needle',
            summary_text: 'frozen projection needle',
            refs_json: '{}',
            created_at: 100,
            score: -1
          }
        ]
      })),
      replaceSession: vi.fn(),
      appendSession: vi.fn(),
      getByEntryIds: vi.fn().mockReturnValue([]),
      getByEntryIdsIfCurrent: vi.fn().mockReturnValue([])
    }
    const { service } = createLinkedTapeService(
      table,
      [
        { id: 'parent', session_kind: 'regular', parent_session_id: null },
        { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
      ],
      projectionTable
    )
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/result',
      data: { text: 'frozen projection needle' },
      createdAt: 100
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))
    table.appendEvent({
      sessionId: 'child',
      name: 'child/late',
      data: { text: 'frozen projection needle late' },
      createdAt: 200
    })
    table.searchEffectiveSourcesAtHeads.mockClear()

    const hits = service.search('parent', 'frozen projection needle', {
      scope: 'linked_subagents'
    })

    expect(projectionTable.searchSourcesReadOnly).toHaveBeenCalledWith(
      [{ sessionId: 'child', maxEntryId: 2 }],
      'frozen projection needle',
      expect.any(Object)
    )
    expect(hits).toMatchObject([{ sessionId: 'child', entryId: 2 }])
    expect(table.searchEffectiveSourcesAtHeads).not.toHaveBeenCalled()
    expect(projectionTable.replaceSession).not.toHaveBeenCalled()
    expect(projectionTable.appendSession).not.toHaveBeenCalled()
  })

  it('deduplicates repeated child links at the newest finalized snapshot', () => {
    const { table } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/first',
      data: { text: 'first snapshot marker' }
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))
    table.appendEvent({
      sessionId: 'child',
      name: 'child/second',
      data: { text: 'second snapshot marker' }
    })
    service.linkSubagentTape({
      ...createSubagentLinkInput('parent', 'child'),
      runId: 'run-child-second',
      taskId: 'task-child-second'
    })

    expect(
      service.search('parent', 'second snapshot marker', { scope: 'linked_subagents' })
    ).toMatchObject([{ sessionId: 'child', entryId: 3 }])
    expect(table.searchEffectiveSourcesAtHeads).toHaveBeenCalledWith(
      [{ sessionId: 'child', maxEntryId: 3 }],
      'second snapshot marker',
      expect.any(Object)
    )
  })

  it('expands linked context within one source and never crosses the frozen head', () => {
    const { table } = createTapeTableMock()
    const projectionTable = {
      getByEntryIdsIfCurrent: vi.fn(() => [
        {
          session_id: 'child',
          entry_id: 2,
          kind: 'event',
          name: 'child/target',
          source_type: null,
          source_id: null,
          source_seq: null,
          search_text: 'stale projection text',
          summary_text: 'stale projection summary',
          refs_json: '{"stale":true}',
          created_at: 100
        }
      ])
    }
    const { service } = createLinkedTapeService(
      table,
      [
        { id: 'parent', session_kind: 'regular', parent_session_id: null },
        { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
      ],
      projectionTable
    )
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/target',
      data: { text: 'target evidence' },
      createdAt: 100
    })
    table.appendEvent({
      sessionId: 'child',
      name: 'child/neighbor',
      data: { text: 'neighbor evidence' },
      createdAt: 110
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))
    table.appendEvent({
      sessionId: 'child',
      name: 'child/late',
      data: { text: 'late evidence' },
      createdAt: 120
    })
    table.append.mockClear()

    const context = service.getContext('parent', [2], {
      sourceSessionId: 'child',
      before: 0,
      after: 5
    })

    expect(context).toMatchObject({
      sessionId: 'parent',
      sourceSessionId: 'child',
      requestedEntryIds: [2],
      matchedEntryIds: [2]
    })
    expect(context.entries.map((entry) => entry.entryId)).toEqual([2, 3])
    expect(context.entries[0].summary).toContain('target evidence')
    expect(context.entries[0].summary).not.toContain('stale projection')
    expect(table.getEffectiveContextRowsAtHead).toHaveBeenCalledWith(
      { sessionId: 'child', maxEntryId: 3 },
      [2],
      expect.objectContaining({ before: 0, after: 5 })
    )
    expect(projectionTable.getByEntryIdsIfCurrent).not.toHaveBeenCalled()
    expect(table.append).not.toHaveBeenCalled()
  })

  it('rejects non-direct children at write time and after reparenting', () => {
    const { table } = createTapeTableMock()
    const { service, sessionById } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'other-parent', session_kind: 'regular', parent_session_id: null },
      { id: 'sibling', session_kind: 'subagent', parent_session_id: 'other-parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('sibling')

    expect(() => service.linkSubagentTape(createSubagentLinkInput('parent', 'sibling'))).toThrow(
      'Session sibling is not a direct subagent child of parent.'
    )
    expect(
      table
        .getBySession('parent')
        .some((entry: { name: string | null }) => entry.name === 'subagent/tape_linked')
    ).toBe(false)

    sessionById.set('sibling', {
      id: 'sibling',
      session_kind: 'subagent',
      parent_session_id: 'parent'
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'sibling'))
    sessionById.set('sibling', {
      id: 'sibling',
      session_kind: 'subagent',
      parent_session_id: 'other-parent'
    })

    let error: unknown
    try {
      service.getContext('parent', [1], { sourceSessionId: 'sibling' })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({
      code: 'linked_tape_unauthorized',
      parentSessionId: 'parent',
      sourceSessionId: 'sibling'
    })
  })

  it('rejects missing parents and non-subagent children before persisting a link', () => {
    const { table } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'regular-child', session_kind: 'regular', parent_session_id: 'parent' },
      { id: 'orphan', session_kind: 'subagent', parent_session_id: 'missing-parent' }
    ])
    table.ensureBootstrapAnchor('regular-child')
    table.ensureBootstrapAnchor('orphan')

    expect(() =>
      service.linkSubagentTape(createSubagentLinkInput('parent', 'regular-child'))
    ).toThrow('Session regular-child is not a direct subagent child of parent.')
    expect(() =>
      service.linkSubagentTape(createSubagentLinkInput('missing-parent', 'orphan'))
    ).toThrow('Session orphan is not a direct subagent child of missing-parent.')
    expect(
      ['parent', 'missing-parent'].some((sessionId) =>
        table
          .getBySession(sessionId)
          .some((entry: { name: string | null }) => entry.name === 'subagent/tape_linked')
      )
    ).toBe(false)
  })

  it('reports a finalized linked Tape as unavailable after its durable session is deleted', () => {
    const { table } = createTapeTableMock()
    const { service, sessionById } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))
    sessionById.delete('child')

    let error: unknown
    try {
      service.search('parent', 'anything', { scope: 'linked_subagents' })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({
      code: 'linked_tape_unavailable',
      parentSessionId: 'parent',
      sourceSessionId: 'child'
    })
  })

  it('rejects a rebuilt child Tape until a new incarnation is explicitly linked', () => {
    const { table } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/original',
      data: { text: 'original incarnation marker' }
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))

    table.deleteBySession('child')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/rebuilt',
      data: { text: 'rebuilt incarnation marker' }
    })
    expect(
      service.search('child', 'rebuilt incarnation marker', { scope: 'current' })
    ).toHaveLength(1)
    expect(() =>
      service.search('parent', 'rebuilt incarnation marker', { scope: 'linked_subagents' })
    ).toThrowError(/Linked Tape child is unavailable/)

    service.linkSubagentTape({
      ...createSubagentLinkInput('parent', 'child'),
      runId: 'run-rebuilt-child',
      taskId: 'task-rebuilt-child'
    })
    expect(
      service.search('parent', 'rebuilt incarnation marker', { scope: 'linked_subagents' })
    ).toMatchObject([{ sessionId: 'child', entryId: 2 }])
  })

  itIfSqlite('detects linked Tape replacement after entry ids are reused in SQLite', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      const lifecycle = new SqliteTapeLifecycleAdapter(db)
      table.createTable()
      const { service } = createLinkedTapeService(table, [
        { id: 'parent', session_kind: 'regular', parent_session_id: null },
        { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
      ])
      table.ensureBootstrapAnchor('parent')
      table.ensureBootstrapAnchor('child')
      table.appendEvent({
        sessionId: 'child',
        name: 'child/original',
        data: { text: 'native original incarnation' }
      })
      service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))

      lifecycle.deleteBySession('child')
      table.ensureBootstrapAnchor('child')
      table.appendEvent({
        sessionId: 'child',
        name: 'child/rebuilt',
        data: { text: 'native rebuilt incarnation' }
      })

      expect(() =>
        service.search('parent', 'native rebuilt incarnation', { scope: 'linked_subagents' })
      ).toThrowError(/Linked Tape child is unavailable/)
    } finally {
      db.close()
    }
  })

  it('reads legacy external merge links and keeps legacy discard audit-only', () => {
    const { table, entries } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'legacy-child', session_kind: 'subagent', parent_session_id: 'parent' },
      { id: 'malformed-child', session_kind: 'subagent', parent_session_id: 'parent' },
      { id: 'discarded-child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('legacy-child')
    table.ensureBootstrapAnchor('malformed-child')
    table.ensureBootstrapAnchor('discarded-child')
    const legacyBootstrap = entries.find(
      (entry) => entry.session_id === 'legacy-child' && entry.entry_id === 1
    )!
    legacyBootstrap.meta_json = '{}'
    table.appendEvent({
      sessionId: 'legacy-child',
      name: 'child/result',
      data: { text: 'legacy link needle' }
    })
    table.appendEvent({
      sessionId: 'parent',
      name: 'fork/merge',
      source: { type: 'fork', id: 'legacy-child', seq: 0 },
      provenanceKey: 'fork:parent:legacy-child:external-merge:event',
      data: {
        forkId: 'legacy-child',
        forkSessionId: 'legacy-child',
        referencedEntryCount: 2,
        status: 'completed'
      }
    })
    table.appendEvent({
      sessionId: 'malformed-child',
      name: 'child/result',
      data: { text: 'malformed legacy link needle' }
    })
    table.appendEvent({
      sessionId: 'parent',
      name: 'fork/merge',
      source: { type: 'fork', id: 'malformed-child', seq: 1 },
      provenanceKey: 'fork:parent:malformed-child:external-merge:event',
      data: {
        forkId: 'malformed-child',
        forkSessionId: 'malformed-child',
        referencedEntryCount: 2,
        status: 'completed'
      }
    })
    table.appendEvent({
      sessionId: 'parent',
      name: 'fork/discard',
      source: { type: 'fork', id: 'discarded-child', seq: 0 },
      provenanceKey: 'fork:parent:discarded-child:external-discard:event',
      data: {
        forkId: 'discarded-child',
        forkSessionId: 'discarded-child',
        status: 'cancelled'
      }
    })

    expect(
      service.search('parent', 'legacy link needle', { scope: 'linked_subagents' })
    ).toMatchObject([{ sessionId: 'legacy-child', entryId: 2 }])
    expect(
      service.search('parent', 'malformed legacy link needle', { scope: 'linked_subagents' })
    ).toEqual([])
    let error: unknown
    try {
      service.getContext('parent', [1], { sourceSessionId: 'discarded-child' })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: 'linked_tape_unauthorized' })
  })
})
