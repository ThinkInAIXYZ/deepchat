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

  it('filters disabled agent tools while preserving MCP tools', async () => {
    const mcpDefs = [buildToolDefinition('shared', 'mcp'), buildToolDefinition('mcp_only', 'mcp')]
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

    const defs = await toolPresenter.getAllToolDefinitions({
      disabledAgentTools: ['read', 'exec'],
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\\\workspace'
    })

    expect(defs.some((tool) => tool.function.name === 'mcp_only' && tool.source === 'mcp')).toBe(
      true
    )
    expect(defs.some((tool) => tool.function.name === 'read')).toBe(false)
    expect(defs.some((tool) => tool.function.name === 'exec')).toBe(false)
    expect(defs.some((tool) => tool.function.name === 'find')).toBe(false)
    expect(defs.some((tool) => tool.function.name === 'grep')).toBe(false)
    expect(defs.some((tool) => tool.function.name === 'ls')).toBe(false)
  })

  it('omits YoBrowser prompt text when no yobrowser tools are enabled', () => {
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
      } as any
    })

    const withoutYoBrowser = toolPresenter.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition('read', 'agent-filesystem'),
          source: 'agent'
        }
      ]
    })
    const withYoBrowser = toolPresenter.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition('read', 'agent-filesystem'),
          source: 'agent'
        },
        {
          ...buildToolDefinition('yo_browser_cdp_send', 'yobrowser'),
          source: 'agent'
        }
      ]
    })

    expect(withoutYoBrowser).not.toContain('YoBrowser')
    expect(withYoBrowser).toContain('YoBrowser')
    expect(withYoBrowser).toContain('yo_browser_cdp_send')
  })

  it('includes question guidance only when deepchat_question is enabled', () => {
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
      } as any
    })

    const withoutQuestion = toolPresenter.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition('read', 'agent-filesystem'),
          source: 'agent'
        }
      ]
    })
    const withQuestion = toolPresenter.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition('deepchat_question', 'agent-core'),
          source: 'agent'
        }
      ]
    })

    expect(withoutQuestion).not.toContain('deepchat_question')
    expect(withQuestion).toContain('deepchat_question')
  })

  it('guides search and directory discovery through exec', () => {
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
      } as any
    })

    const prompt = toolPresenter.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition('read', 'agent-filesystem'),
          source: 'agent'
        },
        {
          ...buildToolDefinition('edit', 'agent-filesystem'),
          source: 'agent'
        },
        {
          ...buildToolDefinition('write', 'agent-filesystem'),
          source: 'agent'
        },
        {
          ...buildToolDefinition('exec', 'agent-filesystem'),
          source: 'agent'
        },
        {
          ...buildToolDefinition('process', 'agent-filesystem'),
          source: 'agent'
        }
      ]
    })

    expect(prompt).toContain(
      'Use canonical Agent tool names only: read, write, edit, exec, process.'
    )
    expect(prompt).toContain(
      'Prefer shell patterns like `rg -n`, `rg --files`, `find . -name ...`, `ls`, and `tree` inside `exec`.'
    )
    expect(prompt).not.toContain('Use `read`/`find`/`grep`/`ls` for file inspection')
  })
})
