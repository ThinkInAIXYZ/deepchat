import { describe, expect, it, vi } from 'vitest'

import {
  mcpServerNeedsNode,
  mcpServerNeedsUv,
  noteNodeDemandFromMcp
} from '../../../src/main/toolchains/mcpDemand'

describe('mcp Node demand', () => {
  it('detects stdio Node-family commands and skips everything else', () => {
    expect(mcpServerNeedsNode({ command: 'npx', type: 'stdio', enabled: true })).toBe(true)
    expect(
      mcpServerNeedsNode({ command: 'C:\\Program Files\\nodejs\\npx.cmd', type: 'stdio' }, 'win32')
    ).toBe(true)
    expect(mcpServerNeedsNode({ command: '/usr/bin/node', type: 'stdio' })).toBe(true)
    expect(mcpServerNeedsNode({ command: 'uvx', type: 'stdio' })).toBe(false)
    expect(mcpServerNeedsUv({ command: 'uvx', type: 'stdio', enabled: true })).toBe(true)
    expect(mcpServerNeedsUv({ command: 'uv', type: 'stdio' })).toBe(true)
    expect(mcpServerNeedsUv({ command: 'npx', type: 'stdio' })).toBe(false)
    expect(mcpServerNeedsNode({ command: 'npx', type: 'http' })).toBe(false)
    expect(mcpServerNeedsNode({ command: 'npx', type: 'inmemory' })).toBe(false)
    expect(mcpServerNeedsNode({ command: 'npx', type: 'stdio', source: 'plugin' })).toBe(false)
    expect(mcpServerNeedsNode({ command: 'npx', type: 'stdio', ownerPluginId: 'p1' })).toBe(false)
    expect(mcpServerNeedsNode({ command: 'npx', type: 'stdio', enabled: false })).toBe(false)
    expect(
      mcpServerNeedsNode({ command: undefined as never, type: undefined as never, enabled: true })
    ).toBe(false)
    expect(
      mcpServerNeedsUv({ command: undefined as never, type: undefined as never, enabled: true })
    ).toBe(false)
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

  it('notes uv demand for an enabled uvx stdio server', async () => {
    const noteDemand = vi.fn()
    await noteNodeDemandFromMcp(
      {
        getMcpEnabled: async () => true,
        getEnabledMcpServers: async () => ['search'],
        getMcpServers: async () => ({
          search: {
            command: 'uvx',
            args: ['example'],
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
    expect(noteDemand).toHaveBeenCalledWith('uv')
    expect(noteDemand).not.toHaveBeenCalledWith('node')
  })
})
