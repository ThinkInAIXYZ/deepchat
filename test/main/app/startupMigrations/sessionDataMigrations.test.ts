import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_MCP_ALLOWLIST_COMPATIBILITY_KEY,
  DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY,
  DISABLED_SEARCH_TOOL_CLEANUP_V1_KEY,
  SQLITE_MAINLINE_NORMALIZATION_KEY,
  runBuiltinMcpAllowlistCompatibilityMigration,
  runDisabledAgentToolCapabilityCleanupMigration,
  runMainlineNormalizationMigration,
  type SessionDataMigrationSQLitePort
} from '@/app/startupMigrations/sessionDataMigrations'
import { TAPE_TOOL_NAMES } from '@shared/agentTools'

function createFixture() {
  const settings = new Map<string, unknown>()
  const sessionRows: Array<{ id: string }> = []
  const sessionDisabledTools = new Map<string, string[]>()
  const statements: string[] = []
  const updateSessionDisabledTools = vi.fn((serialized: string, sessionId: string) => ({
    changes: sessionRows.some((row) => row.id === sessionId) ? 1 : 0,
    serialized
  }))
  const replaceSessionDisabledTools = vi.fn((sessionId: string, disabledAgentTools: string[]) => {
    sessionDisabledTools.set(sessionId, disabledAgentTools)
  })
  const database = {
    prepare: vi.fn((sql: string) => {
      statements.push(sql)
      return {
        all: vi.fn((...params: unknown[]) => {
          if (!sql.includes('FROM new_sessions') || !sql.includes('ORDER BY id ASC')) return []
          const cursor = sql.includes('WHERE id > ?') ? String(params[0]) : null
          const limit = Number(params.at(-1))
          return sessionRows
            .filter((row) => cursor === null || row.id > cursor)
            .sort((left, right) => left.id.localeCompare(right.id))
            .slice(0, limit)
        }),
        run: sql.startsWith('UPDATE new_sessions SET disabled_agent_tools')
          ? updateSessionDisabledTools
          : vi.fn()
      }
    }),
    transaction: vi.fn(
      (callback: (...args: any[]) => unknown) =>
        (...args: any[]) =>
          callback(...args)
    )
  }
  const sqlitePresenter = {
    appSettingsTable: {
      getAppSetting: vi.fn((key: string) => settings.get(key)),
      setAppSetting: vi.fn((key: string, value: unknown) => settings.set(key, value))
    },
    getDatabase: vi.fn(() => database),
    newSessionsTable: {
      get: vi.fn(() => null),
      getActiveSkills: vi.fn(() => []),
      getDisabledAgentTools: vi.fn((sessionId: string) => sessionDisabledTools.get(sessionId) ?? [])
    },
    newSessionActiveSkillsTable: { replaceForSession: vi.fn() },
    newSessionDisabledAgentToolsTable: {
      replaceForSession: replaceSessionDisabledTools
    },
    deepchatSearchDocumentsTable: { upsert: vi.fn() },
    deepchatUserMessagesTable: { upsert: vi.fn() },
    deepchatUserMessageFilesTable: { replaceForMessage: vi.fn() },
    deepchatUserMessageLinksTable: { replaceForMessage: vi.fn() },
    deepchatAssistantBlocksTable: { replaceForMessage: vi.fn() }
  } as unknown as SessionDataMigrationSQLitePort
  const providerSettings = {
    listAgents: vi.fn(async () => []),
    getDeepChatAgentConfig: vi.fn(),
    updateDeepChatAgent: vi.fn(async () => ({ id: 'deepchat' }))
  }
  const taskContext = {
    reportProgress: vi.fn(),
    yield: vi.fn(async () => undefined)
  }

  return {
    settings,
    sessionRows,
    sessionDisabledTools,
    statements,
    sqlitePresenter,
    providerSettings,
    agentSettings: providerSettings,
    updateSessionDisabledTools,
    replaceSessionDisabledTools,
    taskContext
  }
}

describe('session data migrations', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('skips completed mainline normalization without opening the database', async () => {
    const fixture = createFixture()
    fixture.settings.set(SQLITE_MAINLINE_NORMALIZATION_KEY, { status: 'completed' })

    await runMainlineNormalizationMigration(fixture as never, fixture.taskContext as never)

    expect(fixture.sqlitePresenter.getDatabase).not.toHaveBeenCalled()
  })

  it('records running and completed mainline normalization states', async () => {
    const fixture = createFixture()

    await runMainlineNormalizationMigration(fixture as never, fixture.taskContext as never)

    const writes = fixture.sqlitePresenter.appSettingsTable.setAppSetting.mock.calls
      .filter(([key]) => key === SQLITE_MAINLINE_NORMALIZATION_KEY)
      .map(([, value]) => value)
    expect(writes[0]).toMatchObject({ status: 'running', processedCount: 0 })
    expect(writes.at(-1)).toMatchObject({
      status: 'completed',
      processedCount: 0,
      durationMs: expect.any(Number)
    })
    expect(fixture.statements).toEqual(
      expect.arrayContaining([
        expect.stringContaining('FROM new_sessions'),
        expect.stringContaining('FROM deepchat_messages')
      ])
    )
  })

  it('records failed mainline normalization state and rethrows', async () => {
    const fixture = createFixture()
    fixture.sqlitePresenter.getDatabase.mockImplementation(() => {
      throw new Error('database unavailable')
    })

    await expect(
      runMainlineNormalizationMigration(fixture as never, fixture.taskContext as never)
    ).rejects.toThrow('database unavailable')
    expect(fixture.settings.get(SQLITE_MAINLINE_NORMALIZATION_KEY)).toMatchObject({
      status: 'failed',
      error: 'database unavailable'
    })
  })

  it('migrates the legacy built-in empty MCP allowlist exactly once', async () => {
    const fixture = createFixture()
    fixture.agentSettings.getDeepChatAgentConfig.mockResolvedValue({ enabledMcpServerIds: [] })

    await runBuiltinMcpAllowlistCompatibilityMigration(fixture as never)

    expect(fixture.agentSettings.getDeepChatAgentConfig).toHaveBeenCalledWith('deepchat')
    expect(fixture.agentSettings.updateDeepChatAgent).toHaveBeenCalledWith('deepchat', {
      config: { enabledMcpServerIds: null }
    })
    expect(fixture.settings.get(BUILTIN_MCP_ALLOWLIST_COMPATIBILITY_KEY)).toMatchObject({
      status: 'completed',
      migrated: true
    })

    fixture.agentSettings.updateDeepChatAgent.mockClear()
    await runBuiltinMcpAllowlistCompatibilityMigration(fixture as never)
    expect(fixture.agentSettings.updateDeepChatAgent).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', {}],
    ['inherited', { enabledMcpServerIds: null }],
    ['non-empty', { enabledMcpServerIds: ['server-a'] }]
  ])('preserves %s built-in MCP policy', async (_label, config) => {
    const fixture = createFixture()
    fixture.agentSettings.getDeepChatAgentConfig.mockResolvedValue(config)

    await runBuiltinMcpAllowlistCompatibilityMigration(fixture as never)

    expect(fixture.agentSettings.updateDeepChatAgent).not.toHaveBeenCalled()
    expect(fixture.settings.get(BUILTIN_MCP_ALLOWLIST_COMPATIBILITY_KEY)).toMatchObject({
      status: 'completed',
      migrated: false
    })
  })

  it('retries a failed built-in MCP allowlist migration', async () => {
    const fixture = createFixture()
    fixture.agentSettings.getDeepChatAgentConfig.mockResolvedValue({ enabledMcpServerIds: [] })
    fixture.agentSettings.updateDeepChatAgent.mockRejectedValueOnce(new Error('write failed'))

    await expect(runBuiltinMcpAllowlistCompatibilityMigration(fixture as never)).rejects.toThrow(
      'write failed'
    )
    expect(fixture.settings.get(BUILTIN_MCP_ALLOWLIST_COMPATIBILITY_KEY)).toMatchObject({
      status: 'failed',
      error: 'write failed'
    })

    await runBuiltinMcpAllowlistCompatibilityMigration(fixture as never)
    expect(fixture.agentSettings.updateDeepChatAgent).toHaveBeenCalledTimes(2)
    expect(fixture.settings.get(BUILTIN_MCP_ALLOWLIST_COMPATIBILITY_KEY)).toMatchObject({
      status: 'completed',
      migrated: true
    })
  })

  it('runs v2 after v1 completion and removes Tape names from sessions and Agent configs', async () => {
    const fixture = createFixture()
    fixture.settings.set(DISABLED_SEARCH_TOOL_CLEANUP_V1_KEY, { status: 'completed' })
    fixture.sessionRows.push({ id: 'session-1' })
    fixture.sessionDisabledTools.set('session-1', [
      ...Object.values(TAPE_TOOL_NAMES),
      'grep',
      'find',
      'exec',
      'yo_browser_cdp_send',
      'custom_tool'
    ])
    fixture.providerSettings.listAgents.mockResolvedValue([
      { id: 'deepchat', type: 'deepchat', name: 'DeepChat', enabled: true }
    ])
    fixture.providerSettings.getDeepChatAgentConfig.mockResolvedValue({
      disabledAgentTools: ['ls', 'exec', ...Object.values(TAPE_TOOL_NAMES)]
    })

    await runDisabledAgentToolCapabilityCleanupMigration(
      fixture as never,
      fixture.taskContext as never
    )

    expect(fixture.replaceSessionDisabledTools).toHaveBeenCalledWith('session-1', [
      'cdp_send',
      'custom_tool',
      'exec'
    ])
    expect(fixture.updateSessionDisabledTools).toHaveBeenCalledWith(
      JSON.stringify(['cdp_send', 'custom_tool', 'exec']),
      'session-1'
    )
    expect(fixture.providerSettings.updateDeepChatAgent).toHaveBeenCalledWith('deepchat', {
      config: { disabledAgentTools: ['exec'] }
    })
    expect(fixture.settings.get(DISABLED_SEARCH_TOOL_CLEANUP_V1_KEY)).toEqual({
      status: 'completed'
    })
    expect(fixture.settings.get(DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY)).toMatchObject({
      status: 'completed',
      processedCount: 1,
      updatedCount: 1,
      configProcessedCount: 1,
      configUpdatedCount: 1
    })
    expect(fixture.statements).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/ORDER BY id ASC\s+LIMIT \?/),
        expect.stringMatching(/WHERE id > \?\s+ORDER BY id ASC\s+LIMIT \?/)
      ])
    )
    const sessionUpdate = fixture.statements.find((sql) =>
      sql.startsWith('UPDATE new_sessions SET disabled_agent_tools')
    )
    expect(sessionUpdate).toBe('UPDATE new_sessions SET disabled_agent_tools = ? WHERE id = ?')
    expect(sessionUpdate).not.toContain('updated_at')
  })

  it('uses bounded session batches and yields between them', async () => {
    const fixture = createFixture()
    for (let index = 0; index < 125; index += 1) {
      const id = `session-${String(index).padStart(3, '0')}`
      fixture.sessionRows.push({ id })
      fixture.sessionDisabledTools.set(id, [TAPE_TOOL_NAMES.search, 'read'])
    }

    await runDisabledAgentToolCapabilityCleanupMigration(
      fixture as never,
      fixture.taskContext as never
    )

    expect(fixture.replaceSessionDisabledTools).toHaveBeenCalledTimes(125)
    expect(fixture.taskContext.yield).toHaveBeenCalledTimes(3)
    expect(fixture.settings.get(DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY)).toMatchObject({
      status: 'completed',
      processedCount: 125,
      updatedCount: 125
    })
    expect([...fixture.sessionDisabledTools.values()]).toEqual(expect.arrayContaining([['read']]))
    expect(
      [...fixture.sessionDisabledTools.values()].every(
        (disabledAgentTools) => disabledAgentTools.length === 1 && disabledAgentTools[0] === 'read'
      )
    ).toBe(true)
  })

  it('restarts safely after a partially applied session batch', async () => {
    const fixture = createFixture()
    fixture.sessionRows.push({ id: 'session-1' }, { id: 'session-2' })
    fixture.sessionDisabledTools.set('session-1', [TAPE_TOOL_NAMES.search, 'read'])
    fixture.sessionDisabledTools.set('session-2', [TAPE_TOOL_NAMES.handoff, 'exec'])
    let updateCount = 0
    fixture.replaceSessionDisabledTools.mockImplementation(
      (sessionId: string, disabledAgentTools: string[]) => {
        updateCount += 1
        if (updateCount === 2) throw new Error('write interrupted')
        fixture.sessionDisabledTools.set(sessionId, disabledAgentTools)
      }
    )

    await expect(
      runDisabledAgentToolCapabilityCleanupMigration(fixture as never, fixture.taskContext as never)
    ).rejects.toThrow('write interrupted')
    expect(fixture.sessionDisabledTools.get('session-1')).toEqual(['read'])
    expect(fixture.sessionDisabledTools.get('session-2')).toEqual([TAPE_TOOL_NAMES.handoff, 'exec'])
    expect(fixture.settings.get(DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY)).toMatchObject({
      status: 'failed',
      processedCount: 1,
      updatedCount: 1,
      error: 'write interrupted'
    })

    fixture.replaceSessionDisabledTools.mockImplementation(
      (sessionId: string, disabledAgentTools: string[]) => {
        fixture.sessionDisabledTools.set(sessionId, disabledAgentTools)
      }
    )
    await runDisabledAgentToolCapabilityCleanupMigration(
      fixture as never,
      fixture.taskContext as never
    )

    expect(fixture.sessionDisabledTools.get('session-1')).toEqual(['read'])
    expect(fixture.sessionDisabledTools.get('session-2')).toEqual(['exec'])
    expect(fixture.settings.get(DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY)).toMatchObject({
      status: 'completed',
      processedCount: 2,
      updatedCount: 1
    })
  })

  it('skips completed v2 cleanup and records retryable failures', async () => {
    const completed = createFixture()
    completed.settings.set(DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY, { status: 'completed' })
    await runDisabledAgentToolCapabilityCleanupMigration(
      completed as never,
      completed.taskContext as never
    )
    expect(completed.sqlitePresenter.getDatabase).not.toHaveBeenCalled()

    const failed = createFixture()
    failed.providerSettings.listAgents.mockRejectedValue(new Error('config unavailable'))
    await expect(
      runDisabledAgentToolCapabilityCleanupMigration(failed as never, failed.taskContext as never)
    ).rejects.toThrow('config unavailable')
    expect(failed.settings.get(DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY)).toMatchObject({
      status: 'failed',
      error: 'config unavailable'
    })

    failed.providerSettings.listAgents.mockResolvedValue([])
    await runDisabledAgentToolCapabilityCleanupMigration(
      failed as never,
      failed.taskContext as never
    )
    expect(failed.settings.get(DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY)).toMatchObject({
      status: 'completed'
    })
  })
})
