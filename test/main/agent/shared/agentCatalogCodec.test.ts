import { describe, expect, it } from 'vitest'
import type { AgentRow } from '@/presenter/sqlitePresenter/tables/agents'
import {
  AgentUnavailableError,
  decodeAgentCatalogRow,
  decodeExecutableAgentDescriptor
} from '@/agent/shared/agentCatalogCodec'
import { mapCatalogRecordToLegacyAgent } from '@/agent/shared/agentCompatibilityMapper'

const row = (overrides: Partial<AgentRow> = {}): AgentRow => ({
  id: 'agent-1',
  agent_type: 'deepchat',
  source: 'manual',
  name: 'Agent',
  enabled: 1,
  protected: 0,
  description: null,
  icon: null,
  avatar_json: null,
  config_json: '{}',
  state_json: null,
  created_at: 1,
  updated_at: 1,
  ...overrides
})

const context = {
  resolveDeepChatConfig: () => ({ systemPrompt: 'Effective prompt' }),
  resolveRegistryReference: (agentId: string) =>
    agentId === 'registry-agent'
      ? { id: agentId, version: '1.0.0', distribution: { npx: { package: '@test/acp' } } }
      : null
}

describe('agent catalog codecs', () => {
  it('keeps malformed rows visible in the catalog compatibility shape', () => {
    const deepchat = mapCatalogRecordToLegacyAgent(
      decodeAgentCatalogRow(row({ avatar_json: '{bad', config_json: '{bad' }))
    )
    const acp = mapCatalogRecordToLegacyAgent(
      decodeAgentCatalogRow(
        row({ agent_type: 'acp', source: 'manual', config_json: '{bad', state_json: '{bad' })
      )
    )

    expect(deepchat).toMatchObject({
      type: 'deepchat',
      agentType: 'deepchat',
      avatar: null,
      config: null,
      installState: null
    })
    expect(acp).toMatchObject({
      type: 'acp',
      agentType: 'acp',
      config: null,
      installState: null
    })
  })

  it('decodes required executable capabilities without optional kind-specific fields', () => {
    expect(decodeExecutableAgentDescriptor(row(), context)).toMatchObject({
      kind: 'deepchat',
      source: 'manual',
      config: { systemPrompt: 'Effective prompt' }
    })
    expect(
      decodeExecutableAgentDescriptor(
        row({
          id: 'manual-agent',
          agent_type: 'acp',
          source: 'manual',
          config_json: JSON.stringify({
            command: ' acp ',
            args: ['--stdio'],
            env: { MODE: 'test' }
          })
        }),
        context
      )
    ).toMatchObject({
      kind: 'acp',
      source: 'manual',
      launch: { command: 'acp', args: ['--stdio'], env: { MODE: 'test' } }
    })
    expect(
      decodeExecutableAgentDescriptor(
        row({
          id: 'registry-agent',
          agent_type: 'acp',
          source: 'registry',
          state_json: JSON.stringify({ installState: { status: 'installed' } })
        }),
        context
      )
    ).toMatchObject({
      kind: 'acp',
      source: 'registry',
      registry: { id: 'registry-agent', version: '1.0.0' },
      installState: { status: 'installed' }
    })
  })

  it.each([
    [
      'unknown-kind',
      row({ agent_type: 'deepchat' }) as unknown as AgentRow,
      { agent_type: 'other' }
    ],
    ['invalid-source', row(), { source: 'registry' }],
    ['missing-manual-command', row({ agent_type: 'acp', source: 'manual' }), { config_json: '{}' }],
    ['invalid-config', row({ agent_type: 'acp', source: 'manual' }), { config_json: '{bad' }],
    [
      'missing-registry-reference',
      row({ agent_type: 'acp', source: 'registry' }),
      { id: 'missing-registry' }
    ]
  ])('fails executable decode with typed reason %s', (reason, baseRow, overrides) => {
    const runtimeRow = { ...baseRow, ...overrides }

    expect(() => decodeExecutableAgentDescriptor(runtimeRow, context)).toThrowError(
      expect.objectContaining({
        name: 'AgentUnavailableError',
        code: 'AGENT_UNAVAILABLE',
        reason
      })
    )
  })

  it.each([[], 'invalid', 42])(
    'rejects non-object manual config %j as invalid config',
    (config) => {
      expect(() =>
        decodeExecutableAgentDescriptor(
          row({ agent_type: 'acp', source: 'manual', config_json: JSON.stringify(config) }),
          context
        )
      ).toThrowError(
        expect.objectContaining({
          name: 'AgentUnavailableError',
          code: 'AGENT_UNAVAILABLE',
          reason: 'invalid-config'
        })
      )
    }
  )

  it('does not expose raw executable configuration in unavailable errors', () => {
    const secret = 'TOP_SECRET_VALUE'
    let caught: unknown
    try {
      decodeExecutableAgentDescriptor(
        {
          ...row({ agent_type: 'acp', source: 'manual' }),
          config_json: JSON.stringify({ env: { API_KEY: secret } })
        },
        context
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(AgentUnavailableError)
    expect(String(caught)).not.toContain(secret)
  })
})
