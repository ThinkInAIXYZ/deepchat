import { describe, expect, it, vi } from 'vitest'
import type { MCPToolDefinition } from '@shared/presenter'
import { ToolPresenter } from '@/presenter/toolPresenter'
import { CommandPermissionService } from '@/presenter/permission'

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

    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getDefaultVisionModel: vi.fn(),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: {
        resolveConversationWorkdir: vi.fn().mockResolvedValue(null),
        getSkillPresenter: () =>
          ({
            getActiveSkills: vi.fn().mockResolvedValue([]),
            getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
            listSkillScripts: vi.fn().mockResolvedValue([]),
            getSkillExtension: vi.fn().mockResolvedValue({
              version: 1,
              env: {},
              runtimePolicy: { python: 'auto', node: 'auto' },
              scriptOverrides: {}
            })
          }) as any,
        getYoBrowserToolHandler: () => ({
          getToolDefinitions: vi
            .fn()
            .mockReturnValue([buildToolDefinition('shared', 'yo-browser')]),
          callTool: vi.fn()
        }),
        getFilePresenter: () => ({
          getMimeType: vi.fn(),
          prepareFileCompletely: vi.fn()
        }),
        getLlmProviderPresenter: () => ({
          generateCompletionStandalone: vi.fn()
        }),
        createSettingsWindow: vi.fn(),
        sendToWindow: vi.fn().mockReturnValue(true),
        getApprovedFilePaths: vi.fn().mockReturnValue([]),
        consumeSettingsApproval: vi.fn().mockReturnValue(false)
      }
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
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getDefaultVisionModel: vi.fn(),
      getModelConfig: vi.fn()
    }
    const runtimePort = {
      resolveConversationWorkdir: vi.fn().mockResolvedValue(null),
      getSkillPresenter: () =>
        ({
          getActiveSkills: vi.fn().mockResolvedValue([]),
          getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
          listSkillScripts: vi.fn().mockResolvedValue([]),
          getSkillExtension: vi.fn().mockResolvedValue({
            version: 1,
            env: {},
            runtimePolicy: { python: 'auto', node: 'auto' },
            scriptOverrides: {}
          })
        }) as any,
      getYoBrowserToolHandler: () => ({
        getToolDefinitions: vi.fn().mockReturnValue([]),
        callTool: vi.fn()
      }),
      getFilePresenter: () => ({
        getMimeType: vi.fn(),
        prepareFileCompletely: vi.fn()
      }),
      getLlmProviderPresenter: () => ({
        generateCompletionStandalone: vi.fn()
      }),
      createSettingsWindow: vi.fn(),
      sendToWindow: vi.fn().mockReturnValue(true),
      getApprovedFilePaths: vi.fn().mockReturnValue([]),
      consumeSettingsApproval: vi.fn().mockReturnValue(false)
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: runtimePort as any
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
        name: 'read',
        arguments: '{"path":"foo",}'
      },
      conversationId: 'conv-1'
    })

    expect(callToolSpy).toHaveBeenCalledWith('read', { path: 'foo' }, 'conv-1')
  })
})
