import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewAgentPresenter } from '@/presenter/newAgentPresenter/index'
import { DeepChatMessageStore } from '@/presenter/deepchatAgentPresenter/messageStore'
import { DASHBOARD_STATS_BACKFILL_KEY, type UsageStatsRecordInput } from '@/presenter/usageStats'

vi.mock('@/eventbus', () => ({
  eventBus: { sendToRenderer: vi.fn(), sendToMain: vi.fn(), on: vi.fn() },
  SendTarget: { ALL_WINDOWS: 'all' }
}))

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

vi.mock('@/presenter', () => ({
  presenter: {
    commandPermissionService: {
      extractCommandSignature: vi.fn().mockReturnValue('mock-signature'),
      approve: vi.fn(),
      clearConversation: vi.fn()
    },
    filePermissionService: { approve: vi.fn(), clearConversation: vi.fn() },
    settingsPermissionService: { approve: vi.fn(), clearConversation: vi.fn() },
    mcpPresenter: {
      grantPermission: vi.fn().mockResolvedValue(undefined)
    }
  }
}))

vi.mock('@/lib/agentRuntime/rtkRuntimeService', () => ({
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
  message_id: string
  session_id: string
  usage_date: string
  provider_id: string
  model_id: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_input_tokens: number
  cache_write_input_tokens: number
  estimated_cost_usd: number | null
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
  let estimatedCostSum = 0
  let pricedMessages = 0

  for (const row of rows) {
    messageCount += 1
    sessionIds.add(row.session_id)
    inputTokens += row.input_tokens
    outputTokens += row.output_tokens
    totalTokens += row.total_tokens
    cachedInputTokens += row.cached_input_tokens
    if (typeof row.estimated_cost_usd === 'number') {
      estimatedCostSum += row.estimated_cost_usd
      pricedMessages += 1
    }
  }

  return {
    messageCount,
    sessionCount: sessionIds.size,
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    estimatedCostUsd: pricedMessages > 0 ? estimatedCostSum : null
  }
}

function createMockDeepChatAgent() {
  return {
    initSession: vi.fn().mockResolvedValue(undefined),
    destroySession: vi.fn().mockResolvedValue(undefined),
    getSessionState: vi.fn().mockResolvedValue(null),
    processMessage: vi.fn().mockResolvedValue(undefined),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    getMessageIds: vi.fn().mockResolvedValue([]),
    getMessage: vi.fn().mockResolvedValue(null),
    getSessionCompactionState: vi.fn().mockResolvedValue({
      status: 'idle',
      cursorOrderSeq: 1,
      summaryUpdatedAt: null
    })
  }
}

function createMockLlmProviderPresenter() {
  return {
    summaryTitles: vi.fn().mockResolvedValue('Usage Dashboard'),
    generateText: vi.fn().mockResolvedValue({ content: '' }),
    setAcpWorkdir: vi.fn().mockResolvedValue(undefined),
    prepareAcpSession: vi.fn().mockResolvedValue(undefined),
    clearAcpSession: vi.fn().mockResolvedValue(undefined),
    getAcpSessionCommands: vi.fn().mockResolvedValue([])
  }
}

function createMockConfigPresenter() {
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

  const deepchatSessionsTable = {
    create(sessionId: string, providerId: string, modelId: string) {
      sessions.set(sessionId, {
        id: sessionId,
        provider_id: providerId,
        model_id: modelId
      })
    },
    get(sessionId: string) {
      return sessions.get(sessionId) ?? null
    }
  }

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
      return Array.from(messages.values())
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
    }
  }

  const deepchatUsageStatsTable = {
    upsert(input: UsageStatsRecordInput) {
      usageStats.set(input.messageId, {
        message_id: input.messageId,
        session_id: input.sessionId,
        usage_date: input.usageDate,
        provider_id: input.providerId,
        model_id: input.modelId,
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
        total_tokens: input.totalTokens,
        cached_input_tokens: input.cachedInputTokens,
        cache_write_input_tokens: input.cacheWriteInputTokens,
        estimated_cost_usd: input.estimatedCostUsd,
        source: input.source,
        created_at: input.createdAt,
        updated_at: input.updatedAt
      })
    },
    getByMessageId(messageId: string) {
      return usageStats.get(messageId) ?? null
    },
    count() {
      return usageStats.size
    },
    getRecordingStartedAt() {
      const rows = Array.from(usageStats.values())
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
          estimatedCostUsd: number | null
        }
      >()

      for (const row of usageStats.values()) {
        if (row.usage_date < dateFrom) {
          continue
        }

        const current = buckets.get(row.usage_date) ?? {
          date: row.usage_date,
          messageCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          estimatedCostUsd: null
        }

        current.messageCount += 1
        current.inputTokens += row.input_tokens
        current.outputTokens += row.output_tokens
        current.totalTokens += row.total_tokens
        current.cachedInputTokens += row.cached_input_tokens
        if (typeof row.estimated_cost_usd === 'number') {
          current.estimatedCostUsd = (current.estimatedCostUsd ?? 0) + row.estimated_cost_usd
        }
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
        .slice(0, limit)
    }
  }

  return {
    deepchatSessionsTable,
    deepchatMessagesTable,
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

describe('NewAgentPresenter usage dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createPresenter() {
    const sqlitePresenter = createMockSqlitePresenter()
    const configPresenter = createMockConfigPresenter()
    const presenter = new NewAgentPresenter(
      createMockDeepChatAgent() as any,
      createMockLlmProviderPresenter() as any,
      configPresenter as any,
      sqlitePresenter
    )

    return {
      presenter,
      sqlitePresenter,
      configPresenter
    }
  }

  it('backfills current deepchat_messages and uses session provider/model fallback', async () => {
    const { presenter, sqlitePresenter, configPresenter } = createPresenter()

    sqlitePresenter.deepchatSessionsTable.create('session-1', 'openai', 'gpt-4o')
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

    await presenter.startUsageStatsBackfill()

    const row = sqlitePresenter.deepchatUsageStatsTable.getByMessageId('message-1')
    expect(row).toMatchObject({
      message_id: 'message-1',
      provider_id: 'openai',
      model_id: 'gpt-4o',
      cached_input_tokens: 0,
      source: 'backfill'
    })

    const status = configPresenter.store.get(DASHBOARD_STATS_BACKFILL_KEY) as {
      status: string
      finishedAt: number
    }
    expect(status.status).toBe('completed')
    expect(status.finishedAt).toBeGreaterThan(0)
  })

  it('keeps a single stats row when live finalize updates a previously backfilled message', async () => {
    const { presenter, sqlitePresenter } = createPresenter()
    const messageStore = new DeepChatMessageStore(sqlitePresenter)

    sqlitePresenter.deepchatSessionsTable.create('session-1', 'openai', 'gpt-4o')
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

    await presenter.startUsageStatsBackfill()

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
    const { presenter, sqlitePresenter } = createPresenter()

    sqlitePresenter.deepchatSessionsTable.create('session-1', 'openai', 'gpt-4o')
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

    const dashboard = await presenter.getUsageDashboard()

    expect(dashboard.summary.messageCount).toBe(0)
    expect(dashboard.summary.sessionCount).toBe(0)
    expect(dashboard.summary.totalTokens).toBe(0)
    expect(dashboard.summary.mostActiveDay).toEqual({ date: null, messageCount: 0 })
    expect(dashboard.providerBreakdown).toEqual([])
    expect(dashboard.calendar).toHaveLength(365)
  })

  it('returns session count and most active day from usage stats summary', async () => {
    const { presenter, sqlitePresenter } = createPresenter()

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
      estimatedCostUsd: 0.01,
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
      estimatedCostUsd: 0.004,
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
      estimatedCostUsd: 0.002,
      source: 'live',
      createdAt: Date.UTC(2026, 2, 4, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 4, 8, 0, 1)
    })

    const dashboard = await presenter.getUsageDashboard()

    expect(dashboard.summary.messageCount).toBe(3)
    expect(dashboard.summary.sessionCount).toBe(2)
    expect(dashboard.summary.mostActiveDay).toEqual({
      date: '2026-03-03',
      messageCount: 2
    })
  })

  it('uses the earlier date when the most active day is tied on message count', async () => {
    const { presenter, sqlitePresenter } = createPresenter()

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
      estimatedCostUsd: null,
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
      estimatedCostUsd: null,
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
      estimatedCostUsd: null,
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
      estimatedCostUsd: null,
      source: 'live',
      createdAt: Date.UTC(2026, 2, 6, 8, 1, 0),
      updatedAt: Date.UTC(2026, 2, 6, 8, 1, 1)
    })

    const dashboard = await presenter.getUsageDashboard()

    expect(dashboard.summary.mostActiveDay).toEqual({
      date: '2026-03-05',
      messageCount: 2
    })
  })
})
