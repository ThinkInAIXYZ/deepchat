import { describe, it, expect, vi } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import { convertMcpConfigToAcpFormat } from '@/agent/acp/runtime/mcpConfigConverter'
import { filterMcpServersByTransportSupport } from '@/agent/acp/runtime/mcpTransportFilter'
import { AcpSessionManager } from '@/agent/acp/runtime/acpSessionManager'

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getPath: vi.fn(() => '/tmp'),
    getVersion: vi.fn(() => '0.0.0-test')
  }
}))

const createProcessManager = () =>
  ({
    registerSessionWorkdir: vi.fn(),
    registerSessionListener: vi.fn().mockReturnValue(vi.fn()),
    registerPermissionResolver: vi.fn().mockReturnValue(vi.fn()),
    registerProcessExitHandler: vi.fn().mockReturnValue(vi.fn()),
    clearSession: vi.fn()
  }) as any

const createSessionHooks = () => ({
  onSessionUpdate: vi.fn(),
  onPermission: vi.fn()
})

describe('ACP MCP passthrough helpers', () => {
  it('converts stdio MCP config to ACP format', () => {
    const server = convertMcpConfigToAcpFormat('test', {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { FOO: 'bar', NUM: 1 },
      descriptions: 'desc',
      icons: '🧪',
      enabled: true
    })

    expect(server && 'type' in server).toBe(false)
    expect(server).toMatchObject({
      name: 'test',
      command: 'node',
      args: ['server.js'],
      env: [
        { name: 'FOO', value: 'bar' },
        { name: 'NUM', value: '1' }
      ]
    })
  })

  it('filters http/sse MCP servers by agent transport capabilities', () => {
    const servers: schema.McpServer[] = [
      { name: 'stdio', command: 'node', args: [], env: [] },
      { type: 'http', name: 'http', url: 'http://localhost', headers: [] },
      { type: 'sse', name: 'sse', url: 'http://localhost/sse', headers: [] }
    ]

    expect(filterMcpServersByTransportSupport(servers, { http: false, sse: false })).toEqual([
      { name: 'stdio', command: 'node', args: [], env: [] }
    ])

    expect(filterMcpServersByTransportSupport(servers, { http: true, sse: false })).toEqual([
      { name: 'stdio', command: 'node', args: [], env: [] },
      { type: 'http', name: 'http', url: 'http://localhost', headers: [] }
    ])
  })
})

describe('AcpSessionManager MCP server injection', () => {
  it('passes only compatible selected MCP servers to newSession', async () => {
    const providerSettings = {
      getAgentMcpSelections: vi.fn().mockResolvedValue(['stdio-1', 'http-1']),
      getMcpServers: vi.fn().mockResolvedValue({
        'stdio-1': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: {},
          descriptions: '',
          icons: '',
          enabled: true
        },
        'http-1': {
          type: 'http',
          command: '',
          args: [],
          env: {},
          descriptions: '',
          icons: '',
          enabled: true,
          baseUrl: 'http://localhost',
          customHeaders: { Authorization: 'Bearer test' }
        }
      })
    }

    const manager = new AcpSessionManager({
      providerId: 'acp',
      processManager: createProcessManager(),
      sessionPersistence: {
        getSessionData: vi.fn().mockResolvedValue(null)
      } as any,
      agentSettings: providerSettings as any,
      mcpSettings: providerSettings as any
    })

    const handle = {
      connection: {
        newSession: vi.fn().mockResolvedValue({ sessionId: 's1' })
      },
      availableModes: [],
      currentModeId: null,
      mcpCapabilities: { http: false, sse: false }
    } as any

    await (manager as any).initializeSession(
      handle,
      'conv1',
      { id: 'agent1', name: 'Agent 1' },
      '/tmp',
      createSessionHooks()
    )

    expect(handle.connection.newSession).toHaveBeenCalledWith({
      cwd: '/tmp',
      mcpServers: [{ name: 'stdio-1', command: 'node', args: ['server.js'], env: [] }]
    })
  })
})

describe('AcpSessionManager loadSession fallback behavior', () => {
  const createBaseProviderSettings = () =>
    ({
      getAgentMcpSelections: vi.fn().mockResolvedValue([]),
      getMcpServers: vi.fn().mockResolvedValue({})
    }) as any
  const createWarmupConfigState = () => ({
    source: 'configOptions' as const,
    options: [
      {
        id: 'model',
        label: 'Model',
        type: 'select' as const,
        category: 'model',
        currentValue: 'gpt-5',
        options: [
          { value: 'gpt-5', label: 'gpt-5' },
          { value: 'gpt-5-mini', label: 'gpt-5-mini' }
        ]
      }
    ]
  })

  it('prefers loadSession when agent supports it and persisted session exists', async () => {
    const manager = new AcpSessionManager({
      providerId: 'acp',
      processManager: createProcessManager(),
      sessionPersistence: {
        getSessionData: vi.fn().mockResolvedValue({ sessionId: 'persisted-1' })
      } as any,
      agentSettings: createBaseProviderSettings(),
      mcpSettings: createBaseProviderSettings()
    })

    const warmupConfigState = createWarmupConfigState()
    const handle = {
      supportsLoadSession: true,
      configState: warmupConfigState,
      connection: {
        loadSession: vi.fn().mockResolvedValue({}),
        newSession: vi.fn().mockResolvedValue({ sessionId: 'new-1' })
      },
      availableModes: [],
      currentModeId: null,
      mcpCapabilities: {}
    } as any

    const result = await (manager as any).initializeSession(
      handle,
      'conv-load',
      { id: 'agent1', name: 'Agent 1' },
      '/tmp',
      createSessionHooks()
    )

    expect(handle.connection.loadSession).toHaveBeenCalledWith({
      cwd: '/tmp',
      mcpServers: [],
      sessionId: 'persisted-1'
    })
    expect(handle.connection.newSession).not.toHaveBeenCalled()
    expect(result.sessionId).toBe('persisted-1')
    expect(result.configState).toEqual(warmupConfigState)
  })

  it('falls back to newSession when loadSession fails', async () => {
    const manager = new AcpSessionManager({
      providerId: 'acp',
      processManager: createProcessManager(),
      sessionPersistence: {
        getSessionData: vi.fn().mockResolvedValue({ sessionId: 'persisted-2' })
      } as any,
      agentSettings: createBaseProviderSettings(),
      mcpSettings: createBaseProviderSettings()
    })

    const handle = {
      supportsLoadSession: true,
      connection: {
        loadSession: vi.fn().mockRejectedValue(new Error('session not found')),
        newSession: vi.fn().mockResolvedValue({ sessionId: 'new-2' })
      },
      availableModes: [],
      currentModeId: null,
      mcpCapabilities: {}
    } as any

    const result = await (manager as any).initializeSession(
      handle,
      'conv-fallback',
      { id: 'agent1', name: 'Agent 1' },
      '/tmp',
      createSessionHooks()
    )

    expect(handle.connection.loadSession).toHaveBeenCalledTimes(1)
    expect(handle.connection.newSession).toHaveBeenCalledTimes(1)
    expect(result.sessionId).toBe('new-2')
  })

  it('uses newSession when loadSession is not supported', async () => {
    const manager = new AcpSessionManager({
      providerId: 'acp',
      processManager: createProcessManager(),
      sessionPersistence: {
        getSessionData: vi.fn().mockResolvedValue({ sessionId: 'persisted-3' })
      } as any,
      agentSettings: createBaseProviderSettings(),
      mcpSettings: createBaseProviderSettings()
    })

    const handle = {
      supportsLoadSession: false,
      connection: {
        loadSession: vi.fn().mockResolvedValue({}),
        newSession: vi.fn().mockResolvedValue({ sessionId: 'new-3' })
      },
      availableModes: [],
      currentModeId: null,
      mcpCapabilities: {}
    } as any

    const result = await (manager as any).initializeSession(
      handle,
      'conv-new',
      { id: 'agent1', name: 'Agent 1' },
      '/tmp',
      createSessionHooks()
    )

    expect(handle.connection.loadSession).not.toHaveBeenCalled()
    expect(handle.connection.newSession).toHaveBeenCalledTimes(1)
    expect(result.sessionId).toBe('new-3')
  })

  it('keeps warmup config when newSession returns no config payload', async () => {
    const manager = new AcpSessionManager({
      providerId: 'acp',
      processManager: createProcessManager(),
      sessionPersistence: {
        getSessionData: vi.fn().mockResolvedValue(null)
      } as any,
      agentSettings: createBaseProviderSettings(),
      mcpSettings: createBaseProviderSettings()
    })

    const warmupConfigState = createWarmupConfigState()
    const handle = {
      supportsLoadSession: false,
      configState: warmupConfigState,
      connection: {
        loadSession: vi.fn().mockResolvedValue({}),
        newSession: vi.fn().mockResolvedValue({ sessionId: 'new-4' })
      },
      availableModes: [],
      currentModeId: null,
      mcpCapabilities: {}
    } as any

    const result = await (manager as any).initializeSession(
      handle,
      'conv-warmup-config',
      { id: 'agent1', name: 'Agent 1' },
      '/tmp',
      createSessionHooks()
    )

    expect(handle.connection.newSession).toHaveBeenCalledTimes(1)
    expect(result.sessionId).toBe('new-4')
    expect(result.configState).toEqual(warmupConfigState)
  })
})
