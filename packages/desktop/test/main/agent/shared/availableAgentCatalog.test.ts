import { describe, expect, it, vi } from 'vitest'
import { listAvailableAgents } from '@/agent/shared/availableAgentCatalog'

const agents = [
  { id: 'deepchat', name: 'DeepChat', type: 'deepchat' as const, enabled: true },
  { id: 'acp-coder', name: 'ACP Coder', type: 'acp' as const, enabled: true }
]

describe('listAvailableAgents', () => {
  it('always includes DeepChat agents and hides ACP agents when ACP is disabled', async () => {
    const result = await listAvailableAgents({
      listAgents: vi.fn(async () => agents),
      getAcpEnabled: vi.fn(async () => false)
    } as never)
    expect(result.map((agent) => agent.id)).toEqual(['deepchat'])
  })

  it('includes ACP agents when ACP is enabled', async () => {
    const result = await listAvailableAgents({
      listAgents: vi.fn(async () => agents),
      getAcpEnabled: vi.fn(async () => true)
    } as never)
    expect(result).toEqual(agents)
  })
})
