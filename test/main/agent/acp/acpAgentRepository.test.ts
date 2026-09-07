import { describe, expect, it } from 'vitest'
import { AcpAgentRepository } from '@/agent/acp/acpAgentRepository'

function createRepository(sqlitePresenter: any): AcpAgentRepository {
  return new AcpAgentRepository({
    rows: sqlitePresenter.agentsTable,
    listSessionIdsByAgent: (agentId) =>
      (sqlitePresenter.newSessionsTable?.list({ agentId, includeSubagents: true }) ?? []).map(
        (session: { id: string }) => session.id
      )
  })
}

describe('AcpAgentRepository', () => {
  it('clears registry ACP installation state without deleting the row', () => {
    const row = {
      id: 'codex-acp',
      agent_type: 'acp' as const,
      source: 'registry' as const,
      name: 'Codex CLI',
      enabled: 1,
      protected: 0,
      description: null,
      icon: null,
      avatar_json: null,
      config_json: '{}',
      state_json: JSON.stringify({
        envOverride: {
          OPENAI_API_KEY: 'secret'
        },
        installState: {
          status: 'installed',
          version: '0.10.0',
          installDir: 'C:\\temp\\codex-acp'
        }
      }),
      created_at: Date.now(),
      updated_at: Date.now()
    }

    const sqlitePresenter = {
      agentsTable: {
        get: (id: string) => (id === row.id ? row : undefined),
        update: (_id: string, input: { enabled?: boolean; stateJson?: string | null }) => {
          if (typeof input.enabled === 'boolean') {
            row.enabled = input.enabled ? 1 : 0
          }
          if (typeof input.stateJson === 'string') {
            row.state_json = input.stateJson
          }
        }
      },
      newSessionsTable: {
        list: () => []
      }
    }

    const repository = createRepository(sqlitePresenter)
    const updated = repository.clearRegistryInstallation('codex-acp', {
      status: 'not_installed',
      version: '0.10.0',
      distributionType: 'binary',
      installDir: null,
      installedAt: null,
      error: null
    })

    expect(updated).toBe(true)
    expect(row.enabled).toBe(0)
    expect(JSON.parse(row.state_json ?? '{}')).toEqual({
      envOverride: {
        OPENAI_API_KEY: 'secret'
      },
      installState: {
        status: 'not_installed',
        version: '0.10.0',
        distributionType: 'binary',
        installDir: null,
        installedAt: null,
        error: null
      }
    })
  })

  it('preserves the existing winner and state semantics for source and id collisions', () => {
    const rows = new Map<string, any>()
    const agentsTable = {
      get: (id: string) => rows.get(id),
      list: (filters?: { agentType?: string; source?: string }) =>
        [...rows.values()].filter(
          (row) =>
            (!filters?.agentType || row.agent_type === filters.agentType) &&
            (!filters?.source || row.source === filters.source)
        ),
      upsert: (input: any) => {
        const existing = rows.get(input.id)
        rows.set(input.id, {
          id: input.id,
          agent_type: input.agentType,
          source: input.source,
          name: input.name,
          enabled: input.enabled ? 1 : 0,
          protected: input.protected ? 1 : 0,
          description: input.description ?? null,
          icon: input.icon ?? null,
          avatar_json: input.avatarJson ?? null,
          config_json: input.configJson ?? null,
          state_json: input.stateJson ?? null,
          created_at: existing?.created_at ?? input.createdAt ?? Date.now(),
          updated_at: input.updatedAt ?? Date.now()
        })
      }
    }
    const repository = createRepository({ agentsTable })

    rows.set('missing-command', {
      id: 'missing-command',
      agent_type: 'acp',
      source: 'manual',
      name: 'Missing Command',
      enabled: 1,
      protected: 0,
      description: null,
      icon: null,
      avatar_json: null,
      config_json: '{}',
      state_json: null,
      created_at: 1,
      updated_at: 1
    })
    expect(repository.listManual()).toEqual([])

    rows.set('registry-wins', {
      id: 'registry-wins',
      agent_type: 'acp',
      source: 'manual',
      name: 'Manual Agent',
      enabled: 1,
      protected: 0,
      description: null,
      icon: null,
      avatar_json: null,
      config_json: JSON.stringify({ command: 'manual-agent' }),
      state_json: JSON.stringify({
        envOverride: { API_HOST: 'https://example.test' },
        installState: { status: 'installed', version: '1.0.0' }
      }),
      created_at: 123,
      updated_at: 456
    })
    repository.syncRegistry([
      {
        id: 'registry-wins',
        name: 'Registry Agent',
        version: '2.0.0',
        distribution: { npx: { package: '@example/acp@2.0.0' } }
      }
    ])

    expect(rows.get('registry-wins')).toMatchObject({
      agent_type: 'acp',
      source: 'registry',
      name: 'Registry Agent',
      enabled: 1,
      created_at: 123
    })
    expect(JSON.parse(rows.get('registry-wins').state_json)).toEqual({
      envOverride: { API_HOST: 'https://example.test' },
      installState: { status: 'installed', version: '1.0.0' }
    })
    expect(repository.getRegistryReference('registry-wins')).toEqual({
      id: 'registry-wins',
      version: '2.0.0',
      distribution: { npx: { package: '@example/acp@2.0.0' } }
    })

    rows.set('manual-wins', {
      id: 'manual-wins',
      agent_type: 'acp',
      source: 'registry',
      name: 'Registry Agent',
      enabled: 1,
      protected: 0,
      description: null,
      icon: null,
      avatar_json: null,
      config_json: '{}',
      state_json: JSON.stringify({ installState: { status: 'installed' } }),
      created_at: 123,
      updated_at: 456
    })
    expect(
      repository.createManual({
        id: 'manual-wins',
        name: 'Manual Agent',
        command: 'manual-agent',
        args: ['--stdio'],
        enabled: false
      })
    ).toMatchObject({
      id: 'manual-wins',
      source: 'manual',
      command: 'manual-agent',
      args: ['--stdio'],
      enabled: false
    })
    expect(rows.get('manual-wins')).toMatchObject({
      agent_type: 'acp',
      source: 'manual',
      name: 'Manual Agent',
      enabled: 0,
      state_json: '{}',
      created_at: 123
    })
    expect(JSON.parse(rows.get('manual-wins').config_json)).toEqual({
      command: 'manual-agent',
      args: ['--stdio']
    })
  })

  it('refuses to clear registry ACP installation while sessions remain', () => {
    const row = {
      id: 'codex-acp',
      agent_type: 'acp' as const,
      source: 'registry' as const,
      name: 'Codex CLI',
      enabled: 1,
      protected: 0,
      description: null,
      icon: null,
      avatar_json: null,
      config_json: '{}',
      state_json: JSON.stringify({
        installState: {
          status: 'installed',
          version: '0.10.0',
          installDir: 'C:\\temp\\codex-acp'
        }
      }),
      created_at: Date.now(),
      updated_at: Date.now()
    }
    let updateCalled = false

    const sqlitePresenter = {
      agentsTable: {
        get: (id: string) => (id === row.id ? row : undefined),
        update: () => {
          updateCalled = true
        }
      },
      newSessionsTable: {
        list: () => [{ id: 'session-1' }]
      }
    }

    const repository = createRepository(sqlitePresenter)
    const updated = repository.clearRegistryInstallation('codex-acp', {
      status: 'not_installed',
      version: '0.10.0',
      distributionType: 'binary',
      installDir: null,
      installedAt: null,
      error: null
    })

    expect(updated).toBe(false)
    expect(row.enabled).toBe(1)
    expect(updateCalled).toBe(false)
  })
})
