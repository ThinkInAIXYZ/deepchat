import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { McpClient } from '../../../src/main/presenter/mcpPresenter/mcpClient'
import path from 'path'
import fs from 'fs'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

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
  default: {
    existsSync: vi.fn()
  }
}))

// Mock eventBus
vi.mock('../../../src/main/eventbus', () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn()
  }
}))

// Mock presenter
const presenterMocks = vi.hoisted(() => ({
  handleSamplingRequest: vi.fn(),
  cancelSamplingRequest: vi.fn(),
  generateCompletionStandalone: vi.fn(),
  getProviderModels: vi.fn(),
  getCustomModels: vi.fn()
}))

vi.mock('../../../src/main/presenter', () => ({
  presenter: {
    configPresenter: {
      getMcpServers: vi.fn(),
      getProviderModels: presenterMocks.getProviderModels,
      getCustomModels: presenterMocks.getCustomModels
    },
    mcpPresenter: {
      handleSamplingRequest: presenterMocks.handleSamplingRequest,
      cancelSamplingRequest: presenterMocks.cancelSamplingRequest
    },
    llmproviderPresenter: {
      generateCompletionStandalone: presenterMocks.generateCompletionStandalone
    }
  }
}))

const mockHandleSamplingRequest = presenterMocks.handleSamplingRequest
const mockCancelSamplingRequest = presenterMocks.cancelSamplingRequest
const mockGenerateCompletionStandalone = presenterMocks.generateCompletionStandalone
const mockGetProviderModels = presenterMocks.getProviderModels
const mockGetCustomModels = presenterMocks.getCustomModels

// Mock other dependencies that might be imported by mcpClient
vi.mock('../../../src/main/events', () => ({
  MCP_EVENTS: {
    SERVER_STATUS_CHANGED: 'server-status-changed'
  }
}))

vi.mock('../../../src/main/presenter/mcpPresenter/inMemoryServers/builder', () => ({
  getInMemoryServer: vi.fn()
}))

// Mock MCP SDK modules
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    callTool: vi.fn(),
    listTools: vi.fn(),
    listPrompts: vi.fn(),
    getPrompt: vi.fn(),
    listResources: vi.fn(),
    readResource: vi.fn()
  }))
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn()
}))

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn()
}))

vi.mock('@modelcontextprotocol/sdk/inMemory.js', () => ({
  InMemoryTransport: {
    createLinkedPair: vi.fn(() => [vi.fn(), vi.fn()])
  }
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn()
}))

describe('McpClient Runtime Command Processing Tests', () => {
  let mockFsExistsSync: any

  beforeEach(() => {
    mockFsExistsSync = vi.mocked(fs.existsSync)
    vi.clearAllMocks()

    mockHandleSamplingRequest.mockReset()
    mockCancelSamplingRequest.mockReset()
    mockGenerateCompletionStandalone.mockReset()
    mockGetProviderModels.mockReset()
    mockGetCustomModels.mockReset()

    // Mock runtime paths to exist
    mockFsExistsSync.mockImplementation((filePath: string | Buffer | URL) => {
      const pathStr = String(filePath)
      return pathStr.includes('runtime/bun') || pathStr.includes('runtime/uv')
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('NPX to Bun X Command Translation', () => {
    it('should convert npx command to bun x with correct arguments for everything server', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything']
      }

      const client = new McpClient('everything', serverConfig)

      // Access private method for testing
      const processedCommand = (client as any).processCommandWithArgs('npx', [
        '-y',
        '@modelcontextprotocol/server-everything'
      ])

      // Should convert npx to bun and add 'x' as first argument
      expect(processedCommand.command).toContain('bun')
      expect(processedCommand.args).toEqual(['x', '-y', '@modelcontextprotocol/server-everything'])
    })

    it('should handle npx command with runtime path replacement', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything']
      }

      const client = new McpClient('everything', serverConfig)

      // Mock the runtime path for testing
      const bunRuntimePath = path
        .join('/mock/app/runtime/bun')
        .replace('app.asar', 'app.asar.unpacked')
      ;(client as any).bunRuntimePath = bunRuntimePath

      const processedCommand = (client as any).processCommandWithArgs('npx', [
        '-y',
        '@modelcontextprotocol/server-everything'
      ])

      // Should use the runtime path
      const expectedBunPath =
        process.platform === 'win32'
          ? path.join(bunRuntimePath, 'bun.exe')
          : path.join(bunRuntimePath, 'bun')

      expect(processedCommand.command).toBe(expectedBunPath)
      expect(processedCommand.args).toEqual(['x', '-y', '@modelcontextprotocol/server-everything'])
    })

    it('should handle npx in command path correctly', () => {
      const serverConfig = {
        type: 'stdio',
        command: '/usr/local/bin/npx',
        args: ['-y', '@modelcontextprotocol/server-everything']
      }

      const client = new McpClient('everything', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('/usr/local/bin/npx', [
        '-y',
        '@modelcontextprotocol/server-everything'
      ])

      // Should still convert to bun x regardless of npx path
      expect(processedCommand.command).toContain('bun')
      expect(processedCommand.args).toEqual(['x', '-y', '@modelcontextprotocol/server-everything'])
    })
  })

  describe('UVX Command Processing', () => {
    it('should preserve uvx command without modification for osm-mcp-server', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'uvx',
        args: ['osm-mcp-server']
      }

      const client = new McpClient('osm-mcp-server', serverConfig)

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

      const client = new McpClient('osm-mcp-server', serverConfig)

      // Mock the runtime path for testing
      const uvRuntimePath = path
        .join('/mock/app/runtime/uv')
        .replace('app.asar', 'app.asar.unpacked')
      ;(client as any).uvRuntimePath = uvRuntimePath

      const processedCommand = (client as any).processCommandWithArgs('uvx', ['osm-mcp-server'])

      // Should use the runtime path
      const expectedUvxPath =
        process.platform === 'win32'
          ? path.join(uvRuntimePath, 'uvx.exe')
          : path.join(uvRuntimePath, 'uvx')

      expect(processedCommand.command).toBe(expectedUvxPath)
      expect(processedCommand.args).toEqual(['osm-mcp-server'])
    })

    it('should handle uvx in command path correctly', () => {
      const serverConfig = {
        type: 'stdio',
        command: '/usr/local/bin/uvx',
        args: ['osm-mcp-server']
      }

      const client = new McpClient('osm-mcp-server', serverConfig)

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

      const client = new McpClient('test', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('node', ['server.js'])

      // Should replace node with bun
      expect(processedCommand.command).toContain('bun')
      expect(processedCommand.args).toEqual(['server.js']) // No 'x' prefix for node
    })

    it('should handle npm command replacement with bun', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'npm',
        args: ['start']
      }

      const client = new McpClient('test', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('npm', ['start'])

      // Should replace npm with bun
      expect(processedCommand.command).toContain('bun')
      expect(processedCommand.args).toEqual(['start']) // No 'x' prefix for npm
    })

    it('should handle uv command replacement correctly', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'uv',
        args: ['run', 'server.py']
      }

      const client = new McpClient('test', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('uv', ['run', 'server.py'])

      // Should replace uv with runtime uv
      expect(processedCommand.command).toContain('uv')
      expect(processedCommand.args).toEqual(['run', 'server.py'])
    })

    it('should not modify unknown commands', () => {
      const serverConfig = {
        type: 'stdio',
        command: 'python',
        args: ['server.py']
      }

      const client = new McpClient('test', serverConfig)

      const processedCommand = (client as any).processCommandWithArgs('python', ['server.py'])

      // Should keep python command as is
      expect(processedCommand.command).toBe('python')
      expect(processedCommand.args).toEqual(['server.py'])
    })
  })

  describe('Runtime Path Detection', () => {
    it('should detect bun runtime when files exist', () => {
      mockFsExistsSync.mockImplementation((filePath: string | Buffer | URL) => {
        const pathStr = String(filePath)
        return pathStr.includes('runtime/bun/bun')
      })

      const client = new McpClient('test', { type: 'stdio' })

      // Check if bun runtime path is set
      expect((client as any).bunRuntimePath).toBeTruthy()
    })

    it('should detect uv runtime when files exist', () => {
      mockFsExistsSync.mockImplementation((filePath: string | Buffer | URL) => {
        const pathStr = String(filePath)
        return pathStr.includes('runtime/uv/uv')
      })

      const client = new McpClient('test', { type: 'stdio' })

      // Check if uv runtime path is set
      expect((client as any).uvRuntimePath).toBeTruthy()
    })

    it('should handle missing runtime files gracefully', () => {
      mockFsExistsSync.mockReturnValue(false)

      const client = new McpClient('test', { type: 'stdio' })

      // Should not set runtime paths when files don't exist
      expect((client as any).bunRuntimePath).toBeNull()
      expect((client as any).uvRuntimePath).toBeNull()
    })
  })

  describe('Environment Variable Processing', () => {
    it('should set npm registry environment variables', () => {
      const client = new McpClient('test', { type: 'stdio' }, 'https://registry.npmmirror.com')

      // Check if npm registry is stored
      expect((client as any).npmRegistry).toBe('https://registry.npmmirror.com')
    })

    it('should handle null npm registry', () => {
      const client = new McpClient('test', { type: 'stdio' }, null)

      // Should handle null registry gracefully
      expect((client as any).npmRegistry).toBeNull()
    })
  })

  describe('Path Expansion', () => {
    it('should expand tilde (~) in paths', () => {
      const client = new McpClient('test', { type: 'stdio' })

      const expandedPath = (client as any).expandPath('~/test/path')

      expect(expandedPath).toBe('/mock/home/test/path')
    })

    it('should expand environment variables in paths', () => {
      // Set mock environment variable
      process.env.TEST_VAR = '/test/value'

      const client = new McpClient('test', { type: 'stdio' })

      const expandedPath = (client as any).expandPath('/path/${TEST_VAR}/file')

      expect(expandedPath).toBe('/path//test/value/file')

      // Clean up
      delete process.env.TEST_VAR
    })

    it('should handle simple $VAR format', () => {
      // Set mock environment variable
      process.env.TEST_PATH = '/simple/test'

      const client = new McpClient('test', { type: 'stdio' })

      const expandedPath = (client as any).expandPath('/path/$TEST_PATH/file')

      expect(expandedPath).toBe('/path//simple/test/file')

      // Clean up
      delete process.env.TEST_PATH
    })
  })

  describe('Sampling support', () => {
    it('should prepare sampling payload and chat messages from request params', () => {
      const client = new McpClient('server-one', {
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
      const client = new McpClient('server-two', {
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
      const client = new McpClient('server-three', {
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
        expect(error).toBeInstanceOf(McpError)
        expect((error as McpError).code).toBe(ErrorCode.InvalidParams)
        expect((error as Error).message).toContain(
          'Unsupported sampling image mime type: image/svg+xml'
        )
      }
    })

    it('should throw when sampling image data is not valid base64', () => {
      const client = new McpClient('server-four', {
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
        expect(error).toBeInstanceOf(McpError)
        expect((error as McpError).code).toBe(ErrorCode.InvalidParams)
        expect((error as Error).message).toContain('Invalid sampling image payload received')
      }
    })

    it('should return assistant response when sampling decision is approved', async () => {
      const client = new McpClient('code-reviewer', {
        type: 'stdio',
        description: 'Code Reviewer Server'
      })

      mockHandleSamplingRequest.mockResolvedValue({
        requestId: 'rpc-001',
        approved: true,
        providerId: 'provider-1',
        modelId: 'model-42'
      })
      mockGenerateCompletionStandalone.mockResolvedValue('Generated response')
      mockGetProviderModels.mockReturnValue([{ id: 'model-42', name: 'Model Forty Two' }])
      mockGetCustomModels.mockReturnValue([])

      const request = {
        params: {
          maxTokens: 256,
          systemPrompt: 'System context',
          messages: [{ role: 'user', content: { type: 'text', text: 'Explain this change.' } }]
        }
      }

      const result = await (client as any).handleSamplingCreateMessage(request, {
        requestId: 'rpc-001'
      })

      expect(mockHandleSamplingRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'rpc-001',
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
        256
      )

      expect(result).toEqual({
        role: 'assistant',
        model: 'Model Forty Two',
        stopReason: 'endTurn',
        content: { type: 'text', text: 'Generated response' }
      })
    })

    it('should throw when sampling decision is rejected by the user', async () => {
      const client = new McpClient('code-reviewer', { type: 'stdio' })

      mockHandleSamplingRequest.mockResolvedValue({
        requestId: 'rpc-002',
        approved: false
      })

      const request = {
        params: {
          messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }]
        }
      }

      let caughtError: unknown
      try {
        await (client as any).handleSamplingCreateMessage(request, { requestId: 'rpc-002' })
      } catch (error) {
        caughtError = error
      }

      expect(caughtError).toBeInstanceOf(Error)
      expect((caughtError as Error).message).toContain('User rejected sampling request')
      expect(caughtError).toHaveProperty('code', ErrorCode.InvalidRequest)

      expect(mockGenerateCompletionStandalone).not.toHaveBeenCalled()
    })
  })
})
