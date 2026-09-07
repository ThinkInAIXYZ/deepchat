import { describe, expect, it } from 'vitest'
import {
  createPersistedMcpToolResult,
  getToolUiResourceUri,
  getToolVisibility
} from '@/mcp/resultProjection'
import type { MCPServerConfig, Tool } from '@shared/types/mcp'

const config: MCPServerConfig = {
  command: 'node',
  args: [],
  env: {},
  descriptions: '',
  icons: '',
  enabled: true,
  type: 'stdio',
  serverId: '3e07aed8-9581-4e88-bf63-b46a9e17c921',
  configGeneration: 2,
  bindingHash: 'binding'
}

const createTool = (_meta?: Record<string, unknown>): Tool => ({
  name: 'chart',
  inputSchema: { type: 'object', properties: {} },
  _meta
})

describe('MCP result projection', () => {
  it('treats malformed App metadata as inert while preserving ordinary results', () => {
    const tool = createTool({
      ui: { resourceUri: 'https://example.com/app.html' },
      'ui/resourceUri': 'ui://legacy/index.html'
    })
    const persisted = createPersistedMcpToolResult({
      tool,
      config,
      serverName: 'fixture',
      result: { content: [{ type: 'text', text: 'ordinary result' }] }
    })

    expect(getToolUiResourceUri(tool)).toBeUndefined()
    expect(persisted).toMatchObject({
      content: [{ type: 'text', text: 'ordinary result' }]
    })
    expect(persisted?.app).toBeUndefined()
    expect(persisted?.truncated).toBeUndefined()
  })

  it('does not elevate an explicitly malformed visibility declaration', () => {
    expect(getToolVisibility(createTool())).toEqual(['model', 'app'])
    expect(getToolVisibility(createTool({ ui: { visibility: [] } }))).toEqual([])
    expect(
      getToolVisibility(createTool({ ui: { visibility: ['model', 'unknown', 'model'] } }))
    ).toEqual(['model'])
  })

  it('binds persisted App descriptors to immutable server identity', () => {
    const tool = createTool({
      ui: {
        resourceUri: 'ui://chart/index.html',
        visibility: ['app']
      }
    })

    expect(
      createPersistedMcpToolResult({
        tool,
        config,
        serverName: 'fixture',
        result: {
          content: [{ type: 'text', text: 'chart ready' }],
          structuredContent: { points: [1, 2, 3] }
        }
      })
    ).toMatchObject({
      serverId: config.serverId,
      configGeneration: 2,
      bindingHash: 'binding',
      app: {
        serverId: config.serverId,
        resourceUri: 'ui://chart/index.html'
      }
    })
  })

  it('preserves non-object structured content from the modern wire', () => {
    const persisted = createPersistedMcpToolResult({
      tool: createTool(),
      config,
      serverName: 'fixture',
      result: {
        content: [],
        structuredContent: ['north', 42, true]
      }
    })

    expect(persisted?.structuredContent).toEqual(['north', 42, true])
  })

  it('preserves __proto__ as inert structured data', () => {
    const persisted = createPersistedMcpToolResult({
      tool: createTool(),
      config,
      serverName: 'fixture',
      result: {
        content: [],
        structuredContent: JSON.parse('{"__proto__":{"polluted":true},"safe":1}')
      }
    })
    const structuredContent = persisted?.structuredContent as Record<string, unknown>

    expect(Object.prototype.hasOwnProperty.call(structuredContent, '__proto__')).toBe(true)
    expect(structuredContent['__proto__']).toEqual({ polluted: true })
    expect(Object.prototype).not.toHaveProperty('polluted')
  })
})
