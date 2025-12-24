import { describe, it, expect, vi } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import { convertMcpConfigToAcpFormat } from '../../../src/main/presenter/llmProviderPresenter/agent/mcpConfigConverter'
import { filterMcpServersByTransportSupport } from '../../../src/main/presenter/llmProviderPresenter/agent/mcpTransportFilter'
import { AcpSessionManager } from '../../../src/main/presenter/llmProviderPresenter/agent/acpSessionManager'

vi.mock('electron', () => ({
  app: {
    on: vi.fn()
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
      sessionPersistence: {} as any,
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

    await (manager as any).initializeSession(handle, { id: 'agent1', name: 'Agent 1' }, '/tmp')

    expect(handle.connection.newSession).toHaveBeenCalledWith({
      cwd: '/tmp',
      mcpServers: [{ name: 'stdio-1', command: 'node', args: ['server.js'], env: [] }]
    })
  })
})
