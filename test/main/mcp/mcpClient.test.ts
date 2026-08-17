import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { McpClient } from '../../../src/main/mcp/mcpClient'
import { RuntimeHelper } from '../../../src/main/lib/runtimeHelper'
import path from 'path'
import fs from 'fs'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import {
  ProtocolError,
  Client,
  ProtocolErrorCode,
  SdkErrorCode
} from '@modelcontextprotocol/client'

const fsExistsSyncMock = vi.hoisted(() => vi.fn())
const terminateProcessTreeMock = vi.hoisted(() => vi.fn().mockResolvedValue(true))

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((pathType: string) => {
      if (pathType === 'home') return '/mock/home'
      return '/mock/app'
    }),
    getAppPath: vi.fn(() => '/mock/app'),
    getVersion: vi.fn(() => '1.0.0')
  }
}))

// Mock fs module
vi.mock('fs', () => ({
  existsSync: fsExistsSyncMock,
  default: {
    existsSync: fsExistsSyncMock
  }
}))

// Mock presenter
const presenterMocks = vi.hoisted(() => ({
  handleSamplingRequest: vi.fn(),
  cancelSamplingRequest: vi.fn(),
  handleElicitationRequest: vi.fn(),
  cancelElicitationRequest: vi.fn(),
  generateCompletionStandalone: vi.fn(),
  getProviderModels: vi.fn(),
  getCustomModels: vi.fn()
}))

const mockHandleSamplingRequest = presenterMocks.handleSamplingRequest
const mockCancelSamplingRequest = presenterMocks.cancelSamplingRequest
const mockHandleElicitationRequest = presenterMocks.handleElicitationRequest
const mockCancelElicitationRequest = presenterMocks.cancelElicitationRequest
const mockGenerateCompletionStandalone = presenterMocks.generateCompletionStandalone
const mockGetProviderModels = presenterMocks.getProviderModels
const mockGetCustomModels = presenterMocks.getCustomModels

function createMcpClient(
  serverName: string,
  serverConfig: Record<string, unknown>,
  npmRegistry: string | null = null,
  uvRegistry: string | null = null,
  mcpOAuthManager?: ConstructorParameters<typeof McpClient>[4],
  inMemoryServerFactory?: ConstructorParameters<typeof McpClient>[5]
): McpClient {
  return new McpClient(
    serverName,
    serverConfig,
    npmRegistry,
    uvRegistry,
    mcpOAuthManager,
    inMemoryServerFactory,
    {
      sampling: {
        handleSamplingRequest: mockHandleSamplingRequest,
        cancelSamplingRequest: mockCancelSamplingRequest
      },
      elicitation: {
        handleElicitationRequest: mockHandleElicitationRequest,
        cancelElicitationRequest: mockCancelElicitationRequest
      },
      completion: {
        generateCompletionStandalone: mockGenerateCompletionStandalone
      },
      config: {
        getProviderModels: mockGetProviderModels,
        getCustomModels: mockGetCustomModels
      }
    },
    vi.fn(),
    vi.fn()
  )
}

const createLargeToolCatalog = () =>
  Array.from({ length: 151 }, (_, toolIndex) => ({
    name: `tool_${toolIndex}`,
    description: `Tool ${toolIndex}`,
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
    }
  }))

const createSdkToolClient = (tools: unknown[], era: 'modern' | 'legacy') => ({
  connect: vi.fn().mockResolvedValue(undefined),
  callTool: vi.fn().mockResolvedValue({ content: [] }),
  listTools: vi.fn().mockResolvedValue({ tools }),
  listPrompts: vi.fn(),
  getPrompt: vi.fn(),
  listResources: vi.fn(),
  readResource: vi.fn(),
  setNotificationHandler: vi.fn(),
  setRequestHandler: vi.fn(),
  getProtocolEra: vi.fn(() => era),
  getServerCapabilities: vi.fn(() => ({ tools: {} }))
})

vi.mock('@/agent/shared/process/processTree', () => ({
  terminateProcessTreeByPid: terminateProcessTreeMock
}))

// Mock MCP SDK modules
vi.mock('@modelcontextprotocol/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modelcontextprotocol/client')>()
  return {
    ...actual,
    Client: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      callTool: vi.fn(),
      listTools: vi.fn(),
      listPrompts: vi.fn(),
      getPrompt: vi.fn(),
      listResources: vi.fn(),
      readResource: vi.fn(),
      setNotificationHandler: vi.fn(),
      setRequestHandler: vi.fn(),
      getProtocolEra: vi.fn(() => 'modern')
    })),
    SSEClientTransport: vi.fn(),
    InMemoryTransport: {
      createLinkedPair: vi.fn(() => [vi.fn(), vi.fn()])
    },
    StreamableHTTPClientTransport: vi.fn()
  }
})

vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    stderr: {
      on: vi.fn()
    },
    close: vi.fn()
  }))
}))

describe('McpClient Runtime Command Processing Tests', () => {
  let mockFsExistsSync: any
  const runtimeHelper = RuntimeHelper.getInstance() as RuntimeHelper & {
    runtimesInitialized: boolean
  }

  beforeEach(() => {
    mockFsExistsSync = vi.mocked(fs.existsSync)
    vi.clearAllMocks()
    mockFsExistsSync.mockReset()
    mockFsExistsSync.mockReturnValue(false)
    runtimeHelper.runtimesInitialized = false
    runtimeHelper.setNodeRuntimePath(null)
    runtimeHelper.setUvRuntimePath(null)

    mockHandleSamplingRequest.mockReset()
    mockCancelSamplingRequest.mockReset()
    mockHandleElicitationRequest.mockReset()
    mockCancelElicitationRequest.mockReset()
    mockGenerateCompletionStandalone.mockReset()
    mockGetProviderModels.mockReset()
    mockGetCustomModels.mockReset()
    vi.mocked(Client).mockImplementation(
      () =>
        ({
          connect: vi.fn().mockResolvedValue(undefined),
          callTool: vi.fn(),
          listTools: vi.fn(),
          listPrompts: vi.fn(),
          getPrompt: vi.fn(),
          listResources: vi.fn(),
          readResource: vi.fn(),
          setNotificationHandler: vi.fn(),
          setRequestHandler: vi.fn(),
          getProtocolEra: vi.fn(() => 'modern')
        }) as any
    )
    vi.mocked(StdioClientTransport).mockImplementation(
      () =>
        ({
          stderr: {
            on: vi.fn()
          },
          close: vi.fn()
        }) as any
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('NPX Command Processing', () => {
    it('should keep npx command arguments unchanged for everything server', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything']
      }

      const client = createMcpClient('everything', serverConfig)

      // Access private method for testing
      const processedCommand = (client as any).processCommandWithArgs('npx', [
        '-y',
        '@modelcontextprotocol/server-everything'
      ])

      expect(processedCommand.command).toContain('npx')
      expect(processedCommand.args).toEqual(['-y', '@modelcontextprotocol/server-everything'])
    })

    it('should handle npx in command path correctly', () => {
      const serverConfig = {
        type: 'stdio',
        command: '/usr/local/bin/npx',
        args: ['-y', '@modelcontextprotocol/server-everything']
      }

      const client = createMcpClient('everything', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('/usr/local/bin/npx', [
        '-y',
        '@modelcontextprotocol/server-everything'
      ])

      expect(processedCommand.command).toContain('npx')
      expect(processedCommand.args).toEqual(['-y', '@modelcontextprotocol/server-everything'])
    })
  })

  describe('UVX Command Processing', () => {
    it('should preserve uvx command without modification for osm-mcp-server', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'uvx',
        args: ['osm-mcp-server']
      }

      const client = createMcpClient('osm-mcp-server', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('uvx', ['osm-mcp-server'])

      // Should keep uvx as is, only replace with runtime path
      expect(processedCommand.command).toContain('uvx')
      expect(processedCommand.args).toEqual(['osm-mcp-server']) // No 'x' prefix added
    })

    it('should handle uvx command with runtime path replacement', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'uvx',
        args: ['osm-mcp-server']
      }

      const client = createMcpClient('osm-mcp-server', serverConfig)

      // Mock the runtime path for testing
      const uvRuntimePath = path
        .join('/mock/app/runtime/uv')
        .replace('app.asar', 'app.asar.unpacked')
      client.uvRuntimePath = uvRuntimePath

      const processedCommand = (client as any).processCommandWithArgs('uvx', ['osm-mcp-server'])

      // Should use the runtime path
      const expectedUvxPath =
        process.platform === 'win32'
          ? path.join(uvRuntimePath, 'uvx.exe')
          : path.join(uvRuntimePath, 'uvx')

      expect(processedCommand.command.replace(/[\\/]+/g, '/')).toBe(
        expectedUvxPath.replace(/[\\/]+/g, '/')
      )
      expect(processedCommand.args).toEqual(['osm-mcp-server'])
    })

    it('should handle uvx in command path correctly', () => {
      const serverConfig = {
        type: 'stdio',
        command: '/usr/local/bin/uvx',
        args: ['osm-mcp-server']
      }

      const client = createMcpClient('osm-mcp-server', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('/usr/local/bin/uvx', [
        'osm-mcp-server'
      ])

      // Should replace with runtime uvx path
      expect(processedCommand.command).toContain('uvx')
      expect(processedCommand.args).toEqual(['osm-mcp-server'])
    })
  })

  describe('Other Command Processing', () => {
    it('should handle node command replacement with bun', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'node',
        args: ['server.js']
      }

      const client = createMcpClient('test', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('node', ['server.js'])

      expect(processedCommand.command).toContain('node')
      expect(processedCommand.args).toEqual(['server.js'])
    })

    it('should keep npm command processing stable', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'npm',
        args: ['start']
      }

      const client = createMcpClient('test', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('npm', ['start'])

      expect(processedCommand.command).toContain('npm')
      expect(processedCommand.args).toEqual(['start'])
    })

    it('should handle uv command replacement correctly', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'uv',
        args: ['run', 'server.py']
      }

      const client = createMcpClient('test', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('uv', ['run', 'server.py'])

      expect(processedCommand.command).toContain('uv')
      expect(processedCommand.args).toEqual(['run', 'server.py'])
    })

    it('should not modify unknown commands', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'python',
        args: ['server.py']
      }

      const client = createMcpClient('test', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('python', ['server.py'])

      // Should keep python command as is
      expect(processedCommand.command).toBe('python')
      expect(processedCommand.args).toEqual(['server.py'])
    })
  })

  describe('Runtime Path Detection', () => {
    it('should detect uv runtime when files exist', () => {
      mockFsExistsSync.mockImplementation((filePath: string | Buffer | URL) => {
        const pathStr = String(filePath)
        return pathStr.includes('runtime/uv/uv')
      })

      const client = createMcpClient('test', { type: 'stdio' })

      expect((client as any).uvRuntimePath).toBeTruthy()
      expect((client as any).nodeRuntimePath).toBeNull()
    })

    it('should handle missing runtime files gracefully', () => {
      mockFsExistsSync.mockReturnValue(false)

      const client = createMcpClient('test', { type: 'stdio' })

      expect((client as any).bunRuntimePath).toBeNull()
      expect((client as any).uvRuntimePath).toBeNull()
    })
  })

  describe('Environment Variable Processing', () => {
    it('should set npm registry environment variables', () => {
      const client = createMcpClient('test', { type: 'stdio' }, 'https://registry.npmmirror.com')

      // Check if npm registry is stored
      expect((client as any).npmRegistry).toBe('https://registry.npmmirror.com')
    })

    it('should handle null npm registry', () => {
      const client = createMcpClient('test', { type: 'stdio' }, null)

      // Should handle null registry gracefully
      expect((client as any).npmRegistry).toBeNull()
    })

    it('should coerce stdio server env values to strings before spawning', async () => {
      const client = createMcpClient('test', {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: {
          TOKEN: 123,
          EMPTY: null,
          SKIP: undefined,
          PATH: '/custom/bin'
        }
      })

      await client.connect()

      const transportCalls = vi.mocked(StdioClientTransport).mock.calls
      const transportOptions = transportCalls[transportCalls.length - 1][0] as {
        env: Record<string, string>
      }

      expect(transportOptions.env.TOKEN).toBe('123')
      expect(transportOptions.env.EMPTY).toBe('')
      expect(transportOptions.env).not.toHaveProperty('SKIP')
      const pathEnv =
        transportOptions.env.PATH ?? transportOptions.env.Path ?? transportOptions.env.path
      expect(pathEnv).toContain('/custom/bin')
    })

    it('uses the minimal inherited environment only when explicitly requested', async () => {
      const originalApiToken = process.env.API_TOKEN
      const originalCuaLog = process.env.CUA_LOG
      process.env.API_TOKEN = 'secret'
      process.env.CUA_LOG = 'debug'

      try {
        const client = createMcpClient('test', {
          type: 'stdio',
          command: 'cua-driver',
          args: ['mcp'],
          inheritEnv: 'minimal',
          env: {
            PLUGIN_VALUE: 'declared'
          }
        })

        await client.connect()

        const transportCalls = vi.mocked(StdioClientTransport).mock.calls
        const transportOptions = transportCalls[transportCalls.length - 1][0] as {
          env: Record<string, string>
        }
        expect(transportOptions.env).not.toHaveProperty('API_TOKEN')
        expect(transportOptions.env).not.toHaveProperty('CUA_LOG')
        expect(transportOptions.env.PLUGIN_VALUE).toBe('declared')
      } finally {
        if (originalApiToken === undefined) {
          delete process.env.API_TOKEN
        } else {
          process.env.API_TOKEN = originalApiToken
        }
        if (originalCuaLog === undefined) {
          delete process.env.CUA_LOG
        } else {
          process.env.CUA_LOG = originalCuaLog
        }
      }
    })

    it('preserves legacy inheritance for existing native MCP configs', async () => {
      const originalApiToken = process.env.API_TOKEN
      process.env.API_TOKEN = 'legacy-secret'

      try {
        const client = createMcpClient('test', {
          type: 'stdio',
          command: 'native-helper',
          args: []
        })

        await client.connect()

        const transportCalls = vi.mocked(StdioClientTransport).mock.calls
        const transportOptions = transportCalls[transportCalls.length - 1][0] as {
          env: Record<string, string>
        }
        expect(transportOptions.env.API_TOKEN).toBe('legacy-secret')
      } finally {
        if (originalApiToken === undefined) {
          delete process.env.API_TOKEN
        } else {
          process.env.API_TOKEN = originalApiToken
        }
      }
    })

    it('runs process-tree fallback cleanup after closing stdio transport', async () => {
      const order: string[] = []
      const pid = 123
      const closeMock = vi.fn(async () => {
        order.push('transport-close')
      })
      terminateProcessTreeMock.mockImplementationOnce(async () => {
        order.push('process-tree')
        return true
      })
      vi.mocked(StdioClientTransport).mockImplementationOnce(function (this: any) {
        this.stderr = {
          on: vi.fn()
        }
        this.close = closeMock
        this.pid = pid
      } as any)
      const client = createMcpClient('test', {
        type: 'stdio',
        command: 'node',
        args: ['server.js']
      })

      await client.connect()
      await client.disconnect()

      expect(terminateProcessTreeMock).toHaveBeenCalledWith(pid, { graceMs: 2000 })
      expect(closeMock).toHaveBeenCalledTimes(1)
      expect(order).toEqual(['transport-close', 'process-tree'])
    })

    it('keeps stdio transport closed when process-tree fallback cleanup fails', async () => {
      const pid = 456
      const cleanupError = new Error('cleanup failed')
      const closeMock = vi.fn().mockResolvedValue(undefined)
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      terminateProcessTreeMock.mockRejectedValueOnce(cleanupError)
      vi.mocked(StdioClientTransport).mockImplementationOnce(function (this: any) {
        this.stderr = {
          on: vi.fn()
        }
        this.close = closeMock
        this.pid = pid
      } as any)
      const client = createMcpClient('test', {
        type: 'stdio',
        command: 'node',
        args: ['server.js']
      })

      await client.connect()
      await client.disconnect()

      expect(terminateProcessTreeMock).toHaveBeenCalledWith(pid, { graceMs: 2000 })
      expect(closeMock).toHaveBeenCalledTimes(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to terminate MCP stdio process tree for test:',
        cleanupError
      )
      consoleErrorSpy.mockRestore()
    })
  })

  describe('Version negotiation', () => {
    it('retries one timed-out HTTP version negotiation probe', async () => {
      const client = createMcpClient('remote-server', {
        type: 'http',
        baseUrl: 'https://example.com/mcp'
      })

      await client.connect()

      const clientOptions = vi.mocked(Client).mock.calls.at(-1)?.[1]
      expect(clientOptions?.versionNegotiation).toEqual({
        mode: 'auto',
        probe: {
          timeoutMs: 20_000,
          maxRetries: 1
        }
      })
    })
  })

  describe('Unsupported MCP capabilities', () => {
    it('does not call list methods for capabilities the server did not advertise', async () => {
      const sdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        callTool: vi.fn(),
        listTools: vi.fn(),
        listPrompts: vi.fn(),
        getPrompt: vi.fn(),
        listResources: vi.fn(),
        listResourceTemplates: vi.fn(),
        readResource: vi.fn(),
        setNotificationHandler: vi.fn(),
        setRequestHandler: vi.fn(),
        getProtocolEra: vi.fn(() => 'modern'),
        getServerCapabilities: vi.fn(() => ({}))
      }
      vi.mocked(Client).mockImplementationOnce(() => sdkClient as any)
      const client = createMcpClient('minimal-server', {
        type: 'stdio',
        command: 'minimal-server',
        args: []
      })

      await expect(client.listTools()).resolves.toEqual([])
      await expect(client.listToolsPage()).resolves.toEqual({ tools: [] })
      await expect(client.listPrompts()).resolves.toEqual([])
      await expect(client.listPromptsPage()).resolves.toEqual({ prompts: [] })
      await expect(client.listResources()).resolves.toEqual([])
      await expect(client.listResourcesPage()).resolves.toEqual({ resources: [] })
      await expect(client.listResourceTemplatesPage()).resolves.toEqual({
        resourceTemplates: []
      })

      expect(sdkClient.listTools).not.toHaveBeenCalled()
      expect(sdkClient.listPrompts).not.toHaveBeenCalled()
      expect(sdkClient.listResources).not.toHaveBeenCalled()
      expect(sdkClient.listResourceTemplates).not.toHaveBeenCalled()
    })

    it('waits for background startup completion before foreground listTools calls', async () => {
      vi.useFakeTimers()
      let resolveConnect: () => void = () => undefined
      const sdkClient = {
        connect: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveConnect = resolve
            })
        ),
        callTool: vi.fn(),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listPrompts: vi.fn(),
        getPrompt: vi.fn(),
        listResources: vi.fn(),
        readResource: vi.fn(),
        setNotificationHandler: vi.fn(),
        setRequestHandler: vi.fn(),
        getProtocolEra: vi.fn(() => 'modern')
      }
      vi.mocked(Client).mockImplementationOnce(() => sdkClient as any)
      const client = createMcpClient('slow-server', {
        type: 'stdio',
        command: 'slow-server',
        args: []
      })

      try {
        const startupResult = client.connect({ phase: 'startup' })
        await vi.advanceTimersByTimeAsync(45_000)
        await expect(startupResult).resolves.toBe('soft-timeout-released')

        const toolsResult = client.listTools()
        await Promise.resolve()

        expect(sdkClient.listTools).not.toHaveBeenCalled()

        resolveConnect()
        await expect(toolsResult).resolves.toEqual([])
        expect(sdkClient.listTools).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('propagates cancellation into SDK tool discovery', async () => {
      const sdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        callTool: vi.fn(),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listPrompts: vi.fn(),
        getPrompt: vi.fn(),
        listResources: vi.fn(),
        readResource: vi.fn(),
        setNotificationHandler: vi.fn(),
        setRequestHandler: vi.fn(),
        getProtocolEra: vi.fn(() => 'modern')
      }
      vi.mocked(Client).mockImplementationOnce(() => sdkClient as any)
      const client = createMcpClient('diagnostic-server', {
        type: 'stdio',
        command: 'diagnostic-server',
        args: []
      })
      const controller = new AbortController()

      await expect(client.listTools({ signal: controller.signal })).resolves.toEqual([])

      expect(sdkClient.listTools).toHaveBeenCalledWith(undefined, {
        signal: controller.signal
      })

      controller.abort()
      await expect(client.listTools({ signal: controller.signal })).rejects.toThrow()
      expect(sdkClient.listTools).toHaveBeenCalledOnce()
    })

    it('treats unknown tools/list as an empty tool list', async () => {
      const unsupportedError = new ProtocolError(
        ProtocolErrorCode.MethodNotFound,
        'Unknown method: tools/list'
      )
      const sdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        callTool: vi.fn(),
        listTools: vi.fn().mockRejectedValue(unsupportedError),
        listPrompts: vi.fn(),
        getPrompt: vi.fn(),
        listResources: vi.fn(),
        readResource: vi.fn(),
        setNotificationHandler: vi.fn(),
        setRequestHandler: vi.fn(),
        getProtocolEra: vi.fn(() => 'modern')
      }
      vi.mocked(Client).mockImplementationOnce(() => sdkClient as any)
      const client = createMcpClient('diagnostic-server', {
        type: 'stdio',
        command: 'diagnostic-server',
        args: []
      })
      await client.connect()

      const controller = new AbortController()

      await expect(client.listTools({ signal: controller.signal })).resolves.toEqual([])
      expect(sdkClient.listTools).toHaveBeenCalledOnce()
    })

    it('treats unknown paginated list methods as empty pages', async () => {
      const unsupportedError = new ProtocolError(
        ProtocolErrorCode.MethodNotFound,
        'Unknown list method'
      )
      const sdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        callTool: vi.fn(),
        listTools: vi.fn().mockRejectedValue(unsupportedError),
        listPrompts: vi.fn().mockRejectedValue(unsupportedError),
        getPrompt: vi.fn(),
        listResources: vi.fn().mockRejectedValue(unsupportedError),
        listResourceTemplates: vi.fn().mockRejectedValue(unsupportedError),
        readResource: vi.fn(),
        setNotificationHandler: vi.fn(),
        setRequestHandler: vi.fn(),
        getProtocolEra: vi.fn(() => 'modern'),
        getServerCapabilities: vi.fn(() => ({
          tools: {},
          prompts: {},
          resources: {}
        }))
      }
      vi.mocked(Client).mockImplementationOnce(() => sdkClient as any)
      const client = createMcpClient('partial-server', {
        type: 'stdio',
        command: 'partial-server',
        args: []
      })

      await expect(client.listToolsPage()).resolves.toEqual({ tools: [] })
      await expect(client.listPromptsPage()).resolves.toEqual({ prompts: [] })
      await expect(client.listResourcesPage()).resolves.toEqual({ resources: [] })
      await expect(client.listResourceTemplatesPage()).resolves.toEqual({
        resourceTemplates: []
      })
    })

    it('treats unknown prompts/list as an empty prompt list', async () => {
      const sdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        callTool: vi.fn(),
        listTools: vi.fn(),
        listPrompts: vi
          .fn()
          .mockRejectedValue(
            new ProtocolError(ProtocolErrorCode.MethodNotFound, 'Unknown method: prompts/list')
          ),
        getPrompt: vi.fn(),
        listResources: vi.fn(),
        readResource: vi.fn(),
        setNotificationHandler: vi.fn(),
        setRequestHandler: vi.fn(),
        getProtocolEra: vi.fn(() => 'modern')
      }
      vi.mocked(Client).mockImplementationOnce(() => sdkClient as any)
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const client = createMcpClient('cua-driver', {
        type: 'stdio',
        command: 'cua-driver',
        args: ['mcp']
      })

      await expect(client.listPrompts()).resolves.toEqual([])
      await expect(client.listPrompts()).resolves.toEqual([])

      expect(sdkClient.listPrompts).toHaveBeenCalledTimes(2)
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Failed to list MCP prompts:'),
        expect.anything()
      )
      consoleErrorSpy.mockRestore()
    })

    it('treats unknown resources/list as an empty resource list', async () => {
      const sdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        callTool: vi.fn(),
        listTools: vi.fn(),
        listPrompts: vi.fn(),
        getPrompt: vi.fn(),
        listResources: vi
          .fn()
          .mockRejectedValue(new Error('MCP error -32601: Unknown method: resources/list')),
        readResource: vi.fn(),
        setNotificationHandler: vi.fn(),
        setRequestHandler: vi.fn(),
        getProtocolEra: vi.fn(() => 'modern')
      }
      vi.mocked(Client).mockImplementationOnce(() => sdkClient as any)
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const client = createMcpClient('cua-driver', {
        type: 'stdio',
        command: 'cua-driver',
        args: ['mcp']
      })

      await expect(client.listResources()).resolves.toEqual([])
      await expect(client.listResources()).resolves.toEqual([])

      expect(sdkClient.listResources).toHaveBeenCalledTimes(2)
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Failed to list MCP resources:'),
        expect.anything()
      )
      consoleErrorSpy.mockRestore()
    })
  })

  describe('Tool discovery validation', () => {
    it.each(['modern', 'legacy'] as const)(
      'accepts a large valid %s tool catalog without a catalog-wide key budget',
      async (era) => {
        const tools = createLargeToolCatalog()
        const responseBytes = Buffer.byteLength(JSON.stringify({ tools }), 'utf8')
        expect(responseBytes).toBeGreaterThan(260_000)
        expect(responseBytes).toBeLessThan(275_000)

        const sdkClient = createSdkToolClient(tools, era)
        vi.mocked(Client).mockImplementationOnce(() => sdkClient as any)
        const client = createMcpClient('large-catalog', {
          type: 'stdio',
          command: 'large-catalog',
          args: [],
          forceLegacyWire: era === 'legacy'
        })

        await expect(client.listTools()).resolves.toHaveLength(151)
        await expect(client.listToolsPage()).resolves.toMatchObject({
          tools: expect.arrayContaining([
            expect.objectContaining({ name: 'tool_0' }),
            expect.objectContaining({ name: 'tool_150' })
          ])
        })
      }
    )

    it('preserves modern-incompatible schemas for user-owned external legacy servers', async () => {
      const inputSchema = {
        $schema: 'https://example.com/legacy-dialect',
        type: 'object',
        properties: {
          remote: { $ref: 'https://example.com/input.json' }
        }
      }
      const sdkClient = createSdkToolClient(
        [
          {
            name: 'legacy_tool',
            inputSchema,
            outputSchema: { $ref: 'https://example.com/output.json' }
          }
        ],
        'legacy'
      )
      vi.mocked(Client).mockImplementationOnce(() => sdkClient as any)
      const client = createMcpClient('legacy-server', {
        type: 'stdio',
        command: 'legacy-server',
        args: [],
        forceLegacyWire: true
      })

      const tools = await client.listTools()

      expect(tools[0].inputSchema).toEqual(inputSchema)
      expect(tools[0].outputSchema).toEqual({
        $ref: 'https://example.com/output.json'
      })

      await client.callTool('legacy_tool', {}, { toolDefinition: tools[0] })

      expect(sdkClient.callTool).toHaveBeenCalledWith(
        { name: 'legacy_tool', arguments: {} },
        {
          signal: undefined,
          toolDefinition: expect.objectContaining({
            name: 'legacy_tool',
            outputSchema: undefined
          })
        }
      )
    })

    it.each([
      ['modern external', 'modern', {}],
      [
        'plugin-owned legacy',
        'legacy',
        { forceLegacyWire: true, source: 'plugin', ownerPluginId: 'com.deepchat.fixture' }
      ]
    ] as const)('keeps strict schema semantics for %s servers', async (_label, era, config) => {
      const sdkClient = createSdkToolClient(
        [
          {
            name: 'strict_tool',
            inputSchema: {
              type: 'object',
              properties: {
                remote: { $ref: 'https://example.com/input.json' }
              }
            }
          }
        ],
        era
      )
      vi.mocked(Client).mockImplementationOnce(() => sdkClient as any)
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const client = createMcpClient('strict-server', {
        type: 'stdio',
        command: 'strict-server',
        args: [],
        ...config
      })

      await expect(client.listTools()).rejects.toThrow('remote $ref')

      consoleErrorSpy.mockRestore()
    })
  })

  describe('Path Expansion', () => {
    it('should expand tilde (~) in paths', () => {
      const client = createMcpClient('test', { type: 'stdio' })

      const expandedPath = (client as any).expandPath('~/test/path')

      expect(expandedPath).toBe('/mock/home/test/path')
    })

    it('should expand environment variables in paths', () => {
      // Set mock environment variable
      process.env.TEST_VAR = '/test/value'

      const client = createMcpClient('test', { type: 'stdio' })

      const expandedPath = (client as any).expandPath('/path/${TEST_VAR}/file')

      expect(expandedPath).toBe('/path//test/value/file')

      // Clean up
      delete process.env.TEST_VAR
    })

    it('should handle simple $VAR format', () => {
      // Set mock environment variable
      process.env.TEST_PATH = '/simple/test'

      const client = createMcpClient('test', { type: 'stdio' })

      const expandedPath = (client as any).expandPath('/path/$TEST_PATH/file')

      expect(expandedPath).toBe('/path//simple/test/file')

      // Clean up
      delete process.env.TEST_PATH
    })
  })

  describe('Tool cancellation', () => {
    const deferred = <T>() => {
      let resolve!: (value: T) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve
        reject = promiseReject
      })
      return { promise, resolve, reject }
    }

    const configureConnectedClient = (sdkCallTool: ReturnType<typeof vi.fn>) => {
      const client = createMcpClient('cancellable-server', { type: 'stdio' })
      ;(client as any).client = { callTool: sdkCallTool }
      ;(client as any).isConnected = true
      return client
    }

    it('rejects a pre-aborted call without invoking the SDK', async () => {
      const sdkCallTool = vi.fn()
      const client = configureConnectedClient(sdkCallTool)
      const abortController = new AbortController()
      abortController.abort()

      await expect(
        client.callTool('echo', {}, { signal: abortController.signal })
      ).rejects.toMatchObject({ name: 'AbortError' })

      expect(sdkCallTool).not.toHaveBeenCalled()
    })

    it('passes the signal to the SDK when an in-flight call aborts', async () => {
      const sdkCallTool = vi.fn(
        (_request: unknown, requestOptions?: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            const signal = requestOptions?.signal
            if (!signal) {
              reject(new Error('Missing abort signal'))
              return
            }
            if (signal.aborted) {
              reject(signal.reason)
              return
            }
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      )
      const client = configureConnectedClient(sdkCallTool)
      const abortController = new AbortController()

      const callPromise = client.callTool('echo', { value: 1 }, { signal: abortController.signal })
      await vi.waitFor(() => {
        expect(sdkCallTool).toHaveBeenCalledWith(
          { name: 'echo', arguments: { value: 1 } },
          { signal: abortController.signal, toolDefinition: undefined }
        )
      })

      abortController.abort()

      await expect(callPromise).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('rejects promptly when cancellation lands during connection setup', async () => {
      const sdkCallTool = vi.fn()
      const client = configureConnectedClient(sdkCallTool)
      const connection = deferred<any>()
      const connect = vi.spyOn(client, 'connect').mockReturnValue(connection.promise)
      ;(client as any).isConnected = false
      const abortController = new AbortController()

      const callPromise = client.callTool('echo', {}, { signal: abortController.signal })
      await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())

      abortController.abort()

      await expect(callPromise).rejects.toMatchObject({ name: 'AbortError' })
      expect(sdkCallTool).not.toHaveBeenCalled()
      connection.resolve('connected')
    })

    it('observes a connection failure that arrives after setup synchronously cancels', async () => {
      const sdkCallTool = vi.fn()
      const client = configureConnectedClient(sdkCallTool)
      const connection = deferred<any>()
      const abortController = new AbortController()
      const lateError = new Error('late connection failure')
      const unhandled = vi.fn()
      const connect = vi.spyOn(client, 'connect').mockImplementation(() => {
        abortController.abort()
        return connection.promise
      })
      ;(client as any).isConnected = false

      await expect(
        client.callTool('echo', {}, { signal: abortController.signal })
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(connect).toHaveBeenCalledOnce()
      expect(sdkCallTool).not.toHaveBeenCalled()

      process.on('unhandledRejection', unhandled)
      try {
        connection.reject(lateError)
        await new Promise<void>((resolve) => setImmediate(resolve))
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(unhandled.mock.calls.some(([reason]) => reason === lateError)).toBe(false)
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    it('propagates non-abort SDK failures', async () => {
      const sdkError = new Error('MCP request failed')
      const sdkCallTool = vi.fn().mockRejectedValue(sdkError)
      const client = configureConnectedClient(sdkCallTool)
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

      await expect(client.callTool('echo', {})).rejects.toBe(sdkError)

      expect(sdkCallTool).toHaveBeenCalledTimes(1)
      consoleErrorSpy.mockRestore()
    })
  })

  describe('Elicitation support', () => {
    it('reports malformed URLs as invalid protocol parameters', async () => {
      const client = createMcpClient('server-one', {
        type: 'stdio'
      }) as unknown as {
        handleElicitationCreate(request: unknown, context: unknown): Promise<unknown>
      }

      await expect(
        client.handleElicitationCreate(
          {
            params: {
              mode: 'url',
              message: 'Open the authorization page',
              url: 'not-an-absolute-url'
            }
          },
          {
            mcpReq: {
              signal: new AbortController().signal
            }
          }
        )
      ).rejects.toMatchObject({
        code: ProtocolErrorCode.InvalidParams
      })
    })

    it('handles a rejected server cancellation without an unhandled rejection', async () => {
      const cancellationError = new Error('cancel failed')
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      mockHandleElicitationRequest.mockImplementationOnce(() => new Promise(() => undefined))
      mockCancelElicitationRequest.mockRejectedValueOnce(cancellationError)
      const controller = new AbortController()
      const client = createMcpClient('server-one', {
        type: 'stdio'
      }) as unknown as {
        handleElicitationCreate(request: unknown, context: unknown): Promise<unknown>
      }

      const pending = client.handleElicitationCreate(
        {
          params: {
            mode: 'url',
            message: 'Open the authorization page',
            url: 'https://example.com/authorize'
          }
        },
        {
          mcpReq: {
            signal: controller.signal
          }
        }
      )
      controller.abort()

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(mockCancelElicitationRequest).toHaveBeenCalledWith(
        expect.any(String),
        'cancelled by server'
      )
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cancel elicitation request'),
        cancellationError
      )
      consoleWarnSpy.mockRestore()
    })
  })

  describe('Sampling support', () => {
    it('should prepare sampling payload and chat messages from request params', () => {
      const client = createMcpClient('server-one', {
        type: 'stdio',
        description: 'Sample server'
      })

      const params = {
        systemPrompt: 'You are a helpful assistant.',
        maxTokens: 128,
        modelPreferences: {
          costPriority: 0.5,
          hints: [{ name: 'fast' }, { name: null }]
        },
        messages: [
          { role: 'user', content: { type: 'text', text: 'hello' } },
          {
            role: 'assistant',
            content: { type: 'image', mimeType: 'image/jpeg', data: 'aGVsbG8=' }
          }
        ]
      }

      const { payload, chatMessages } = (client as any).prepareSamplingContext('req-123', params)

      expect(payload).toEqual({
        requestId: 'req-123',
        serverName: 'server-one',
        serverLabel: 'Sample server',
        systemPrompt: 'You are a helpful assistant.',
        maxTokens: 128,
        modelPreferences: {
          costPriority: 0.5,
          hints: [{ name: 'fast' }, { name: undefined }]
        },
        requiresVision: true,
        messages: [
          { role: 'user', type: 'text', text: 'hello' },
          {
            role: 'assistant',
            type: 'image',
            dataUrl: 'data:image/jpeg;base64,aGVsbG8=',
            mimeType: 'image/jpeg'
          }
        ]
      })

      expect(chatMessages).toEqual([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'data:image/jpeg;base64,aGVsbG8=', detail: 'auto' }
            }
          ]
        }
      ])
    })

    it('should default sampling image mime type to png when not provided', () => {
      const client = createMcpClient('server-two', {
        type: 'stdio'
      })

      const { payload } = (client as any).prepareSamplingContext('req-vision', {
        messages: [
          {
            role: 'user',
            content: { type: 'image', data: 'aGVsbG8=' }
          }
        ]
      })

      expect(payload.requiresVision).toBe(true)
      expect(payload.messages).toEqual([
        {
          role: 'user',
          type: 'image',
          dataUrl: 'data:image/png;base64,aGVsbG8=',
          mimeType: 'image/png'
        }
      ])
    })

    it('should throw when sampling image mime type is not allowed', () => {
      const client = createMcpClient('server-three', {
        type: 'stdio'
      })

      try {
        ;(client as any).prepareSamplingContext('req-bad-mime', {
          messages: [
            {
              role: 'user',
              content: { type: 'image', mimeType: 'image/svg+xml', data: 'aGVsbG8=' }
            }
          ]
        })
        throw new Error('Expected prepareSamplingContext to throw for disallowed mime type')
      } catch (error) {
        expect(error).toBeInstanceOf(ProtocolError)
        expect((error as ProtocolError).code).toBe(ProtocolErrorCode.InvalidParams)
        expect((error as Error).message).toContain(
          'Unsupported sampling image mime type: image/svg+xml'
        )
      }
    })

    it('should throw when sampling image data is not valid base64', () => {
      const client = createMcpClient('server-four', {
        type: 'stdio'
      })

      try {
        ;(client as any).prepareSamplingContext('req-bad-data', {
          messages: [
            {
              role: 'assistant',
              content: { type: 'image', data: 'not_base64!!' }
            }
          ]
        })
        throw new Error('Expected prepareSamplingContext to throw for invalid image data')
      } catch (error) {
        expect(error).toBeInstanceOf(ProtocolError)
        expect((error as ProtocolError).code).toBe(ProtocolErrorCode.InvalidParams)
        expect((error as Error).message).toContain('Invalid sampling image payload received')
      }
    })

    it('should return assistant response when sampling decision is approved', async () => {
      const client = createMcpClient('code-reviewer', {
        type: 'stdio',
        description: 'Code Reviewer Server'
      })

      mockHandleSamplingRequest.mockImplementation(async (payload) => ({
        requestId: payload.requestId,
        approved: true,
        providerId: 'provider-1',
        modelId: 'model-42'
      }))
      mockGenerateCompletionStandalone.mockResolvedValue('Generated response')
      mockGetProviderModels.mockReturnValue([{ id: 'model-42', name: 'Model Forty Two' }])
      mockGetCustomModels.mockReturnValue([])
      const signal = new AbortController().signal

      const request = {
        params: {
          maxTokens: 256,
          systemPrompt: 'System context',
          messages: [{ role: 'user', content: { type: 'text', text: 'Explain this change.' } }]
        }
      }

      const result = await (client as any).handleSamplingCreateMessage(request, {
        mcpReq: {
          id: 'rpc-001',
          signal
        }
      })

      expect(mockHandleSamplingRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: expect.any(String),
          serverName: 'code-reviewer'
        })
      )
      expect(mockGenerateCompletionStandalone).toHaveBeenCalledWith(
        'provider-1',
        [
          { role: 'system', content: 'System context' },
          { role: 'user', content: 'Explain this change.' }
        ],
        'model-42',
        undefined,
        256,
        { signal, swallowErrors: false }
      )

      expect(result).toEqual({
        role: 'assistant',
        model: 'Model Forty Two',
        stopReason: 'endTurn',
        content: { type: 'text', text: 'Generated response' }
      })
    })

    it('should throw when sampling decision is rejected by the user', async () => {
      const client = createMcpClient('code-reviewer', { type: 'stdio' })

      mockHandleSamplingRequest.mockImplementation(async (payload) => ({
        requestId: payload.requestId,
        approved: false
      }))

      const request = {
        params: {
          messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }]
        }
      }

      let caughtError: unknown
      try {
        await (client as any).handleSamplingCreateMessage(request, {
          mcpReq: {
            id: 'rpc-002',
            signal: new AbortController().signal
          }
        })
      } catch (error) {
        caughtError = error
      }

      expect(caughtError).toBeInstanceOf(Error)
      expect((caughtError as Error).message).toContain('User rejected sampling request')
      expect(caughtError).toHaveProperty('code', ProtocolErrorCode.InvalidRequest)

      expect(mockGenerateCompletionStandalone).not.toHaveBeenCalled()
    })

    it('observes a late sampling decision failure after the request was cancelled', async () => {
      let rejectDecision!: (reason?: unknown) => void
      const decision = new Promise<never>((_, reject) => {
        rejectDecision = reject
      })
      const client = createMcpClient('code-reviewer', { type: 'stdio' })
      const abortController = new AbortController()
      const lateError = new Error('late sampling decision failure')
      const unhandled = vi.fn()
      mockHandleSamplingRequest.mockReturnValue(decision)
      mockCancelSamplingRequest.mockResolvedValue(undefined)
      abortController.abort()

      await expect(
        (client as any).handleSamplingCreateMessage(
          {
            params: {
              messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }]
            }
          },
          {
            mcpReq: {
              id: 'rpc-cancelled',
              signal: abortController.signal
            }
          }
        )
      ).rejects.toMatchObject({ code: SdkErrorCode.RequestTimeout })
      const samplingRequestId = mockHandleSamplingRequest.mock.calls[0][0].requestId
      expect(mockCancelSamplingRequest).toHaveBeenCalledWith(
        samplingRequestId,
        'cancelled by server'
      )

      process.on('unhandledRejection', unhandled)
      try {
        rejectDecision(lateError)
        await new Promise<void>((resolve) => setImmediate(resolve))
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(unhandled.mock.calls.some(([reason]) => reason === lateError)).toBe(false)
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    it('forwards cancellation through sampling generation without wrapping AbortError', async () => {
      const client = createMcpClient('code-reviewer', { type: 'stdio' })
      const abortController = new AbortController()
      mockHandleSamplingRequest.mockImplementation(async (payload) => ({
        requestId: payload.requestId,
        approved: true,
        providerId: 'provider-1',
        modelId: 'model-42'
      }))
      mockCancelSamplingRequest.mockResolvedValue(undefined)
      mockGenerateCompletionStandalone.mockImplementation(
        (...args: unknown[]) =>
          new Promise((_, reject) => {
            const options = args[5] as { signal?: AbortSignal } | undefined
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
              once: true
            })
          })
      )

      const generating = (client as any).handleSamplingCreateMessage(
        {
          params: {
            messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }]
          }
        },
        {
          mcpReq: {
            id: 'rpc-generation-cancelled',
            signal: abortController.signal
          }
        }
      )
      await vi.waitFor(() => expect(mockGenerateCompletionStandalone).toHaveBeenCalledOnce())

      abortController.abort()

      await expect(generating).rejects.toMatchObject({ name: 'AbortError' })
      expect(mockGenerateCompletionStandalone).toHaveBeenCalledWith(
        'provider-1',
        expect.any(Array),
        'model-42',
        undefined,
        undefined,
        { signal: abortController.signal, swallowErrors: false }
      )
      const samplingRequestId = mockHandleSamplingRequest.mock.calls[0][0].requestId
      expect(mockCancelSamplingRequest).toHaveBeenCalledWith(
        samplingRequestId,
        'cancelled by server'
      )
    })
  })
})
