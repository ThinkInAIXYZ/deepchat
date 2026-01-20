import { describe, it, expect } from 'vitest'
import type { MCPConfig } from '@shared/presenter'
import { computeMcpConfigUpdate } from '@/composables/mcp/mcpConfigSync'

describe('computeMcpConfigUpdate', () => {
  const baseConfig = (overrides?: Partial<MCPConfig>): MCPConfig => ({
    mcpServers: {},
    defaultServers: [],
    mcpEnabled: true,
    ready: true,
    ...overrides
  })

  it('skips apply when query in flight would disable ready enabled config', () => {
    const current = baseConfig()
    const next = { mcpServers: {}, defaultServers: [], mcpEnabled: false }

    const result = computeMcpConfigUpdate(current, next, true)

    expect(result.shouldApply).toBe(false)
    expect(result.mcpEnabledChanged).toBe(false)
  })

  it('applies config update and detects enabled change', () => {
    const current = baseConfig()
    const next = { mcpServers: {}, defaultServers: [], mcpEnabled: false }

    const result = computeMcpConfigUpdate(current, next, false)

    expect(result.shouldApply).toBe(true)
    expect(result.mcpEnabledChanged).toBe(true)
    expect(result.nextConfig.mcpEnabled).toBe(false)
    expect(result.nextConfig.ready).toBe(true)
  })
})
