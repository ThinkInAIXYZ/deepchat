import { describe, expect, it } from 'vitest'
import { AgentRepository } from '../../../src/main/presenter/agentRepository'

describe('AgentRepository', () => {
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
      }
    }

    const repository = new AgentRepository(sqlitePresenter as never)
    const updated = repository.clearRegistryAcpAgentInstallation('codex-acp', {
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
})
