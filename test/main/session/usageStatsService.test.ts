import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTranscript } from '@/session/data/transcript'
import { SessionTape } from '@/tape/application/sessionTape'
import { DASHBOARD_STATS_BACKFILL_KEY, type UsageStatsRecordInput } from '@/session/usageStats'
import { UsageStatsService } from '@/session/usageStatsService'
import type { PermissionMode } from '@shared/types/agent-interface'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import {
  buildTapeCompactionModelCallEvent,
  parseTapeCompactionModelCallEvent,
  TAPE_COMPACTION_MODEL_CALL_EVENT_NAME
} from '@/tape/domain/compactionUsage'

vi.mock('@/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/events')>()
  return {
    ...actual,
    SESSION_EVENTS: {
      LIST_UPDATED: 'session:list-updated',
      ACTIVATED: 'session:activated',
      DEACTIVATED: 'session:deactivated',
      STATUS_CHANGED: 'session:status-changed',
      COMPACTION_UPDATED: 'session:compaction-updated'
    }
  }
})

vi.mock('@/agent/shared/process/rtkRuntimeService', () => ({
  RTK_ENABLED_SETTING_KEY: 'rtkEnabled',
  rtkRuntimeService: {
    startHealthCheck: vi.fn().mockResolvedValue(undefined),
    retryHealthCheck: vi.fn().mockResolvedValue(undefined),
    getDashboardData: vi.fn().mockResolvedValue({
      scope: 'deepchat',
      enabled: true,
      effectiveEnabled: true,
      available: true,
      health: 'healthy',
      checkedAt: Date.UTC(2026, 2, 1, 12, 0, 0),
      source: 'bundled',
      failureStage: null,
      failureMessage: null,
      summary: {
        totalCommands: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalSavedTokens: 0,
        avgSavingsPct: 0,
        totalTimeMs: 0,
        avgTimeMs: 0
      },
      daily: []
    })
  }
}))

type SessionRow = {
  id: string
  provider_id: string
  model_id: string
  permission_mode: PermissionMode
}

type MessageRow = {
  id: string
  session_id: string
  order_seq: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  status: 'pending' | 'sent' | 'error'
  metadata: string | null
  is_context_edge: number
  trace_count: number
  created_at: number
  updated_at: number
}

type UsageStatsRow = {
  usage_id: string
  message_id: string
  usage_category: 'chat' | 'compaction'
  compaction_attempt_id: string | null
  provider_call_id: string | null
  provider_call_seq: number | null
  session_id: string
  usage_date: string
  provider_id: string
  model_id: string
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  cached_input_tokens: number | null
  cache_write_input_tokens: number | null
  source: 'backfill' | 'live'
  created_at: number
  updated_at: number
}

function aggregateUsageRows(rows: UsageStatsRow[]) {
  let messageCount = 0
  const sessionIds = new Set<string>()
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let cachedInputTokens = 0
  let cacheMeasuredInputTokens = 0

  for (const row of rows) {
    messageCount += row.usage_category === 'chat' ? 1 : 0
    if (row.usage_category === 'chat') {
      sessionIds.add(row.session_id)
    }
    inputTokens += row.input_tokens ?? 0
    outputTokens += row.output_tokens ?? 0
    totalTokens += row.total_tokens ?? 0
    cachedInputTokens += row.cached_input_tokens ?? 0
    if (row.cached_input_tokens !== null) {
      cacheMeasuredInputTokens += row.input_tokens ?? 0
    }
  }

  return {
    messageCount,
    sessionCount: sessionIds.size,
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    cacheMeasuredInputTokens
  }
}

function createMockProviderSettings() {
  const store = new Map<string, unknown>()
  const providers = [{ id: 'openai', name: 'OpenAI' }]

  return {
    getDefaultModel: vi.fn().mockReturnValue({ providerId: 'openai', modelId: 'gpt-4o' }),
    getModelConfig: vi.fn().mockReturnValue({}),
    getAcpAgents: vi.fn().mockResolvedValue([]),
    getProviders: vi.fn().mockReturnValue(providers),
    getProviderById: vi.fn((providerId: string) =>
      providers.find((item) => item.id === providerId)
    ),
    getSetting: vi.fn((key: string) => store.get(key)),
    setSetting: vi.fn((key: string, value: unknown) => {
      store.set(key, value)
    }),
    store
  }
}

function createMockSqlitePresenter() {
  const sessions = new Map<string, SessionRow>()
  const messages = new Map<string, MessageRow>()
  const usageStats = new Map<string, UsageStatsRow>()
  const tapeEntries: DeepChatTapeEntryRow[] = []

  const deepchatSessionsTable = {
    create(sessionId: string, providerId: string, modelId: string, permissionMode: PermissionMode) {
      sessions.set(sessionId, {
        id: sessionId,
        provider_id: providerId,
        model_id: modelId,
        permission_mode: permissionMode
      })
    },
    get(sessionId: string) {
      return sessions.get(sessionId) ?? null
    }
  }

  const buildAssistantUsageCandidates = () =>
    Array.from(messages.values())
      .filter((row) => row.role === 'assistant' && typeof row.metadata === 'string')
      .map((row) => {
        const session = sessions.get(row.session_id)
        return {
          id: row.id,
          session_id: row.session_id,
          metadata: row.metadata,
          provider_id: session?.provider_id ?? null,
          model_id: session?.model_id ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at
        }
      })
      .sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id))

  const deepchatMessagesTable = {
    insert(input: {
      id: string
      sessionId: string
      orderSeq: number
      role: MessageRow['role']
      content: string
      status: MessageRow['status']
      metadata?: string
      createdAt?: number
      updatedAt?: number
    }) {
      const now = Date.now()
      messages.set(input.id, {
        id: input.id,
        session_id: input.sessionId,
        order_seq: input.orderSeq,
        role: input.role,
        content: input.content,
        status: input.status,
        metadata: input.metadata ?? null,
        is_context_edge: 0,
        trace_count: 0,
        created_at: input.createdAt ?? now,
        updated_at: input.updatedAt ?? input.createdAt ?? now
      })
    },
    get(messageId: string) {
      return messages.get(messageId)
    },
    updateContentAndStatus(
      messageId: string,
      content: string,
      status: MessageRow['status'],
      metadata?: string
    ) {
      const row = messages.get(messageId)
      if (!row) return
      row.content = content
      row.status = status
      if (metadata !== undefined) {
        row.metadata = metadata
      }
      row.updated_at = Date.now()
    },
    listAssistantUsageCandidates() {
      return buildAssistantUsageCandidates()
    },
    listAssistantUsageCandidatesPage(
      cursor: { createdAt: number; id: string } | null,
      limit: number
    ) {
      return buildAssistantUsageCandidates()
        .filter(
          (row) =>
            !cursor ||
            row.created_at > cursor.createdAt ||
            (row.created_at === cursor.createdAt && row.id > cursor.id)
        )
        .slice(0, limit)
    }
  }

  const deepchatUsageStatsTable = {
    upsert(input: UsageStatsRecordInput) {
      const usageId = input.usageId ?? input.messageId ?? ''
      const existing = usageStats.get(usageId)
      usageStats.set(usageId, {
        usage_id: usageId,
        message_id: input.messageId ?? usageId,
        usage_category: input.category ?? 'chat',
        compaction_attempt_id: input.compactionAttemptId ?? null,
        provider_call_id: input.providerCallId ?? null,
        provider_call_seq: input.providerCallSeq ?? null,
        session_id: input.sessionId,
        usage_date: input.usageDate,
        provider_id: input.providerId,
        model_id: input.modelId,
        input_tokens: input.inputTokens === undefined ? 0 : input.inputTokens,
        output_tokens: input.outputTokens === undefined ? 0 : input.outputTokens,
        total_tokens: input.totalTokens === undefined ? 0 : input.totalTokens,
        cached_input_tokens: input.cachedInputTokens === undefined ? 0 : input.cachedInputTokens,
        cache_write_input_tokens:
          input.cacheWriteInputTokens === undefined ? 0 : input.cacheWriteInputTokens,
        source: existing?.source === 'live' ? 'live' : input.source,
        created_at: input.createdAt,
        updated_at: input.updatedAt
      })
    },
    getByMessageId(messageId: string) {
      return (
        Array.from(usageStats.values()).find(
          (row) => row.message_id === messageId && row.usage_category === 'chat'
        ) ?? null
      )
    },
    count() {
      return usageStats.size
    },
    getRecordingStartedAt() {
      const rows = Array.from(usageStats.values()).filter((row) => row.usage_category === 'chat')
      if (rows.length === 0) {
        return null
      }
      return Math.min(...rows.map((row) => row.created_at))
    },
    getSummary() {
      return aggregateUsageRows(Array.from(usageStats.values()))
    },
    getMostActiveDay() {
      const buckets = new Map<string, number>()

      for (const row of usageStats.values()) {
        if (row.usage_category !== 'chat') continue
        buckets.set(row.usage_date, (buckets.get(row.usage_date) ?? 0) + 1)
      }

      const rows = Array.from(buckets.entries())
        .map(([date, messageCount]) => ({ date, messageCount }))
        .sort((left, right) => {
          if (right.messageCount !== left.messageCount) {
            return right.messageCount - left.messageCount
          }

          return left.date.localeCompare(right.date)
        })

      return rows[0] ?? { date: null, messageCount: 0 }
    },
    getDailyCalendarRows(dateFrom: string) {
      const buckets = new Map<
        string,
        {
          date: string
          messageCount: number
          inputTokens: number
          outputTokens: number
          totalTokens: number
          cachedInputTokens: number
        }
      >()

      for (const row of usageStats.values()) {
        if (row.usage_category !== 'chat' || row.usage_date < dateFrom) {
          continue
        }

        const current = buckets.get(row.usage_date) ?? {
          date: row.usage_date,
          messageCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0
        }

        current.messageCount += row.usage_category === 'chat' ? 1 : 0
        current.inputTokens += row.input_tokens ?? 0
        current.outputTokens += row.output_tokens ?? 0
        current.totalTokens += row.total_tokens ?? 0
        current.cachedInputTokens += row.cached_input_tokens ?? 0
        buckets.set(row.usage_date, current)
      }

      return Array.from(buckets.values()).sort((left, right) => left.date.localeCompare(right.date))
    },
    getProviderBreakdownRows() {
      const buckets = new Map<string, UsageStatsRow[]>()
      for (const row of usageStats.values()) {
        const list = buckets.get(row.provider_id) ?? []
        list.push(row)
        buckets.set(row.provider_id, list)
      }

      return Array.from(buckets.entries()).map(([id, rows]) => ({
        id,
        ...aggregateUsageRows(rows)
      }))
    },
    getModelBreakdownRows(limit: number) {
      const buckets = new Map<string, UsageStatsRow[]>()
      for (const row of usageStats.values()) {
        const list = buckets.get(row.model_id) ?? []
        list.push(row)
        buckets.set(row.model_id, list)
      }

      return Array.from(buckets.entries())
        .map(([id, rows]) => ({
          id,
          ...aggregateUsageRows(rows)
        }))
        .sort(
          (left, right) => right.totalTokens - left.totalTokens || left.id.localeCompare(right.id)
        )
        .slice(0, limit)
    },
    getCategoryBreakdownRows() {
      const buckets = new Map<'chat' | 'compaction', UsageStatsRow[]>()
      for (const row of usageStats.values()) {
        const list = buckets.get(row.usage_category) ?? []
        list.push(row)
        buckets.set(row.usage_category, list)
      }
      return Array.from(buckets.entries()).map(([id, rows]) => ({
        id,
        eventCount: rows.length,
        knownUsageCount: rows.filter(
          (row) =>
            row.input_tokens !== null || row.output_tokens !== null || row.total_tokens !== null
        ).length,
        unknownUsageCount: rows.filter(
          (row) =>
            row.input_tokens === null && row.output_tokens === null && row.total_tokens === null
        ).length,
        inputTokens: rows.reduce((total, row) => total + (row.input_tokens ?? 0), 0),
        outputTokens: rows.reduce((total, row) => total + (row.output_tokens ?? 0), 0),
        totalTokens: rows.reduce((total, row) => total + (row.total_tokens ?? 0), 0)
      }))
    }
  }

  const compactionUsageReader = {
    listCompactionModelCallsPage(
      cursor: { sessionId: string; entryId: number } | null,
      limit: number
    ) {
      return tapeEntries
        .filter(
          (row) =>
            row.kind === 'event' &&
            row.name === TAPE_COMPACTION_MODEL_CALL_EVENT_NAME &&
            (!cursor ||
              row.session_id > cursor.sessionId ||
              (row.session_id === cursor.sessionId && row.entry_id > cursor.entryId))
        )
        .sort(
          (left, right) =>
            left.session_id.localeCompare(right.session_id) || left.entry_id - right.entry_id
        )
        .slice(0, limit)
        .map((row) => ({
          sessionId: row.session_id,
          entryId: row.entry_id,
          event: parseTapeCompactionModelCallEvent(row)
        }))
    }
  }

  return {
    compactionUsageReader,
    deepchatSessionsTable,
    deepchatMessagesTable,
    deepchatAssistantBlocksTable: {
      replaceForMessage: vi.fn(),
      listByMessageId: vi.fn().mockReturnValue([]),
      listByMessageIds: vi.fn().mockReturnValue([])
    },
    deepchatSearchDocumentsTable: {
      upsert: vi.fn()
    },
    deepchatUserMessagesTable: {
      get: vi.fn().mockReturnValue(undefined),
      listByMessageIds: vi.fn().mockReturnValue([])
    },
    deepchatUserMessageFilesTable: {
      listByMessageIds: vi.fn().mockReturnValue([])
    },
    deepchatUserMessageLinksTable: {
      listByMessageIds: vi.fn().mockReturnValue([])
    },
    deepchatMessageTracesTable: {
      listByMessageId: vi.fn().mockReturnValue([]),
      countByMessageId: vi.fn().mockReturnValue(0)
    },
    deepchatMessageSearchResultsTable: {
      listByMessageId: vi.fn().mockReturnValue([])
    },
    deepchatTapeEntriesTable: {
      ensureBootstrapAnchor: vi.fn(),
      append: vi.fn(),
      listEventsByNamePage(
        name: string,
        cursor: { sessionId: string; entryId: number } | null,
        limit: number
      ) {
        return tapeEntries
          .filter(
            (row) =>
              row.kind === 'event' &&
              row.name === name &&
              (!cursor ||
                row.session_id > cursor.sessionId ||
                (row.session_id === cursor.sessionId && row.entry_id > cursor.entryId))
          )
          .sort(
            (left, right) =>
              left.session_id.localeCompare(right.session_id) || left.entry_id - right.entry_id
          )
          .slice(0, limit)
      },
      testAppendEvent(row: DeepChatTapeEntryRow) {
        tapeEntries.push(row)
      }
    },
    deepchatUsageStatsTable,
    newSessionsTable: {
      create: vi.fn(),
      get: vi.fn().mockReturnValue(null),
      list: vi.fn().mockReturnValue([]),
      update: vi.fn(),
      delete: vi.fn(),
      getDisabledAgentTools: vi.fn().mockReturnValue([]),
      updateDisabledAgentTools: vi.fn(),
      getActiveSkills: vi.fn().mockReturnValue([])
    },
    legacyImportStatusTable: {
      get: vi.fn().mockReturnValue(null),
      upsert: vi.fn()
    }
  } as any
}

describe('UsageStatsService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createService() {
    const sqlitePresenter = createMockSqlitePresenter()
    const providerSettings = createMockProviderSettings()
    const service = new UsageStatsService(
      sqlitePresenter,
      providerSettings as any,
      {
        get: (key) => providerSettings.getSetting(key),
        set: (key, value) => providerSettings.setSetting(key, value)
      },
      sqlitePresenter.compactionUsageReader
    )

    return {
      service,
      sqlitePresenter,
      providerSettings
    }
  }

  it('backfills current deepchat_messages and uses session provider/model fallback', async () => {
    const { service, sqlitePresenter, providerSettings } = createService()
    const listAllSpy = vi.spyOn(
      sqlitePresenter.deepchatMessagesTable,
      'listAssistantUsageCandidates'
    )
    const listPageSpy = vi.spyOn(
      sqlitePresenter.deepchatMessagesTable,
      'listAssistantUsageCandidatesPage'
    )

    sqlitePresenter.deepchatSessionsTable.create('session-1', 'openai', 'gpt-4o', 'full_access')
    sqlitePresenter.deepchatMessagesTable.insert({
      id: 'message-1',
      sessionId: 'session-1',
      orderSeq: 1,
      role: 'assistant',
      content: '[]',
      status: 'sent',
      metadata: JSON.stringify({
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
        cachedInputTokens: 15,
        cacheWriteInputTokens: 5
      }),
      createdAt: Date.UTC(2026, 2, 10, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 10, 8, 0, 1)
    })

    await service.startBackfill()

    expect(listPageSpy).toHaveBeenCalled()
    expect(listAllSpy).not.toHaveBeenCalled()

    const row = sqlitePresenter.deepchatUsageStatsTable.getByMessageId('message-1')
    expect(row).toMatchObject({
      message_id: 'message-1',
      provider_id: 'openai',
      model_id: 'gpt-4o',
      cached_input_tokens: 15,
      cache_write_input_tokens: 5,
      source: 'backfill'
    })

    const status = providerSettings.store.get(DASHBOARD_STATS_BACKFILL_KEY) as {
      status: string
      finishedAt: number
    }
    expect(status.status).toBe('completed')
    expect(status.finishedAt).toBeGreaterThan(0)
  })

  it('does not treat compaction transcript markers as chat usage during backfill', async () => {
    const { service, sqlitePresenter } = createService()
    sqlitePresenter.deepchatSessionsTable.create('session-1', 'openai', 'gpt-4o', 'full_access')
    sqlitePresenter.deepchatMessagesTable.insert({
      id: 'compaction-marker',
      sessionId: 'session-1',
      orderSeq: 1,
      role: 'assistant',
      content: '[]',
      status: 'sent',
      metadata: JSON.stringify({
        messageType: 'compaction',
        compactionStatus: 'compacted',
        compactionAttemptId: 'attempt-1',
        summaryUpdatedAt: 1
      }),
      createdAt: Date.UTC(2026, 2, 10, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 10, 8, 0, 1)
    })

    await service.startBackfill()

    expect(sqlitePresenter.deepchatUsageStatsTable.count()).toBe(0)
  })

  it('rebuilds compaction usage from valid Tape facts without treating missing totals as zero', async () => {
    const { service, sqlitePresenter } = createService()
    const event = buildTapeCompactionModelCallEvent(
      {
        sessionId: 'session-1',
        compactionMessageId: 'marker-1',
        compactionAttemptId: 'attempt-1',
        providerCallId: 'call-1',
        providerId: 'openai',
        modelId: 'gpt-4o',
        status: 'completed',
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: null },
        startedAt: 10,
        completedAt: 20
      },
      1
    )
    sqlitePresenter.deepchatTapeEntriesTable.testAppendEvent({
      session_id: 'session-1',
      entry_id: 2,
      kind: 'event',
      name: 'compaction/model_call_completed',
      source_type: 'runtime_event',
      source_id: 'attempt-1',
      source_seq: 1,
      provenance_key: 'compaction-model-call:attempt-1:call-1',
      payload_json: JSON.stringify({ name: 'compaction/model_call_completed', data: event }),
      meta_json: '{}',
      created_at: 20
    })
    sqlitePresenter.deepchatTapeEntriesTable.testAppendEvent({
      session_id: 'session-1',
      entry_id: 3,
      kind: 'event',
      name: 'compaction/model_call_completed',
      source_type: 'runtime_event',
      source_id: 'invalid-attempt',
      source_seq: 1,
      provenance_key: 'invalid',
      payload_json: '{}',
      meta_json: '{}',
      created_at: 21
    })

    await service.startBackfill()

    expect(sqlitePresenter.deepchatUsageStatsTable.count()).toBe(1)
    expect(sqlitePresenter.deepchatUsageStatsTable.getCategoryBreakdownRows()).toEqual([
      {
        id: 'compaction',
        eventCount: 1,
        knownUsageCount: 1,
        unknownUsageCount: 0,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 0
      }
    ])
  })

  it('keeps concurrent backfill requests single-flight', async () => {
    const { service, sqlitePresenter, providerSettings } = createService()
    sqlitePresenter.deepchatSessionsTable.create('session-1', 'openai', 'gpt-4o', 'full_access')
    for (let index = 0; index < 50; index += 1) {
      sqlitePresenter.deepchatMessagesTable.insert({
        id: `message-${index}`,
        sessionId: 'session-1',
        orderSeq: index,
        role: 'assistant',
        content: '[]',
        status: 'sent',
        metadata: JSON.stringify({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
        createdAt: index,
        updatedAt: index
      })
    }
    let releaseYield: (() => void) | undefined
    const blockedYield = new Promise<void>((resolve) => {
      releaseYield = resolve
    })
    const taskContext = {
      reportProgress: vi.fn(),
      yield: vi.fn(() => blockedYield)
    }

    const first = service.startBackfill(taskContext as never)
    await vi.waitFor(() => expect(taskContext.yield).toHaveBeenCalledTimes(1))
    const second = service.startBackfill(taskContext as never)

    const runningWrites = providerSettings.setSetting.mock.calls.filter(
      ([key, value]) =>
        key === DASHBOARD_STATS_BACKFILL_KEY &&
        (value as { status?: string } | undefined)?.status === 'running' &&
        (value as { processedCount?: number } | undefined)?.processedCount === 0
    )
    expect(runningWrites).toHaveLength(1)

    releaseYield?.()
    await Promise.all([first, second])
    expect(sqlitePresenter.deepchatUsageStatsTable.count()).toBe(50)
  })

  it('normalizes stale running state before restarting backfill', async () => {
    const { service, providerSettings } = createService()
    providerSettings.store.set(DASHBOARD_STATS_BACKFILL_KEY, {
      status: 'running',
      startedAt: 1,
      finishedAt: null,
      error: null,
      updatedAt: 1,
      processedCount: 12
    })

    await service.startBackfill()

    expect(providerSettings.setSetting).toHaveBeenCalledWith(
      DASHBOARD_STATS_BACKFILL_KEY,
      expect.objectContaining({
        status: 'failed',
        error: 'Usage stats backfill timed out'
      })
    )
    expect(providerSettings.store.get(DASHBOARD_STATS_BACKFILL_KEY)).toMatchObject({
      status: 'completed'
    })
  })

  it('keeps a single stats row when live finalize updates a previously backfilled message', async () => {
    const { service, sqlitePresenter } = createService()
    const messageStore = new SessionTranscript(sqlitePresenter, new SessionTape(sqlitePresenter))

    sqlitePresenter.deepchatSessionsTable.create('session-1', 'openai', 'gpt-4o', 'full_access')
    sqlitePresenter.deepchatMessagesTable.insert({
      id: 'message-1',
      sessionId: 'session-1',
      orderSeq: 1,
      role: 'assistant',
      content: '[]',
      status: 'sent',
      metadata: JSON.stringify({
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200
      }),
      createdAt: Date.UTC(2026, 2, 10, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 10, 8, 0, 1)
    })

    await service.startBackfill()

    messageStore.finalizeAssistantMessage(
      'message-1',
      [],
      JSON.stringify({
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 140,
        outputTokens: 60,
        totalTokens: 200,
        cachedInputTokens: 20,
        cacheWriteInputTokens: 0
      })
    )

    expect(sqlitePresenter.deepchatUsageStatsTable.count()).toBe(1)
    const row = sqlitePresenter.deepchatUsageStatsTable.getByMessageId('message-1')
    expect(row).toMatchObject({
      source: 'live',
      cached_input_tokens: 20,
      input_tokens: 140,
      output_tokens: 60
    })
  })

  it('reads dashboard data from deepchat_usage_stats only', async () => {
    const { service, sqlitePresenter } = createService()

    sqlitePresenter.deepchatSessionsTable.create('session-1', 'openai', 'gpt-4o', 'full_access')
    sqlitePresenter.deepchatMessagesTable.insert({
      id: 'message-1',
      sessionId: 'session-1',
      orderSeq: 1,
      role: 'assistant',
      content: '[]',
      status: 'sent',
      metadata: JSON.stringify({
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120
      }),
      createdAt: Date.UTC(2026, 2, 10, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 10, 8, 0, 1)
    })

    const dashboard = await service.getDashboard()

    expect(dashboard.summary.messageCount).toBe(0)
    expect(dashboard.summary.sessionCount).toBe(0)
    expect(dashboard.summary.totalTokens).toBe(0)
    expect(dashboard.summary.mostActiveDay).toEqual({ date: null, messageCount: 0 })
    expect(dashboard.providerBreakdown).toEqual([])
    expect(dashboard.calendar).toHaveLength(365)
  })

  it('returns session count and most active day from usage stats summary', async () => {
    const { service, sqlitePresenter } = createService()

    sqlitePresenter.deepchatUsageStatsTable.upsert({
      messageId: 'message-1',
      sessionId: 'session-1',
      usageDate: '2026-03-03',
      providerId: 'openai',
      modelId: 'gpt-4o',
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      source: 'live',
      createdAt: Date.UTC(2026, 2, 3, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 3, 8, 0, 1)
    })
    sqlitePresenter.deepchatUsageStatsTable.upsert({
      messageId: 'message-2',
      sessionId: 'session-1',
      usageDate: '2026-03-03',
      providerId: 'openai',
      modelId: 'gpt-4o',
      inputTokens: 60,
      outputTokens: 40,
      totalTokens: 100,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      source: 'live',
      createdAt: Date.UTC(2026, 2, 3, 8, 1, 0),
      updatedAt: Date.UTC(2026, 2, 3, 8, 1, 1)
    })
    sqlitePresenter.deepchatUsageStatsTable.upsert({
      messageId: 'message-3',
      sessionId: 'session-2',
      usageDate: '2026-03-04',
      providerId: 'openai',
      modelId: 'gpt-4o',
      inputTokens: 30,
      outputTokens: 20,
      totalTokens: 50,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      source: 'live',
      createdAt: Date.UTC(2026, 2, 4, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 4, 8, 0, 1)
    })

    const dashboard = await service.getDashboard()

    expect(dashboard.summary.messageCount).toBe(3)
    expect(dashboard.summary.sessionCount).toBe(2)
    expect(dashboard.summary.mostActiveDay).toEqual({
      date: '2026-03-03',
      messageCount: 2
    })
  })

  it('reports compaction separately without changing chat activity or cache rate', async () => {
    const { service, sqlitePresenter } = createService()
    const base = {
      sessionId: 'session-1',
      usageDate: '2026-03-03',
      providerId: 'openai',
      modelId: 'gpt-4o',
      source: 'live' as const,
      createdAt: Date.UTC(2026, 2, 3, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 3, 8, 0, 1)
    }
    sqlitePresenter.deepchatUsageStatsTable.upsert({
      ...base,
      usageId: 'message-1',
      messageId: 'message-1',
      category: 'chat',
      compactionAttemptId: null,
      providerCallId: null,
      providerCallSeq: null,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 25,
      cacheWriteInputTokens: 0
    })
    sqlitePresenter.deepchatUsageStatsTable.upsert({
      ...base,
      usageId: 'compaction:attempt-1:call-1',
      messageId: 'compaction-message',
      category: 'compaction',
      compactionAttemptId: 'attempt-1',
      providerCallId: 'call-1',
      providerCallSeq: 1,
      inputTokens: 200,
      outputTokens: 30,
      totalTokens: 230,
      cachedInputTokens: null,
      cacheWriteInputTokens: null
    })
    sqlitePresenter.deepchatUsageStatsTable.upsert({
      ...base,
      usageId: 'compaction:attempt-1:call-2',
      messageId: 'compaction-message',
      category: 'compaction',
      compactionAttemptId: 'attempt-1',
      providerCallId: 'call-2',
      providerCallSeq: 2,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
      cacheWriteInputTokens: null
    })
    sqlitePresenter.deepchatUsageStatsTable.upsert({
      ...base,
      sessionId: 'compaction-only-session',
      usageId: 'compaction:attempt-2:call-1',
      messageId: 'compaction-message-2',
      category: 'compaction',
      compactionAttemptId: 'attempt-2',
      providerCallId: 'call-1',
      providerCallSeq: 1,
      inputTokens: 50,
      outputTokens: 10,
      totalTokens: 60,
      cachedInputTokens: null,
      cacheWriteInputTokens: null
    })

    const dashboard = await service.getDashboard()

    expect(dashboard.summary).toMatchObject({
      messageCount: 1,
      sessionCount: 1,
      inputTokens: 350,
      outputTokens: 60,
      totalTokens: 410,
      cachedInputTokens: 25,
      cacheHitRate: 0.25,
      mostActiveDay: { date: '2026-03-03', messageCount: 1 }
    })
    expect(dashboard.categoryBreakdown).toEqual([
      {
        id: 'chat',
        eventCount: 1,
        knownUsageCount: 1,
        unknownUsageCount: 0,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120
      },
      {
        id: 'compaction',
        eventCount: 3,
        knownUsageCount: 2,
        unknownUsageCount: 1,
        inputTokens: 250,
        outputTokens: 40,
        totalTokens: 290
      }
    ])
    expect(dashboard.calendar.find((day) => day.date === '2026-03-03')).toMatchObject({
      messageCount: 1,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120
    })
  })

  it('sorts provider and model breakdowns by total tokens', async () => {
    const { service, sqlitePresenter } = createService()

    sqlitePresenter.deepchatUsageStatsTable.upsert({
      messageId: 'message-1',
      sessionId: 'session-1',
      usageDate: '2026-03-03',
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      inputTokens: 40,
      outputTokens: 60,
      totalTokens: 100,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      source: 'live',
      createdAt: Date.UTC(2026, 2, 3, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 3, 8, 0, 1)
    })
    sqlitePresenter.deepchatUsageStatsTable.upsert({
      messageId: 'message-2',
      sessionId: 'session-2',
      usageDate: '2026-03-04',
      providerId: 'anthropic',
      modelId: 'claude-sonnet',
      inputTokens: 80,
      outputTokens: 120,
      totalTokens: 200,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      source: 'live',
      createdAt: Date.UTC(2026, 2, 4, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 4, 8, 0, 1)
    })

    const dashboard = await service.getDashboard()

    expect(dashboard.providerBreakdown.map((item) => item.id)).toEqual(['anthropic', 'openai'])
    expect(dashboard.modelBreakdown.map((item) => item.id)).toEqual([
      'claude-sonnet',
      'gpt-4o-mini'
    ])
  })

  it('uses the earlier date when the most active day is tied on message count', async () => {
    const { service, sqlitePresenter } = createService()

    sqlitePresenter.deepchatUsageStatsTable.upsert({
      messageId: 'message-1',
      sessionId: 'session-1',
      usageDate: '2026-03-05',
      providerId: 'openai',
      modelId: 'gpt-4o',
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      source: 'live',
      createdAt: Date.UTC(2026, 2, 5, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 5, 8, 0, 1)
    })
    sqlitePresenter.deepchatUsageStatsTable.upsert({
      messageId: 'message-2',
      sessionId: 'session-1',
      usageDate: '2026-03-05',
      providerId: 'openai',
      modelId: 'gpt-4o',
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      source: 'live',
      createdAt: Date.UTC(2026, 2, 5, 8, 1, 0),
      updatedAt: Date.UTC(2026, 2, 5, 8, 1, 1)
    })
    sqlitePresenter.deepchatUsageStatsTable.upsert({
      messageId: 'message-3',
      sessionId: 'session-2',
      usageDate: '2026-03-06',
      providerId: 'openai',
      modelId: 'gpt-4o',
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      source: 'live',
      createdAt: Date.UTC(2026, 2, 6, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 6, 8, 0, 1)
    })
    sqlitePresenter.deepchatUsageStatsTable.upsert({
      messageId: 'message-4',
      sessionId: 'session-2',
      usageDate: '2026-03-06',
      providerId: 'openai',
      modelId: 'gpt-4o',
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      source: 'live',
      createdAt: Date.UTC(2026, 2, 6, 8, 1, 0),
      updatedAt: Date.UTC(2026, 2, 6, 8, 1, 1)
    })

    const dashboard = await service.getDashboard()

    expect(dashboard.summary.mostActiveDay).toEqual({
      date: '2026-03-05',
      messageCount: 2
    })
  })
})
