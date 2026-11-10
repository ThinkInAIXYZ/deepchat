import { describe, expect, it, vi } from 'vitest'
import {
  runDisabledAgentToolCapabilityCleanupMigration,
  runHtmlRenderSessionToolsSeedMigration,
  type SessionDataMigrationSQLitePort
} from '@/app/startupMigrations/sessionDataMigrations'
import { TAPE_TOOL_NAMES } from '@shared/agentTools'
import { HTML_RENDER_SECTION_TOOL_NAME, HTML_RENDER_TOOL_NAME } from '@shared/agentHtmlRenderTool'
import { NewSessionActiveSkillsTable } from '@/session/data/tables/newSessionActiveSkills'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const sessionsModule = sqliteModule
  ? await import('@/session/data/tables/newSessions').catch(() => null)
  : null
const disabledToolsModule = sqliteModule
  ? await import('@/session/data/tables/newSessionDisabledAgentTools').catch(() => null)
  : null
const environmentsModule = sqliteModule
  ? await import('@/project/data/tables/newEnvironments').catch(() => null)
  : null

const Database = sqliteModule?.default
const NewSessionsTable = sessionsModule?.NewSessionsTable
const NewSessionDisabledAgentToolsTable = disabledToolsModule?.NewSessionDisabledAgentToolsTable
const NewEnvironmentsTable = environmentsModule?.NewEnvironmentsTable
const DatabaseCtor = Database!
const NewSessionsTableCtor = NewSessionsTable!
const NewSessionDisabledAgentToolsTableCtor = NewSessionDisabledAgentToolsTable!
const NewEnvironmentsTableCtor = NewEnvironmentsTable!

let sqliteAvailable = false
if (Database) {
  try {
    const smokeDb = new Database(':memory:')
    smokeDb.close()
    sqliteAvailable = true
  } catch {
    sqliteAvailable = false
  }
}

const describeIfSqlite =
  sqliteAvailable && NewSessionsTable && NewSessionDisabledAgentToolsTable && NewEnvironmentsTable
    ? describe
    : describe.skip

describeIfSqlite('disabled Agent tool capability cleanup SQLite integration', () => {
  it('preserves session and environment recency while replacing both disabled-tool stores', async () => {
    const db = new DatabaseCtor(':memory:')
    try {
      db.exec(`
        CREATE TABLE acp_sessions (
          conversation_id TEXT NOT NULL,
          workdir TEXT,
          updated_at INTEGER NOT NULL
        );
      `)

      const sessions = new NewSessionsTableCtor(db)
      const disabledTools = new NewSessionDisabledAgentToolsTableCtor(db)
      const environments = new NewEnvironmentsTableCtor(db)
      sessions.createTable()
      new NewSessionActiveSkillsTable(db).createTable()
      disabledTools.createTable()
      environments.createTable()

      sessions.create('older', 'deepchat', 'Older', '/work/app', {
        disabledAgentTools: [TAPE_TOOL_NAMES.search, 'read'],
        createdAt: 50,
        updatedAt: 100
      })
      sessions.create('newer', 'deepchat', 'Newer', '/work/app', {
        disabledAgentTools: ['exec'],
        createdAt: 150,
        updatedAt: 200
      })
      environments.rebuildFromSessions()
      const environmentBefore = environments.list()

      const settings = new Map<string, unknown>()
      const sqlitePresenter = {
        appSettingsTable: {
          getAppSetting: vi.fn((key: string) => settings.get(key)),
          setAppSetting: vi.fn((key: string, value: unknown) => settings.set(key, value))
        },
        getDatabase: vi.fn(() => db),
        newSessionsTable: sessions,
        newSessionDisabledAgentToolsTable: disabledTools
      } as unknown as SessionDataMigrationSQLitePort

      await runDisabledAgentToolCapabilityCleanupMigration(
        {
          sqlitePresenter,
          agentSettings: {
            listAgents: vi.fn(async () => [])
          }
        } as never,
        {
          reportProgress: vi.fn(),
          yield: vi.fn(async () => undefined)
        } as never
      )

      expect(sessions.list().map((row) => row.id)).toEqual(['newer', 'older'])
      expect(sessions.get('older')).toMatchObject({
        disabled_agent_tools: JSON.stringify(['read']),
        updated_at: 100,
        revision: 1
      })
      expect(sessions.get('newer')).toMatchObject({
        updated_at: 200,
        revision: 0
      })
      expect(disabledTools.listBySession('older')).toEqual([
        { session_id: 'older', ordinal: 0, tool_name: 'read' }
      ])
      expect(environments.list()).toEqual(environmentBefore)
      expect(environmentBefore).toEqual([
        { path: '/work/app', session_count: 2, last_used_at: 200 }
      ])
    } finally {
      db.close()
    }
  })

  it('rolls back both disabled-tool stores when normalized persistence fails', async () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const sessions = new NewSessionsTableCtor(db)
      const disabledTools = new NewSessionDisabledAgentToolsTableCtor(db)
      sessions.createTable()
      new NewSessionActiveSkillsTable(db).createTable()
      disabledTools.createTable()

      const originalDisabledTools = [TAPE_TOOL_NAMES.search, 'read']
      sessions.create('session-1', 'deepchat', 'Session', '/work/app', {
        disabledAgentTools: originalDisabledTools,
        createdAt: 50,
        updatedAt: 100
      })

      const settings = new Map<string, unknown>()
      const sqlitePresenter = {
        appSettingsTable: {
          getAppSetting: vi.fn((key: string) => settings.get(key)),
          setAppSetting: vi.fn((key: string, value: unknown) => settings.set(key, value))
        },
        getDatabase: vi.fn(() => db),
        newSessionsTable: sessions,
        newSessionDisabledAgentToolsTable: {
          replaceForSession: (sessionId: string, toolNames: string[]) => {
            disabledTools.replaceForSession(sessionId, toolNames)
            throw new Error('normalized persistence failed')
          }
        }
      } as unknown as SessionDataMigrationSQLitePort

      await expect(
        runDisabledAgentToolCapabilityCleanupMigration({
          sqlitePresenter,
          agentSettings: {
            listAgents: vi.fn(async () => [])
          }
        } as never)
      ).rejects.toThrow('normalized persistence failed')

      expect(sessions.get('session-1')).toMatchObject({
        disabled_agent_tools: JSON.stringify(originalDisabledTools),
        updated_at: 100,
        revision: 0
      })
      expect(disabledTools.listBySession('session-1')).toEqual([
        { session_id: 'session-1', ordinal: 0, tool_name: TAPE_TOOL_NAMES.search },
        { session_id: 'session-1', ordinal: 1, tool_name: 'read' }
      ])
    } finally {
      db.close()
    }
  })

  it('disables html_render tools in pre-upgrade sessions once and keeps later user enables', async () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const sessions = new NewSessionsTableCtor(db)
      const disabledTools = new NewSessionDisabledAgentToolsTableCtor(db)
      sessions.createTable()
      new NewSessionActiveSkillsTable(db).createTable()
      disabledTools.createTable()

      sessions.create('pre-upgrade', 'deepchat', 'Old', '/work/app', {
        disabledAgentTools: ['cronjob'],
        createdAt: 50,
        updatedAt: 100
      })
      sessions.create('acp-session', 'acp-agent', 'ACP', '/work/app', {
        disabledAgentTools: [],
        createdAt: 60,
        updatedAt: 110
      })

      const settings = new Map<string, unknown>()
      const dependencies = {
        sqlitePresenter: {
          appSettingsTable: {
            getAppSetting: vi.fn((key: string) => settings.get(key)),
            setAppSetting: vi.fn((key: string, value: unknown) => settings.set(key, value))
          },
          getDatabase: vi.fn(() => db),
          newSessionsTable: sessions,
          newSessionDisabledAgentToolsTable: disabledTools
        } as unknown as SessionDataMigrationSQLitePort,
        agentSettings: {
          listAgents: vi.fn(async () => [
            { id: 'deepchat', type: 'deepchat' },
            { id: 'acp-agent', type: 'acp' }
          ])
        } as never
      }

      await runHtmlRenderSessionToolsSeedMigration(dependencies)

      const seeded = ['cronjob', HTML_RENDER_TOOL_NAME, HTML_RENDER_SECTION_TOOL_NAME]
      expect(sessions.getDisabledAgentTools('pre-upgrade')).toEqual(seeded)
      expect(sessions.get('pre-upgrade')?.disabled_agent_tools).toBe(JSON.stringify(seeded))
      expect(sessions.get('pre-upgrade')?.updated_at).toBe(100)
      expect(sessions.getDisabledAgentTools('acp-session')).toEqual([])

      sessions.updateDisabledAgentTools('pre-upgrade', ['cronjob', HTML_RENDER_SECTION_TOOL_NAME])
      await runHtmlRenderSessionToolsSeedMigration(dependencies)

      expect(sessions.getDisabledAgentTools('pre-upgrade')).toEqual([
        'cronjob',
        HTML_RENDER_SECTION_TOOL_NAME
      ])
    } finally {
      db.close()
    }
  })
})
