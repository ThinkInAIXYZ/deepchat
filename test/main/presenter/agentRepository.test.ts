import { describe, expect, it } from 'vitest'
import { AgentRepository } from '../../../src/main/presenter/agentRepository'

describe('AgentRepository', () => {
  it('resolves default DeepChat subagent slots for the builtin agent', () => {
    const rows = new Map<string, any>()
    const sqlitePresenter = {
      agentsTable: {
        get: (id: string) => rows.get(id),
        create: (input: any) => {
          rows.set(input.id, {
            id: input.id,
            agent_type: input.agentType,
            source: input.source,
            name: input.name,
            enabled: input.enabled ? 1 : 0,
            protected: input.protected ? 1 : 0,
            description: null,
            icon: input.icon ?? null,
            avatar_json: input.avatarJson,
            config_json: input.configJson,
            state_json: null,
            created_at: Date.now(),
            updated_at: Date.now()
          })
        },
        update: (id: string, input: any) => {
          const row = rows.get(id)
          rows.set(id, { ...row, ...input })
        }
      }
    }
    const repository = new AgentRepository(sqlitePresenter as never)

    repository.ensureBuiltinDeepChatAgent({ name: 'DeepChat', config: {} })
    const config = repository.resolveDeepChatAgentConfig('deepchat')

    expect(config.subagentEnabled).toBe(true)
    expect(config.subagents?.map((slot) => slot.id)).toEqual([
      'explorer',
      'implementer',
      'reviewer'
    ])
    expect(config.subagents?.every((slot) => slot.targetType === 'self')).toBe(true)
  })

  it('inherits DeepChat image generation model from the builtin agent', () => {
    const now = Date.now()
    const rows = new Map<string, any>([
      [
        'deepchat',
        {
          id: 'deepchat',
          agent_type: 'deepchat',
          source: 'builtin',
          name: 'DeepChat',
          enabled: 1,
          protected: 1,
          description: null,
          icon: null,
          avatar_json: null,
          config_json: JSON.stringify({
            imageGenerationModel: { providerId: 'openai', modelId: 'gpt-image-1' }
          }),
          state_json: null,
          created_at: now,
          updated_at: now
        }
      ],
      [
        'custom-agent',
        {
          id: 'custom-agent',
          agent_type: 'deepchat',
          source: 'manual',
          name: 'Custom Agent',
          enabled: 1,
          protected: 0,
          description: null,
          icon: null,
          avatar_json: null,
          config_json: JSON.stringify({}),
          state_json: null,
          created_at: now,
          updated_at: now
        }
      ]
    ])
    const repository = new AgentRepository({
      agentsTable: {
        get: (id: string) => rows.get(id)
      }
    } as never)

    expect(repository.resolveDeepChatAgentConfig('custom-agent').imageGenerationModel).toEqual({
      providerId: 'openai',
      modelId: 'gpt-image-1'
    })
  })

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

    const repository = new AgentRepository(sqlitePresenter as never)
    const updated = repository.clearRegistryAcpAgentInstallation('codex-acp', {
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
