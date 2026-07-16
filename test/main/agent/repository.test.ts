import { describe, expect, it } from 'vitest'
import {
  AgentNotFoundError,
  AgentUnavailableError
} from '../../../src/main/agent/shared/agentCatalogCodec'
import { AgentRepository } from '../../../src/main/agent/repository'

describe('AgentRepository', () => {
  it('preserves catalog rows while current executable lookups reject malformed data', () => {
    const now = Date.now()
    const makeRow = (
      id: string,
      agentType: 'deepchat' | 'acp',
      source: string,
      configJson: string,
      stateJson: string | null = null
    ) => ({
      id,
      agent_type: agentType,
      source,
      name: id,
      enabled: 1,
      protected: 0,
      description: null,
      icon: null,
      avatar_json: id === 'broken-deepchat' ? '{broken-avatar' : null,
      config_json: configJson,
      state_json: stateJson,
      created_at: now,
      updated_at: now
    })
    const rows = new Map<string, any>([
      [
        'deepchat',
        {
          ...makeRow(
            'deepchat',
            'deepchat',
            'builtin',
            JSON.stringify({ systemPrompt: 'Builtin prompt' })
          ),
          protected: 1
        }
      ],
      ['broken-deepchat', makeRow('broken-deepchat', 'deepchat', 'manual', '{broken-config')],
      ['broken-registry', makeRow('broken-registry', 'acp', 'registry', '{}', '{broken-state')],
      [
        'missing-command',
        makeRow('missing-command', 'acp', 'manual', JSON.stringify({ args: ['--stdio'] }))
      ],
      ['malformed-command', makeRow('malformed-command', 'acp', 'manual', '{broken-config')]
    ])
    const database = {
      agentsTable: {
        get: (id: string) => rows.get(id),
        list: (filters?: { agentType?: string; source?: string }) =>
          [...rows.values()].filter(
            (row) =>
              (!filters?.agentType || row.agent_type === filters.agentType) &&
              (!filters?.source || row.source === filters.source)
          )
      }
    } as never
    const repository = new AgentRepository(database, database, database)

    expect(repository.listAgents().map((agent) => agent.id)).toEqual([
      'deepchat',
      'broken-deepchat',
      'broken-registry',
      'missing-command',
      'malformed-command'
    ])
    expect(repository.getAgent('broken-deepchat')).toMatchObject({
      type: 'deepchat',
      agentType: 'deepchat',
      avatar: null,
      config: null
    })
    expect(repository.getDeepChatAgentConfig('broken-deepchat')).toBeNull()
    const resolvedConfig = repository.resolveDeepChatAgentConfig('broken-deepchat')
    expect(resolvedConfig).toMatchObject({ systemPrompt: 'Builtin prompt' })
    expect(resolvedConfig.permissionMode).toBeUndefined()
    expect(repository.listResolvedDeepChatAgentConfigs()).toEqual([
      expect.objectContaining({
        agentId: 'deepchat',
        config: expect.objectContaining({ systemPrompt: 'Builtin prompt' })
      }),
      expect.objectContaining({
        agentId: 'broken-deepchat',
        config: expect.objectContaining({ systemPrompt: 'Builtin prompt' })
      })
    ])
    expect(repository.getAgent('broken-registry')).toMatchObject({
      type: 'acp',
      agentType: 'acp',
      installState: null
    })
    expect(repository.getAcpAgentState('broken-registry')).toEqual({
      agentId: 'broken-registry',
      enabled: true,
      envOverride: undefined,
      updatedAt: now
    })
    expect(repository.getAcpRegistryOverlay('broken-registry')).toEqual({
      enabled: true,
      envOverride: undefined,
      installState: null
    })
    expect(repository.listManualAcpAgents()).toEqual([])
    for (const id of ['missing-command', 'malformed-command']) {
      expect(repository.getAgent(id)).toMatchObject({ type: 'acp', agentType: 'acp' })
      expect(repository.getManualAcpAgent(id)).toBeNull()
      expect(repository.toAcpAgentConfig(id)).toBeNull()
      expect(() => repository.resolveExecutableDescriptor(id)).toThrow(AgentUnavailableError)
    }
    expect(() => repository.resolveExecutableDescriptor('missing')).toThrow(AgentNotFoundError)
  })

  it('preserves current source and kind interpretation at catalog boundaries', () => {
    const now = Date.now()
    const makeRow = (id: string, agentType: 'deepchat' | 'acp', source: string) => ({
      id,
      agent_type: agentType,
      source,
      name: id,
      enabled: 1,
      protected: 0,
      description: null,
      icon: null,
      avatar_json: null,
      config_json:
        agentType === 'deepchat'
          ? JSON.stringify({ systemPrompt: 'Registry source still resolves' })
          : '{}',
      state_json: null,
      created_at: now,
      updated_at: now
    })
    const rows = new Map<string, any>([
      ['registry-deepchat', makeRow('registry-deepchat', 'deepchat', 'registry')],
      ['builtin-acp', makeRow('builtin-acp', 'acp', 'builtin')]
    ])
    const database = {
      agentsTable: {
        get: (id: string) => rows.get(id),
        list: (filters?: { agentType?: string; source?: string }) =>
          [...rows.values()].filter(
            (row) =>
              (!filters?.agentType || row.agent_type === filters.agentType) &&
              (!filters?.source || row.source === filters.source)
          )
      }
    } as never
    const repository = new AgentRepository(database, database, database)

    expect(repository.getAgent('registry-deepchat')).toMatchObject({
      type: 'deepchat',
      agentType: 'deepchat',
      source: 'registry'
    })
    expect(repository.getAgentType('registry-deepchat')).toBe('deepchat')
    expect(repository.getDeepChatAgentConfig('registry-deepchat')).toMatchObject({
      systemPrompt: 'Registry source still resolves'
    })
    expect(repository.getAgent('builtin-acp')).toMatchObject({
      type: 'acp',
      agentType: 'acp',
      source: 'builtin'
    })
    expect(repository.getAgentType('builtin-acp')).toBe('acp')
    expect(repository.listManualAcpAgents()).toEqual([])
    expect(
      repository.toAcpAgentConfig('builtin-acp', { command: 'builtin-acp', args: ['--stdio'] })
    ).toMatchObject({ source: 'registry', command: 'builtin-acp', args: ['--stdio'] })
  })
})
