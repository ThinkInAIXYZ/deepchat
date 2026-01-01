import { describe, expect, it, vi } from 'vitest'
import type { MCPToolDefinition } from '@shared/presenter'
import { ToolPresenter } from '@/presenter/toolPresenter'

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP || process.env.TMP || 'C:\\\\temp'
  }
}))

const buildToolDefinition = (name: string, serverName: string): MCPToolDefinition => ({
  type: 'function',
  function: {
    name,
    description: `${name} tool`,
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  server: {
    name: serverName,
    icons: '',
    description: `${serverName} server`
  }
})

describe('ToolPresenter', () => {
  it('deduplicates agent tools when MCP tool names overlap', async () => {
    const mcpDefs = [buildToolDefinition('shared', 'mcp')]
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue(mcpDefs),
      callTool: vi.fn()
    } as any
    const yoBrowserPresenter = {
      getToolDefinitions: vi.fn().mockResolvedValue([buildToolDefinition('shared', 'yo-browser')])
    } as any

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      yoBrowserPresenter,
      configPresenter: {} as any
    })

    const defs = await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\\\workspace'
    })
    const sharedDefs = defs.filter((def) => def.function.name === 'shared')

    expect(sharedDefs).toHaveLength(1)
    expect(sharedDefs[0].server?.name).toBe('mcp')
  })

  it('falls back to jsonrepair when tool arguments are malformed', async () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const yoBrowserPresenter = {
      getToolDefinitions: vi.fn().mockResolvedValue([])
    } as any

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      yoBrowserPresenter,
      configPresenter: {} as any
    })

    await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\\\workspace'
    })

    const agentToolManager = (toolPresenter as any).agentToolManager
    const callToolSpy = vi.fn().mockResolvedValue('ok')
    agentToolManager.callTool = callToolSpy

    await toolPresenter.callTool({
      id: 'tool-1',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: '{"path":"foo",}'
      },
      conversationId: 'conv-1'
    })

    expect(callToolSpy).toHaveBeenCalledWith('read_file', { path: 'foo' }, 'conv-1')
  })
})
