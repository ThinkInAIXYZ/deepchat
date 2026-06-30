import { describe, expect, it } from 'vitest'
import { AgentRepository } from '../../../src/main/presenter/agentRepository'

describe('AgentRepository', () => {
  it('deletes DeepChat agent memory rows and the agent row in one transaction', () => {
    const agents = new Map<string, any>([
      [
        'writer',
        {
          id: 'writer',
          agent_type: 'deepchat',
          source: 'manual',
          name: 'Writer',
          enabled: 1,
          protected: 0,
          description: null,
          icon: null,
          avatar_json: null,
          config_json: '{}',
          state_json: null,
          created_at: 1,
          updated_at: 1
        }
      ]
    ])
    const memories = new Map<string, string>([
      ['m1', 'writer'],
      ['m2', 'other']
    ])
    const audits = new Map<string, string>([
      ['a1', 'writer'],
      ['a2', 'other']
    ])
    const sqlitePresenter = {
      getDatabase: () => ({
        transaction: (callback: () => boolean) => callback
      }),
      agentsTable: {
        get: (id: string) => agents.get(id),
        delete: (id: string) => {
          agents.delete(id)
        }
      },
      agentMemoryTable: {
        clearByAgent: (agentId: string) => {
          let removed = 0
          for (const [id, owner] of [...memories]) {
            if (owner === agentId) {
              memories.delete(id)
              removed += 1
            }
          }
          return removed
        }
      },
      agentMemoryAuditTable: {
        clearByAgent: (agentId: string) => {
          let removed = 0
          for (const [id, owner] of [...audits]) {
            if (owner === agentId) {
              audits.delete(id)
              removed += 1
            }
          }
          return removed
        }
      },
      newSessionsTable: {
        list: () => []
      }
    }
    const repository = new AgentRepository(sqlitePresenter as never)

    expect(repository.deleteDeepChatAgent('writer')).toBe(true)
    expect(agents.has('writer')).toBe(false)
    expect([...memories.entries()]).toEqual([['m2', 'other']])
    expect([...audits.entries()]).toEqual([['a2', 'other']])
  })

  it('does not clear memory or audit rows when DeepChat agent deletion is blocked', () => {
    const agent = {
      id: 'writer',
      agent_type: 'deepchat',
      source: 'manual',
      name: 'Writer',
      enabled: 1,
      protected: 0,
      description: null,
      icon: null,
      avatar_json: null,
      config_json: '{}',
      state_json: null,
      created_at: 1,
      updated_at: 1
    }
    const memories = new Map<string, string>([['m1', 'writer']])
    const audits = new Map<string, string>([['a1', 'writer']])
    const sqlitePresenter = {
      getDatabase: () => ({
        transaction: (callback: () => boolean) => callback
      }),
      agentsTable: {
        get: () => agent,
        delete: () => {
          throw new Error('should not delete')
        }
      },
      agentMemoryTable: {
        clearByAgent: () => {
          memories.clear()
          return 1
        }
      },
      agentMemoryAuditTable: {
        clearByAgent: () => {
          audits.clear()
          return 1
        }
      },
      newSessionsTable: {
        list: () => [{ id: 's1' }]
      }
    }
    const repository = new AgentRepository(sqlitePresenter as never)

    expect(repository.deleteDeepChatAgent('writer')).toBe(false)
    expect(memories.has('m1')).toBe(true)
    expect(audits.has('a1')).toBe(true)
  })

  it('does not clear memory or audit rows for protected or non-DeepChat agents', () => {
    const cases = [
      { agentType: 'deepchat', protected: 1 },
      { agentType: 'acp', protected: 0 }
    ]

    for (const testCase of cases) {
      const agent = {
        id: 'writer',
        agent_type: testCase.agentType,
        source: 'manual',
        name: 'Writer',
        enabled: 1,
        protected: testCase.protected,
        description: null,
        icon: null,
        avatar_json: null,
        config_json: '{}',
        state_json: null,
        created_at: 1,
        updated_at: 1
      }
      const memories = new Map<string, string>([['m1', 'writer']])
      const audits = new Map<string, string>([['a1', 'writer']])
      const sqlitePresenter = {
        getDatabase: () => ({
          transaction: (callback: () => boolean) => callback
        }),
        agentsTable: {
          get: () => agent,
          delete: () => {
            throw new Error('should not delete')
          }
        },
        agentMemoryTable: {
          clearByAgent: () => {
            memories.clear()
            return 1
          }
        },
        agentMemoryAuditTable: {
          clearByAgent: () => {
            audits.clear()
            return 1
          }
        },
        newSessionsTable: {
          list: () => []
        }
      }
      const repository = new AgentRepository(sqlitePresenter as never)

      expect(repository.deleteDeepChatAgent('writer')).toBe(false)
      expect(memories.has('m1')).toBe(true)
      expect(audits.has('a1')).toBe(true)
    }
  })

  it('rolls back memory and audit cleanup when agent row deletion fails', () => {
    const agents = new Map<string, any>([
      [
        'writer',
        {
          id: 'writer',
          agent_type: 'deepchat',
          source: 'manual',
          name: 'Writer',
          enabled: 1,
          protected: 0,
          description: null,
          icon: null,
          avatar_json: null,
          config_json: '{}',
          state_json: null,
          created_at: 1,
          updated_at: 1
        }
      ]
    ])
    const memories = new Map<string, string>([['m1', 'writer']])
    const audits = new Map<string, string>([['a1', 'writer']])
    const sqlitePresenter = {
      getDatabase: () => ({
        transaction: (callback: () => boolean) => () => {
          const agentSnapshot = new Map(agents)
          const memorySnapshot = new Map(memories)
          const auditSnapshot = new Map(audits)
          try {
            return callback()
          } catch (error) {
            agents.clear()
            for (const entry of agentSnapshot) agents.set(...entry)
            memories.clear()
            for (const entry of memorySnapshot) memories.set(...entry)
            audits.clear()
            for (const entry of auditSnapshot) audits.set(...entry)
            throw error
          }
        }
      }),
      agentsTable: {
        get: (id: string) => agents.get(id),
        delete: () => {
          throw new Error('delete failed')
        }
      },
      agentMemoryTable: {
        clearByAgent: (agentId: string) => {
          let removed = 0
          for (const [id, owner] of [...memories]) {
            if (owner === agentId) {
              memories.delete(id)
              removed += 1
            }
          }
          return removed
        }
      },
      agentMemoryAuditTable: {
        clearByAgent: (agentId: string) => {
          let removed = 0
          for (const [id, owner] of [...audits]) {
            if (owner === agentId) {
              audits.delete(id)
              removed += 1
            }
          }
          return removed
        }
      },
      newSessionsTable: {
        list: () => []
      }
    }
    const repository = new AgentRepository(sqlitePresenter as never)

    expect(() => repository.deleteDeepChatAgent('writer')).toThrow('delete failed')
    expect(agents.has('writer')).toBe(true)
    expect(memories.has('m1')).toBe(true)
    expect(audits.has('a1')).toBe(true)
  })

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

  it('inherits memoryExtractionModel from the builtin agent and lets a custom agent override it', () => {
    const now = Date.now()
    const makeRow = (id: string, source: string, config: object) => ({
      id,
      agent_type: 'deepchat',
      source,
      name: id,
      enabled: 1,
      protected: source === 'builtin' ? 1 : 0,
      description: null,
      icon: null,
      avatar_json: null,
      config_json: JSON.stringify(config),
      state_json: null,
      created_at: now,
      updated_at: now
    })
    const rows = new Map<string, any>([
      [
        'deepchat',
        makeRow('deepchat', 'builtin', {
          memoryExtractionModel: { providerId: 'openai', modelId: 'gpt-4o-mini' }
        })
      ],
      ['inheriting-agent', makeRow('inheriting-agent', 'manual', {})],
      [
        'overriding-agent',
        makeRow('overriding-agent', 'manual', {
          memoryExtractionModel: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' }
        })
      ]
    ])
    const repository = new AgentRepository({
      agentsTable: {
        get: (id: string) => rows.get(id)
      }
    } as never)

    expect(repository.resolveDeepChatAgentConfig('inheriting-agent').memoryExtractionModel).toEqual(
      { providerId: 'openai', modelId: 'gpt-4o-mini' }
    )
    expect(repository.resolveDeepChatAgentConfig('overriding-agent').memoryExtractionModel).toEqual(
      { providerId: 'anthropic', modelId: 'claude-haiku-4-5' }
    )
  })

  it('inherits memoryInjectionTokenBudget from the builtin agent and lets a custom agent override it', () => {
    const now = Date.now()
    const makeRow = (id: string, source: string, config: object) => ({
      id,
      agent_type: 'deepchat',
      source,
      name: id,
      enabled: 1,
      protected: source === 'builtin' ? 1 : 0,
      description: null,
      icon: null,
      avatar_json: null,
      config_json: JSON.stringify(config),
      state_json: null,
      created_at: now,
      updated_at: now
    })
    const rows = new Map<string, any>([
      ['deepchat', makeRow('deepchat', 'builtin', { memoryInjectionTokenBudget: 800 })],
      ['inheriting-agent', makeRow('inheriting-agent', 'manual', {})],
      [
        'overriding-agent',
        makeRow('overriding-agent', 'manual', { memoryInjectionTokenBudget: 2000 })
      ]
    ])
    const repository = new AgentRepository({
      agentsTable: {
        get: (id: string) => rows.get(id)
      }
    } as never)

    expect(
      repository.resolveDeepChatAgentConfig('inheriting-agent').memoryInjectionTokenBudget
    ).toBe(800)
    expect(
      repository.resolveDeepChatAgentConfig('overriding-agent').memoryInjectionTokenBudget
    ).toBe(2000)
  })

  it('inherits extension policies from builtin and lets custom agents override with empty arrays', () => {
    const now = Date.now()
    const makeRow = (id: string, source: string, config: object) => ({
      id,
      agent_type: 'deepchat',
      source,
      name: id,
      enabled: 1,
      protected: source === 'builtin' ? 1 : 0,
      description: null,
      icon: null,
      avatar_json: null,
      config_json: JSON.stringify(config),
      state_json: null,
      created_at: now,
      updated_at: now
    })
    const rows = new Map<string, any>([
      [
        'deepchat',
        makeRow('deepchat', 'builtin', {
          enabledPluginIds: [' plugin-a ', 'plugin-a'],
          enabledSkillNames: ['skill-a'],
          enabledMcpServerIds: ['server-a']
        })
      ],
      ['inheriting-agent', makeRow('inheriting-agent', 'manual', {})],
      [
        'overriding-agent',
        makeRow('overriding-agent', 'manual', {
          enabledPluginIds: [],
          enabledSkillNames: ['skill-b'],
          enabledMcpServerIds: []
        })
      ]
    ])
    const repository = new AgentRepository({
      agentsTable: {
        get: (id: string) => rows.get(id)
      }
    } as never)

    expect(repository.resolveDeepChatAgentConfig('inheriting-agent')).toMatchObject({
      enabledPluginIds: ['plugin-a'],
      enabledSkillNames: ['skill-a'],
      enabledMcpServerIds: ['server-a']
    })
    expect(repository.resolveDeepChatAgentConfig('overriding-agent')).toMatchObject({
      enabledPluginIds: [],
      enabledSkillNames: ['skill-b'],
      enabledMcpServerIds: []
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
