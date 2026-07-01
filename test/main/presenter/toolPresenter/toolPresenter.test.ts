import { describe, expect, it, vi } from 'vitest'
import type { MCPToolDefinition } from '@shared/presenter'
import { ToolPresenter } from '@/presenter/toolPresenter'
import { TAPE_TOOL_NAMES, UPDATE_PLAN_TOOL_NAME } from '@/presenter/toolPresenter/agentTools'
import { CommandPermissionService } from '@/presenter/permission'
import { IMAGE_GENERATE_TOOL_NAME } from '@shared/agentImageGenerationTool'

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

const buildAgentToolRuntimeMock = (overrides: Record<string, unknown> = {}) =>
  ({
    resolveConversationWorkdir: vi.fn().mockResolvedValue(null),
    resolveConversationSessionInfo: vi.fn().mockResolvedValue(null),
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
      executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
      generateCompletionStandalone: vi.fn(),
      generateImageStandalone: vi.fn()
    }),
    createSettingsWindow: vi.fn(),
    sendToWindow: vi.fn().mockReturnValue(true),
    getApprovedFilePaths: vi.fn().mockReturnValue([]),
    consumeSettingsApproval: vi.fn().mockReturnValue(false),
    ...overrides
  }) as any

describe('ToolPresenter', () => {
  it('reserves image_generate for the built-in agent tool when MCP exposes the same name', async () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi
        .fn()
        .mockResolvedValue([buildToolDefinition(IMAGE_GENERATE_TOOL_NAME, 'mcp-images')]),
      callTool: vi.fn()
    } as any

    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })

    const defs = await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\\\workspace'
    })
    const imageGenerateDefs = defs.filter((def) => def.function.name === IMAGE_GENERATE_TOOL_NAME)

    expect(imageGenerateDefs).toHaveLength(1)
    expect(imageGenerateDefs[0].source).toBe('agent')
    expect(imageGenerateDefs[0].server.name).toBe('agent-image-generation')

    const agentToolManager = (toolPresenter as any).agentToolManager
    const callToolSpy = vi.fn().mockResolvedValue('agent-image')
    agentToolManager.callTool = callToolSpy

    await toolPresenter.callTool({
      id: 'tool-1',
      type: 'function',
      function: {
        name: IMAGE_GENERATE_TOOL_NAME,
        arguments: '{"prompt":"sunset"}'
      },
      conversationId: 'conv-1'
    })

    expect(callToolSpy).toHaveBeenCalledWith(
      IMAGE_GENERATE_TOOL_NAME,
      { prompt: 'sunset' },
      'conv-1',
      expect.objectContaining({
        toolCallId: 'tool-1'
      })
    )
    expect(mcpPresenter.callTool).not.toHaveBeenCalled()
  })

  it('deduplicates agent tools when MCP tool names overlap', async () => {
    const mcpDefs = [buildToolDefinition('shared', 'mcp')]
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue(mcpDefs),
      callTool: vi.fn()
    } as any

    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock({
        getYoBrowserToolHandler: () => ({
          getToolDefinitions: vi
            .fn()
            .mockReturnValue([buildToolDefinition('shared', 'yo-browser')]),
          callTool: vi.fn()
        })
      })
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

  it('clears only agent plan state without clearing tool mappings', async () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })
    await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\\\workspace'
    })
    const agentToolManager = (toolPresenter as any).agentToolManager
    agentToolManager.clearPlanState = vi.fn()

    toolPresenter.clearAgentPlanState(' conv-1 ')

    expect(agentToolManager.clearPlanState).toHaveBeenCalledWith('conv-1')
  })

  it('falls back to jsonrepair when tool arguments are malformed', async () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getModelConfig: vi.fn()
    }
    const runtimePort = buildAgentToolRuntimeMock()

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: runtimePort
    })

    await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\\\workspace'
    })

    const agentToolManager = (toolPresenter as any).agentToolManager
    const callToolSpy = vi.fn().mockResolvedValue('ok')
    agentToolManager.callTool = callToolSpy

    const result = await toolPresenter.callTool({
      id: 'tool-1',
      type: 'function',
      function: {
        name: 'read',
        arguments: '{"path":"foo",}'
      },
      conversationId: 'conv-1'
    })

    expect(result.rawData.toolResult).toMatchObject({
      ok: true,
      data: {
        content: 'ok',
        source: 'agent'
      }
    })
    callToolSpy.mockResolvedValueOnce({
      rawData: {
        content: 'from-raw'
      }
    })
    const rawOnlyResult = await toolPresenter.callTool({
      id: 'tool-2',
      type: 'function',
      function: {
        name: 'read',
        arguments: '{"path":"bar"}'
      },
      conversationId: 'conv-1'
    })

    expect(rawOnlyResult.content).toBe('from-raw')
    expect(callToolSpy).toHaveBeenCalledWith(
      'read',
      { path: 'foo' },
      'conv-1',
      expect.objectContaining({
        toolCallId: 'tool-1'
      })
    )
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
      getModelConfig: vi.fn()
    }
    const runtimePort = buildAgentToolRuntimeMock()

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: runtimePort
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
    expect(defs.some((tool) => tool.function.name === 'glob')).toBe(true)
    expect(defs.some((tool) => tool.function.name === 'grep')).toBe(true)
    expect(defs.some((tool) => tool.function.name === 'find')).toBe(false)
    expect(defs.some((tool) => tool.function.name === 'ls')).toBe(false)
  })

  it('passes DeepChat agent MCP policy context to MCP presenter', async () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\skills'),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })

    await toolPresenter.getAllToolDefinitions({
      agentId: 'agent-1',
      enabledMcpServerIds: ['server-a'],
      enabledPluginIds: ['plugin-a'],
      chatMode: 'agent',
      conversationId: 'session-1'
    })

    expect(mcpPresenter.getAllToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        enabledServerIds: ['server-a'],
        enabledPluginIds: ['plugin-a'],
        conversationId: 'session-1'
      })
    )
  })

  it('preserves unrestricted MCP policy in stored conversation context', async () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi
        .fn()
        .mockResolvedValue([buildToolDefinition('mcp_only', 'open-server')]),
      callTool: vi.fn().mockResolvedValue({ content: 'ok' })
    } as any
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\skills'),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })

    await toolPresenter.getAllToolDefinitions({
      agentId: 'agent-1',
      enabledMcpServerIds: undefined,
      enabledPluginIds: undefined,
      chatMode: 'agent',
      conversationId: 'session-unrestricted'
    })

    await toolPresenter.callTool({
      id: 'tool-1',
      type: 'function',
      function: {
        name: 'mcp_only',
        arguments: '{}'
      },
      server: {
        name: 'open-server'
      },
      conversationId: 'session-unrestricted'
    } as any)

    expect(mcpPresenter.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'session-unrestricted' }),
      expect.objectContaining({
        agentId: 'agent-1',
        enabledServerIds: undefined,
        enabledPluginIds: undefined
      })
    )
  })

  it('omits YoBrowser prompt text when no yobrowser tools are enabled', () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
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
          ...buildToolDefinition('load_url', 'yobrowser'),
          source: 'agent'
        },
        {
          ...buildToolDefinition('cdp_send', 'yobrowser'),
          source: 'agent'
        }
      ]
    })

    expect(withoutYoBrowser).not.toContain('YoBrowser')
    expect(withYoBrowser).toContain('YoBrowser')
    expect(withYoBrowser).toContain('cdp_send')
    expect(withYoBrowser).toContain(
      'Prefer `load_url` to create the session browser and handle navigation.'
    )
    expect(withYoBrowser).toContain(
      'Avoid using `cdp_send` `Page.navigate` for normal navigation unless needed.'
    )
    expect(withYoBrowser).toContain(
      'If `cdp_send` reports `yobrowser_unavailable`, call `get_browser_status`, then use `load_url` with the target URL when available.'
    )
  })

  it('includes question guidance only when deepchat_question is enabled', () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
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

    expect(withoutQuestion).not.toContain('## User Interaction')
    expect(withQuestion).toContain('## User Interaction')
    expect(withQuestion).toContain(
      'Use `deepchat_question` when missing user preferences, implementation direction, output shape, or risk decisions would materially change the result.'
    )
    expect(withQuestion).toContain(
      'Do not ask for facts you can discover from the repo, tools, or existing conversation context.'
    )
    expect(withQuestion).toContain(
      'Ask exactly one question per `deepchat_question` call. If multiple clarifications are needed, split them into multiple tool calls.'
    )
    expect(withQuestion).toContain(
      'Do not send `questions`, `allowOther`, or stringified `options` JSON.'
    )
  })

  it('includes progress guidance only when update_plan is enabled', () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })

    const withoutProgress = toolPresenter.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition('read', 'agent-filesystem'),
          source: 'agent'
        }
      ]
    })
    const withProgress = toolPresenter.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition(UPDATE_PLAN_TOOL_NAME, 'agent-core'),
          source: 'agent'
        }
      ]
    })

    expect(withoutProgress).not.toContain('## Progress Checklist Tool')
    expect(withProgress).toContain('## Progress Checklist Tool')
    expect(withProgress).toContain('Use `update_plan` for non-trivial multi-step tasks.')
    expect(withProgress).toContain('At most one step may be in_progress at a time.')
    expect(withProgress).toContain('Before ending the turn, reconcile the checklist')
  })

  it('describes only enabled tape tools in the tape prompt', () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })

    const prompt = toolPresenter.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition(TAPE_TOOL_NAMES.info, 'agent-tape'),
          source: 'agent'
        },
        {
          ...buildToolDefinition(TAPE_TOOL_NAMES.anchors, 'agent-tape'),
          source: 'agent'
        }
      ]
    })

    expect(prompt).toContain('## Tape Tools')
    expect(prompt).toContain('`tape_info` inspects')
    expect(prompt).toContain('`tape_anchors` lists')
    expect(prompt).not.toContain('`tape_search` supports')
    expect(prompt).not.toContain('`tape_context` expands')
    expect(prompt).not.toContain('`tape_handoff` writes')
  })

  it('describes tape_context only when the context tool is enabled', () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })

    const prompt = toolPresenter.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition(TAPE_TOOL_NAMES.search, 'agent-tape'),
          source: 'agent'
        },
        {
          ...buildToolDefinition(TAPE_TOOL_NAMES.context, 'agent-tape'),
          source: 'agent'
        }
      ]
    })

    expect(prompt).toContain('`tape_context` expands selected `entryIds`')
    expect(prompt).toContain('compact `tape_search` results')
    expect(prompt).toContain('bounded evidence/context')
    expect(prompt).toContain('without dumping raw payloads')
  })

  it('describes the question schema and returns actionable validation errors', async () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getModelConfig: vi.fn()
    }
    const runtimePort = buildAgentToolRuntimeMock()

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: runtimePort
    })

    const defs = await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\\\workspace'
    })
    const questionDef = defs.find((def) => def.function.name === 'deepchat_question')

    expect(questionDef?.function.description).toContain('one structured clarification question')
    expect(questionDef?.function.description).toContain(
      'The loop resumes only after the user responds.'
    )
    expect((questionDef?.function.parameters as any)?.description).toContain(
      'Ask exactly one blocking clarification question.'
    )
    expect((questionDef?.function.parameters as any)?.properties?.options?.description).toContain(
      'Do not pass a stringified JSON array.'
    )
    expect((questionDef?.function.parameters as any)?.properties?.custom?.description).toContain(
      'The field name is `custom`, not `allowOther`.'
    )

    await expect(
      toolPresenter.callTool({
        id: 'tool-1',
        type: 'function',
        function: {
          name: 'deepchat_question',
          arguments: JSON.stringify({
            questions: [
              {
                question: 'Pick one',
                options: [{ label: 'A' }]
              }
            ]
          })
        },
        conversationId: 'conv-1'
      })
    ).rejects.toThrow(
      'Use a single object with `header?`, `question`, `options`, `multiple?`, and `custom?`.'
    )
  })

  it('guides search and directory discovery through exec', () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const configPresenter = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
      getModelConfig: vi.fn()
    }

    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: configPresenter as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })

    const promptWithoutFocusedTools = toolPresenter.buildToolSystemPrompt({
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
          ...buildToolDefinition('glob', 'agent-filesystem'),
          source: 'agent'
        },
        {
          ...buildToolDefinition('grep', 'agent-filesystem'),
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
    expect(promptWithoutFocusedTools).toContain(
      'Use canonical Agent tool names only: read, write, edit, glob, grep, exec, process.'
    )
    expect(promptWithoutFocusedTools).toContain(
      'Use `glob` for file discovery and `grep` for content search; both return structured JSON.'
    )
    expect(promptWithoutFocusedTools).toContain(
      'Search order: `glob(query)` -> choose relevant `pathScope` -> `grep(query, pathScope, contextLines)` -> `read` concrete files.'
    )
    expect(promptWithoutFocusedTools).toContain(
      'Recommended file task flow: `glob` / `grep` -> `read` -> `edit`/`write`.'
    )
    expect(promptWithoutFocusedTools).not.toContain('rg -n')
    expect(promptWithoutFocusedTools).not.toContain('rg --files')

    const grepOnlyPrompt = toolPresenter.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition('grep', 'agent-filesystem'),
          source: 'agent'
        }
      ]
    })
    expect(grepOnlyPrompt).toContain(
      'Use `grep` for content search; it returns structured JSON and supports `mode: "regex"` for regular expressions.'
    )
    expect(grepOnlyPrompt).not.toContain('Search order: `glob(query)`')
  })
})
