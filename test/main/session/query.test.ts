import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessageRecord, SessionRecord } from '@shared/types/agent-interface'
import { SessionQuery, type SessionQueryDependencies } from '@/session/query'
import { ExecutionJournalCorruptionError } from '@/tape/domain/executionJournal'

const createSessionRecord = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  agentId: 'deepchat',
  title: 'Original title',
  projectDir: null,
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular',
  parentSessionId: null,
  subagentMeta: null,
  createdAt: 100,
  updatedAt: 200,
  ...overrides
})

const createMessage = (overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id: 'm1',
  sessionId: 's1',
  orderSeq: 1,
  role: 'user',
  content: JSON.stringify({ text: 'Summarize this session', files: [] }),
  status: 'sent',
  isContextEdge: 0,
  metadata: '{}',
  createdAt: 100,
  updatedAt: 100,
  ...overrides
})

function createHarness() {
  const records = new Map<string, SessionRecord>([['s1', createSessionRecord()]])
  const sessions = {
    get: vi.fn((sessionId: string) => records.get(sessionId) ?? null),
    getMany: vi.fn((sessionIds: string[]) =>
      sessionIds.flatMap((sessionId) => {
        const record = records.get(sessionId)
        return record ? [record] : []
      })
    ),
    list: vi.fn(() => [...records.values()]),
    listPage: vi.fn(() => ({
      records: [...records.values()],
      nextCursor: null,
      hasMore: false
    })),
    update: vi.fn((sessionId: string, fields: Partial<SessionRecord>) => {
      const record = records.get(sessionId)
      if (record) records.set(sessionId, { ...record, ...fields })
    })
  }
  const runtime = {
    getAgentKind: vi.fn(() => 'deepchat' as const),
    snapshot: vi.fn().mockResolvedValue({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    }),
    snapshotIfHydrated: vi.fn().mockResolvedValue(null),
    waitForFirstTurnReady: vi.fn().mockResolvedValue(true)
  }
  const transcript = {
    getMessages: vi.fn().mockResolvedValue([]),
    listMessagesPage: vi.fn().mockResolvedValue({
      messages: [],
      nextCursor: null,
      hasMore: false
    }),
    getMessageIds: vi.fn().mockResolvedValue([]),
    getMessage: vi.fn().mockResolvedValue(null)
  }
  const tape = {
    getTapeInfo: vi.fn().mockResolvedValue({}),
    searchTape: vi.fn().mockResolvedValue([]),
    getTapeContext: vi.fn().mockResolvedValue({}),
    listTapeAnchors: vi.fn().mockResolvedValue([]),
    handoffTape: vi.fn().mockResolvedValue({}),
    listMessageViewManifests: vi.fn().mockResolvedValue([]),
    listNestedExecutionAuditForMessage: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      state: 'available',
      operations: [],
      truncated: false
    }),
    exportMessageTapeReplaySlice: vi.fn().mockResolvedValue(null),
    listTapeInspectorPage: vi.fn(),
    getTapeInspectorRecordDetail: vi.fn(),
    exportTapeInspectorSupportFacts: vi.fn()
  }
  const messages = { get: vi.fn() }
  const searchResults = { listByMessageId: vi.fn().mockReturnValue([]) }
  const traces = {
    listByMessageId: vi.fn().mockReturnValue([]),
    countByMessageId: vi.fn().mockReturnValue(0),
    listInspectorMetadata: vi
      .fn()
      .mockReturnValue({ rows: [], hasMore: false, appendCursorRowId: null })
  }
  const titles = { summaryTitles: vi.fn().mockResolvedValue('Generated title') }
  const agentConfig = { getAssistantModel: vi.fn().mockResolvedValue(null) }
  const events = { publish: vi.fn() }
  const ui = { refreshSessionUi: vi.fn() }
  const dependencies = {
    sessions,
    runtime,
    transcript,
    tape,
    messages,
    searchResults,
    traces,
    titles,
    agentConfig,
    events,
    ui
  } as unknown as SessionQueryDependencies

  return {
    coordinator: new SessionQuery(dependencies),
    records,
    sessions,
    runtime,
    transcript,
    tape,
    messages,
    searchResults,
    traces,
    titles,
    agentConfig,
    events,
    ui
  }
}

describe('SessionQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('materializes full/list state and keeps lightweight reads non-hydrating', async () => {
    const harness = createHarness()
    harness.runtime.snapshot.mockResolvedValueOnce({
      status: 'generating',
      providerId: 'anthropic',
      modelId: 'claude',
      permissionMode: 'full_access'
    })

    await expect(harness.coordinator.getSession('s1')).resolves.toMatchObject({
      status: 'generating',
      providerId: 'anthropic',
      modelId: 'claude'
    })
    expect(harness.runtime.snapshot).toHaveBeenCalledWith('s1', { lightweight: false })

    harness.runtime.snapshot.mockClear()
    harness.runtime.snapshotIfHydrated.mockResolvedValueOnce({
      status: 'generating',
      providerId: 'anthropic',
      modelId: 'claude',
      permissionMode: 'full_access'
    })
    await expect(harness.coordinator.listLightweight()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 's1', status: 'generating' })]
    })
    expect(harness.runtime.snapshot).not.toHaveBeenCalled()

    await expect(harness.coordinator.getLightweightByIds([' s1 ', 's1', ' '])).resolves.toEqual([
      expect.objectContaining({ id: 's1', status: 'idle' })
    ])
    expect(harness.sessions.getMany).toHaveBeenCalledWith(['s1'])

    await harness.coordinator.listSessions()
    expect(harness.runtime.snapshot).toHaveBeenCalledWith('s1', { lightweight: true })
  })

  it('skips unavailable full projections without poisoning lightweight status', async () => {
    const harness = createHarness()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    harness.runtime.snapshot.mockRejectedValueOnce(new Error('backend unavailable'))

    await expect(harness.coordinator.listSessions()).resolves.toEqual([])
    await expect(harness.coordinator.listLightweight()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 's1', status: 'idle' })]
    })
    expect(warn).toHaveBeenCalledWith(
      '[SessionQuery] Skipping unavailable session id=s1 agent=deepchat:',
      expect.any(Error)
    )
    warn.mockRestore()
  })

  it('dedupes and orders lightweight rows while filtering prioritized subagents', async () => {
    const harness = createHarness()
    const newer = createSessionRecord({ id: 's2', updatedAt: 300 })
    const child = createSessionRecord({ id: 'child', sessionKind: 'subagent', updatedAt: 400 })
    harness.records.set('s2', newer)
    harness.records.set('child', child)
    harness.sessions.listPage.mockReturnValue({
      records: [createSessionRecord(), newer],
      nextCursor: { updatedAt: 200, id: 's1' },
      hasMore: true
    })

    await expect(
      harness.coordinator.listLightweight({ prioritizeSessionId: 'child' })
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: 's2' }), expect.objectContaining({ id: 's1' })],
      nextCursor: { updatedAt: 200, id: 's1' },
      hasMore: true
    })
  })

  it('owns message, Tape, search-result, trace, manifest, and replay reads', async () => {
    const harness = createHarness()
    const message = createMessage()
    harness.transcript.getMessages.mockResolvedValue([message])
    harness.transcript.getMessageIds.mockResolvedValue(['m1'])
    harness.transcript.getMessage.mockResolvedValue(message)
    harness.messages.get.mockReturnValue({ session_id: 's1' })
    harness.tape.getTapeInfo.mockResolvedValue({ sessionId: 's1' })
    harness.tape.searchTape.mockResolvedValue([{ entryId: 1 }])
    harness.tape.getTapeContext.mockResolvedValue({ sessionId: 's1' })
    harness.tape.listTapeAnchors.mockResolvedValue([{ name: 'checkpoint' }])
    harness.tape.handoffTape.mockResolvedValue({ name: 'handoff' })
    harness.tape.listMessageViewManifests.mockResolvedValue([{ id: 'view-1' }])
    harness.tape.listNestedExecutionAuditForMessage.mockResolvedValue({
      schemaVersion: 1,
      state: 'available',
      operations: [{ toolName: 'search', status: 'success' }],
      truncated: false
    })
    harness.tape.exportMessageTapeReplaySlice.mockResolvedValue({ version: 1 })
    harness.searchResults.listByMessageId.mockReturnValue([
      { content: '{', rank: 1, search_id: 'new' },
      {
        content: JSON.stringify({ title: 'Legacy', url: 'https://example.com' }),
        rank: 2,
        search_id: null
      }
    ])
    harness.traces.listByMessageId.mockReturnValue([
      {
        id: 'trace-1',
        message_id: 'm1',
        session_id: 's1',
        provider_id: 'openai',
        model_id: 'gpt-4',
        request_seq: 2,
        logical_round: 1,
        physical_attempt: 2,
        endpoint: '/responses',
        headers_json: '{}',
        body_json: '{}',
        truncated: 1,
        created_at: 123
      }
    ])
    harness.traces.countByMessageId.mockReturnValue(1)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(harness.coordinator.getMessages('s1')).resolves.toEqual([message])
    await harness.coordinator.listMessagesPage('s1', { limit: 10 })
    await expect(harness.coordinator.getMessageIds('s1')).resolves.toEqual(['m1'])
    await expect(harness.coordinator.getMessage('m1')).resolves.toBe(message)
    await expect(harness.coordinator.getTapeInfo('s1')).resolves.toEqual({ sessionId: 's1' })
    await harness.coordinator.searchTape('s1', 'needle', { scope: 'current_and_linked' })
    await harness.coordinator.getTapeContext('s1', [1], { sourceSessionId: 'acp-child' })
    await harness.coordinator.listTapeAnchors('s1')
    await harness.coordinator.handoffTape('s1', 'handoff', { summary: 'handoff summary' })
    await expect(harness.coordinator.listMessageViewManifests(' m1 ')).resolves.toEqual([
      { id: 'view-1' }
    ])
    await expect(harness.coordinator.listNestedExecutionAudit(' m1 ')).resolves.toEqual(
      expect.objectContaining({
        state: 'available',
        operations: [expect.objectContaining({ toolName: 'search', status: 'success' })]
      })
    )
    await expect(harness.coordinator.exportMessageTapeReplaySlice('m1')).resolves.toEqual({
      version: 1
    })
    await expect(harness.coordinator.getSearchResults(' m1 ', 'missing')).resolves.toEqual([
      expect.objectContaining({ title: 'Legacy', rank: 2, searchId: undefined })
    ])
    await expect(harness.coordinator.listMessageTraces('m1')).resolves.toEqual([
      expect.objectContaining({ id: 'trace-1', truncated: true, requestSeq: 2 })
    ])
    await expect(harness.coordinator.getMessageTraceCount(' m1 ')).resolves.toBe(1)
    await expect(harness.coordinator.getMessages('missing')).rejects.toThrow(
      'Session not found: missing'
    )
    expect(warn).toHaveBeenCalledWith(
      '[SessionQuery] Failed to parse search result row:',
      expect.any(SyntaxError)
    )
    expect(harness.tape.searchTape).toHaveBeenCalledWith('s1', 'needle', {
      scope: 'current_and_linked'
    })
    expect(harness.tape.getTapeContext).toHaveBeenCalledWith('s1', [1], {
      sourceSessionId: 'acp-child'
    })
    warn.mockRestore()
  })

  it('projects bounded Inspector pages, details, and metadata-only evidence', async () => {
    const harness = createHarness()
    harness.tape.listTapeInspectorPage.mockReturnValue({
      status: 'ok',
      tapeIncarnationId: 'incarnation-1',
      snapshotMaxEntryId: 8,
      records: [],
      nextCursor: null
    })
    harness.tape.getTapeInspectorRecordDetail.mockReturnValue({
      status: 'not_found',
      tapeIncarnationId: 'incarnation-1'
    })
    harness.traces.listInspectorMetadata.mockReturnValue({
      rows: [
        {
          row_id: 2,
          id: 'trace-2',
          message_id: 'm1',
          session_id: 's1',
          provider_id: 'openai',
          model_id: 'gpt-4',
          request_seq: 3,
          logical_round: 2,
          physical_attempt: null,
          truncated: 1,
          created_at: 456
        }
      ],
      hasMore: true,
      appendCursorRowId: 2
    })

    await expect(
      harness.coordinator.listTapeInspectorPage({ sessionId: 's1', mode: 'tail' })
    ).resolves.toMatchObject({ status: 'ok', snapshotMaxEntryId: 8 })
    await expect(
      harness.coordinator.getTapeInspectorRecordDetail({
        sessionId: 's1',
        expectedTapeIncarnationId: 'incarnation-1',
        entryId: 8
      })
    ).resolves.toEqual({ status: 'not_found', tapeIncarnationId: 'incarnation-1' })
    await expect(
      harness.coordinator.listTapeInspectorEvidence({
        sessionId: 's1',
        mode: 'newer',
        limit: 500,
        physicalAttempt: null
      })
    ).resolves.toEqual({
      records: [
        {
          recordType: 'evidence',
          key: 'trace:trace-2',
          traceId: 'trace-2',
          messageId: 'm1',
          requestSeq: 3,
          logicalRound: 2,
          providerId: 'openai',
          modelId: 'gpt-4',
          createdAt: 456,
          truncated: true
        }
      ],
      nextCursor: null,
      newerCursor: { rowId: 2 }
    })
    expect(harness.traces.listInspectorMetadata).toHaveBeenCalledWith({
      sessionId: 's1',
      mode: 'newer',
      limit: 200,
      physicalAttempt: null
    })
    await expect(
      harness.coordinator.listTapeInspectorEvidence({ sessionId: 'missing', mode: 'older' })
    ).rejects.toThrow('Session not found: missing')
  })

  it('combines bounded support facts with metadata-only evidence and honors resets', async () => {
    const harness = createHarness()
    harness.traces.listInspectorMetadata.mockReturnValue({
      rows: [
        {
          row_id: 1,
          id: 'trace-1',
          message_id: 'm1',
          session_id: 's1',
          provider_id: 'openai',
          model_id: 'gpt-4',
          request_seq: 2,
          logical_round: 1,
          physical_attempt: null,
          endpoint: 'https://private.example',
          headers_json: '{"authorization":"private"}',
          body_json: '{"prompt":"private"}',
          truncated: 1,
          created_at: 456
        }
      ],
      hasMore: true,
      appendCursorRowId: 1
    })
    harness.tape.exportTapeInspectorSupportFacts.mockReturnValue({
      status: 'ok',
      tapeIncarnationId: 'incarnation-1',
      snapshotMaxEntryId: 8,
      facts: [
        {
          record: {
            recordType: 'fact',
            key: 'entry:8',
            entryId: 8,
            kind: 'event',
            family: 'other',
            name: 'future/event',
            createdAt: 400,
            hashes: { payloadHash: 'a'.repeat(64), metaHash: 'b'.repeat(64) }
          },
          disclosure: 'metadata_only',
          provenance: {},
          hashes: { payloadHash: 'a'.repeat(64), metaHash: 'b'.repeat(64) },
          sizes: { payloadBytes: 20, metaBytes: 2 }
        }
      ],
      factsTruncated: true,
      detailDataTruncated: false
    })

    const exported = await harness.coordinator.exportTapeInspectorSupportTrace({
      sessionId: 's1',
      expectedTapeIncarnationId: 'incarnation-1'
    })

    expect(exported).toMatchObject({
      status: 'ok',
      trace: {
        schemaVersion: 1,
        sessionId: 's1',
        tapeIncarnationId: 'incarnation-1',
        snapshotMaxEntryId: 8,
        facts: [{ record: { entryId: 8 } }],
        evidence: [
          {
            traceId: 'trace-1',
            messageId: 'm1',
            requestSeq: 2,
            logicalRound: 1,
            providerId: 'openai',
            modelId: 'gpt-4',
            truncated: true
          }
        ],
        truncated: { facts: true, evidence: true, detailData: false }
      }
    })
    expect(JSON.stringify(exported)).not.toContain('authorization')
    expect(JSON.stringify(exported)).not.toContain('prompt')
    expect(harness.traces.listInspectorMetadata).toHaveBeenCalledWith({
      sessionId: 's1',
      mode: 'older',
      limit: 200
    })
    expect(harness.tape.exportTapeInspectorSupportFacts).toHaveBeenCalledWith({
      sessionId: 's1',
      expectedTapeIncarnationId: 'incarnation-1'
    })

    harness.traces.listInspectorMetadata.mockClear()
    harness.tape.exportTapeInspectorSupportFacts.mockReturnValueOnce({
      status: 'reset',
      tapeIncarnationId: 'incarnation-2',
      snapshotMaxEntryId: 1
    })
    await expect(
      harness.coordinator.exportTapeInspectorSupportTrace({
        sessionId: 's1',
        expectedTapeIncarnationId: 'incarnation-1'
      })
    ).resolves.toEqual({
      status: 'reset',
      tapeIncarnationId: 'incarnation-2',
      snapshotMaxEntryId: 1
    })
    expect(harness.traces.listInspectorMetadata).not.toHaveBeenCalled()
    await expect(
      harness.coordinator.exportTapeInspectorSupportTrace({
        sessionId: 'missing',
        expectedTapeIncarnationId: 'incarnation-1'
      })
    ).rejects.toThrow('Session not found: missing')
  })

  it('keeps opaque provider replay out of client message pages', async () => {
    const harness = createHarness()
    const persistedMessage = createMessage({
      role: 'assistant',
      content: JSON.stringify([
        {
          id: 'ws_1',
          type: 'search',
          status: 'success',
          timestamp: 100,
          extra: {
            actionType: 'search',
            providerReplayJson: JSON.stringify({ private: 'x'.repeat(1024) })
          }
        },
        {
          type: 'legacy-search-block',
          extra: { providerReplayJson: 'legacy-opaque-payload' }
        }
      ])
    })
    harness.transcript.listMessagesPage.mockResolvedValue({
      messages: [persistedMessage],
      nextCursor: null,
      hasMore: false
    })

    const page = await harness.coordinator.listMessagesPage('s1')
    const projectedBlocks = JSON.parse(page.messages[0]?.content ?? '[]')
    const persistedBlocks = JSON.parse(persistedMessage.content)

    expect(projectedBlocks[0]?.extra).toEqual({ actionType: 'search' })
    expect(projectedBlocks[1]?.extra).toBeUndefined()
    expect(persistedBlocks[0]?.extra?.providerReplayJson).toContain('private')
    expect(persistedBlocks[1]?.extra?.providerReplayJson).toBe('legacy-opaque-payload')
  })

  it('fails closed when invalid assistant content contains opaque provider replay', async () => {
    const harness = createHarness()
    const malformedMessage = createMessage({
      id: 'malformed',
      role: 'assistant',
      content: '[{"extra":{"providerReplayJson":"opaque"}}'
    })
    const nonArrayMessage = createMessage({
      id: 'non-array',
      role: 'assistant',
      content: JSON.stringify({ extra: { providerReplayJson: 'opaque' } })
    })
    harness.transcript.listMessagesPage.mockResolvedValue({
      messages: [malformedMessage, nonArrayMessage],
      nextCursor: null,
      hasMore: false
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const page = await harness.coordinator.listMessagesPage('s1')

    expect(page.messages.map((message) => message.content)).toEqual(['[]', '[]'])
    expect(malformedMessage.content).toContain('providerReplayJson')
    expect(nonArrayMessage.content).toContain('providerReplayJson')
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(
      '[ClientMessageProjection] Redacted invalid assistant blocks:',
      expect.any(Error)
    )
    warn.mockRestore()
  })

  it('falls back when manifest and replay projections fail or lose their session', async () => {
    const harness = createHarness()
    harness.messages.get.mockReturnValue({ session_id: 's1' })
    harness.tape.listMessageViewManifests.mockRejectedValue(new Error('manifest failed'))
    harness.tape.listNestedExecutionAuditForMessage.mockRejectedValue(
      new Error('nested audit failed')
    )
    harness.tape.exportMessageTapeReplaySlice.mockRejectedValue(new Error('replay failed'))

    await expect(harness.coordinator.listMessageViewManifests('m1')).resolves.toEqual([])
    await expect(harness.coordinator.listNestedExecutionAudit('m1')).resolves.toMatchObject({
      state: 'unavailable',
      operations: []
    })
    await expect(harness.coordinator.exportMessageTapeReplaySlice('m1')).resolves.toBeNull()

    harness.records.delete('s1')
    harness.tape.listMessageViewManifests.mockClear()
    harness.tape.listNestedExecutionAuditForMessage.mockClear()
    await expect(harness.coordinator.listMessageViewManifests('m1')).resolves.toEqual([])
    await expect(harness.coordinator.listNestedExecutionAudit('m1')).resolves.toMatchObject({
      state: 'available',
      operations: []
    })
    expect(harness.tape.listMessageViewManifests).not.toHaveBeenCalled()
    expect(harness.tape.listNestedExecutionAuditForMessage).not.toHaveBeenCalled()
  })

  it('distinguishes corrupt nested Journal evidence from unavailable storage', async () => {
    const harness = createHarness()
    harness.messages.get.mockReturnValue({ session_id: 's1' })
    harness.tape.listNestedExecutionAuditForMessage.mockRejectedValue(
      new ExecutionJournalCorruptionError('conflicting nested facts')
    )

    await expect(harness.coordinator.listNestedExecutionAudit('m1')).resolves.toMatchObject({
      state: 'corrupt',
      operations: []
    })
  })

  it('owns rename, pin, normalized updates, and UI refresh', async () => {
    const harness = createHarness()

    const renamed = await harness.coordinator.renameSession('s1', '  Renamed  ')
    const pinned = await harness.coordinator.toggleSessionPinned('s1', true)
    expect(harness.records.get('s1')).toMatchObject({ title: 'Renamed', isPinned: true })
    expect(renamed).toMatchObject({ title: 'Renamed' })
    expect(pinned).toMatchObject({ isPinned: true })

    harness.events.publish.mockClear()
    harness.ui.refreshSessionUi.mockClear()
    harness.coordinator.notify({ sessionIds: [' s1 ', 's1', ' ', 's2'] })
    expect(harness.events.publish).toHaveBeenCalledWith({
      sessionIds: ['s1', 's2'],
      reason: 'updated',
      activeSessionId: undefined,
      webContentsId: undefined
    })
    expect(harness.ui.refreshSessionUi).toHaveBeenCalledOnce()

    harness.coordinator.notify()
    expect(harness.events.publish).toHaveBeenLastCalledWith({
      sessionIds: [],
      reason: 'list-refreshed',
      activeSessionId: undefined,
      webContentsId: undefined
    })
  })

  it('uses the preferred title model, falls back, normalizes, and checks both CAS points', async () => {
    const harness = createHarness()
    harness.transcript.getMessages.mockResolvedValue([createMessage()])
    harness.agentConfig.getAssistantModel.mockResolvedValue({
      providerId: 'anthropic',
      modelId: 'claude-assistant'
    })
    harness.titles.summaryTitles
      .mockRejectedValueOnce(new Error('assistant unavailable'))
      .mockResolvedValueOnce(`"${'x'.repeat(100)}"`)

    harness.coordinator.scheduleTitleGeneration({
      sessionId: 's1',
      initialTitle: 'Original title',
      fallbackProviderId: 'openai',
      fallbackModelId: 'gpt-4'
    })

    await vi.waitFor(() => expect(harness.records.get('s1')?.title).toBe('x'.repeat(80)))
    expect(harness.titles.summaryTitles).toHaveBeenNthCalledWith(
      1,
      expect.any(Array),
      'anthropic',
      'claude-assistant'
    )
    expect(harness.titles.summaryTitles).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      'openai',
      'gpt-4'
    )

    const firstCas = createHarness()
    let resolveMessages: (messages: ChatMessageRecord[]) => void = () => undefined
    firstCas.transcript.getMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMessages = resolve
        })
    )
    firstCas.coordinator.scheduleTitleGeneration({
      sessionId: 's1',
      initialTitle: 'Original title',
      fallbackProviderId: 'openai',
      fallbackModelId: 'gpt-4'
    })
    firstCas.records.set('s1', createSessionRecord({ title: 'Manual title' }))
    resolveMessages([createMessage()])
    await vi.waitFor(() => expect(firstCas.transcript.getMessages).toHaveBeenCalled())
    expect(firstCas.titles.summaryTitles).not.toHaveBeenCalled()

    const secondCas = createHarness()
    secondCas.transcript.getMessages.mockResolvedValue([createMessage()])
    let resolveTitle: (title: string) => void = () => undefined
    secondCas.titles.summaryTitles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTitle = resolve
        })
    )
    secondCas.coordinator.scheduleTitleGeneration({
      sessionId: 's1',
      initialTitle: 'Original title',
      fallbackProviderId: 'openai',
      fallbackModelId: 'gpt-4'
    })
    await vi.waitFor(() => expect(secondCas.titles.summaryTitles).toHaveBeenCalledOnce())
    secondCas.records.set('s1', createSessionRecord({ title: 'Manual title' }))
    resolveTitle('Generated title')
    await vi.waitFor(() => expect(secondCas.records.get('s1')?.title).toBe('Manual title'))
    expect(secondCas.sessions.update).not.toHaveBeenCalledWith('s1', {
      title: 'Generated title'
    })
  })
})
