import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/eventbus', () => ({ eventBus: { on: vi.fn(), sendToMain: vi.fn() } }))
vi.mock('@/routes/publishDeepchatEvent', () => ({ publishDeepchatEvent: vi.fn() }))
vi.mock('@/presenter', () => ({
  presenter: {
    commandPermissionService: {
      extractCommandSignature: vi.fn(() => 'benchmark'),
      approve: vi.fn(),
      clearConversation: vi.fn()
    },
    filePermissionService: { approve: vi.fn(), clearConversation: vi.fn() },
    settingsPermissionService: { approve: vi.fn(), clearConversation: vi.fn() },
    mcpPresenter: { grantPermission: vi.fn() }
  }
}))

const enabled = process.env.DEEPCHAT_HISTORY_BASELINE === '1'
const describeBenchmark = enabled ? describe : describe.skip
const quickCheck = process.env.DEEPCHAT_HISTORY_BASELINE_QUICK === '1'
const MESSAGE_COUNTS = quickCheck ? ([10] as const) : ([10, 100, 1_000, 10_000] as const)
const TRACE_COUNTS = quickCheck ? ([0] as const) : ([0, 10_000, 100_000] as const)
const WARMUPS = 1
const MEASURED_REPEATS = quickCheck ? 1 : 5
const FIXTURE_SEED = 'history-read-v1'
const BASE_TIME = 1_700_000_000_000
const REPO_ROOT = process.env.DEEPCHAT_HISTORY_BASELINE_ROOT ?? process.cwd()
const RAW_PATH = resolve(
  REPO_ROOT,
  'docs/architecture/history-read-model-baseline/results/raw.json'
)

type HistoryTable =
  | 'deepchat_messages'
  | 'deepchat_user_messages'
  | 'deepchat_user_message_files'
  | 'deepchat_user_message_links'
  | 'deepchat_assistant_blocks'

type HistoryProjection = 'rich' | 'runtime'
type SqlObservation = {
  table: HistoryTable
  projection: HistoryProjection
  rowCount: number
  durationMs: number
}
type HistoryObservation = {
  sessionId: string
  projection: HistoryProjection
  headerRows: number
  structuredRows: {
    user: number
    file: number
    link: number
    assistantBlock: number
    total: number
  }
  historySqlStatementCount: number
  historySqlDurationMs: number
  materializationDurationMs: number
  sql: SqlObservation[]
}
type Sample = {
  sampleIndex: number
  fixtureMessageCountBefore: number
  getMessagesCallCount: number
  richGetMessagesCallCount: number
  runtimeGetMessagesCallCount: number
  richHeaderCallCount: number
  runtimeHeaderCallCount: number
  headerRows: number
  structuredRows: number
  structuredRowsByType: {
    user: number
    file: number
    link: number
    assistantBlock: number
  }
  historySqlStatementCount: number
  historySqlDurationMs: number
  materializationDurationMs: number
  providerStartElapsedMs: number
  eventLoopDelayMs: number | null
  eventLoopDelayCensored: boolean
}
type ActiveSample = {
  sessionId: string
  history: HistoryObservation[]
  sql: SqlObservation[]
  frozen: boolean
}

function createEventLoopDelayProbe(
  startedAt: () => number,
  ports: {
    now: () => number
    schedule: (callback: () => void) => ReturnType<typeof setTimeout>
    cancel: (timer: ReturnType<typeof setTimeout>) => void
  } = {
    now: () => performance.now(),
    schedule: (callback) => setTimeout(callback, 0),
    cancel: (timer) => clearTimeout(timer)
  }
) {
  let eventLoopDelayMs: number | null = null
  const timer = ports.schedule(() => {
    eventLoopDelayMs = Math.max(0, ports.now() - startedAt())
  })
  return {
    finish() {
      ports.cancel(timer)
      return {
        eventLoopDelayMs,
        eventLoopDelayCensored: eventLoopDelayMs === null
      }
    }
  }
}

function createConfigPresenter() {
  const modelConfig = {
    temperature: 0,
    maxTokens: 1,
    contextLength: 10_000_000,
    timeout: 60_000
  }
  return {
    getAgentType: vi.fn(async (agentId: string) => (agentId === 'deepchat' ? 'deepchat' : null)),
    getDefaultModel: vi.fn(() => ({ providerId: 'local-fixture', modelId: 'fixture-model' })),
    getModelConfig: vi.fn(() => modelConfig),
    getDefaultSystemPrompt: vi.fn(async () => ''),
    getAutoCompactionEnabled: vi.fn(() => false),
    getAutoCompactionTriggerThreshold: vi.fn(() => 100),
    getAutoCompactionRetainRecentPairs: vi.fn(() => 2),
    supportsReasoningCapability: vi.fn(() => false),
    supportsReasoningEffortCapability: vi.fn(() => false),
    supportsVerbosityCapability: vi.fn(() => false),
    supportsVisionCapability: vi.fn(() => false),
    supportsAudioInputCapability: vi.fn(() => false),
    getThinkingBudgetRange: vi.fn(() => ({})),
    getSkillsEnabled: vi.fn(() => false),
    getSetting: vi.fn(() => undefined),
    getAcpAgents: vi.fn(async () => []),
    getProviderModels: vi.fn(() => []),
    getCustomModels: vi.fn(() => [])
  } as any
}

function createToolPresenter() {
  return {
    getAllToolDefinitions: vi.fn(async () => []),
    buildToolSystemPrompt: vi.fn(() => ''),
    clearConversationToolMapping: vi.fn()
  } as any
}

function createLocalProviderPresenter(onFirstCoreStream: () => void) {
  const provider = {
    coreStream: vi.fn(() => {
      onFirstCoreStream()
      return (async function* () {
        yield { type: 'text', content: 'ok' }
        yield { type: 'stop', stop_reason: 'end_turn' }
      })()
    })
  }
  return {
    presenter: {
      getProviderInstance: vi.fn(() => provider),
      executeWithRateLimit: vi.fn(async () => undefined),
      generateText: vi.fn(async () => ({ content: '' })),
      summaryTitles: vi.fn(async () => '')
    } as any,
    provider
  }
}

function seedScenario(
  sqlitePresenter: any,
  messageCount: number,
  globalTraceRows: number,
  sampleCount: number
): string[] {
  const db = sqlitePresenter.getDatabase()
  const sessionIds = Array.from(
    { length: sampleCount },
    (_, index) => `target-${messageCount}-${globalTraceRows}-${index}`
  )
  const insertMessage = db.prepare(
    `INSERT INTO deepchat_messages
      (id, session_id, order_seq, role, content, status, is_context_edge, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'sent', 0, '{}', ?, ?)`
  )
  const insertUser = db.prepare(
    `INSERT INTO deepchat_user_messages
      (message_id, text, search_enabled, think_enabled) VALUES (?, ?, 0, 0)`
  )
  const insertAssistant = db.prepare(
    `INSERT INTO deepchat_assistant_blocks
      (message_id, block_index, block_type, status, text_content, tool_call_id, tool_name,
       tool_params, tool_response, action_type, image_mime_type, reasoning_start_at,
       reasoning_end_at, extra_json, updated_at)
     VALUES (?, 0, 'content', 'success', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}', ?)`
  )
  const insertTrace = db.prepare(
    `INSERT INTO deepchat_message_traces
      (id, message_id, session_id, provider_id, model_id, request_seq, endpoint,
       headers_json, body_json, truncated, created_at)
     VALUES (?, ?, 'global-noise', 'local-fixture', 'fixture-model', ?, '', '{}', '{}', 0, ?)`
  )
  const userContent = JSON.stringify({
    text: 'u',
    files: [],
    links: [],
    search: false,
    think: false,
    inlineItems: [{ type: 'skill', offset: 0, skillName: 'fixture' }]
  })
  const assistantContent = JSON.stringify([
    { type: 'content', status: 'success', content: 'a', timestamp: BASE_TIME }
  ])

  db.transaction(() => {
    for (const sessionId of sessionIds) {
      sqlitePresenter.newSessionsTable.create(sessionId, 'deepchat', 'Benchmark', null, {
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME
      })
      sqlitePresenter.deepchatSessionsTable.create(
        sessionId,
        'local-fixture',
        'fixture-model',
        'full_access',
        { systemPrompt: '', temperature: 0, contextLength: 10_000_000, maxTokens: 1 }
      )
      for (let index = 0; index < messageCount; index += 1) {
        const id = `${sessionId}-message-${index}`
        const role = index % 2 === 0 ? 'user' : 'assistant'
        insertMessage.run(
          id,
          sessionId,
          index + 1,
          role,
          role === 'user' ? userContent : assistantContent,
          BASE_TIME + index,
          BASE_TIME + index
        )
        if (role === 'user') insertUser.run(id, 'u')
        else insertAssistant.run(id, 'a', BASE_TIME + index)
      }
    }

    const noiseMessageCount = Math.min(100, globalTraceRows)
    for (let index = 0; index < noiseMessageCount; index += 1) {
      insertMessage.run(
        `noise-message-${index}`,
        'global-noise',
        index + 1,
        'assistant',
        assistantContent,
        BASE_TIME + index,
        BASE_TIME + index
      )
    }
    for (let index = 0; index < globalTraceRows; index += 1) {
      const messageIndex = index % noiseMessageCount
      insertTrace.run(
        `noise-trace-${index}`,
        `noise-message-${messageIndex}`,
        Math.floor(index / noiseMessageCount) + 1,
        BASE_TIME + index
      )
    }
  })()
  return sessionIds
}

function countFixtureMessages(sqlitePresenter: any, sessionId: string): number {
  return (
    sqlitePresenter
      .getDatabase()
      .prepare('SELECT COUNT(*) AS count FROM deepchat_messages WHERE session_id = ?')
      .get(sessionId) as { count: number }
  ).count
}

function getHeaderQueryPlan(sqlitePresenter: any) {
  return sqlitePresenter
    .getDatabase()
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT m.*, 0 AS trace_count
       FROM deepchat_messages m
       WHERE m.session_id = ?
       ORDER BY m.order_seq`
    )
    .all('query-plan-target') as Array<{
    id: number
    parent: number
    notused: number
    detail: string
  }>
}

function installHistoryInstrumentation(args: {
  messageStoreClass: any
  sqlitePresenter: any
  collector: (observation: HistoryObservation) => void
}) {
  let activeSample: ActiveSample | undefined
  let historyReadDepth = 0
  let activeProjection: HistoryProjection | undefined
  const spies: Array<{ mockRestore: () => void }> = []
  const tableCalls: Array<[HistoryTable, any, string, HistoryProjection | undefined]> = [
    ['deepchat_messages', args.sqlitePresenter.deepchatMessagesTable, 'getBySession', 'rich'],
    [
      'deepchat_messages',
      args.sqlitePresenter.deepchatMessagesTable,
      'getBySessionForRuntime',
      'runtime'
    ],
    [
      'deepchat_user_messages',
      args.sqlitePresenter.deepchatUserMessagesTable,
      'listByMessageIds',
      undefined
    ],
    [
      'deepchat_user_message_files',
      args.sqlitePresenter.deepchatUserMessageFilesTable,
      'listByMessageIds',
      undefined
    ],
    [
      'deepchat_user_message_links',
      args.sqlitePresenter.deepchatUserMessageLinksTable,
      'listByMessageIds',
      undefined
    ],
    [
      'deepchat_assistant_blocks',
      args.sqlitePresenter.deepchatAssistantBlocksTable,
      'listByMessageIds',
      undefined
    ]
  ]

  for (const [tableName, table, methodName, tableProjection] of tableCalls) {
    const original = table[methodName].bind(table)
    spies.push(
      vi.spyOn(table, methodName).mockImplementation((...methodArgs: unknown[]) => {
        const startedAt = performance.now()
        const rows = original(...methodArgs)
        const projection = tableProjection ?? activeProjection
        if (activeSample && !activeSample.frozen && historyReadDepth > 0 && projection) {
          activeSample.sql.push({
            table: tableName,
            projection,
            rowCount: rows.length,
            durationMs: performance.now() - startedAt
          })
        }
        return rows
      })
    )
  }

  const prototype = args.messageStoreClass.prototype
  const installStoreMethod = (
    methodName: 'getMessages' | 'getRuntimeMessages',
    projection: HistoryProjection
  ) => {
    const original = prototype[methodName]
    spies.push(
      vi.spyOn(prototype, methodName).mockImplementation(function (sessionId: string) {
        if (!activeSample || activeSample.frozen || activeSample.sessionId !== sessionId) {
          return original.call(this, sessionId)
        }
        const sample = activeSample
        const sqlStartIndex = sample.sql.length
        const startedAt = performance.now()
        const previousProjection = activeProjection
        activeProjection = projection
        historyReadDepth += 1
        try {
          const records = original.call(this, sessionId)
          const sql = sample.sql.slice(sqlStartIndex)
          const historySqlDurationMs = sql.reduce(
            (total, observation) => total + observation.durationMs,
            0
          )
          const rowCount = (table: HistoryTable) =>
            sql
              .filter((observation) => observation.table === table)
              .reduce((total, observation) => total + observation.rowCount, 0)
          const user = rowCount('deepchat_user_messages')
          const file = rowCount('deepchat_user_message_files')
          const link = rowCount('deepchat_user_message_links')
          const assistantBlock = rowCount('deepchat_assistant_blocks')
          const observation: HistoryObservation = {
            sessionId,
            projection,
            headerRows: rowCount('deepchat_messages'),
            structuredRows: {
              user,
              file,
              link,
              assistantBlock,
              total: user + file + link + assistantBlock
            },
            historySqlStatementCount: sql.length,
            historySqlDurationMs,
            materializationDurationMs: Math.max(
              0,
              performance.now() - startedAt - historySqlDurationMs
            ),
            sql
          }
          args.collector(observation)
          sample.history.push(observation)
          return records
        } finally {
          historyReadDepth -= 1
          activeProjection = previousProjection
        }
      })
    )
  }
  installStoreMethod('getMessages', 'rich')
  installStoreMethod('getRuntimeMessages', 'runtime')

  return {
    activate(sessionId: string) {
      if (activeSample) throw new Error('A benchmark sample is already active')
      activeSample = { sessionId, history: [], sql: [], frozen: false }
      return activeSample
    },
    freeze() {
      if (!activeSample || activeSample.frozen) return false
      activeSample.frozen = true
      return true
    },
    clear() {
      activeSample = undefined
    },
    restore() {
      for (const spy of spies.reverse()) spy.mockRestore()
      activeSample = undefined
    }
  }
}

function sumHistory(events: HistoryObservation[], sampleIndex: number, fixtureCount: number) {
  const structuredRowsByType = events.reduce(
    (total, event) => ({
      user: total.user + event.structuredRows.user,
      file: total.file + event.structuredRows.file,
      link: total.link + event.structuredRows.link,
      assistantBlock: total.assistantBlock + event.structuredRows.assistantBlock
    }),
    { user: 0, file: 0, link: 0, assistantBlock: 0 }
  )
  return {
    sampleIndex,
    fixtureMessageCountBefore: fixtureCount,
    getMessagesCallCount: events.length,
    richGetMessagesCallCount: events.filter((event) => event.projection === 'rich').length,
    runtimeGetMessagesCallCount: events.filter((event) => event.projection === 'runtime').length,
    richHeaderCallCount: events
      .flatMap((event) => event.sql)
      .filter(
        (observation) =>
          observation.table === 'deepchat_messages' && observation.projection === 'rich'
      ).length,
    runtimeHeaderCallCount: events
      .flatMap((event) => event.sql)
      .filter(
        (observation) =>
          observation.table === 'deepchat_messages' && observation.projection === 'runtime'
      ).length,
    headerRows: events.reduce((sum, event) => sum + event.headerRows, 0),
    structuredRows: events.reduce((sum, event) => sum + event.structuredRows.total, 0),
    structuredRowsByType,
    historySqlStatementCount: events.reduce(
      (sum, event) => sum + event.historySqlStatementCount,
      0
    ),
    historySqlDurationMs: events.reduce((sum, event) => sum + event.historySqlDurationMs, 0),
    materializationDurationMs: events.reduce(
      (sum, event) => sum + event.materializationDurationMs,
      0
    )
  }
}

async function waitForSettled(runtime: any, sessionId: string): Promise<void> {
  const deadline = performance.now() + 30_000
  while (performance.now() < deadline) {
    const status = (await runtime.getSessionState(sessionId))?.status
    if (status === 'idle' || status === 'error') return
    await new Promise((resolveWait) => setTimeout(resolveWait, 1))
  }
  throw new Error(`Local fake provider did not settle for ${sessionId}`)
}

describeBenchmark('HIS-001 real SQLite history read baseline', () => {
  it(
    'measures all scenarios through AgentSessionPresenter to the first local provider call',
    async () => {
      if (!process.versions.electron || process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE !== '1') {
        throw new Error('Run through pnpm benchmark:history-read with Electron native SQLite')
      }
      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')
      const [
        { SQLitePresenter },
        { AgentRuntimePresenter },
        { AgentSessionPresenter },
        { DeepChatMessageStore }
      ] = await Promise.all([
        import('@/presenter/sqlitePresenter/index'),
        import('@/presenter/agentRuntimePresenter/index'),
        import('@/presenter/agentSessionPresenter/index'),
        import('@/presenter/agentRuntimePresenter/messageStore')
      ])

      let cancelledSynchronousProbe = false
      const synchronousProviderProbe = createEventLoopDelayProbe(() => 0, {
        now: () => 1,
        schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
        cancel: () => {
          cancelledSynchronousProbe = true
        }
      })
      expect(synchronousProviderProbe.finish()).toEqual({
        eventLoopDelayMs: null,
        eventLoopDelayCensored: true
      })
      expect(cancelledSynchronousProbe).toBe(true)

      const contractDb = new SQLitePresenter(':memory:')
      seedScenario(contractDb, 10, 0, 1)
      try {
        const exact: HistoryObservation[] = []
        const instrumentation = installHistoryInstrumentation({
          messageStoreClass: DeepChatMessageStore,
          sqlitePresenter: contractDb,
          collector: (observation) => exact.push(observation)
        })
        const store = new DeepChatMessageStore(contractDb)
        instrumentation.activate('target-10-0-0')
        expect(store.getMessages('target-10-0-0')).toHaveLength(10)
        expect(store.getRuntimeMessages('target-10-0-0')).toHaveLength(10)
        expect(exact).toEqual([
          expect.objectContaining({
            projection: 'rich',
            headerRows: 10,
            structuredRows: {
              user: 5,
              file: 0,
              link: 0,
              assistantBlock: 5,
              total: 10
            },
            historySqlStatementCount: 5,
            sql: [
              expect.objectContaining({ table: 'deepchat_messages', projection: 'rich' }),
              expect.objectContaining({ projection: 'rich' }),
              expect.objectContaining({ projection: 'rich' }),
              expect.objectContaining({ projection: 'rich' }),
              expect.objectContaining({ projection: 'rich' })
            ]
          }),
          expect.objectContaining({
            projection: 'runtime',
            headerRows: 10,
            structuredRows: {
              user: 5,
              file: 0,
              link: 0,
              assistantBlock: 5,
              total: 10
            },
            historySqlStatementCount: 5,
            sql: [
              expect.objectContaining({ table: 'deepchat_messages', projection: 'runtime' }),
              expect.objectContaining({ projection: 'runtime' }),
              expect.objectContaining({ projection: 'runtime' }),
              expect.objectContaining({ projection: 'runtime' }),
              expect.objectContaining({ projection: 'runtime' })
            ]
          })
        ])
        expect(instrumentation.freeze()).toBe(true)
        expect(instrumentation.freeze()).toBe(false)
        instrumentation.restore()
        expect(vi.isMockFunction(DeepChatMessageStore.prototype.getMessages)).toBe(false)
        expect(vi.isMockFunction(DeepChatMessageStore.prototype.getRuntimeMessages)).toBe(false)

        const collectorError = installHistoryInstrumentation({
          messageStoreClass: DeepChatMessageStore,
          sqlitePresenter: contractDb,
          collector: () => {
            throw new Error('collector failed')
          }
        })
        collectorError.activate('target-10-0-0')
        expect(() => store.getRuntimeMessages('target-10-0-0')).toThrow('collector failed')
        collectorError.restore()
      } finally {
        contractDb.close()
      }

      const scenarios: Array<{
        messageCount: number
        globalTraceRows: number
        queryPlan: ReturnType<typeof getHeaderQueryPlan>
        samples: Sample[]
      }> = []
      for (const messageCount of MESSAGE_COUNTS) {
        for (const globalTraceRows of TRACE_COUNTS) {
          const sqlitePresenter = new SQLitePresenter(':memory:')
          try {
            const sessionIds = seedScenario(
              sqlitePresenter,
              messageCount,
              globalTraceRows,
              WARMUPS + MEASURED_REPEATS
            )
            let resolveProviderStart:
              | ((boundary: {
                  providerStartElapsedMs: number
                  eventLoopDelayMs: number | null
                  eventLoopDelayCensored: boolean
                }) => void)
              | undefined
            let sampleStartedAt = 0
            let eventLoopDelayProbe: ReturnType<typeof createEventLoopDelayProbe> | undefined
            let instrumentation: ReturnType<typeof installHistoryInstrumentation>
            const localProvider = createLocalProviderPresenter(() => {
              if (instrumentation.freeze()) {
                resolveProviderStart?.({
                  providerStartElapsedMs: performance.now() - sampleStartedAt,
                  ...(eventLoopDelayProbe?.finish() ?? {
                    eventLoopDelayMs: null,
                    eventLoopDelayCensored: true
                  })
                })
              }
            })
            instrumentation = installHistoryInstrumentation({
              messageStoreClass: DeepChatMessageStore,
              sqlitePresenter,
              collector: () => undefined
            })
            const configPresenter = createConfigPresenter()
            const runtime = new AgentRuntimePresenter(
              localProvider.presenter,
              configPresenter,
              sqlitePresenter,
              createToolPresenter()
            )
            const sessionPresenter = new AgentSessionPresenter(
              runtime as any,
              localProvider.presenter,
              configPresenter,
              sqlitePresenter
            )
            const samples: Sample[] = []

            for (const [sampleIndex, sessionId] of sessionIds.entries()) {
              const fixtureCount = countFixtureMessages(sqlitePresenter, sessionId)
              expect(fixtureCount).toBe(messageCount)
              const providerStart = new Promise<{
                providerStartElapsedMs: number
                eventLoopDelayMs: number | null
                eventLoopDelayCensored: boolean
              }>((resolveStart) => {
                resolveProviderStart = resolveStart
              })
              const activeSample = instrumentation.activate(sessionId)
              eventLoopDelayProbe = createEventLoopDelayProbe(() => sampleStartedAt)
              sampleStartedAt = performance.now()
              await sessionPresenter.sendMessage(sessionId, 'benchmark')
              const boundary = await providerStart
              instrumentation.clear()
              await waitForSettled(runtime, sessionId)
              if (sampleIndex >= WARMUPS) {
                samples.push({
                  ...sumHistory(activeSample.history, sampleIndex - WARMUPS, fixtureCount),
                  ...boundary
                })
              }
            }

            instrumentation.restore()
            expect(samples).toHaveLength(MEASURED_REPEATS)
            if (quickCheck) {
              expect(samples).toEqual([
                expect.objectContaining({
                  getMessagesCallCount: 2,
                  richGetMessagesCallCount: 0,
                  runtimeGetMessagesCallCount: 2,
                  richHeaderCallCount: 0,
                  runtimeHeaderCallCount: 2,
                  historySqlStatementCount: 10
                })
              ])
            }
            expect(localProvider.provider.coreStream).toHaveBeenCalledTimes(
              WARMUPS + MEASURED_REPEATS
            )
            scenarios.push({
              messageCount,
              globalTraceRows,
              queryPlan: getHeaderQueryPlan(sqlitePresenter),
              samples
            })
          } finally {
            sqlitePresenter.close()
          }
        }
      }

      const packageJson = JSON.parse(
        realFs.readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')
      )
      const metadataDb = new SQLitePresenter(':memory:')
      const sqliteVersion = (
        metadataDb.getDatabase().prepare('SELECT sqlite_version() AS version').get() as {
          version: string
        }
      ).version
      metadataDb.close()
      const cpu = os.cpus()[0]
      const raw = {
        schemaVersion: 1,
        environment: {
          generatedAt: new Date().toISOString(),
          gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: REPO_ROOT,
            encoding: 'utf8'
          }).trim(),
          gitDirty:
            execFileSync('git', ['status', '--porcelain'], {
              cwd: REPO_ROOT,
              encoding: 'utf8'
            }).trim().length > 0,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
          nodeModuleAbi: process.versions.modules,
          sqliteVersion,
          sqlitePackageVersion: packageJson.dependencies['better-sqlite3-multiple-ciphers'],
          platform: os.platform(),
          osRelease: os.release(),
          arch: os.arch(),
          cpuModel: cpu?.model ?? 'unknown',
          logicalCpuCount: os.cpus().length
        },
        config: {
          seed: FIXTURE_SEED,
          messageCounts: MESSAGE_COUNTS,
          globalTraceRows: TRACE_COUNTS,
          warmups: WARMUPS,
          measuredRepeats: MEASURED_REPEATS,
          scenarioCount: MESSAGE_COUNTS.length * TRACE_COUNTS.length,
          targetSessionPerScenario: WARMUPS + MEASURED_REPEATS
        },
        scenarios
      }
      realFs.mkdirSync(dirname(RAW_PATH), { recursive: true })
      realFs.writeFileSync(RAW_PATH, `${JSON.stringify(raw, null, 2)}\n`)
    },
    30 * 60 * 1000
  )
})
