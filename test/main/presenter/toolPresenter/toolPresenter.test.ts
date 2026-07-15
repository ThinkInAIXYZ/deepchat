import { describe, expect, it, vi } from 'vitest'
import type { MCPToolDefinition } from '@shared/presenter'
import { ToolPresenter } from '@/presenter/toolPresenter'
import { createToolCatalogPort } from '@/presenter/agentRuntimePresenter/toolAdapters'
import {
  CronJobToolHandler,
  TAPE_TOOL_NAMES,
  UPDATE_PLAN_TOOL_NAME
} from '@/presenter/toolPresenter/agentTools'
import { CommandPermissionService } from '@/presenter/permission'
import { QUESTION_TOOL_NAME } from '@/presenter/toolPresenter/agentTools/questionTool'
import { IMAGE_GENERATE_TOOL_NAME } from '@shared/agentImageGenerationTool'
import {
  CRON_JOB_AGENT_TOOL_NAME,
  assertAgentToolExposure,
  getAgentToolExposure
} from '@shared/agentTools'

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

const cronJobFixture = {
  id: 'job-1',
  name: 'Daily summary',
  description: null,
  enabled: true,
  status: 'ready',
  cronExpr: '0 9 * * *',
  timezone: 'UTC',
  agentId: 'deepchat',
  nextRunAt: 10,
  misfirePolicy: 'skip',
  maxCatchUpRuns: null,
  scheduleError: null,
  taskPrompt: 'P'.repeat(800),
  taskSystemInstruction: 'S'.repeat(800),
  taskOutputMode: 'final_message',
  modelPolicy: 'follow_agent',
  toolPolicy: 'follow_agent',
  permissionPolicy: 'follow_agent',
  runtime: {
    maxDurationMs: 3_600_000,
    maxTurns: 20,
    concurrencyPolicy: 'skip'
  },
  agentSnapshot: null,
  delivery: {
    targets: [
      {
        type: 'remote',
        remoteId: 'feishu',
        channelId: 'channel-1',
        mode: 'summary'
      }
    ],
    suppressSuccessNotification: false,
    notifyOnFailure: true
  },
  createdAt: 1,
  updatedAt: 2
} as any

const cronJobRunFixture = {
  id: 'run-1',
  jobId: 'job-1',
  sessionId: 'session-1',
  scheduledAt: 10,
  queuedAt: 10,
  startedAt: 11,
  completedAt: 12,
  status: 'completed',
  reason: 'manual',
  outputMessageId: 'message-1',
  outputPreview: 'Done',
  error: null,
  claimedAt: 10,
  claimOwner: 'owner',
  createdAt: 10,
  updatedAt: 12
} as any

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

  it('keeps every Tape capability name reserved against same-name MCP tools', async () => {
    const tapeToolNames = new Set<string>(Object.values(TAPE_TOOL_NAMES))
    const toolPresenter = new ToolPresenter({
      mcpPresenter: {
        getAllToolDefinitions: vi
          .fn()
          .mockResolvedValue(
            Object.values(TAPE_TOOL_NAMES).map((name) => buildToolDefinition(name, 'untrusted-mcp'))
          )
      } as any,
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getSkillsPath: vi.fn().mockReturnValue('C:\\skills'),
        getModelConfig: vi.fn()
      } as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })

    const defs = await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace'
    })

    expect(defs.some((definition) => tapeToolNames.has(definition.function.name))).toBe(false)
  })

  it('keeps ToolPresenter collision resolution behind the DeepChat catalog port', async () => {
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

    const catalog = createToolCatalogPort({
      toolPresenter,
      resolveContext: async () => ({
        profile: 'code' as const,
        fingerprint: 'revision:1',
        context: {
          chatMode: 'agent' as const,
          supportsVision: false,
          agentWorkspacePath: 'C:\\\\workspace'
        }
      }),
      commitCache: vi.fn()
    })
    const defs = await catalog.resolve()
    const sharedDefs = defs.filter((def) => def.function.name === 'shared')

    expect(sharedDefs).toHaveLength(1)
    expect(sharedDefs[0].server?.name).toBe('mcp')
  })

  it('keeps concurrent catalog resolutions isolated for the same conversation', async () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
        getModelConfig: vi.fn()
      } as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })
    const agentToolManager = (toolPresenter as any).ensureAgentToolManager('C:\\\\workspace')
    let resolveFirst!: (tools: MCPToolDefinition[]) => void
    let resolveSecond!: (tools: MCPToolDefinition[]) => void
    const firstAgentTools = new Promise<MCPToolDefinition[]>((resolve) => {
      resolveFirst = resolve
    })
    const secondAgentTools = new Promise<MCPToolDefinition[]>((resolve) => {
      resolveSecond = resolve
    })
    const getAgentToolDefinitions = vi
      .spyOn(agentToolManager, 'getAllToolDefinitions')
      .mockReturnValueOnce(firstAgentTools)
      .mockReturnValueOnce(secondAgentTools)
    const context = {
      chatMode: 'agent' as const,
      supportsVision: false,
      agentWorkspacePath: 'C:\\\\workspace',
      conversationId: 'conversation-1'
    }

    const firstResolution = toolPresenter.getAllToolDefinitions(context)
    const secondResolution = toolPresenter.getAllToolDefinitions(context)
    await vi.waitFor(() => expect(getAgentToolDefinitions).toHaveBeenCalledTimes(2))

    const agentTools = [buildToolDefinition('read', 'agent-filesystem')]
    resolveFirst(agentTools)
    await expect(firstResolution).resolves.toMatchObject([
      { source: 'agent', function: { name: 'read' } }
    ])
    resolveSecond(agentTools)
    await expect(secondResolution).resolves.toMatchObject([
      { source: 'agent', function: { name: 'read' } }
    ])

    const callTool = vi.fn().mockResolvedValue('ok')
    agentToolManager.callTool = callTool
    await toolPresenter.callTool({
      id: 'tool-1',
      type: 'function',
      function: { name: 'read', arguments: '{}' },
      conversationId: 'conversation-1'
    })

    expect(callTool).toHaveBeenCalledWith(
      'read',
      {},
      'conversation-1',
      expect.objectContaining({ toolCallId: 'tool-1' })
    )
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
    const runtimePort = buildAgentToolRuntimeMock({
      listCronJobs: vi.fn().mockResolvedValue({ jobs: [], schedulerStatus: { state: 'idle' } }),
      previewCronSchedule: vi.fn().mockResolvedValue({ runs: [], error: null })
    })

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

  it('uses one exposure policy for Tape tools and defaults existing tools to configurable', () => {
    expect(getAgentToolExposure(TAPE_TOOL_NAMES.search)).toBe('system-model')
    expect(getAgentToolExposure(TAPE_TOOL_NAMES.context)).toBe('system-model')
    expect(getAgentToolExposure(TAPE_TOOL_NAMES.info)).toBe('diagnostic')
    expect(getAgentToolExposure(TAPE_TOOL_NAMES.anchors)).toBe('diagnostic')
    expect(getAgentToolExposure(TAPE_TOOL_NAMES.handoff)).toBe('runtime-only')
    expect(getAgentToolExposure('read')).toBe('user-configurable')
    expect(getAgentToolExposure('__proto__')).toBe('user-configurable')
    expect(() => assertAgentToolExposure(TAPE_TOOL_NAMES.handoff, 'user-configurable')).toThrow(
      "Agent tool exposure mismatch for 'tape_handoff': expected 'user-configurable', registered 'runtime-only'."
    )
  })

  it('keeps the recall pair in the runtime catalog despite stale disabled values', async () => {
    const toolPresenter = new ToolPresenter({
      mcpPresenter: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([])
      } as any,
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getSkillsPath: vi.fn().mockReturnValue('C:\\skills'),
        getModelConfig: vi.fn()
      } as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock({
        resolveConversationSessionInfo: vi.fn().mockResolvedValue({ agentType: 'deepchat' }),
        getTapeInfo: vi.fn(),
        searchTape: vi.fn(),
        getTapeContext: vi.fn(),
        listTapeAnchors: vi.fn(),
        handoffTape: vi.fn()
      })
    })

    const defs = await toolPresenter.getAllToolDefinitions({
      disabledAgentTools: Object.values(TAPE_TOOL_NAMES),
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\runtime-workspace',
      conversationId: 'conv-1'
    })
    const names = defs.map((tool) => tool.function.name)

    expect(names).toEqual(expect.arrayContaining([TAPE_TOOL_NAMES.search, TAPE_TOOL_NAMES.context]))
    expect(names).not.toContain(TAPE_TOOL_NAMES.info)
    expect(names).not.toContain(TAPE_TOOL_NAMES.anchors)
    expect(names).not.toContain(TAPE_TOOL_NAMES.handoff)
  })

  it('reads configurable definitions without publishing mappings or mutating runtime context', async () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi
        .fn()
        .mockResolvedValue([buildToolDefinition('mcp_only', 'mcp-server')]),
      callTool: vi.fn().mockResolvedValue({ content: 'mcp-result' })
    } as any
    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getSkillsPath: vi.fn().mockReturnValue('C:\\skills'),
        getModelConfig: vi.fn()
      } as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock({
        resolveConversationSessionInfo: vi.fn().mockResolvedValue({ agentType: 'deepchat' }),
        getTapeInfo: vi.fn(),
        searchTape: vi.fn(),
        getTapeContext: vi.fn(),
        listTapeAnchors: vi.fn(),
        handoffTape: vi.fn()
      })
    })

    await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\runtime-workspace',
      conversationId: 'conv-1',
      agentId: 'agent-1',
      enabledMcpServerIds: ['mcp-server']
    })
    const runtimeManager = (toolPresenter as any).agentToolManager

    const configurableDefs = await toolPresenter.getConfigurableAgentToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\settings-workspace',
      conversationId: 'conv-1',
      disabledAgentTools: ['read']
    })
    const tapeToolNames = new Set<string>(Object.values(TAPE_TOOL_NAMES))

    expect(configurableDefs.some((tool) => tool.function.name === 'read')).toBe(true)
    expect(configurableDefs.some((tool) => tapeToolNames.has(tool.function.name))).toBe(false)
    expect(configurableDefs.every((tool) => tool.source === 'agent')).toBe(true)
    expect(mcpPresenter.getAllToolDefinitions).toHaveBeenCalledTimes(1)
    expect((toolPresenter as any).agentToolManager).toBe(runtimeManager)
    expect(runtimeManager.agentWorkspacePath).toBe('C:\\runtime-workspace')

    await toolPresenter.callTool({
      id: 'tool-1',
      type: 'function',
      function: { name: 'mcp_only', arguments: '{}' },
      conversationId: 'conv-1'
    })

    expect(mcpPresenter.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ function: expect.objectContaining({ name: 'mcp_only' }) }),
      expect.objectContaining({ agentId: 'agent-1', enabledServerIds: ['mcp-server'] })
    )
  })

  it('does not fall back to another conversation mapping when a tool is unavailable', async () => {
    const toolPresenter = new ToolPresenter({
      mcpPresenter: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([])
      } as any,
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getSkillsPath: vi.fn().mockReturnValue('C:\\skills'),
        getModelConfig: vi.fn()
      } as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })

    await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace-b',
      conversationId: 'conv-b',
      disabledAgentTools: [QUESTION_TOOL_NAME]
    })
    await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace-a',
      conversationId: 'conv-a'
    })

    await expect(
      toolPresenter.callTool({
        id: 'tool-b',
        type: 'function',
        function: {
          name: QUESTION_TOOL_NAME,
          arguments: JSON.stringify({ question: 'Should not execute', options: [] })
        },
        conversationId: 'conv-b'
      })
    ).rejects.toThrow(`Tool ${QUESTION_TOOL_NAME} not found in any source`)

    await expect(
      toolPresenter.callTool({
        id: 'tool-unknown',
        type: 'function',
        function: {
          name: QUESTION_TOOL_NAME,
          arguments: JSON.stringify({ question: 'Unknown conversation', options: [] })
        },
        conversationId: 'conv-unknown'
      })
    ).rejects.toThrow(`Tool ${QUESTION_TOOL_NAME} not found in any source`)

    toolPresenter.clearConversationToolMapping('conv-b')
    await expect(
      toolPresenter.callTool({
        id: 'tool-b-cleared',
        type: 'function',
        function: {
          name: QUESTION_TOOL_NAME,
          arguments: JSON.stringify({ question: 'Still should not execute', options: [] })
        },
        conversationId: 'conv-b'
      })
    ).rejects.toThrow(`Tool ${QUESTION_TOOL_NAME} not found in any source`)
  })

  it('keeps a draft-origin mapping available for the first persisted turn', async () => {
    const toolPresenter = new ToolPresenter({
      mcpPresenter: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([])
      } as any,
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getSkillsPath: vi.fn().mockReturnValue('C:\\skills'),
        getModelConfig: vi.fn()
      } as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })

    await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace'
    })
    const callTool = vi.fn().mockResolvedValue('draft-result')
    const agentToolManager = (toolPresenter as any).agentToolManager
    agentToolManager.callTool = callTool

    await expect(
      toolPresenter.callTool({
        id: 'draft-tool',
        type: 'function',
        function: {
          name: QUESTION_TOOL_NAME,
          arguments: JSON.stringify({ question: 'First turn', options: [] })
        },
        conversationId: 'persisted-session'
      })
    ).resolves.toMatchObject({ content: 'draft-result' })
    expect(callTool).toHaveBeenCalledWith(
      QUESTION_TOOL_NAME,
      { question: 'First turn', options: [] },
      'persisted-session',
      expect.objectContaining({ toolCallId: 'draft-tool' })
    )
  })

  it('exposes cronjob only when runtime ports are available and the tool is enabled', async () => {
    const toolPresenter = new ToolPresenter({
      mcpPresenter: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([])
      } as any,
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getSkillsPath: vi.fn().mockReturnValue('C:\\\\skills'),
        getModelConfig: vi.fn()
      } as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock({
        listCronJobs: vi.fn().mockResolvedValue({ jobs: [], schedulerStatus: { state: 'idle' } }),
        previewCronSchedule: vi.fn().mockResolvedValue({ runs: [], error: null })
      })
    })

    const defs = await toolPresenter.getAllToolDefinitions({
      disabledAgentTools: [],
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace'
    })

    expect(defs.some((tool) => tool.function.name === CRON_JOB_AGENT_TOOL_NAME)).toBe(true)

    const disabledCronJobDefs = await toolPresenter.getAllToolDefinitions({
      disabledAgentTools: [CRON_JOB_AGENT_TOOL_NAME],
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace'
    })

    expect(
      disabledCronJobDefs.some((tool) => tool.function.name === CRON_JOB_AGENT_TOOL_NAME)
    ).toBe(false)
  })

  it('routes every cronjob action through runtime ports', async () => {
    const runtimePort = buildAgentToolRuntimeMock({
      listCronJobs: vi.fn().mockResolvedValue({
        jobs: [cronJobFixture],
        schedulerStatus: { state: 'idle' }
      }),
      previewCronSchedule: vi.fn().mockResolvedValue({ runs: [10, 20], error: null }),
      listCronJobRuns: vi.fn().mockResolvedValue([cronJobRunFixture]),
      upsertCronJob: vi.fn().mockResolvedValue(cronJobFixture),
      toggleCronJob: vi.fn().mockResolvedValue(cronJobFixture),
      runCronJobNow: vi.fn().mockResolvedValue(cronJobRunFixture),
      deleteCronJob: vi.fn().mockResolvedValue(undefined)
    })
    const handler = new CronJobToolHandler(runtimePort)

    const listResult = await handler.call({ action: 'list' })
    expect(listResult).toMatchObject({
      rawData: { isError: false }
    })
    expect(listResult.content).toContain('taskPromptPreview')
    expect(listResult.content).toContain('targetCount')
    expect(listResult.content).not.toContain('P'.repeat(800))
    expect(listResult.content).not.toContain('channel-1')
    await expect(handler.call({ action: 'show', jobId: 'job-1' })).resolves.toMatchObject({
      rawData: { isError: false }
    })
    await expect(
      handler.call({
        action: 'preview_schedule',
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        count: 2
      })
    ).resolves.toMatchObject({
      rawData: { isError: false }
    })
    await expect(
      handler.call({ action: 'history', jobId: 'job-1', limit: 2 })
    ).resolves.toMatchObject({
      rawData: { isError: false }
    })
    await expect(
      handler.call({
        action: 'create',
        job: {
          name: 'New task',
          agentId: 'deepchat',
          taskPrompt: 'Run report',
          delivery: {
            targets: [
              {
                type: 'remote',
                remoteId: 'feishu',
                channelId: 'channel-1'
              }
            ]
          }
        }
      })
    ).resolves.toMatchObject({
      rawData: { isError: false }
    })
    await expect(
      handler.call({ action: 'update', jobId: 'job-1', patch: { name: 'Updated task' } })
    ).resolves.toMatchObject({
      rawData: { isError: false }
    })
    await expect(handler.call({ action: 'pause', jobId: 'job-1' })).resolves.toMatchObject({
      rawData: { isError: false }
    })
    await expect(handler.call({ action: 'resume', jobId: 'job-1' })).resolves.toMatchObject({
      rawData: { isError: false }
    })
    await expect(handler.call({ action: 'run_now', jobId: 'job-1' })).resolves.toMatchObject({
      rawData: { isError: false }
    })
    await expect(handler.call({ action: 'delete', jobId: 'job-1' })).resolves.toMatchObject({
      rawData: { isError: false }
    })
    await expect(handler.call({ action: 'create' })).rejects.toThrow('job is required for create.')

    expect(runtimePort.previewCronSchedule).toHaveBeenCalledWith({
      cronExpr: '0 9 * * *',
      timezone: 'UTC',
      count: 2
    })
    expect(runtimePort.listCronJobRuns).toHaveBeenCalledWith('job-1', 2)
    expect(runtimePort.upsertCronJob).toHaveBeenCalledTimes(2)
    expect(runtimePort.toggleCronJob).toHaveBeenNthCalledWith(1, 'job-1', false)
    expect(runtimePort.toggleCronJob).toHaveBeenNthCalledWith(2, 'job-1', true)
    expect(runtimePort.runCronJobNow).toHaveBeenCalledWith('job-1')
    expect(runtimePort.deleteCronJob).toHaveBeenCalledWith('job-1')
  })

  it('requires approval for cronjob write actions', async () => {
    const upsertCronJob = vi.fn()
    const toolPresenter = new ToolPresenter({
      mcpPresenter: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([]),
        callTool: vi.fn()
      } as any,
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getSkillsPath: vi.fn().mockReturnValue('C:\\skills'),
        getModelConfig: vi.fn()
      } as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock({
        listCronJobs: vi.fn().mockResolvedValue({ jobs: [], schedulerStatus: { state: 'idle' } }),
        previewCronSchedule: vi.fn().mockResolvedValue({ runs: [], error: null }),
        upsertCronJob
      })
    })

    await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace',
      conversationId: 'conv-1'
    })

    await expect(
      toolPresenter.preCheckToolPermission({
        id: 'tool-1',
        type: 'function',
        function: {
          name: CRON_JOB_AGENT_TOOL_NAME,
          arguments: '{"action":"run_now","jobId":"job-1"}'
        },
        conversationId: 'conv-1'
      })
    ).resolves.toMatchObject({
      needsPermission: true,
      toolName: CRON_JOB_AGENT_TOOL_NAME,
      serverName: 'scheduled',
      permissionType: 'write'
    })
    expect(upsertCronJob).not.toHaveBeenCalled()
  })

  it('passes DeepChat agent MCP server policy context to MCP presenter', async () => {
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
      chatMode: 'agent',
      conversationId: 'session-1'
    })

    expect(mcpPresenter.getAllToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        enabledServerIds: ['server-a'],
        conversationId: 'session-1'
      })
    )
  })

  it('forwards cancellation and stored access context to MCP permission pre-checks', async () => {
    const mcpPresenter = {
      getAllToolDefinitions: vi
        .fn()
        .mockResolvedValue([buildToolDefinition('mcp_only', 'server-a')]),
      callTool: vi.fn(),
      preCheckToolPermission: vi.fn().mockResolvedValue(null)
    } as any
    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getSkillsPath: vi.fn().mockReturnValue('C:\\skills'),
        getModelConfig: vi.fn()
      } as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })
    const abortController = new AbortController()
    await toolPresenter.getAllToolDefinitions({
      agentId: 'agent-1',
      enabledMcpServerIds: ['server-a'],
      chatMode: 'agent',
      conversationId: 'session-1'
    })
    const request = {
      id: 'permission-1',
      type: 'function' as const,
      function: { name: 'mcp_only', arguments: '{}' },
      conversationId: 'session-1'
    }

    await toolPresenter.preCheckToolPermission(request, {
      permissionMode: 'default',
      signal: abortController.signal
    })

    expect(mcpPresenter.preCheckToolPermission).toHaveBeenCalledWith(request, {
      agentId: 'agent-1',
      enabledServerIds: ['server-a'],
      signal: abortController.signal
    })
  })

  it('observes a late agent permission failure after pre-check synchronously cancels', async () => {
    let rejectPermission!: (reason?: unknown) => void
    const permission = new Promise<never>((_, reject) => {
      rejectPermission = reject
    })
    const mcpPresenter = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const toolPresenter = new ToolPresenter({
      mcpPresenter,
      configPresenter: {
        getSkillsEnabled: vi.fn().mockReturnValue(false),
        getSkillsPath: vi.fn().mockReturnValue('C:\\skills'),
        getModelConfig: vi.fn()
      } as any,
      commandPermissionHandler: new CommandPermissionService(),
      agentToolRuntime: buildAgentToolRuntimeMock()
    })
    const abortController = new AbortController()
    const lateError = new Error('late permission failure')
    const unhandled = vi.fn()
    await toolPresenter.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'permission-cancel-session'
    })
    const agentToolManager = (toolPresenter as any).agentToolManager
    agentToolManager.preCheckToolPermission = vi.fn().mockImplementation(() => {
      abortController.abort()
      return permission
    })

    await expect(
      toolPresenter.preCheckToolPermission(
        {
          id: 'permission-sync-cancel',
          type: 'function',
          function: { name: UPDATE_PLAN_TOOL_NAME, arguments: '{}' },
          conversationId: 'permission-cancel-session'
        },
        { signal: abortController.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(agentToolManager.preCheckToolPermission).toHaveBeenCalledTimes(1)

    process.on('unhandledRejection', unhandled)
    try {
      rejectPermission(lateError)
      await new Promise<void>((resolve) => setImmediate(resolve))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled.mock.calls.some(([reason]) => reason === lateError)).toBe(false)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
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
    const abortController = new AbortController()

    await toolPresenter.getAllToolDefinitions({
      agentId: 'agent-1',
      enabledMcpServerIds: undefined,
      chatMode: 'agent',
      conversationId: 'session-unrestricted'
    })

    await toolPresenter.callTool(
      {
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
      } as any,
      { signal: abortController.signal }
    )

    expect(mcpPresenter.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'session-unrestricted' }),
      expect.objectContaining({
        agentId: 'agent-1',
        enabledServerIds: undefined,
        signal: abortController.signal
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

  it('omits diagnostic and runtime-only Tape capabilities from the model prompt', () => {
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
        },
        {
          ...buildToolDefinition(TAPE_TOOL_NAMES.handoff, 'agent-tape'),
          source: 'agent'
        }
      ]
    })

    expect(prompt).not.toContain('## Tape Tools')
    expect(prompt).not.toContain('tape_info')
    expect(prompt).not.toContain('tape_anchors')
    expect(prompt).not.toContain('tape_handoff')
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
