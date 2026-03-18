import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') {
        return '/mock/userData'
      }
      return `/mock/${name}`
    })
  }
}))

vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: vi.fn()
}))

import { LegacyChatImportService } from '@/presenter/newAgentPresenter/legacyImportService'

function createMockSqlitePresenter() {
  const statusStore = new Map<string, any>()
  const sessionStore = new Map<
    string,
    {
      id: string
      activeSkills: string[]
    }
  >()
  let conversations: Array<{ id: string; settings: { activeSkills?: string[] } }> = []

  return {
    setConversations(next: Array<{ id: string; settings: { activeSkills?: string[] } }>) {
      conversations = next
    },
    newSessionsTable: {
      create: vi.fn(
        (
          id: string,
          _agentId: string,
          _title: string,
          _projectDir: string | null,
          options?: { activeSkills?: string[] }
        ) => {
          sessionStore.set(id, {
            id,
            activeSkills: [...(options?.activeSkills ?? [])]
          })
        }
      ),
      get: vi.fn((id: string) => {
        const row = sessionStore.get(id)
        return row
          ? {
              id: row.id,
              active_skills: JSON.stringify(row.activeSkills)
            }
          : undefined
      }),
      getActiveSkills: vi.fn((id: string) => sessionStore.get(id)?.activeSkills ?? []),
      getDisabledAgentTools: vi.fn().mockReturnValue([]),
      updateActiveSkills: vi.fn((id: string, activeSkills: string[]) => {
        const row = sessionStore.get(id)
        if (!row) return
        row.activeSkills = [...activeSkills]
      }),
      updateDisabledAgentTools: vi.fn()
    },
    deepchatSessionsTable: {
      get: vi.fn(() => undefined),
      create: vi.fn()
    },
    legacyImportStatusTable: {
      get: vi.fn((key: string) => statusStore.get(key)),
      upsert: vi.fn((key: string, data: any) => {
        statusStore.set(key, {
          import_key: key,
          status: data.status,
          source_db_path: data.sourceDbPath,
          started_at: data.startedAt ?? null,
          finished_at: data.finishedAt ?? null,
          imported_sessions: data.importedSessions ?? 0,
          imported_messages: data.importedMessages ?? 0,
          imported_search_results: data.importedSearchResults ?? 0,
          error: data.error ?? null,
          updated_at: data.updatedAt ?? Date.now()
        })
      })
    },
    runTransaction: vi.fn(async (operations: () => void) => {
      operations()
    }),
    getConversationCount: vi.fn(async () => conversations.length),
    getConversationList: vi.fn(async (page: number, pageSize: number) => {
      const start = (page - 1) * pageSize
      return {
        total: conversations.length,
        list: conversations.slice(start, start + pageSize)
      }
    }),
    deepchatMessagesTable: {
      get: vi.fn(() => undefined),
      insert: vi.fn()
    },
    deepchatMessageSearchResultsTable: {
      listByMessageId: vi.fn(() => []),
      insert: vi.fn()
    },
    newEnvironmentsTable: {
      rebuildFromSessions: vi.fn()
    }
  }
}

describe('LegacyChatImportService', () => {
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let service: LegacyChatImportService

  beforeEach(() => {
    vi.clearAllMocks()
    sqlitePresenter = createMockSqlitePresenter()
    service = new LegacyChatImportService(sqlitePresenter as any, '/mock/legacy.db')
  })

  it('preserves active skills when importing fresh legacy sessions', async () => {
    await (service as any).importRows({
      conversations: [
        {
          conv_id: 'conv-1',
          title: 'Imported Chat',
          provider_id: 'openai',
          model_id: 'gpt-4',
          active_skills: '["skill-1","skill-2"]'
        }
      ],
      messageRows: [],
      attachmentRows: [],
      acpSessionRows: []
    })

    expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
      'legacy-session-conv-1',
      'deepchat',
      'Imported Chat',
      null,
      expect.objectContaining({
        activeSkills: ['skill-1', 'skill-2']
      })
    )
    expect(sqlitePresenter.newEnvironmentsTable.rebuildFromSessions).toHaveBeenCalledTimes(1)
  })

  it('imports legacy conversation workdir as the project directory', async () => {
    await (service as any).importRows({
      conversations: [
        {
          conv_id: 'conv-workdir',
          title: 'ACP Imported Chat',
          provider_id: 'acp',
          model_id: 'agent-1',
          workdir: '/legacy/workdir'
        }
      ],
      messageRows: [],
      attachmentRows: [],
      acpSessionRows: []
    })

    expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
      'legacy-session-conv-workdir',
      'agent-1',
      'ACP Imported Chat',
      '/legacy/workdir',
      expect.any(Object)
    )
    expect(sqlitePresenter.newEnvironmentsTable.rebuildFromSessions).toHaveBeenCalledTimes(1)
  })

  it('keeps the import successful when rebuilding environments fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sqlitePresenter.newEnvironmentsTable.rebuildFromSessions.mockImplementation(() => {
      throw new Error('boom')
    })

    const result = await (service as any).importRows({
      conversations: [
        {
          conv_id: 'conv-1',
          title: 'Imported Chat',
          provider_id: 'openai',
          model_id: 'gpt-4'
        }
      ],
      messageRows: [],
      attachmentRows: [],
      acpSessionRows: []
    })

    expect(result).toEqual({
      importedSessions: 1,
      importedMessages: 0,
      importedSearchResults: 0
    })
    expect(errorSpy).toHaveBeenCalledWith(
      '[LegacyChatImport] Failed to rebuild environments after import:',
      expect.objectContaining({
        message: 'boom'
      })
    )

    errorSpy.mockRestore()
  })

  it('repairs previously imported legacy sessions on first access', async () => {
    sqlitePresenter.newSessionsTable.create(
      'legacy-session-conv-2',
      'deepchat',
      'Imported',
      null,
      {}
    )
    sqlitePresenter.setConversations([
      {
        id: 'conv-2',
        settings: { activeSkills: ['skill-1'] }
      }
    ])

    const skills = await service.repairImportedLegacySessionSkills('legacy-session-conv-2')

    expect(skills).toEqual(['skill-1'])
    expect(sqlitePresenter.newSessionsTable.updateActiveSkills).toHaveBeenCalledWith(
      'legacy-session-conv-2',
      ['skill-1']
    )

    await service.repairImportedLegacySessionSkills('legacy-session-conv-2')
    expect(sqlitePresenter.getConversationCount).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite non-empty imported session skills during repair', async () => {
    sqlitePresenter.newSessionsTable.create('legacy-session-conv-3', 'deepchat', 'Imported', null, {
      activeSkills: ['manual-skill']
    })
    sqlitePresenter.setConversations([
      {
        id: 'conv-3',
        settings: { activeSkills: ['legacy-skill'] }
      }
    ])

    const skills = await service.repairImportedLegacySessionSkills('legacy-session-conv-3')

    expect(skills).toEqual(['manual-skill'])
    expect(sqlitePresenter.newSessionsTable.updateActiveSkills).not.toHaveBeenCalled()
    expect(sqlitePresenter.getConversationCount).not.toHaveBeenCalled()
  })
})
