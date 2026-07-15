import { describe, expect, it } from 'vitest'
import { DeepChatAgentRepository } from '@/agent/deepchat/deepChatAgentRepository'
import { TAPE_TOOL_NAMES } from '@shared/agentTools'

function createRepository(sqlitePresenter: any): DeepChatAgentRepository {
  return new DeepChatAgentRepository({
    rows: sqlitePresenter.agentsTable,
    listSessionIdsByAgent: (agentId) =>
      (sqlitePresenter.newSessionsTable?.list({ agentId, includeSubagents: true }) ?? []).map(
        (session: { id: string }) => session.id
      ),
    clearMemoryByAgent: (agentId) => sqlitePresenter.agentMemoryTable?.clearByAgent(agentId) ?? 0,
    clearMemoryAuditByAgent: (agentId) =>
      sqlitePresenter.agentMemoryAuditTable?.clearByAgent(agentId) ?? 0,
    transaction: (operation) =>
      sqlitePresenter.getDatabase?.().transaction(operation)() ?? operation()
  })
}

describe('DeepChatAgentRepository', () => {
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
    const repository = createRepository(sqlitePresenter)

    expect(repository.delete('writer')).toBe(true)
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
    const repository = createRepository(sqlitePresenter)

    expect(repository.delete('writer')).toBe(false)
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
      const repository = createRepository(sqlitePresenter)

      expect(repository.delete('writer')).toBe(false)
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
    const repository = createRepository(sqlitePresenter)

    expect(() => repository.delete('writer')).toThrow('delete failed')
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
    const repository = createRepository(sqlitePresenter)

    repository.ensureBuiltin({ name: 'DeepChat', config: {} })
    const config = repository.resolveConfig('deepchat')

    expect(config.subagentEnabled).toBe(true)
    expect(config.subagents?.map((slot) => slot.id)).toEqual([
      'explorer',
      'implementer',
      'reviewer'
    ])
    expect(config.subagents?.every((slot) => slot.targetType === 'self')).toBe(true)
  })

  it('keeps non-configurable Tape names out of persisted and resolved Agent configs', () => {
    const rows = new Map<string, any>()
    const agentsTable = {
      get: (id: string) => rows.get(id),
      create: (input: any) => {
        const now = Date.now()
        rows.set(input.id, {
          id: input.id,
          agent_type: input.agentType,
          source: input.source,
          name: input.name,
          enabled: input.enabled ? 1 : 0,
          protected: input.protected ? 1 : 0,
          description: input.description ?? null,
          icon: input.icon ?? null,
          avatar_json: input.avatarJson,
          config_json: input.configJson,
          state_json: null,
          created_at: now,
          updated_at: now
        })
      },
      update: (id: string, input: any) => {
        const current = rows.get(id)
        rows.set(id, {
          ...current,
          ...input,
          config_json: input.configJson ?? current.config_json
        })
      }
    }
    const repository = createRepository({ agentsTable })

    repository.ensureBuiltin({
      config: { disabledAgentTools: [TAPE_TOOL_NAMES.search, 'read'] }
    })
    const created = repository.create({
      name: 'Writer',
      config: { disabledAgentTools: [TAPE_TOOL_NAMES.handoff, 'exec'] }
    })

    expect(repository.getConfig('deepchat')?.disabledAgentTools).toEqual(['read'])
    expect(repository.getConfig(created.id)?.disabledAgentTools).toEqual(['exec'])

    repository.update(created.id, {
      config: { disabledAgentTools: [TAPE_TOOL_NAMES.info, 'write'] }
    })
    expect(repository.getConfig(created.id)?.disabledAgentTools).toEqual(['write'])

    rows.set('legacy-agent', {
      ...rows.get(created.id),
      id: 'legacy-agent',
      config_json: JSON.stringify({
        disabledAgentTools: [TAPE_TOOL_NAMES.anchors, TAPE_TOOL_NAMES.context, 'exec']
      })
    })
    expect(repository.getConfig('legacy-agent')?.disabledAgentTools).toEqual([
      TAPE_TOOL_NAMES.anchors,
      TAPE_TOOL_NAMES.context,
      'exec'
    ])
    expect(repository.resolveConfig('legacy-agent').disabledAgentTools).toEqual(['exec'])
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
    const repository = createRepository({
      agentsTable: {
        get: (id: string) => rows.get(id)
      }
    } as never)

    expect(repository.resolveConfig('custom-agent').imageGenerationModel).toEqual({
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
    const repository = createRepository({
      agentsTable: {
        get: (id: string) => rows.get(id)
      }
    } as never)

    expect(repository.resolveConfig('inheriting-agent').memoryExtractionModel).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4o-mini'
    })
    expect(repository.resolveConfig('overriding-agent').memoryExtractionModel).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-haiku-4-5'
    })
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
    const repository = createRepository({
      agentsTable: {
        get: (id: string) => rows.get(id)
      }
    } as never)

    expect(repository.resolveConfig('inheriting-agent').memoryInjectionTokenBudget).toBe(800)
    expect(repository.resolveConfig('overriding-agent').memoryInjectionTokenBudget).toBe(2000)
  })

  it('inherits skill and MCP policies while ignoring historical plugin policies', () => {
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
    const repository = createRepository({
      agentsTable: {
        get: (id: string) => rows.get(id)
      }
    } as never)

    const inheritedConfig = repository.resolveConfig('inheriting-agent')
    const overriddenConfig = repository.resolveConfig('overriding-agent')

    expect(inheritedConfig).toMatchObject({
      enabledSkillNames: ['skill-a'],
      enabledMcpServerIds: ['server-a']
    })
    expect(overriddenConfig).toMatchObject({
      enabledSkillNames: ['skill-b'],
      enabledMcpServerIds: []
    })
    expect(inheritedConfig).not.toHaveProperty('enabledPluginIds')
    expect(overriddenConfig).not.toHaveProperty('enabledPluginIds')
  })
})
