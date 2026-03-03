import { describe, it, expect, vi } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import { convertMcpConfigToAcpFormat } from '../../../src/main/presenter/agentPresenter/acp/mcpConfigConverter'
import { filterMcpServersByTransportSupport } from '../../../src/main/presenter/agentPresenter/acp/mcpTransportFilter'
import { AcpSessionManager } from '../../../src/main/presenter/agentPresenter/acp/acpSessionManager'

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getPath: vi.fn(() => '/tmp'),
    getVersion: vi.fn(() => '0.0.0-test')
  }
}))

describe('ACP MCP passthrough helpers', () => {
  it('converts stdio MCP config to ACP format', () => {
    const server = convertMcpConfigToAcpFormat('test', {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { FOO: 'bar', NUM: 1 },
      descriptions: 'desc',
      icons: '🧪',
      autoApprove: []
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
    const configPresenter = {
      getAgentMcpSelections: vi.fn().mockResolvedValue(['stdio-1', 'http-1']),
      getMcpServers: vi.fn().mockResolvedValue({
        'stdio-1': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: {},
          descriptions: '',
          icons: '',
          autoApprove: []
        },
        'http-1': {
          type: 'http',
          command: '',
          args: [],
          env: {},
          descriptions: '',
          icons: '',
          autoApprove: [],
          baseUrl: 'http://localhost',
          customHeaders: { Authorization: 'Bearer test' }
        }
      })
    }

    const manager = new AcpSessionManager({
      providerId: 'acp',
      processManager: {} as any,
      sessionPersistence: {
        getSessionData: vi.fn().mockResolvedValue(null)
      } as any,
      configPresenter: configPresenter as any
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
      '/tmp'
    )

    expect(handle.connection.newSession).toHaveBeenCalledWith({
      cwd: '/tmp',
      mcpServers: [{ name: 'stdio-1', command: 'node', args: ['server.js'], env: [] }]
    })
  })
})

describe('AcpSessionManager loadSession fallback behavior', () => {
  const createBaseConfigPresenter = () =>
    ({
      getAgentMcpSelections: vi.fn().mockResolvedValue([]),
      getMcpServers: vi.fn().mockResolvedValue({})
    }) as any

  it('prefers loadSession when agent supports it and persisted session exists', async () => {
    const manager = new AcpSessionManager({
      providerId: 'acp',
      processManager: {} as any,
      sessionPersistence: {
        getSessionData: vi.fn().mockResolvedValue({ sessionId: 'persisted-1' })
      } as any,
      configPresenter: createBaseConfigPresenter()
    })

    const handle = {
      supportsLoadSession: true,
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
      '/tmp'
    )

    expect(handle.connection.loadSession).toHaveBeenCalledWith({
      cwd: '/tmp',
      mcpServers: [],
      sessionId: 'persisted-1'
    })
    expect(handle.connection.newSession).not.toHaveBeenCalled()
    expect(result.sessionId).toBe('persisted-1')
  })

  it('falls back to newSession when loadSession fails', async () => {
    const manager = new AcpSessionManager({
      providerId: 'acp',
      processManager: {} as any,
      sessionPersistence: {
        getSessionData: vi.fn().mockResolvedValue({ sessionId: 'persisted-2' })
      } as any,
      configPresenter: createBaseConfigPresenter()
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
      '/tmp'
    )

    expect(handle.connection.loadSession).toHaveBeenCalledTimes(1)
    expect(handle.connection.newSession).toHaveBeenCalledTimes(1)
    expect(result.sessionId).toBe('new-2')
  })

  it('uses newSession when loadSession is not supported', async () => {
    const manager = new AcpSessionManager({
      providerId: 'acp',
      processManager: {} as any,
      sessionPersistence: {
        getSessionData: vi.fn().mockResolvedValue({ sessionId: 'persisted-3' })
      } as any,
      configPresenter: createBaseConfigPresenter()
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
      '/tmp'
    )

    expect(handle.connection.loadSession).not.toHaveBeenCalled()
    expect(handle.connection.newSession).toHaveBeenCalledTimes(1)
    expect(result.sessionId).toBe('new-3')
  })
})
