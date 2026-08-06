import { describe, expect, it, vi } from 'vitest'
import { McpAppHost } from '@/mcp/apps/appHost'
import type { McpAppDescriptor, Tool } from '@shared/types/mcp'

const context = { webContentsId: 7, windowId: 11 }
const descriptor: McpAppDescriptor = {
  schemaVersion: 1,
  serverId: 'server-id',
  configGeneration: 3,
  bindingHash: 'binding-hash',
  serverName: 'apps-server',
  toolName: 'render_chart',
  resourceUri: 'ui://chart/index.html',
  resourceMimeType: 'text/html;profile=mcp-app'
}
const tool: Tool = {
  name: 'render_chart',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  _meta: {
    ui: {
      resourceUri: descriptor.resourceUri,
      visibility: ['model', 'app']
    }
  }
}

const createHarness = () => {
  let currentConfig = {
    serverId: descriptor.serverId,
    configGeneration: descriptor.configGeneration,
    bindingHash: descriptor.bindingHash,
    enabled: true
  }
  const getMcpServers = vi.fn(async () => ({
    'apps-server': currentConfig
  }))
  const client = {
    isServerRunning: vi.fn(() => true),
    listTools: vi.fn().mockResolvedValue([tool]),
    listToolsPage: vi.fn().mockResolvedValue({ tools: [tool] }),
    readResourceContents: vi.fn().mockResolvedValue([
      {
        uri: descriptor.resourceUri,
        mimeType: descriptor.resourceMimeType,
        text: '<main>Chart</main>'
      }
    ]),
    listResourcesPage: vi
      .fn()
      .mockResolvedValueOnce({
        resources: [],
        nextCursor: 'second-page'
      })
      .mockResolvedValueOnce({
        resources: [
          {
            uri: descriptor.resourceUri,
            name: 'Chart',
            _meta: {
              ui: {
                csp: { connectDomains: ['https://api.example.com'] },
                permissions: { clipboardWrite: {} },
                prefersBorder: false,
                domain: 'charts.example.com'
              }
            }
          }
        ]
      }),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'done' }],
      structuredContent: ['north', 42]
    })
  }
  const instance = {
    instanceId: 'instance-id',
    webContentsId: context.webContentsId,
    windowId: context.windowId,
    conversationId: 'conversation-id',
    messageId: 'message-id',
    blockId: 'block-id',
    descriptor,
    toolInput: { points: [1, 2] },
    html: '<main>Chart</main>',
    csp: { connectDomains: ['https://api.example.com'] },
    permissions: { clipboardWrite: {} },
    prefersBorder: false,
    advisoryDomain: 'charts.example.com',
    expiresAt: Date.now() + 60_000,
    toolAccessSuspended: false
  }
  const registry = {
    create: vi.fn((input: Record<string, unknown>) => ({ ...instance, ...input })),
    assertOwned: vi.fn(() => instance),
    revoke: vi.fn(),
    requestConsent: vi.fn().mockResolvedValue(true),
    submitConsent: vi.fn()
  }
  const permissionBroker = {
    requestAppDecision: vi.fn().mockResolvedValue({ allowed: true })
  }
  const validateSource = vi.fn(() => true)
  const host = new McpAppHost({
    settings: {
      getMcpServers
    } as never,
    serverManager: {
      getClient: vi.fn(() => client)
    } as never,
    permissionBroker: permissionBroker as never,
    registry: registry as never,
    ensureServerRunning: vi.fn(),
    getPermissionMode: vi.fn().mockResolvedValue('default'),
    validateSource,
    persistModelContext: vi.fn(() => true)
  })

  return {
    client,
    host,
    permissionBroker,
    registry,
    validateSource,
    setConfig: (config: typeof currentConfig) => {
      currentConfig = config
    }
  }
}

describe('MCP App host', () => {
  it('hydrates an exact saved App binding and finds metadata on later resource pages', async () => {
    const { client, host, registry } = createHarness()

    const prepared = await host.prepareView(
      {
        descriptor,
        conversationId: 'conversation-id',
        messageId: 'message-id',
        blockId: 'block-id',
        toolInput: { points: [1, 2] }
      },
      context
    )

    expect(client.listResourcesPage).toHaveBeenNthCalledWith(1, undefined)
    expect(client.listResourcesPage).toHaveBeenNthCalledWith(2, 'second-page')
    expect(registry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        descriptor,
        html: '<main>Chart</main>',
        csp: { connectDomains: ['https://api.example.com'] },
        permissions: { clipboardWrite: {} },
        prefersBorder: false,
        advisoryDomain: 'charts.example.com'
      })
    )
    expect(prepared).toMatchObject({
      instanceId: 'instance-id',
      sandboxUrl: 'mcp-app://instance-id/sandbox.html',
      sandbox: 'allow-scripts allow-same-origin'
    })
  })

  it('routes App-visible tool calls through the broker and preserves arbitrary JSON results', async () => {
    const { client, host, permissionBroker } = createHarness()

    const result = await host.callTool('instance-id', 'render_chart', { region: 'north' }, context)

    expect(permissionBroker.requestAppDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-id',
        serverId: descriptor.serverId,
        toolName: 'render_chart',
        permissionType: 'write'
      }),
      expect.any(Function)
    )
    expect(client.callTool).toHaveBeenCalledWith(
      'render_chart',
      { region: 'north' },
      { toolDefinition: tool }
    )
    expect(result).toEqual({
      result: {
        content: [{ type: 'text', text: 'done' }],
        structuredContent: ['north', 42]
      },
      toolAccessSuspended: false
    })
  })

  it('returns a large App-visible tool catalog without a catalog-wide key budget', async () => {
    const { client, host } = createHarness()
    const tools = Array.from({ length: 151 }, (_, toolIndex) => ({
      name: `app_tool_${toolIndex}`,
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 22 }, (_, propertyIndex) => [
            `field_${propertyIndex}`,
            {
              type: 'string',
              description: `Input field ${propertyIndex} owned by tool ${toolIndex}`
            }
          ])
        )
      },
      _meta: {
        ui: {
          visibility: ['app']
        }
      }
    }))
    client.listToolsPage.mockResolvedValueOnce({ tools })

    const result = await host.listTools('instance-id', undefined, context)

    expect(result.tools).toHaveLength(151)
    expect(result.tools.at(-1)?.name).toBe('app_tool_150')
  })

  it('does not create an App instance if its binding changes while resources load', async () => {
    const { client, host, registry, setConfig } = createHarness()
    let resolveResource!: (value: Awaited<ReturnType<typeof client.readResourceContents>>) => void
    client.readResourceContents.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResource = resolve
      })
    )
    const preparing = host.prepareView(
      {
        descriptor,
        conversationId: 'conversation-id',
        messageId: 'message-id',
        blockId: 'block-id',
        toolInput: { points: [1, 2] }
      },
      context
    )
    await vi.waitFor(() => expect(client.readResourceContents).toHaveBeenCalled())

    setConfig({
      serverId: descriptor.serverId,
      configGeneration: descriptor.configGeneration + 1,
      bindingHash: 'changed-binding',
      enabled: true
    })
    resolveResource([
      {
        uri: descriptor.resourceUri,
        mimeType: descriptor.resourceMimeType,
        text: '<main>Chart</main>'
      }
    ])

    await expect(preparing).rejects.toThrow('binding changed')
    expect(registry.create).not.toHaveBeenCalled()
  })

  it('rechecks the App binding after tool consent before dispatch', async () => {
    const { client, host, permissionBroker, setConfig } = createHarness()
    let resolveDecision!: (value: { allowed: boolean }) => void
    permissionBroker.requestAppDecision.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDecision = resolve
      })
    )
    const call = host.callTool('instance-id', 'render_chart', { region: 'north' }, context)
    await vi.waitFor(() => expect(permissionBroker.requestAppDecision).toHaveBeenCalled())

    setConfig({
      serverId: descriptor.serverId,
      configGeneration: descriptor.configGeneration + 1,
      bindingHash: 'changed-binding',
      enabled: true
    })
    resolveDecision({ allowed: true })

    await expect(call).rejects.toThrow('binding changed')
    expect(client.callTool).not.toHaveBeenCalled()
  })
})
