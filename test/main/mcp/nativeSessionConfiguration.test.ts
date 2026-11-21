import { expect, it, vi } from 'vitest'
import type { MCPServerConfig } from '@shared/types/mcp'
import { nativeMcpSessionConfiguration } from '@/mcp/nativeSessionConfiguration'

const server = (patch: Partial<MCPServerConfig> = {}): MCPServerConfig => ({
  command: '',
  args: [],
  env: {},
  descriptions: '',
  icons: '',
  enabled: true,
  type: 'http',
  baseUrl: 'https://mcp.example/mcp',
  ...patch
})

it('exports selected native transports and keeps product-owned services in the plugin bridge', async () => {
  const authorization = vi.fn(async () => 'Bearer volatile-only')
  const stdio = vi.fn(async () => ({
    type: 'stdio' as const,
    command: '/managed/node',
    args: ['server.mjs'],
    env: { PATH: '/managed' }
  }))
  const servers = {
    oauth: server(),
    fixed: server({ customHeaders: { Authorization: 'Bearer configured-only' } }),
    local: server({ type: 'stdio', command: 'node' }),
    plugin: server({ source: 'plugin', ownerPluginId: 'user.plugin' }),
    desktop: server({ type: 'inmemory' }),
    disabled: server({ enabled: false }),
    unselected: server()
  }
  const before = JSON.stringify(servers)
  const result = await nativeMcpSessionConfiguration({
    selectedServerIds: Object.keys(servers).filter((name) => name !== 'unselected'),
    enabled: true,
    servers,
    pluginOwns: () => false,
    authorization,
    stdio
  })
  expect(Object.keys(result.servers)).toEqual(['oauth', 'fixed', 'local'])
  expect(result.servers.oauth).toMatchObject({
    headers: { Authorization: 'Bearer volatile-only' }
  })
  expect(result.servers.fixed).toMatchObject({
    headers: { Authorization: 'Bearer configured-only' }
  })
  expect(result.bridgeServerNames).toEqual(['plugin', 'desktop'])
  expect(authorization).toHaveBeenCalledTimes(1)
  expect(stdio).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(servers)).toBe(before)
  for (const selectedServerIds of [[], ['oauth']]) {
    const denied = await nativeMcpSessionConfiguration({
      selectedServerIds,
      enabled: selectedServerIds.length === 0,
      servers,
      pluginOwns: () => false,
      authorization,
      stdio
    })
    expect(denied).toEqual({ servers: {}, bridgeServerNames: [] })
  }
  expect(authorization).toHaveBeenCalledTimes(1)
})

it('rejects ambiguous authorization and credential-bearing endpoints before native attachment', async () => {
  const authorization = vi.fn(async () => undefined)
  for (const config of [
    server({ customHeaders: { Authorization: 'first', authorization: 'second' } }),
    server({ baseUrl: 'https://secret:mcp@mcp.example/mcp' })
  ])
    await expect(
      nativeMcpSessionConfiguration({
        enabled: true,
        servers: { service: config },
        pluginOwns: () => false,
        authorization,
        stdio: async () => null
      })
    ).rejects.toThrow()
  expect(authorization).not.toHaveBeenCalled()
})
