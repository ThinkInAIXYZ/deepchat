import { describe, expect, it, vi } from 'vitest'
import {
  mcpAddPublicRoute,
  mcpListPublicRoute,
  mcpRemovePublicRoute,
  mcpSetPublicStatusRoute,
  mcpStartPublicRoute,
  mcpStopPublicRoute,
  mcpUpdatePublicRoute
} from '@shared/contracts/routes'
import type { MCPServerConfig, McpServicePort } from '@shared/types/mcp'
import { createCliMcpAdminRoutes } from '@/cli/mcpAdminRoutes'
import type { CliRouteCaller, RouteContext } from '@/routes/routeRegistry'

const caller: CliRouteCaller = {
  kind: 'cli',
  principal: 'human',
  connectionId: 'connection-1',
  scopes: ['mcp:read', 'mcp:write']
}

function stdioConfig(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return {
    type: 'stdio',
    command: '/private/bin/npx',
    args: ['--yes', 'private-package'],
    env: { PRIVATE_TOKEN: 'super-secret' },
    descriptions: 'Server\n\u001b[31m description',
    icons: 'terminal',
    enabled: false,
    inheritEnv: 'minimal',
    ...overrides
  }
}

function createHarness(initialServers: Record<string, MCPServerConfig> = {}) {
  const servers = new Map(Object.entries(initialServers))
  const running = new Map<string, boolean>()
  const getMcpServers = vi.fn(async () => Object.fromEntries(servers))
  const isServerRunning = vi.fn(async (serverName: string) => running.get(serverName) ?? false)
  const addMcpServer = vi.fn(async (serverName: string, config: MCPServerConfig) => {
    if (servers.has(serverName)) return { status: 'duplicate' as const }
    servers.set(serverName, config)
    return { status: 'added' as const }
  })
  const updateMcpServer = vi.fn(async (serverName: string, updates: Partial<MCPServerConfig>) => {
    const current = servers.get(serverName)
    if (!current) throw new Error('missing')
    servers.set(serverName, { ...current, ...updates })
  })
  const setMcpServerEnabled = vi.fn(async (serverName: string, enabled: boolean) => {
    const current = servers.get(serverName)
    if (!current) throw new Error('missing')
    servers.set(serverName, { ...current, enabled })
    running.set(serverName, enabled)
  })
  const startServer = vi.fn(async (serverName: string) => {
    running.set(serverName, true)
  })
  const stopServer = vi.fn(async (serverName: string) => {
    running.set(serverName, false)
  })
  const removeMcpServer = vi.fn(async (serverName: string) => {
    servers.delete(serverName)
    running.delete(serverName)
  })
  const recordSettingsActivity = vi.fn()
  const log = { warn: vi.fn() }
  const routes = createCliMcpAdminRoutes({
    mcp: {
      getMcpServers,
      isServerRunning,
      addMcpServer,
      updateMcpServer,
      setMcpServerEnabled,
      startServer,
      stopServer,
      removeMcpServer
    } as Pick<
      McpServicePort,
      | 'getMcpServers'
      | 'isServerRunning'
      | 'addMcpServer'
      | 'updateMcpServer'
      | 'setMcpServerEnabled'
      | 'startServer'
      | 'stopServer'
      | 'removeMcpServer'
    >,
    recordSettingsActivity,
    log
  })
  const invoke = async (method: string, input: unknown, context: RouteContext = { caller }) => {
    const route = routes.get(method as never)
    if (!route) throw new Error(`Missing route: ${method}`)
    return await route(input, context)
  }

  return {
    servers,
    running,
    getMcpServers,
    isServerRunning,
    addMcpServer,
    updateMcpServer,
    setMcpServerEnabled,
    startServer,
    stopServer,
    removeMcpServer,
    recordSettingsActivity,
    log,
    invoke
  }
}

describe('CLI MCP administration routes', () => {
  it('accepts only bounded public transports and structurally complete authorization', () => {
    expect(
      mcpAddPublicRoute.input.safeParse({
        serverName: 'local-server',
        config: { type: 'stdio', command: 'npx' }
      }).success
    ).toBe(true)
    for (const serverName of ['__proto__', 'constructor', 'toString', 'prototype']) {
      expect(
        mcpAddPublicRoute.input.safeParse({
          serverName,
          config: { type: 'stdio', command: 'npx' }
        }).success
      ).toBe(false)
    }
    expect(
      mcpAddPublicRoute.input.safeParse({
        serverName: 'internal',
        config: { type: 'inmemory', command: '' }
      }).success
    ).toBe(false)
    expect(
      mcpUpdatePublicRoute.input.safeParse({
        serverName: 'server',
        updates: { command: 'npx', baseUrl: 'https://mcp.example/api' }
      }).success
    ).toBe(false)
    expect(
      mcpAddPublicRoute.input.safeParse({
        serverName: 'host-owned',
        config: { type: 'stdio', command: 'npx', ownerPluginId: 'plugin-private' }
      }).success
    ).toBe(false)
    for (const config of [
      { type: 'http', baseUrl: 'not-a-url' },
      { type: 'http', baseUrl: 'http://mcp.example/api' },
      { type: 'http', baseUrl: 'https://user:secret@mcp.example/api' },
      { type: 'http', baseUrl: 'https://mcp.example/api?token=secret' },
      {
        type: 'sse',
        baseUrl: 'https://mcp.example/sse',
        authorization: { mode: 'interactive' }
      },
      {
        type: 'http',
        baseUrl: 'https://mcp.example/api',
        headers: { Authorization: 'Bearer secret\r\nX-Injected: true' }
      },
      {
        type: 'http',
        baseUrl: 'https://mcp.example/api',
        authorization: { mode: 'client_credentials', clientId: 'client-1' }
      },
      {
        type: 'http',
        baseUrl: 'https://mcp.example/api',
        headers: { Authorization: 'first', authorization: 'second' }
      }
    ]) {
      expect(
        mcpAddPublicRoute.input.safeParse({ serverName: 'unsafe-server', config }).success
      ).toBe(false)
    }
    expect(
      mcpAddPublicRoute.input.safeParse({
        serverName: 'machine-server',
        config: {
          type: 'http',
          baseUrl: 'https://mcp.example/api',
          authorization: {
            mode: 'private_key_jwt',
            clientId: 'client-1',
            protectedResourceUrl: 'https://mcp.example/',
            authorizationServerIssuer: 'https://identity.example/',
            keyAlgorithm: 'ES256'
          }
        }
      }).success
    ).toBe(true)
    expect(
      mcpAddPublicRoute.input.safeParse({
        serverName: 'oversized-server',
        config: {
          type: 'stdio',
          command: 'npx',
          environment: Object.fromEntries(
            Array.from({ length: 13 }, (_, index) => [`VALUE_${index}`, 'x'.repeat(64 * 1024)])
          )
        }
      }).success
    ).toBe(false)
  })

  it('lists deterministic redacted summaries without paths, arguments, headers, or secrets', async () => {
    const harness = createHarness({
      user: stdioConfig(),
      plugin: stdioConfig({ ownerPluginId: 'private-plugin', source: 'plugin' }),
      builtin: stdioConfig({ type: 'inmemory', command: '', args: [], env: {} }),
      remote: {
        ...stdioConfig(),
        type: 'http',
        command: '',
        args: [],
        env: {},
        baseUrl: 'https://mcp.example/private/path',
        customHeaders: { Authorization: 'Bearer super-secret' },
        authorization: {
          mode: 'client_credentials',
          clientId: 'private-client-id',
          protectedResourceUrl: 'https://mcp.example/',
          authorizationServerIssuer: 'https://identity.example/'
        }
      }
    })
    harness.running.set('user', true)
    harness.isServerRunning.mockRejectedValueOnce(new Error('runtime secret'))

    const result = (await harness.invoke(mcpListPublicRoute.name, {})) as {
      servers: Array<Record<string, unknown>>
      truncated: boolean
    }

    expect(result.servers.map((server) => server.name)).toEqual([
      'builtin',
      'plugin',
      'remote',
      'user'
    ])
    expect(result.servers.find((server) => server.name === 'builtin')).toMatchObject({
      managedBy: 'deepchat',
      editable: false,
      removable: false,
      running: null
    })
    expect(result.servers.find((server) => server.name === 'plugin')).toMatchObject({
      managedBy: 'plugin',
      editable: false,
      removable: false
    })
    expect(result.servers.find((server) => server.name === 'user')).toMatchObject({
      commandName: 'npx',
      argumentCount: 2,
      environmentEntryCount: 1
    })
    expect(result.servers.find((server) => server.name === 'remote')).toMatchObject({
      endpoint: { origin: 'https://mcp.example', pathPresent: true },
      headerEntryCount: 1,
      authorizationMode: 'client_credentials'
    })
    const serialized = JSON.stringify(result)
    for (const secret of [
      '/private/bin',
      'private-package',
      'super-secret',
      'private-plugin',
      'private-client-id',
      '/private/path'
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('adds disabled servers, defaults to minimal environment, and rejects duplicate names', async () => {
    const harness = createHarness()

    await expect(
      harness.invoke(mcpAddPublicRoute.name, {
        serverName: 'new-server',
        config: { type: 'stdio', command: 'npx', args: ['server-package'] }
      })
    ).resolves.toMatchObject({
      server: {
        name: 'new-server',
        type: 'stdio',
        enabled: false,
        commandName: 'npx'
      }
    })
    expect(harness.servers.get('new-server')).toMatchObject({
      enabled: false,
      inheritEnv: 'minimal',
      env: {},
      args: ['server-package']
    })
    await expect(
      harness.invoke(mcpAddPublicRoute.name, {
        serverName: 'new-server',
        config: { type: 'stdio', command: 'other-command' }
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(harness.recordSettingsActivity).toHaveBeenCalledOnce()
  })

  it('returns canonical MCP state read back after successful mutations', async () => {
    const harness = createHarness({ server: stdioConfig() })
    harness.addMcpServer.mockImplementationOnce(async (serverName, config) => {
      harness.servers.set(serverName, {
        ...config,
        command: '/managed/bin/pnpm',
        enabled: true
      })
      return { status: 'added' as const }
    })

    await expect(
      harness.invoke(mcpAddPublicRoute.name, {
        serverName: 'normalized',
        config: { type: 'stdio', command: 'npx' }
      })
    ).resolves.toMatchObject({
      server: { name: 'normalized', commandName: 'pnpm', enabled: true }
    })

    harness.updateMcpServer.mockImplementationOnce(async (serverName, updates) => {
      harness.servers.set(serverName, {
        ...harness.servers.get(serverName)!,
        ...updates,
        descriptions: 'Persisted description'
      })
    })
    await expect(
      harness.invoke(mcpUpdatePublicRoute.name, {
        serverName: 'server',
        updates: { description: 'Requested description' }
      })
    ).resolves.toMatchObject({ server: { description: 'Persisted description' } })

    harness.setMcpServerEnabled.mockImplementationOnce(async (serverName) => {
      harness.servers.set(serverName, { ...harness.servers.get(serverName)!, enabled: false })
    })
    await expect(
      harness.invoke(mcpSetPublicStatusRoute.name, { serverName: 'server', enabled: true })
    ).resolves.toMatchObject({ server: { enabled: false } })
  })

  it('marks a successful mutation as applied when canonical read-back fails', async () => {
    const harness = createHarness()
    harness.getMcpServers.mockRejectedValueOnce(new Error('store unavailable'))

    const failure = await harness
      .invoke(mcpAddPublicRoute.name, {
        serverName: 'applied-server',
        config: { type: 'stdio', command: 'npx' }
      })
      .catch((error: unknown) => error)

    expect(harness.servers.has('applied-server')).toBe(true)
    expect(failure).toMatchObject({
      code: 'unavailable',
      retriable: false,
      options: { details: { serverName: 'applied-server', applied: true } }
    })
    expect(harness.recordSettingsActivity).toHaveBeenCalledOnce()
  })

  it('preserves unmentioned secrets and clears incompatible fields on transport changes', async () => {
    const harness = createHarness({
      server: stdioConfig({ customNpmRegistry: 'https://registry.example/npm' })
    })

    await harness.invoke(mcpUpdatePublicRoute.name, {
      serverName: 'server',
      updates: { description: 'Updated description' }
    })
    expect(harness.servers.get('server')).toMatchObject({
      env: { PRIVATE_TOKEN: 'super-secret' },
      args: ['--yes', 'private-package'],
      customNpmRegistry: 'https://registry.example/npm'
    })

    await harness.invoke(mcpUpdatePublicRoute.name, {
      serverName: 'server',
      updates: {
        type: 'http',
        baseUrl: 'https://mcp.example/api',
        headers: { Authorization: 'Bearer replacement' }
      }
    })
    expect(harness.servers.get('server')).toMatchObject({
      type: 'http',
      command: '',
      args: [],
      env: {},
      baseUrl: 'https://mcp.example/api',
      customHeaders: { Authorization: 'Bearer replacement' }
    })
    expect(harness.servers.get('server')?.customNpmRegistry).toBeUndefined()
    expect(harness.servers.get('server')?.inheritEnv).toBeUndefined()

    await expect(
      harness.invoke(mcpUpdatePublicRoute.name, {
        serverName: 'server',
        updates: { command: 'npx' }
      })
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('allows policy-gated Agent adapters but keeps runtime and destructive mutations human-only', async () => {
    const harness = createHarness({
      plugin: stdioConfig({ ownerPluginId: 'plugin-1' }),
      builtin: stdioConfig({ type: 'inmemory', command: '', args: [], env: {} })
    })

    for (const [method, input] of [
      [mcpUpdatePublicRoute.name, { serverName: 'plugin', updates: { description: 'x' } }],
      [mcpRemovePublicRoute.name, { serverName: 'builtin' }],
      [mcpStartPublicRoute.name, { serverName: 'plugin' }],
      [mcpStopPublicRoute.name, { serverName: 'builtin' }]
    ] as const) {
      await expect(harness.invoke(method, input)).rejects.toMatchObject({ code: 'conflict' })
    }
    await expect(
      harness.invoke(
        mcpListPublicRoute.name,
        {},
        { caller: { kind: 'renderer', webContentsId: 1, windowId: 1 } }
      )
    ).rejects.toMatchObject({ code: 'permission_denied' })
    const agentCaller: CliRouteCaller = {
      ...caller,
      principal: 'agent',
      tokenId: 'token-id-conversation-1',
      conversationId: 'conversation-1',
      expiresAt: Date.now() + 60_000
    }
    await expect(
      harness.invoke(mcpListPublicRoute.name, {}, { caller: agentCaller })
    ).resolves.toMatchObject({ truncated: false })
    await expect(
      harness.invoke(
        mcpAddPublicRoute.name,
        {
          serverName: 'agent-server',
          config: { type: 'http', baseUrl: 'https://mcp.example/agent' }
        },
        { caller: agentCaller }
      )
    ).resolves.toMatchObject({ server: { name: 'agent-server', enabled: false } })
    await expect(
      harness.invoke(
        mcpUpdatePublicRoute.name,
        { serverName: 'agent-server', updates: { command: 'pnpm' } },
        { caller: agentCaller }
      )
    ).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(
      harness.invoke(mcpRemovePublicRoute.name, { serverName: 'plugin' }, { caller: agentCaller })
    ).rejects.toMatchObject({ code: 'permission_denied' })
    expect(harness.removeMcpServer).not.toHaveBeenCalled()
  })

  it('controls user-owned runtime state and removal through public adapters', async () => {
    const harness = createHarness({ server: stdioConfig() })

    await expect(
      harness.invoke(mcpSetPublicStatusRoute.name, { serverName: 'server', enabled: true })
    ).resolves.toMatchObject({
      server: { name: 'server', enabled: true, running: true }
    })
    await expect(
      harness.invoke(mcpStopPublicRoute.name, { serverName: 'server' })
    ).resolves.toMatchObject({ server: { enabled: true, running: false } })
    await expect(
      harness.invoke(mcpStartPublicRoute.name, { serverName: 'server' })
    ).resolves.toMatchObject({ server: { enabled: true, running: true } })
    await expect(
      harness.invoke(mcpRemovePublicRoute.name, { serverName: 'server' })
    ).resolves.toEqual({ serverName: 'server', removed: true })

    expect(harness.setMcpServerEnabled).toHaveBeenCalledWith('server', true)
    expect(harness.stopServer).toHaveBeenCalledWith('server')
    expect(harness.startServer).toHaveBeenCalledWith('server')
    expect(harness.removeMcpServer).toHaveBeenCalledWith('server')
    expect(harness.recordSettingsActivity).toHaveBeenCalledTimes(4)
  })

  it('reports persisted state when enablement only partially succeeds', async () => {
    const harness = createHarness({ server: stdioConfig() })
    harness.setMcpServerEnabled.mockImplementationOnce(async (serverName, enabled) => {
      harness.servers.set(serverName, { ...harness.servers.get(serverName)!, enabled })
      throw new Error('start failed with PRIVATE_TOKEN=super-secret')
    })

    const failure = await harness
      .invoke(mcpSetPublicStatusRoute.name, { serverName: 'server', enabled: true })
      .catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'unavailable',
      options: {
        details: { serverName: 'server', enabled: true, running: false }
      }
    })
    expect(String((failure as Error).message)).not.toContain('PRIVATE_TOKEN')
    expect(harness.log.warn).toHaveBeenCalledWith(
      '[CLI] MCP enablement changed incompletely',
      expect.not.objectContaining({ error: expect.stringContaining('super-secret') })
    )
    expect(harness.recordSettingsActivity).toHaveBeenCalledOnce()
  })
})
