import { describe, expect, it, vi } from 'vitest'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import { ToolService } from '@/tool'
import { createToolCatalogPort } from '@/agent/deepchat/runtime/toolAdapters'
import {
  AgentToolManager,
  CronJobToolHandler,
  TAPE_TOOL_NAMES,
  UPDATE_PLAN_TOOL_NAME
} from '@/tool/agentTools'
import { CommandPermissionService, ToolPermissionBroker } from '@/tool/permission'
import { QUESTION_TOOL_NAME } from '@/tool/agentTools/questionTool'
import { IMAGE_GENERATE_TOOL_NAME } from '@shared/agentImageGenerationTool'
import { createAgentToolDependencies } from './agentTools/agentToolDependencies'
import {
  CRON_JOB_AGENT_TOOL_NAME,
  LIVE_DELEGATION_AGENT_TOOL_NAME,
  SKILL_LIST_AGENT_TOOL_NAME,
  SUBAGENT_ORCHESTRATOR_TOOL_NAME,
  assertAgentToolExposure,
  getAgentToolExposure
} from '@shared/agentTools'
import { resolveDeepChatSubagentCapability } from '@shared/lib/deepchatSubagents'
import { parseChildAgentResultEnvelope } from '@shared/orchestration/resultSafety'
import { LiveDelegationConsentAuthority } from '@/orchestration/liveDelegationConsent'
import { createOpaquePromptAssembly } from '@/agent/deepchat/resources/promptAssembly'
import { buildExecutionContract } from '@/tape/domain/executionContract'

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP || process.env.TMP || 'C:\\\\temp'
  }
}))

const buildToolDefinition = (name: string, serverName: string): MCPToolDefinition => ({
  execution: TOOL_EXECUTION.write,
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
    description: `${serverName} server`,
    id: '11111111-1111-4111-8111-111111111111',
    configGeneration: 1,
    bindingHash: 'binding-hash'
  },
  raw: {
    name,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
})

const buildAgentToolRuntimeMock = (overrides: Record<string, unknown> = {}) =>
  createAgentToolDependencies({
    resolveConversationSessionInfo: vi.fn(async (sessionId: string) => ({
      sessionId,
      sessionKind: 'regular'
    })),
    ...overrides
  })

const CONTRACT_RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const buildContractMcpDefinition = (name = 'remote_read'): MCPToolDefinition => {
  const definition = buildToolDefinition(name, 'remote')
  return {
    ...definition,
    source: 'mcp',
    server: {
      ...definition.server,
      bindingHash: 'a'.repeat(64)
    }
  }
}

const buildToolExecutionContract = (
  tool: MCPToolDefinition,
  workspace: string | null = '/workspace',
  maxSubagentDepth = 0
) => {
  const promptAssembly = createOpaquePromptAssembly('System prompt')
  return buildExecutionContract({
    request: {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: CONTRACT_RUN_ID,
      requestSeq: 1
    },
    promptAssembly,
    providerMessages: [
      { role: 'system', content: promptAssembly.prompt },
      { role: 'user', content: 'Use the tool' }
    ],
    tools: [tool],
    providerId: 'provider-1',
    modelId: 'model-1',
    modelConfig: { contextLength: 1_000 } as any,
    temperature: 0.2,
    maxTokens: 100,
    workspace: workspace ? { kind: 'path', path: workspace } : { kind: 'runtime_default' },
    maxSubagentDepth,
    dynamicControlSnapshot: {
      permissionMode: 'default',
      requestAdmitted: true,
      cancellationRequested: false
    },
    assemblerVersion: 'test-v1'
  })
}

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

describe('ToolService', () => {
  it('meets the frozen execution contract with current authority at dispatch', async () => {
    const definition = buildContractMcpDefinition()
    const resolveConversationExecutionAuthority = vi.fn(async (sessionId: string) => ({
      sessionId,
      agentId: 'agent-1',
      projectDir: '/workspace',
      sessionKind: 'regular',
      disabledAgentTools: [],
      subagentCapability: {
        available: false,
        reason: 'policy_disabled',
        cacheKey: 'unavailable'
      }
    }))
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([definition]),
      callTool: vi.fn(async () => ({
        content: 'ok',
        rawData: { toolCallId: 'call-1', content: 'ok' }
      }))
    } as any
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({ resolveConversationExecutionAuthority })
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'session-1',
      sessionKind: 'regular'
    })
    const executionContract = buildToolExecutionContract(definition)

    await expect(
      toolService.callTool(
        {
          id: 'call-1',
          type: 'function',
          function: { name: definition.function.name, arguments: '{}' },
          conversationId: 'session-1'
        },
        {
          runId: CONTRACT_RUN_ID,
          messageId: 'message-1',
          requestSeq: 1,
          executionContract,
          permissionMode: 'full_access'
        }
      )
    ).resolves.toMatchObject({ content: 'ok' })
    expect(resolveConversationExecutionAuthority).toHaveBeenCalledTimes(2)
    expect(mcpService.callTool).toHaveBeenCalledOnce()
  })

  it.each([
    {
      name: 'workspace change',
      authorityUpdate: { projectDir: '/other-workspace' },
      expectedCode: 'workspace_mismatch'
    },
    {
      name: 'workspace change hidden by trailing whitespace',
      authorityUpdate: { projectDir: '/workspace ' },
      expectedCode: 'workspace_mismatch'
    },
    {
      name: 'MCP server revocation',
      authorityUpdate: { enabledMcpServerIds: [] },
      expectedCode: 'tool_not_allowed'
    }
  ])('rejects current $name before crossing tool dispatch', async (scenario) => {
    const definition = buildContractMcpDefinition()
    const runtimeSession = {
      sessionId: 'session-1',
      agentId: 'agent-1',
      projectDir: '/workspace',
      sessionKind: 'regular',
      disabledAgentTools: [],
      enabledMcpServerIds: [definition.server.id],
      subagentCapability: { available: false, reason: 'policy_disabled', cacheKey: 'off' }
    }
    const resolveConversationExecutionAuthority = vi
      .fn()
      .mockResolvedValueOnce(runtimeSession)
      .mockResolvedValueOnce({ ...runtimeSession, ...scenario.authorityUpdate })
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([definition]),
      callTool: vi.fn()
    } as any
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({ resolveConversationExecutionAuthority })
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'session-1',
      sessionKind: 'regular'
    })
    await expect(
      toolService.callTool(
        {
          id: 'call-1',
          type: 'function',
          function: { name: definition.function.name, arguments: '{}' },
          conversationId: 'session-1'
        },
        {
          runId: CONTRACT_RUN_ID,
          messageId: 'message-1',
          requestSeq: 1,
          executionContract: buildToolExecutionContract(definition),
          permissionMode: 'full_access'
        }
      )
    ).rejects.toMatchObject({ code: scenario.expectedCode })
    expect(mcpService.callTool).not.toHaveBeenCalled()
  })

  it('rejects an Agent tool disabled by current Session authority', async () => {
    const resolveConversationExecutionAuthority = vi.fn(async (sessionId: string) => ({
      sessionId,
      agentId: 'agent-1',
      projectDir: '/workspace',
      sessionKind: 'regular' as const,
      disabledAgentTools: ['read'],
      subagentCapability: {
        available: false as const,
        reason: 'policy_disabled' as const,
        cacheKey: 'off'
      }
    }))
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: { getAllToolDefinitions: vi.fn().mockResolvedValue([]) } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({ resolveConversationExecutionAuthority })
    })
    const definitions = await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'session-1',
      sessionKind: 'regular',
      agentWorkspacePath: '/workspace'
    })
    const definition = definitions.find((candidate) => candidate.function.name === 'read')
    expect(definition).toBeDefined()

    await expect(
      toolService.callTool(
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'read', arguments: '{}' },
          conversationId: 'session-1'
        },
        {
          runId: CONTRACT_RUN_ID,
          messageId: 'message-1',
          requestSeq: 1,
          executionContract: buildToolExecutionContract(definition!),
          permissionMode: 'full_access'
        }
      )
    ).rejects.toMatchObject({ code: 'tool_not_allowed' })
    expect(resolveConversationExecutionAuthority).toHaveBeenCalledOnce()
  })

  it('rechecks live delegation authority immediately before Agent dispatch', async () => {
    const availableCapability = resolveDeepChatSubagentCapability({
      agentType: 'deepchat',
      sessionKind: 'regular',
      agentPolicyEnabled: true,
      slots: [
        {
          id: 'self',
          targetType: 'self',
          displayName: 'Self Clone',
          description: 'Delegate work.'
        }
      ]
    })
    const baseAuthority = {
      sessionId: 'session-1',
      agentId: 'agent-1',
      projectDir: '/workspace',
      sessionKind: 'regular' as const,
      disabledAgentTools: []
    }
    const resolveConversationExecutionAuthority = vi
      .fn()
      .mockResolvedValueOnce({ ...baseAuthority, subagentCapability: availableCapability })
      .mockResolvedValueOnce({
        ...baseAuthority,
        subagentCapability: {
          available: false,
          reason: 'policy_disabled',
          cacheKey: 'off'
        }
      })
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: { getAllToolDefinitions: vi.fn().mockResolvedValue([]) } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({ resolveConversationExecutionAuthority })
    })
    const definitions = await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'session-1',
      sessionKind: 'regular',
      agentWorkspacePath: '/workspace',
      subagentCapability: availableCapability
    })
    const definition = definitions.find(
      (candidate) => candidate.function.name === LIVE_DELEGATION_AGENT_TOOL_NAME
    )
    expect(definition).toBeDefined()

    await expect(
      toolService.callTool(
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: LIVE_DELEGATION_AGENT_TOOL_NAME,
            arguments: JSON.stringify({ operation: 'list' })
          },
          conversationId: 'session-1'
        },
        {
          runId: CONTRACT_RUN_ID,
          messageId: 'message-1',
          requestSeq: 1,
          executionContract: buildToolExecutionContract(definition!, '/workspace', 1),
          permissionMode: 'full_access'
        }
      )
    ).rejects.toMatchObject({ code: 'subagent_depth_exceeded' })
    expect(resolveConversationExecutionAuthority).toHaveBeenCalledTimes(2)
  })

  it('records effect intent before dispatch and blocks execution when it cannot persist', async () => {
    const order: string[] = []
    const effectObserver = {
      beforeToolAuthorization: vi.fn().mockResolvedValue(null),
      beforeToolExecution: vi.fn(async () => {
        order.push('effect')
      })
    }
    const mcpDefinition = {
      ...buildToolDefinition('remote_read', 'remote'),
      execution: TOOL_EXECUTION.read.parallel
    }
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([mcpDefinition]),
      callTool: vi.fn(async () => {
        order.push('tool')
        return {
          content: 'ok',
          rawData: {
            toolCallId: 'call-1',
            content: 'ok'
          }
        }
      })
    } as any
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock(),
      effectObserver
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'child-session'
    })
    const request = {
      id: 'call-1',
      type: 'function',
      function: {
        name: 'remote_read',
        arguments: '{}'
      },
      conversationId: 'child-session'
    }

    await expect(
      toolService.callTool(request, { permissionMode: 'full_access' })
    ).resolves.toMatchObject({ content: 'ok' })
    expect(order).toEqual(['effect', 'tool'])
    expect(effectObserver.beforeToolExecution).toHaveBeenCalledWith(
      {
        conversationId: 'child-session',
        toolCallId: 'call-1',
        toolName: 'remote_read',
        source: 'mcp',
        reviewedExecution: null,
        authorizedPermissionMode: 'full_access'
      },
      undefined
    )

    order.length = 0
    mcpService.callTool.mockClear()
    effectObserver.beforeToolExecution.mockRejectedValueOnce(new Error('intent write failed'))
    await expect(toolService.callTool(request, { permissionMode: 'full_access' })).rejects.toThrow(
      'intent write failed'
    )
    expect(mcpService.callTool).not.toHaveBeenCalled()

    effectObserver.beforeToolExecution.mockClear()
    const controller = new AbortController()
    controller.abort()
    await expect(
      toolService.callTool(request, { signal: controller.signal })
    ).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(effectObserver.beforeToolExecution).not.toHaveBeenCalled()

    mcpService.callTool.mockClear()
    effectObserver.beforeToolAuthorization.mockResolvedValueOnce({ permissionMode: 'default' })
    await expect(
      toolService.callTool(request, { permissionMode: 'full_access' })
    ).resolves.toMatchObject({ rawData: { requiresPermission: true } })
    expect(effectObserver.beforeToolExecution).not.toHaveBeenCalled()
    expect(mcpService.callTool).not.toHaveBeenCalled()

    await expect(toolService.callTool(request)).resolves.toMatchObject({
      rawData: {
        requiresPermission: true
      }
    })
    expect(effectObserver.beforeToolExecution).not.toHaveBeenCalled()
    expect(mcpService.callTool).not.toHaveBeenCalled()
    toolService.clearConversationToolMapping('child-session')
  })

  it('reserves image_generate for the built-in agent tool when MCP exposes the same name', async () => {
    const mcpService = {
      getAllToolDefinitions: vi
        .fn()
        .mockResolvedValue([buildToolDefinition(IMAGE_GENERATE_TOOL_NAME, 'mcp-images')]),
      callTool: vi.fn()
    } as any

    const providerSettings = {
      getModelConfig: vi.fn()
    }

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const defs = await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\\\workspace'
    })
    const imageGenerateDefs = defs.filter((def) => def.function.name === IMAGE_GENERATE_TOOL_NAME)

    expect(imageGenerateDefs).toHaveLength(1)
    expect(imageGenerateDefs[0].source).toBe('agent')
    expect(imageGenerateDefs[0].server.name).toBe('agent-image-generation')

    const agentToolManager = (toolService as any).agentToolManager
    const callToolSpy = vi.fn().mockResolvedValue('agent-image')
    agentToolManager.callTool = callToolSpy

    await toolService.callTool({
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
    expect(mcpService.callTool).not.toHaveBeenCalled()
  })

  it('keeps every Tape capability name reserved against same-name MCP tools', async () => {
    const tapeToolNames = new Set<string>(Object.values(TAPE_TOOL_NAMES))
    const toolService = new ToolService({
      mcpService: {
        getAllToolDefinitions: vi
          .fn()
          .mockResolvedValue(
            Object.values(TAPE_TOOL_NAMES).map((name) => buildToolDefinition(name, 'untrusted-mcp'))
          )
      } as any,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const defs = await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace'
    })

    expect(defs.some((definition) => tapeToolNames.has(definition.function.name))).toBe(false)
  })

  it('propagates Agent catalog failures only for fail-closed resolutions', async () => {
    const toolService = new ToolService({
      mcpService: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([])
      } as any,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    const agentToolManager = (toolService as any).ensureAgentToolManager(null)
    vi.spyOn(agentToolManager, 'getAllToolDefinitions').mockRejectedValue(
      new Error('Agent catalog unavailable')
    )
    const context = {
      chatMode: 'agent' as const,
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conversation-1'
    }

    await expect(toolService.getAllToolDefinitions(context)).resolves.toEqual([])
    await expect(
      toolService.getAllToolDefinitions({ ...context, requireCompleteCatalog: true })
    ).rejects.toThrow('Agent catalog unavailable')
  })

  it('keeps ToolService collision resolution behind the DeepChat catalog port', async () => {
    const mcpDefs = [buildToolDefinition('shared', 'mcp')]
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue(mcpDefs),
      callTool: vi.fn()
    } as any

    const providerSettings = {
      getModelConfig: vi.fn()
    }

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({
        browser: {
          getToolDefinitions: vi
            .fn()
            .mockReturnValue([buildToolDefinition('shared', 'yo-browser')]),
          callTool: vi.fn()
        }
      })
    })

    const catalog = createToolCatalogPort({
      toolService,
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
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: {
        getModelConfig: vi.fn()
      } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    const agentToolManager = (toolService as any).ensureAgentToolManager('C:\\\\workspace')
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

    const firstResolution = toolService.getAllToolDefinitions(context)
    const secondResolution = toolService.getAllToolDefinitions(context)
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
    await toolService.callTool({
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
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\\\workspace'
    })
    const agentToolManager = (toolService as any).agentToolManager
    agentToolManager.clearPlanState = vi.fn()

    toolService.clearAgentPlanState(' conv-1 ')

    expect(agentToolManager.clearPlanState).toHaveBeenCalledWith('conv-1')
  })

  it('falls back to jsonrepair when tool arguments are malformed', async () => {
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }
    const runtimePort = buildAgentToolRuntimeMock({
      listCronJobs: vi.fn().mockResolvedValue({ jobs: [], schedulerStatus: { state: 'idle' } }),
      previewCronSchedule: vi.fn().mockResolvedValue({ runs: [], error: null })
    })

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: runtimePort
    })

    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\\\workspace'
    })

    const agentToolManager = (toolService as any).agentToolManager
    const callToolSpy = vi.fn().mockResolvedValue('ok')
    agentToolManager.callTool = callToolSpy

    const result = await toolService.callTool({
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
    const rawOnlyResult = await toolService.callTool({
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
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue(mcpDefs),
      callTool: vi.fn()
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }
    const runtimePort = buildAgentToolRuntimeMock()

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: runtimePort
    })

    const defs = await toolService.getAllToolDefinitions({
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

  it('keeps skill discovery available when configurable Skill tools are disabled', async () => {
    const conflictingMcpSkillList = buildToolDefinition(SKILL_LIST_AGENT_TOOL_NAME, 'mcp')
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => true } as any,
      mcpService: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([conflictingMcpSkillList])
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const defs = await toolService.getAllToolDefinitions({
      disabledAgentTools: [SKILL_LIST_AGENT_TOOL_NAME, 'skill_view'],
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace'
    })

    expect(defs.filter((tool) => tool.function.name === SKILL_LIST_AGENT_TOOL_NAME)).toEqual([
      expect.objectContaining({ source: 'agent' })
    ])
    expect(defs.some((tool) => tool.function.name === 'skill_view')).toBe(false)
  })

  it('keeps one published discovery mapping stable across a Skills setting change', async () => {
    let skillsEnabled = true
    const isEnabled = vi.fn(() => skillsEnabled)
    const skillService = {
      resolveSessionAgentId: vi.fn().mockResolvedValue('deepchat'),
      getMetadataList: vi
        .fn()
        .mockResolvedValue([{ name: 'routing-skill', description: 'Routes tasks' }]),
      getActiveSkills: vi.fn().mockResolvedValue([]),
      getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
      listSkillScripts: vi.fn().mockResolvedValue([]),
      getSkillExtension: vi.fn().mockResolvedValue({
        version: 1,
        env: {},
        runtimePolicy: { python: 'auto', node: 'auto' },
        scriptOverrides: {}
      })
    }
    const toolService = new ToolService({
      skillSettings: { isEnabled } as any,
      mcpService: {
        getAllToolDefinitions: vi
          .fn()
          .mockResolvedValue([buildToolDefinition(SKILL_LIST_AGENT_TOOL_NAME, 'mcp')])
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({ skillService })
    })

    const defs = await toolService.getAllToolDefinitions({
      disabledAgentTools: [],
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace'
    })
    skillsEnabled = false
    const result = await toolService.callTool({
      id: 'skill-list-1',
      type: 'function',
      function: { name: SKILL_LIST_AGENT_TOOL_NAME, arguments: '{}' }
    })

    expect(defs.filter((tool) => tool.function.name === SKILL_LIST_AGENT_TOOL_NAME)).toEqual([
      expect.objectContaining({ source: 'agent' })
    ])
    expect(JSON.parse(String(result.content))).toMatchObject({
      skills: [{ name: 'routing-skill' }]
    })
  })

  it('preserves an MCP skill_list tool when built-in Skills are disabled', async () => {
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: {
        getAllToolDefinitions: vi
          .fn()
          .mockResolvedValue([buildToolDefinition(SKILL_LIST_AGENT_TOOL_NAME, 'mcp')])
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const defs = await toolService.getAllToolDefinitions({
      disabledAgentTools: [],
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace'
    })

    expect(defs.filter((tool) => tool.function.name === SKILL_LIST_AGENT_TOOL_NAME)).toEqual([
      expect.objectContaining({ source: 'mcp' })
    ])
  })

  it('preserves an MCP skill_list tool for ACP agents when Skills are enabled', async () => {
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => true } as any,
      mcpService: {
        getAllToolDefinitions: vi
          .fn()
          .mockResolvedValue([buildToolDefinition(SKILL_LIST_AGENT_TOOL_NAME, 'mcp')])
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const defs = await toolService.getAllToolDefinitions({
      disabledAgentTools: [],
      chatMode: 'acp agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace'
    })

    expect(defs.filter((tool) => tool.function.name === SKILL_LIST_AGENT_TOOL_NAME)).toEqual([
      expect.objectContaining({ source: 'mcp' })
    ])
  })

  it('uses one exposure policy for Tape tools and defaults existing tools to configurable', () => {
    expect(getAgentToolExposure(TAPE_TOOL_NAMES.search)).toBe('system-model')
    expect(getAgentToolExposure(TAPE_TOOL_NAMES.context)).toBe('system-model')
    expect(getAgentToolExposure(TAPE_TOOL_NAMES.info)).toBe('diagnostic')
    expect(getAgentToolExposure(TAPE_TOOL_NAMES.anchors)).toBe('diagnostic')
    expect(getAgentToolExposure(TAPE_TOOL_NAMES.handoff)).toBe('runtime-only')
    expect(getAgentToolExposure(SUBAGENT_ORCHESTRATOR_TOOL_NAME)).toBe('system-model')
    expect(getAgentToolExposure(LIVE_DELEGATION_AGENT_TOOL_NAME)).toBe('system-model')
    expect(getAgentToolExposure(SKILL_LIST_AGENT_TOOL_NAME)).toBe('system-model')
    expect(getAgentToolExposure('read')).toBe('user-configurable')
    expect(getAgentToolExposure('__proto__')).toBe('user-configurable')
    expect(() => assertAgentToolExposure(TAPE_TOOL_NAMES.handoff, 'user-configurable')).toThrow(
      "Agent tool exposure mismatch for 'tape_handoff': expected 'user-configurable', registered 'runtime-only'."
    )
  })

  it('keeps Subagent orchestration outside disabled catalog controls', async () => {
    const toolService = new ToolService({
      mcpService: { getAllToolDefinitions: vi.fn().mockResolvedValue([]) } as any,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const configurable = await toolService.getConfigurableAgentToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null
    })
    expect(configurable.map((definition) => definition.function.name)).not.toContain(
      LIVE_DELEGATION_AGENT_TOOL_NAME
    )

    const subagentCapability = resolveDeepChatSubagentCapability({
      agentType: 'deepchat',
      sessionKind: 'regular',
      agentPolicyEnabled: true,
      slots: [
        {
          id: 'reviewer',
          targetType: 'self',
          displayName: 'Reviewer',
          description: 'Review the result.'
        }
      ]
    })
    const runtimeDefinitions = await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1',
      disabledAgentTools: [LIVE_DELEGATION_AGENT_TOOL_NAME],
      subagentCapability
    })
    expect(runtimeDefinitions.map((definition) => definition.function.name)).toContain(
      LIVE_DELEGATION_AGENT_TOOL_NAME
    )
  })

  it('reserves live delegation names and ignores generic disabled-tool state', async () => {
    const toolService = new ToolService({
      mcpService: {
        getAllToolDefinitions: vi
          .fn()
          .mockResolvedValue([
            buildToolDefinition(LIVE_DELEGATION_AGENT_TOOL_NAME, 'untrusted-mcp'),
            buildToolDefinition(SUBAGENT_ORCHESTRATOR_TOOL_NAME, 'legacy-untrusted-mcp')
          ])
      } as any,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    const subagentCapability = resolveDeepChatSubagentCapability({
      agentType: 'deepchat',
      sessionKind: 'regular',
      agentPolicyEnabled: true,
      slots: [
        {
          id: 'reviewer',
          targetType: 'self',
          displayName: 'Reviewer',
          description: 'Review the result.'
        }
      ]
    })

    const defs = await toolService.getAllToolDefinitions({
      disabledAgentTools: [LIVE_DELEGATION_AGENT_TOOL_NAME, SUBAGENT_ORCHESTRATOR_TOOL_NAME],
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1',
      subagentCapability
    })
    const orchestrators = defs.filter(
      (definition) => definition.function.name === LIVE_DELEGATION_AGENT_TOOL_NAME
    )

    expect(orchestrators).toHaveLength(1)
    expect(orchestrators[0]).toMatchObject({
      source: 'agent',
      server: { name: 'agent-live-delegation' }
    })
    expect(
      defs.some((definition) => definition.function.name === SUBAGENT_ORCHESTRATOR_TOOL_NAME)
    ).toBe(false)

    const configurable = await toolService.getConfigurableAgentToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1'
    })
    expect(
      configurable.some(
        (definition) => definition.function.name === LIVE_DELEGATION_AGENT_TOOL_NAME
      )
    ).toBe(false)
  })

  it('host-enforces explicit Subagent starts and treats proactive policy as authorization', async () => {
    let orchestrationPolicy: 'explicit' | 'proactive' = 'explicit'
    const spawn = vi.fn().mockResolvedValue({ delegation: { id: 'delegation-1' }, turns: [] })
    const permissionBroker = new ToolPermissionBroker()
    const liveDelegationConsent = new LiveDelegationConsentAuthority()
    const toolService = new ToolService({
      mcpService: { getAllToolDefinitions: vi.fn().mockResolvedValue([]) } as any,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      permissionBroker,
      liveDelegationConsent,
      agentTools: buildAgentToolRuntimeMock({
        resolveConversationSessionInfo: vi.fn(async (sessionId: string) => ({
          sessionId,
          sessionKind: 'regular',
          orchestrationPolicy
        })),
        liveDelegation: {
          spawn,
          send: vi.fn(),
          followUp: vi.fn(),
          list: vi.fn().mockReturnValue([]),
          inspect: vi.fn(),
          readResult: vi.fn(),
          wait: vi.fn(),
          interrupt: vi.fn()
        }
      })
    })
    const subagentCapability = resolveDeepChatSubagentCapability({
      agentType: 'deepchat',
      sessionKind: 'regular',
      agentPolicyEnabled: true,
      slots: [
        {
          id: 'reviewer',
          targetType: 'self',
          displayName: 'Reviewer',
          description: 'Review the result.'
        }
      ]
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1',
      subagentCapability
    })
    const request = {
      id: 'spawn-1',
      type: 'function' as const,
      function: {
        name: LIVE_DELEGATION_AGENT_TOOL_NAME,
        arguments: JSON.stringify({
          operation: 'spawn',
          slotId: 'reviewer',
          title: 'Review architecture',
          prompt: 'Inspect module boundaries.'
        })
      },
      conversationId: 'conv-1'
    }

    const preChecked = await toolService.preCheckToolPermission(request, {
      permissionMode: 'full_access'
    })
    expect(preChecked).toMatchObject({
      needsPermission: true,
      requiresUserConfirmation: true,
      rememberable: false
    })
    const blocked = await toolService.callTool(request, { permissionMode: 'full_access' })
    expect(blocked.rawData).toMatchObject({
      requiresPermission: true,
      permissionRequest: { requestId: preChecked?.requestId }
    })
    expect(spawn).not.toHaveBeenCalled()

    expect(permissionBroker.approve(preChecked!.requestId!, 'conv-1')).toBe(true)
    const approved = await toolService.callTool(request, { permissionMode: 'full_access' })
    expect(spawn).toHaveBeenCalledTimes(1)
    const receipt = spawn.mock.calls[0]?.[2]
    expect(receipt).toBeDefined()
    expect(
      liveDelegationConsent.isValid(receipt, {
        parentSessionId: 'conv-1',
        operation: 'spawn'
      })
    ).toBe(true)
    expect(parseChildAgentResultEnvelope(JSON.parse(String(approved.content)))).toMatchObject({
      kind: 'child_agent_result',
      trust: 'untrusted',
      source: { operation: 'spawn' }
    })

    const oneShot = await toolService.callTool(request, { permissionMode: 'full_access' })
    expect(oneShot.rawData.requiresPermission).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)

    orchestrationPolicy = 'proactive'
    await toolService.callTool(request, { permissionMode: 'default' })
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn.mock.calls[1]?.[2]).toBeUndefined()
    permissionBroker.clear()
  })

  it('revalidates Subagent built-in and MCP authority at execution time', async () => {
    const mcpDefinition = buildToolDefinition('remote_write', 'remote-server')
    let parentMcpServerIds = [mcpDefinition.server.id!]
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([mcpDefinition]),
      callTool: vi.fn()
    }
    const parent = {
      sessionId: 'parent-1',
      sessionKind: 'regular',
      parentSessionId: null,
      agentId: 'parent-agent',
      disabledAgentTools: ['read']
    }
    const child = {
      sessionId: 'child-1',
      sessionKind: 'subagent',
      parentSessionId: 'parent-1',
      agentId: 'reviewer',
      disabledAgentTools: []
    }
    const effectObserver = {
      beforeToolExecution: vi.fn(async () => {
        parentMcpServerIds = []
      })
    }
    const toolService = new ToolService({
      mcpService: mcpService as any,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: {
        resolveDeepChatAgentConfig: vi.fn(async (agentId: string) => ({
          enabledMcpServerIds:
            agentId === 'parent-agent' ? parentMcpServerIds : [mcpDefinition.server.id!]
        }))
      } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      effectObserver,
      agentTools: buildAgentToolRuntimeMock({
        resolveConversationSessionInfo: vi.fn(async (sessionId: string) =>
          sessionId === 'child-1' ? child : sessionId === 'parent-1' ? parent : null
        )
      })
    })

    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'child-1',
      agentWorkspacePath: '/repo',
      enabledMcpServerIds: [mcpDefinition.server.id!]
    })

    await expect(
      toolService.callTool(
        {
          id: 'read-1',
          type: 'function',
          function: { name: 'read', arguments: JSON.stringify({ path: '/repo/file.ts' }) },
          conversationId: 'child-1'
        },
        { permissionMode: 'full_access' }
      )
    ).rejects.toThrow("Tool 'read' is disabled by the current Subagent authority")
    expect(effectObserver.beforeToolExecution).not.toHaveBeenCalled()
    await expect(
      toolService.callTool(
        {
          id: 'mcp-1',
          type: 'function',
          function: { name: 'remote_write', arguments: '{}' },
          conversationId: 'child-1'
        },
        { permissionMode: 'full_access', enabledMcpServerIds: [mcpDefinition.server.id!] }
      )
    ).rejects.toThrow("MCP tool 'remote_write' is disabled by the current Subagent authority")
    expect(mcpService.callTool).not.toHaveBeenCalled()
    expect(effectObserver.beforeToolExecution).toHaveBeenCalledOnce()
  })

  it('fails closed before effect evidence when a mapped Session identity disappears', async () => {
    const mcpDefinition = buildToolDefinition('remote_write', 'remote-server')
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([mcpDefinition]),
      callTool: vi.fn()
    }
    const effectObserver = {
      beforeToolExecution: vi.fn()
    }
    const toolService = new ToolService({
      mcpService: mcpService as any,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      effectObserver,
      agentTools: buildAgentToolRuntimeMock({
        resolveConversationSessionInfo: vi.fn().mockResolvedValue(null)
      })
    })

    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'missing-child',
      sessionKind: 'subagent',
      agentWorkspacePath: '/repo',
      enabledMcpServerIds: [mcpDefinition.server.id!]
    })

    await expect(
      toolService.callTool(
        {
          id: 'mcp-missing-child',
          type: 'function',
          function: { name: 'remote_write', arguments: '{}' },
          conversationId: 'missing-child'
        },
        { permissionMode: 'full_access' }
      )
    ).rejects.toThrow('Session missing-child execution identity is unavailable')
    expect(effectObserver.beforeToolExecution).not.toHaveBeenCalled()
    expect(mcpService.callTool).not.toHaveBeenCalled()
  })

  it('rejects malformed live-delegation results at the model-facing boundary', async () => {
    const toolService = new ToolService({
      mcpService: { getAllToolDefinitions: vi.fn().mockResolvedValue([]) } as any,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    const subagentCapability = resolveDeepChatSubagentCapability({
      agentType: 'deepchat',
      sessionKind: 'regular',
      agentPolicyEnabled: true,
      slots: [
        {
          id: 'reviewer',
          targetType: 'self',
          displayName: 'Reviewer',
          description: 'Review the result.'
        }
      ]
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'conv-1',
      sessionKind: 'regular',
      agentWorkspacePath: '/repo',
      subagentCapability
    })
    const callToolSpy = vi.spyOn(AgentToolManager.prototype, 'callTool').mockResolvedValueOnce({
      content: 'raw child output'
    })

    await expect(
      toolService.callTool(
        {
          id: 'list-1',
          type: 'function',
          function: {
            name: LIVE_DELEGATION_AGENT_TOOL_NAME,
            arguments: JSON.stringify({ operation: 'list' })
          },
          conversationId: 'conv-1'
        },
        { permissionMode: 'full_access' }
      )
    ).rejects.toThrow('invalid child-result envelope')
    callToolSpy.mockRestore()
  })

  it('keeps the recall pair in the runtime catalog despite stale disabled values', async () => {
    const toolService = new ToolService({
      mcpService: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([])
      } as any,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({
        resolveConversationSessionInfo: vi.fn(async (sessionId: string) => ({
          sessionId,
          sessionKind: 'regular',
          agentType: 'deepchat'
        })),
        getTapeInfo: vi.fn(),
        searchTape: vi.fn(),
        getTapeContext: vi.fn(),
        listTapeAnchors: vi.fn(),
        handoffTape: vi.fn()
      })
    })

    const defs = await toolService.getAllToolDefinitions({
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
    const mcpService = {
      getAllToolDefinitions: vi
        .fn()
        .mockResolvedValue([buildToolDefinition('mcp_only', 'mcp-server')]),
      callTool: vi.fn().mockResolvedValue({ content: 'mcp-result' })
    } as any
    const toolService = new ToolService({
      mcpService,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({
        resolveConversationSessionInfo: vi.fn(async (sessionId: string) => ({
          sessionId,
          sessionKind: 'regular',
          agentType: 'deepchat'
        })),
        getTapeInfo: vi.fn(),
        searchTape: vi.fn(),
        getTapeContext: vi.fn(),
        listTapeAnchors: vi.fn(),
        handoffTape: vi.fn()
      })
    })

    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\runtime-workspace',
      conversationId: 'conv-1',
      agentId: 'agent-1',
      enabledMcpServerIds: ['mcp-server']
    })
    const runtimeManager = (toolService as any).agentToolManager

    const configurableDefs = await toolService.getConfigurableAgentToolDefinitions({
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
    expect(mcpService.getAllToolDefinitions).toHaveBeenCalledTimes(1)
    expect((toolService as any).agentToolManager).toBe(runtimeManager)
    expect(runtimeManager.agentWorkspacePath).toBe('C:\\runtime-workspace')

    const commitDispatch = vi.fn()
    const registerOutcomeProjection = vi.fn()
    await toolService.callTool(
      {
        id: 'tool-1',
        type: 'function',
        function: { name: 'mcp_only', arguments: '{}' },
        conversationId: 'conv-1'
      },
      {
        runId: 'run-1',
        permissionMode: 'full_access',
        commitDispatch,
        registerOutcomeProjection
      }
    )

    expect(mcpService.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ function: expect.objectContaining({ name: 'mcp_only' }) }),
      expect.objectContaining({
        agentId: 'agent-1',
        enabledServerIds: ['mcp-server'],
        runId: 'run-1',
        commitDispatch,
        registerOutcomeProjection,
        expectedTarget: {
          finalName: 'mcp_only',
          serverName: 'mcp-server',
          serverId: '11111111-1111-4111-8111-111111111111',
          configGeneration: 1,
          bindingHash: 'binding-hash',
          originalName: 'mcp_only'
        }
      })
    )
  })

  it('does not fall back to another conversation mapping when a tool is unavailable', async () => {
    const toolService = new ToolService({
      mcpService: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([])
      } as any,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace-b',
      conversationId: 'conv-b',
      disabledAgentTools: [QUESTION_TOOL_NAME]
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace-a',
      conversationId: 'conv-a'
    })

    await expect(
      toolService.callTool({
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
      toolService.callTool({
        id: 'tool-unknown',
        type: 'function',
        function: {
          name: QUESTION_TOOL_NAME,
          arguments: JSON.stringify({ question: 'Unknown conversation', options: [] })
        },
        conversationId: 'conv-unknown'
      })
    ).rejects.toThrow(`Tool ${QUESTION_TOOL_NAME} not found in any source`)

    toolService.clearConversationToolMapping('conv-b')
    await expect(
      toolService.callTool({
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
    const toolService = new ToolService({
      mcpService: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([])
      } as any,
      skillSettings: { isEnabled: () => false } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace'
    })
    const callTool = vi.fn().mockResolvedValue('draft-result')
    const agentToolManager = (toolService as any).agentToolManager
    agentToolManager.callTool = callTool

    await expect(
      toolService.callTool({
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
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([])
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: {
        getModelConfig: vi.fn()
      } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({
        listCronJobs: vi.fn().mockResolvedValue({ jobs: [], schedulerStatus: { state: 'idle' } }),
        previewCronSchedule: vi.fn().mockResolvedValue({ runs: [], error: null })
      })
    })

    const defs = await toolService.getAllToolDefinitions({
      disabledAgentTools: [],
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace'
    })

    expect(defs.some((tool) => tool.function.name === CRON_JOB_AGENT_TOOL_NAME)).toBe(true)

    const disabledCronJobDefs = await toolService.getAllToolDefinitions({
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
    const handler = new CronJobToolHandler(runtimePort.cronJobs)

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

    expect(runtimePort.cronJobs.previewCronSchedule).toHaveBeenCalledWith({
      cronExpr: '0 9 * * *',
      timezone: 'UTC',
      count: 2
    })
    expect(runtimePort.cronJobs.listCronJobRuns).toHaveBeenCalledWith('job-1', 2)
    expect(runtimePort.cronJobs.upsertCronJob).toHaveBeenCalledTimes(2)
    expect(runtimePort.cronJobs.toggleCronJob).toHaveBeenNthCalledWith(1, 'job-1', false, undefined)
    expect(runtimePort.cronJobs.toggleCronJob).toHaveBeenNthCalledWith(2, 'job-1', true, undefined)
    expect(runtimePort.cronJobs.runCronJobNow).toHaveBeenCalledWith('job-1', undefined)
    expect(runtimePort.cronJobs.deleteCronJob).toHaveBeenCalledWith('job-1', undefined)
  })

  it('commits cron mutations before invoking the scheduler runtime', async () => {
    const order: string[] = []
    const upsertCronJob = vi.fn().mockImplementation(async (_input, beforeMutation) => {
      beforeMutation?.()
      order.push('target')
      return cronJobFixture
    })
    const deleteCronJob = vi.fn().mockImplementation(async (_jobId, beforeMutation) => {
      beforeMutation?.()
      order.push('delete')
    })
    const runtimePort = buildAgentToolRuntimeMock({ upsertCronJob, deleteCronJob })
    const handler = new CronJobToolHandler(runtimePort.cronJobs)
    const beforeMutation = vi.fn(() => order.push('commit'))

    await handler.call(
      {
        action: 'create',
        job: {
          name: 'Journaled task',
          agentId: 'deepchat',
          taskPrompt: 'Run report'
        }
      },
      { beforeMutation }
    )

    expect(order).toEqual(['commit', 'target'])

    const readCommit = vi.fn()
    await handler.call({ action: 'list' }, { beforeMutation: readCommit })
    expect(readCommit).not.toHaveBeenCalled()

    const invalidCommit = vi.fn()
    await expect(
      handler.call({ action: 'create' }, { beforeMutation: invalidCommit })
    ).rejects.toThrow('job is required for create.')
    expect(invalidCommit).not.toHaveBeenCalled()

    const journalError = new Error('journal unavailable')
    await expect(
      handler.call(
        { action: 'delete', jobId: 'job-1' },
        {
          beforeMutation: () => {
            throw journalError
          }
        }
      )
    ).rejects.toBe(journalError)
    expect(order).not.toContain('delete')
  })

  it('requires approval for cronjob write actions', async () => {
    const upsertCronJob = vi.fn()
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([]),
        callTool: vi.fn()
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: {
        getModelConfig: vi.fn()
      } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({
        listCronJobs: vi.fn().mockResolvedValue({ jobs: [], schedulerStatus: { state: 'idle' } }),
        previewCronSchedule: vi.fn().mockResolvedValue({ runs: [], error: null }),
        upsertCronJob
      })
    })

    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: 'C:\\workspace',
      conversationId: 'conv-1'
    })

    await expect(
      toolService.preCheckToolPermission({
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
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    await toolService.getAllToolDefinitions({
      agentId: 'agent-1',
      enabledMcpServerIds: ['server-a'],
      chatMode: 'agent',
      conversationId: 'session-1'
    })

    expect(mcpService.getAllToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        enabledServerIds: ['server-a'],
        conversationId: 'session-1'
      })
    )
  })

  it('evaluates MCP permission at the shared broker boundary', async () => {
    const mcpService = {
      getAllToolDefinitions: vi
        .fn()
        .mockResolvedValue([buildToolDefinition('mcp_only', 'server-a')]),
      callTool: vi.fn()
    } as any
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: {
        getModelConfig: vi.fn()
      } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    const abortController = new AbortController()
    await toolService.getAllToolDefinitions({
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

    const result = await toolService.preCheckToolPermission(request, {
      permissionMode: 'default',
      signal: abortController.signal
    })

    expect(result).toMatchObject({
      needsPermission: true,
      conversationId: 'session-1',
      serverId: '11111111-1111-4111-8111-111111111111',
      serverName: 'server-a',
      toolName: 'mcp_only',
      source: 'model',
      permissionType: 'write'
    })
    expect(mcpService.callTool).not.toHaveBeenCalled()
  })

  it('rejects an unstable MCP target during pre-check and execution', async () => {
    const definition = buildToolDefinition('mcp_only', 'server-a')
    definition.server.id = undefined
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([definition]),
      callTool: vi.fn()
    } as any
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: {
        getModelConfig: vi.fn()
      } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'session-1'
    })
    const authorizeExecution = vi.spyOn(
      (toolService as unknown as { permissionBroker: { authorizeExecution(): unknown } })
        .permissionBroker,
      'authorizeExecution'
    )
    const request = {
      id: 'permission-1',
      type: 'function' as const,
      function: { name: 'mcp_only', arguments: '{}' },
      conversationId: 'session-1'
    }

    await expect(
      toolService.preCheckToolPermission(request, { permissionMode: 'default' })
    ).rejects.toThrow('no stable execution binding')
    await expect(toolService.callTool(request, { permissionMode: 'default' })).rejects.toThrow(
      'no stable execution binding'
    )

    expect(authorizeExecution).not.toHaveBeenCalled()
    expect(mcpService.callTool).not.toHaveBeenCalled()
  })

  it('observes a late agent permission failure after pre-check synchronously cancels', async () => {
    let rejectPermission!: (reason?: unknown) => void
    const permission = new Promise<never>((_, reject) => {
      rejectPermission = reject
    })
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: {
        getModelConfig: vi.fn()
      } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    const abortController = new AbortController()
    const lateError = new Error('late permission failure')
    const unhandled = vi.fn()
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'permission-cancel-session'
    })
    const agentToolManager = (toolService as any).agentToolManager
    agentToolManager.preCheckToolPermission = vi.fn().mockImplementation(() => {
      abortController.abort()
      return permission
    })

    await expect(
      toolService.preCheckToolPermission(
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
    const mcpService = {
      getAllToolDefinitions: vi
        .fn()
        .mockResolvedValue([buildToolDefinition('mcp_only', 'open-server')]),
      callTool: vi.fn().mockResolvedValue({ content: 'ok' })
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    const abortController = new AbortController()

    await toolService.getAllToolDefinitions({
      agentId: 'agent-1',
      enabledMcpServerIds: undefined,
      chatMode: 'agent',
      conversationId: 'session-unrestricted'
    })

    await toolService.callTool(
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
      { signal: abortController.signal, permissionMode: 'full_access' }
    )

    expect(mcpService.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'session-unrestricted' }),
      expect.objectContaining({
        agentId: 'agent-1',
        enabledServerIds: undefined,
        signal: abortController.signal
      })
    )
  })

  it('omits YoBrowser prompt text when no yobrowser tools are enabled', () => {
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const withoutYoBrowser = toolService.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition('read', 'agent-filesystem'),
          source: 'agent'
        }
      ]
    })
    const withYoBrowser = toolService.buildToolSystemPrompt({
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
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const withoutQuestion = toolService.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition('read', 'agent-filesystem'),
          source: 'agent'
        }
      ]
    })
    const withQuestion = toolService.buildToolSystemPrompt({
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
      'Each `options` item must be `{ "label": string, "description"?: string }`.'
    )
    expect(withQuestion).toContain(
      'Use `header` only as the optional top-level question title, never inside `options`.'
    )
    expect(withQuestion).toContain(
      'Do not send `questions`, `allowOther`, or stringified `options` JSON.'
    )
  })

  it('includes progress guidance only when update_plan is enabled', () => {
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const withoutProgress = toolService.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition('read', 'agent-filesystem'),
          source: 'agent'
        }
      ]
    })
    const withProgress = toolService.buildToolSystemPrompt({
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
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const prompt = toolService.buildToolSystemPrompt({
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

  it('describes source-qualified Tape recall when the tool pair is enabled', () => {
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const prompt = toolService.buildToolSystemPrompt({
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

    expect(prompt).toContain('`tape_search` supports `query`, `limit`, `kinds`, `start`, `end`')
    expect(prompt).toContain('`scope`')
    expect(prompt).toContain('source `sessionId`')
    expect(prompt).toContain('`tape_context` expands selected `entryIds`')
    expect(prompt).toContain('from exactly one source')
    expect(prompt).toContain('`sourceSessionId` for linked Tapes')
    expect(prompt).toContain('bounded evidence/context')
    expect(prompt).toContain('without dumping raw payloads')
  })

  it('describes the question schema and returns actionable validation errors', async () => {
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }
    const runtimePort = buildAgentToolRuntimeMock()

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: runtimePort
    })

    const defs = await toolService.getAllToolDefinitions({
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
    expect(
      (questionDef?.function.parameters as any)?.properties?.options?.items?.properties?.label
        ?.description
    ).toContain('Use `label`, not `header`')
    expect(
      (questionDef?.function.parameters as any)?.properties?.options?.items?.required
    ).toContain('label')
    expect((questionDef?.function.parameters as any)?.properties?.custom?.description).toContain(
      'The field name is `custom`, not `allowOther`.'
    )

    await expect(
      toolService.callTool({
        id: 'tool-alias',
        type: 'function',
        function: {
          name: 'deepchat_question',
          arguments: JSON.stringify({
            question: 'Pick one',
            options: [{ header: 'Option A', description: 'First option' }]
          })
        },
        conversationId: 'conv-1'
      })
    ).resolves.toMatchObject({
      rawData: {
        toolResult: {
          question: 'Pick one',
          options: [{ label: 'Option A', description: 'First option' }],
          multiple: false,
          custom: true
        }
      }
    })

    await expect(
      toolService.callTool({
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
      'Use a single object with fields `header?`, `question`, `options`, `multiple?`, and `custom?`.'
    )
  })

  it('guides search and directory discovery through exec', () => {
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    } as any
    const providerSettings = {
      getModelConfig: vi.fn()
    }

    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: providerSettings as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    const promptWithoutFocusedTools = toolService.buildToolSystemPrompt({
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

    const grepOnlyPrompt = toolService.buildToolSystemPrompt({
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
