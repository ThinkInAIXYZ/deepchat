import { describe, expect, it, vi } from 'vitest'

import { mcpServerNeedsNode, noteNodeDemandFromMcp } from '../../../src/main/toolchains/mcpDemand'

describe('mcp Node demand', () => {
  it('detects stdio Node-family commands and skips everything else', () => {
    expect(mcpServerNeedsNode({ command: 'npx', type: 'stdio', enabled: true })).toBe(true)
    expect(
      mcpServerNeedsNode({ command: 'C:\\Program Files\\nodejs\\npx.cmd', type: 'stdio' }, 'win32')
    ).toBe(true)
    expect(mcpServerNeedsNode({ command: '/usr/bin/node', type: 'stdio' })).toBe(true)
    expect(mcpServerNeedsNode({ command: 'uvx', type: 'stdio' })).toBe(false)
    expect(mcpServerNeedsNode({ command: 'npx', type: 'http' })).toBe(false)
    expect(mcpServerNeedsNode({ command: 'npx', type: 'inmemory' })).toBe(false)
    expect(mcpServerNeedsNode({ command: 'npx', type: 'stdio', source: 'plugin' })).toBe(false)
    expect(mcpServerNeedsNode({ command: 'npx', type: 'stdio', ownerPluginId: 'p1' })).toBe(false)
    expect(mcpServerNeedsNode({ command: 'npx', type: 'stdio', enabled: false })).toBe(false)
  })

  it('notes Node demand only when MCP is on and an enabled stdio server needs it', async () => {
    const noteDemand = vi.fn()
    await noteNodeDemandFromMcp(
      {
        getMcpEnabled: async () => true,
        getEnabledMcpServers: async () => ['docs'],
        getMcpServers: async () => ({
          docs: {
            command: 'npx',
            args: ['-y', 'example'],
            env: {},
            descriptions: '',
            icons: '',
            enabled: true,
            type: 'stdio'
          }
        })
      },
      { noteDemand }
    )
    expect(noteDemand).toHaveBeenCalledWith('node')

    noteDemand.mockClear()
    await noteNodeDemandFromMcp(
      {
        getMcpEnabled: async () => false,
        getEnabledMcpServers: async () => ['docs'],
        getMcpServers: async () => ({
          docs: {
            command: 'npx',
            args: [],
            env: {},
            descriptions: '',
            icons: '',
            enabled: true,
            type: 'stdio'
          }
        })
      },
      { noteDemand }
    )
    expect(noteDemand).not.toHaveBeenCalled()
  })
})
