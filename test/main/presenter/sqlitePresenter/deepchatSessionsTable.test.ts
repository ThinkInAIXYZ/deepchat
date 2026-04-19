import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeepChatSessionsTable } from '@/presenter/sqlitePresenter/tables/deepchatSessions'

describe('DeepChatSessionsTable.updateSummaryStateIfMatches', () => {
  const run = vi.fn()
  const prepare = vi.fn()
  const db = {
    prepare
  } as any

  let table: DeepChatSessionsTable

  beforeEach(() => {
    run.mockReset()
    prepare.mockReset()
    prepare.mockReturnValue({ run })
    table = new DeepChatSessionsTable(db)
  })

  it('uses an atomic guarded update and returns true when sqlite reports a write', () => {
    run.mockReturnValue({ changes: 1 })

    const applied = table.updateSummaryStateIfMatches(
      's1',
      {
        summaryText: 'fresh summary',
        summaryCursorOrderSeq: 3,
        summaryUpdatedAt: 111
      },
      {
        summaryText: null,
        summaryCursorOrderSeq: 1,
        summaryUpdatedAt: null
      }
    )

    expect(applied).toBe(true)
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE deepchat_sessions'))
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('AND summary_cursor_order_seq = ?')
    )
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('summary_text IS NULL AND ? IS NULL')
    )
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('summary_updated_at IS NULL AND ? IS NULL')
    )
    expect(run).toHaveBeenCalledWith('fresh summary', 3, 111, 's1', 1, null, null, null, null)
  })

  it('returns false when sqlite reports that the guarded update did not apply', () => {
    run.mockReturnValue({ changes: 0 })

    const applied = table.updateSummaryStateIfMatches(
      's1',
      {
        summaryText: 'stale summary',
        summaryCursorOrderSeq: 3,
        summaryUpdatedAt: 111
      },
      {
        summaryText: null,
        summaryCursorOrderSeq: 1,
        summaryUpdatedAt: null
      }
    )

    expect(applied).toBe(false)
    expect(run).toHaveBeenCalledOnce()
  })

  it('restores the v23 recovery migration for missing forward columns', () => {
    const get = vi.fn((param?: string) => {
      if (param === 'deepchat_sessions') {
        return { name: 'deepchat_sessions' }
      }

      return undefined
    })
    const all = vi.fn(() => [
      { name: 'id' },
      { name: 'provider_id' },
      { name: 'model_id' },
      { name: 'permission_mode' },
      { name: 'system_prompt' },
      { name: 'temperature' },
      { name: 'context_length' },
      { name: 'max_tokens' },
      { name: 'thinking_budget' },
      { name: 'reasoning_effort' },
      { name: 'verbosity' },
      { name: 'summary_text' },
      { name: 'summary_cursor_order_seq' },
      { name: 'summary_updated_at' }
    ])

    prepare.mockImplementation((sql: string) => {
      if (sql === "SELECT name FROM sqlite_master WHERE type='table' AND name=?") {
        return { get }
      }

      if (sql === 'PRAGMA table_info(deepchat_sessions)') {
        return { all }
      }

      throw new Error(`Unexpected SQL: ${sql}`)
    })

    expect(table.getLatestVersion()).toBe(23)

    expect(table.getMigrationSQL(23)).toBe(
      [
        'ALTER TABLE deepchat_sessions ADD COLUMN force_interleaved_thinking_compat INTEGER;',
        'ALTER TABLE deepchat_sessions ADD COLUMN reasoning_visibility TEXT;'
      ].join('\n')
    )
  })

  it('aborts table creation when the recorded schema version is newer than supported', () => {
    const exec = vi.fn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const guardedDb = {
      prepare: vi.fn((sql: string) => {
        if (sql === "SELECT name FROM sqlite_master WHERE type='table' AND name=?") {
          return {
            get: (param?: string) => {
              if (param === 'deepchat_sessions') {
                return undefined
              }

              if (param === 'schema_versions') {
                return { name: 'schema_versions' }
              }

              return undefined
            }
          }
        }

        if (
          sql === "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_versions'"
        ) {
          return {
            get: () => ({ name: 'schema_versions' })
          }
        }

        if (sql === 'SELECT MAX(version) as version FROM schema_versions') {
          return {
            get: () => ({ version: 24 })
          }
        }

        throw new Error(`Unexpected SQL: ${sql}`)
      }),
      exec
    } as any

    const guardedTable = new DeepChatSessionsTable(guardedDb)

    expect(() => guardedTable.createTable()).toThrow(
      'Recorded deepchat_sessions schema version 24 exceeds supported version 23.'
    )
    expect(exec).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      'Recorded deepchat_sessions schema version 24 exceeds supported version 23. Refusing to create table from a downgraded schema.'
    )
  })
})
