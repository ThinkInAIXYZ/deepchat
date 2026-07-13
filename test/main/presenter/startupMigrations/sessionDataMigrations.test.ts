import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DISABLED_SEARCH_TOOL_CLEANUP_KEY,
  SQLITE_MAINLINE_NORMALIZATION_KEY,
  runDisabledSearchToolCleanupMigration,
  runMainlineNormalizationMigration,
  type SessionDataMigrationSQLitePort
} from '@/presenter/startupMigrations/sessionDataMigrations'

function createFixture() {
  const settings = new Map<string, unknown>()
  const sessionRows: Array<{ id: string }> = []
  const statements: string[] = []
  const sqlitePresenter = {
    configTables: {
      getAgentSetting: vi.fn((key: string) => settings.get(key)),
      setAgentSetting: vi.fn((key: string, value: unknown) => settings.set(key, value))
    },
    getDatabase: vi.fn(() => ({
      prepare: vi.fn((sql: string) => {
        statements.push(sql)
        return {
          all: vi.fn(() =>
            sql.includes('SELECT id FROM new_sessions ORDER BY updated_at ASC') ? sessionRows : []
          )
        }
      })
    })),
    newSessionsTable: {
      get: vi.fn(() => null),
      getActiveSkills: vi.fn(() => []),
      getDisabledAgentTools: vi.fn(() => [])
    },
    newSessionActiveSkillsTable: { replaceForSession: vi.fn() },
    newSessionDisabledAgentToolsTable: { replaceForSession: vi.fn() },
    deepchatSearchDocumentsTable: { upsert: vi.fn() },
    deepchatUserMessagesTable: { upsert: vi.fn() },
    deepchatUserMessageFilesTable: { replaceForMessage: vi.fn() },
    deepchatUserMessageLinksTable: { replaceForMessage: vi.fn() },
    deepchatAssistantBlocksTable: { replaceForMessage: vi.fn() }
  } as unknown as SessionDataMigrationSQLitePort
  const configPresenter = {
    listAgents: vi.fn(async () => []),
    getDeepChatAgentConfig: vi.fn(),
    updateDeepChatAgent: vi.fn()
  }
  const appSessionService = { updateDisabledAgentTools: vi.fn() }
  const taskContext = {
    reportProgress: vi.fn(),
    yield: vi.fn(async () => undefined)
  }

  return {
    settings,
    sessionRows,
    statements,
    sqlitePresenter,
    configPresenter,
    appSessionService,
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

    const writes = fixture.sqlitePresenter.configTables.setAgentSetting.mock.calls
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

  it('normalizes session and agent-config disabled tools and records completion', async () => {
    const fixture = createFixture()
    fixture.sessionRows.push({ id: 'session-1' })
    fixture.sqlitePresenter.newSessionsTable.getDisabledAgentTools.mockReturnValue([
      'grep',
      'find',
      'exec',
      'yo_browser_cdp_send'
    ])
    fixture.configPresenter.listAgents.mockResolvedValue([
      { id: 'deepchat', type: 'deepchat', name: 'DeepChat', enabled: true }
    ])
    fixture.configPresenter.getDeepChatAgentConfig.mockResolvedValue({
      disabledAgentTools: ['ls', 'exec']
    })

    await runDisabledSearchToolCleanupMigration(fixture as never, fixture.taskContext as never)

    expect(fixture.appSessionService.updateDisabledAgentTools).toHaveBeenCalledWith('session-1', [
      'cdp_send',
      'exec'
    ])
    expect(fixture.configPresenter.updateDeepChatAgent).toHaveBeenCalledWith('deepchat', {
      config: { disabledAgentTools: ['exec'] }
    })
    expect(fixture.settings.get(DISABLED_SEARCH_TOOL_CLEANUP_KEY)).toMatchObject({
      status: 'completed',
      processedCount: 1,
      updatedCount: 1,
      configUpdatedCount: 1
    })
  })

  it('skips completed cleanup and records cleanup failures', async () => {
    const completed = createFixture()
    completed.settings.set(DISABLED_SEARCH_TOOL_CLEANUP_KEY, { status: 'completed' })
    await runDisabledSearchToolCleanupMigration(completed as never, completed.taskContext as never)
    expect(completed.sqlitePresenter.getDatabase).not.toHaveBeenCalled()

    const failed = createFixture()
    failed.configPresenter.listAgents.mockRejectedValue(new Error('config unavailable'))
    await expect(
      runDisabledSearchToolCleanupMigration(failed as never, failed.taskContext as never)
    ).rejects.toThrow('config unavailable')
    expect(failed.settings.get(DISABLED_SEARCH_TOOL_CLEANUP_KEY)).toMatchObject({
      status: 'failed',
      error: 'config unavailable'
    })
  })
})
