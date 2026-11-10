import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import { RUN_CODE_PROTOCOL_VERSION, type RunCodeParentMessage } from '@shared/codeModeProtocol'
import { ToolService } from '@/tool'
import { RunCodeRuntimeManager } from '@/tool/codeMode/runCodeRuntimeManager'
import { POSIX_COMMAND_SHELL } from '../../helpers/commandShell'
import { createToolCatalogPort } from '@/agent/shared/resources/toolCatalog'
import { AgentToolManager, CronJobToolHandler, TAPE_TOOL_NAMES } from '@/tool/agentTools'
import { CommandPermissionService, ToolPermissionBroker } from '@/tool/permission'
import { QUESTION_TOOL_NAME } from '@shared/contracts/questionTool'
import { IMAGE_GENERATE_TOOL_NAME } from '@shared/agentImageGenerationTool'
import { createAgentToolDependencies } from './agentTools/agentToolDependencies'
import {
  CRON_JOB_AGENT_TOOL_NAME,
  LIVE_DELEGATION_AGENT_TOOL_NAME,
  SKILL_AGENT_TOOL_NAMES,
  SKILL_LIST_AGENT_TOOL_NAME,
  SKILL_MANAGE_AGENT_TOOL_NAME,
  SKILL_RUN_AGENT_TOOL_NAME,
  SKILL_VIEW_AGENT_TOOL_NAME,
  SUBAGENT_ORCHESTRATOR_TOOL_NAME,
  TOOL_SEARCH_AGENT_TOOL_NAME,
  assertAgentToolExposure,
  getAgentToolExposure
} from '@shared/agentTools'
import { resolveDeepChatSubagentCapability } from '@shared/lib/deepchatSubagents'
import { parseChildAgentResultEnvelope } from '@shared/orchestration/resultSafety'
import { LiveDelegationConsentAuthority } from '@/orchestration/liveDelegationConsent'
import { createOpaquePromptAssembly } from '@/agent/shared/resources/promptAssembly'
import { buildExecutionContract } from '@/tape/domain/executionContract'
import {
  buildCanonicalToolCatalog,
  buildToolSurfaceDeferredDispatchBinding,
  createFullToolSurfaceRunController,
  createPolicySelectedToolSurfaceRun,
  createToolSurfaceExecutionBatch,
  registerToolSurfaceDeferredDispatch,
  revokeToolSurfaceDeferredDispatch,
  revokeToolSurfaceExecutionEligibility,
  type ToolSurfaceShadowPolicy
} from '@/tool/catalog/toolSurface'
import {
  buildProgrammaticToolCapabilityV1,
  createProgrammaticToolSurfaceRunControllerV1,
  assertProgrammaticToolCapabilityViewCommitted,
  markProgrammaticToolCapabilityProvenanceCommitted,
  projectProgrammaticExecDefinition
} from '@/tool/catalog/programmaticToolSurface'
import {
  AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
  AgentCliTokenAuthority
} from '@/cli/agentTokenAuthority'
import { ProgrammaticToolParentRegistry } from '@/cli/programmaticToolParentRegistry'
import { LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION } from '@shared/contracts/localControl'
import { ExecutionJournalService } from '@/tape/application/executionJournalService'
import { createTapeTableMock } from '../session/data/tapeTestHarness'
import { buildToolSearchDefinition } from '@/tool/agentTools/toolSearchTool'
import {
  bindToolSurfaceCanaryRunEvidence,
  createToolSurfaceCanaryRunEvidenceRecorder
} from '@/tool/catalog/toolSurfaceCanaryDiagnostics'

vi.mock('electron', async () => {
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { rmSync } = await import('node:fs')
  // Isolate the mocked userData per worker process and clean it up on exit so
  // parallel workers never share persistent electron-store state.
  const userDataDir = join(tmpdir(), `deepchat-vitest-userdata-toolservice-${process.pid}`)
  process.on('exit', () => {
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })
  const electronModuleMock = {
    app: {
      getName: () => 'DeepChat',
      getVersion: () => '0.0.0-test',
      getPath: (type: string) => (type === 'userData' ? userDataDir : '/mock/path')
    },
    ipcMain: {
      on: () => {},
      handle: () => {}
    },
    shell: {
      openPath: async () => ''
    }
  }
  return { ...electronModuleMock, default: electronModuleMock }
})

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

function buildToolSurfaceExecutionContext(stale = false) {
  const agentTool = (name: string): MCPToolDefinition => ({
    type: 'function',
    source: 'agent' as const,
    execution: TOOL_EXECUTION.read.parallel,
    function: {
      name,
      description: `${name} tool`,
      parameters: { type: 'object', properties: {} }
    },
    server: { name: 'deepchat', icons: '', description: 'DeepChat' }
  })
  const hidden = agentTool('hidden')
  const toolSearch = buildToolSearchDefinition()
  const policy: ToolSurfaceShadowPolicy = {
    policyVersion: 'tool-service-test-v1',
    enterToolCount: 1,
    exitToolCount: 0,
    enterEstimatedInputTokens: 1,
    exitEstimatedInputTokens: 0,
    maxInitialToolCount: 2,
    maxInitialDefinitionTokens: 100_000,
    activationReserveToolCount: 1,
    activationReserveDefinitionTokens: 10_000,
    maxActivationCandidatesPerBatch: 2,
    maxActivationCandidateDefinitionTokensPerBatch: 10_000,
    maxActivationBatchesPerRun: 2,
    maxAppendedTargetsPerRun: 2,
    toolSearchDefinitionTokens: buildCanonicalToolCatalog([toolSearch]).definitionTokens,
    toolSearchPromptTokens: 0
  }
  const selected = createPolicySelectedToolSurfaceRun({
    ceilingDefinitions: [hidden],
    initialEligibleDefinitions: [hidden],
    toolSearchDefinition: toolSearch,
    policy,
    coreStableTargetKeys: []
  })
  const request = {
    sessionId: 'session-1',
    messageId: 'message-1',
    runId: CONTRACT_RUN_ID,
    requestSeq: 1
  }
  const snapshot = selected.controller.build({
    request,
    eligibleDefinitions: [hidden],
    toolSearchAvailable: true
  })
  selected.controller.admit(snapshot)
  const batch = createToolSurfaceExecutionBatch({ snapshot })
  const context = batch.createContext(0)
  if (stale) batch.seal()
  return { batch, context, request }
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
  it('dispatches an unchanged MCP definition through the exact Tool Surface boundary', async () => {
    const definition = buildContractMcpDefinition()
    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [definition],
      initialActiveDefinitions: [definition],
      policyVersion: 'tool-service-test-v1'
    })
    const request = {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: CONTRACT_RUN_ID,
      requestSeq: 1
    }
    const snapshot = controller.build({ request, eligibleDefinitions: [definition] })
    controller.admit(snapshot)
    const commitDispatch = vi.fn()
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([definition]),
      callTool: vi.fn(async (toolCall, access) => {
        access.assertCurrentToolDefinition({ ...definition, source: 'mcp' })
        access.commitDispatch({
          toolName: definition.function.name,
          toolSource: 'mcp',
          normalizedArguments: {},
          target: {
            serverName: definition.server.name,
            originalName: definition.raw.name
          }
        })
        return { toolCallId: toolCall.id, content: 'ok' }
      })
    } as any
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: request.sessionId,
      sessionKind: 'regular'
    })

    await expect(
      toolService.callTool(
        {
          id: 'unchanged-mcp-call',
          type: 'function',
          function: { name: definition.function.name, arguments: '{}' },
          conversationId: request.sessionId
        },
        {
          messageId: request.messageId,
          runId: request.runId,
          requestSeq: request.requestSeq,
          permissionMode: 'full_access',
          toolSurfaceSnapshot: snapshot,
          commitDispatch
        }
      )
    ).resolves.toMatchObject({ content: 'ok' })
    expect(commitDispatch).toHaveBeenCalledOnce()
  })

  it('requires a durable dispatch commit for deferred Tool Surface authority', async () => {
    const definition = buildContractMcpDefinition()
    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [definition],
      initialActiveDefinitions: [definition],
      policyVersion: 'tool-service-test-v1'
    })
    const request = {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: CONTRACT_RUN_ID,
      requestSeq: 1
    }
    const snapshot = controller.build({ request, eligibleDefinitions: [definition] })
    controller.admit(snapshot)
    const toolCallId = 'deferred-without-journal'
    const deferred = registerToolSurfaceDeferredDispatch({
      snapshot,
      toolCallId,
      toolName: definition.function.name,
      binding: buildToolSurfaceDeferredDispatchBinding({
        snapshot,
        toolCallId,
        toolName: definition.function.name,
        contractBearing: false
      })
    })!
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: { getAllToolDefinitions: vi.fn(), callTool: vi.fn() } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })

    try {
      await expect(
        toolService.callTool(
          {
            id: toolCallId,
            type: 'function',
            function: { name: definition.function.name, arguments: '{}' },
            conversationId: request.sessionId
          },
          {
            messageId: request.messageId,
            runId: request.runId,
            requestSeq: request.requestSeq,
            toolSurfaceDeferredDispatch: deferred
          }
        )
      ).rejects.toThrow(/requires a durable dispatch commit/)
    } finally {
      revokeToolSurfaceDeferredDispatch(request.sessionId, request.messageId, toolCallId)
    }
  })

  it('rejects Tool Surface definition drift before authorization or dispatch', async () => {
    const definition = buildContractMcpDefinition()
    const driftedDefinition = {
      ...definition,
      function: { ...definition.function, description: 'changed after provider View assembly' }
    }
    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [definition],
      initialActiveDefinitions: [definition],
      policyVersion: 'tool-service-test-v1'
    })
    const request = {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: CONTRACT_RUN_ID,
      requestSeq: 1
    }
    const snapshot = controller.build({ request, eligibleDefinitions: [definition] })
    controller.admit(snapshot)
    const mcpService = {
      getAllToolDefinitions: vi
        .fn()
        .mockResolvedValueOnce([definition])
        .mockResolvedValueOnce([driftedDefinition]),
      callTool: vi.fn()
    } as any
    const effectObserver = {
      beforeToolAuthorization: vi.fn(),
      beforeToolExecution: vi.fn()
    }
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
    const definitionContext = {
      chatMode: 'agent' as const,
      conversationId: request.sessionId,
      sessionKind: 'regular' as const
    }
    await toolService.getAllToolDefinitions(definitionContext)
    await toolService.getAllToolDefinitions(definitionContext)

    await expect(
      toolService.preCheckToolPermission(
        {
          id: 'drifted-pre-check',
          type: 'function',
          function: { name: definition.function.name, arguments: '{}' },
          conversationId: request.sessionId
        },
        {
          messageId: request.messageId,
          runId: request.runId,
          requestSeq: request.requestSeq,
          toolSurfaceSnapshot: snapshot
        }
      )
    ).rejects.toThrow(/changed after provider View assembly/)
    await expect(
      toolService.callTool(
        {
          id: 'drifted-call',
          type: 'function',
          function: { name: definition.function.name, arguments: '{}' },
          conversationId: request.sessionId
        },
        {
          messageId: request.messageId,
          runId: request.runId,
          requestSeq: request.requestSeq,
          toolSurfaceSnapshot: snapshot,
          commitDispatch: vi.fn()
        }
      )
    ).rejects.toThrow(/changed after provider View assembly/)
    expect(effectObserver.beforeToolAuthorization).not.toHaveBeenCalled()
    expect(effectObserver.beforeToolExecution).not.toHaveBeenCalled()
    expect(mcpService.callTool).not.toHaveBeenCalled()
  })

  it('rejects guessed inactive tools before source or target resolution', async () => {
    const active = buildToolSurfaceExecutionContext()
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: { getAllToolDefinitions: vi.fn(), callTool: vi.fn() } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    const sourceLookup = vi.spyOn(toolService as any, 'getToolSource')
    const mcpTargetLookup = vi.spyOn(toolService as any, 'getMcpDefinition')
    const agentTargetLookup = vi.spyOn(toolService as any, 'getAgentDefinition')

    for (const toolName of ['hidden', 'does_not_exist']) {
      const toolCall = {
        id: `guessed-${toolName}`,
        type: 'function' as const,
        function: { name: toolName, arguments: '{}' },
        conversationId: active.request.sessionId
      }
      const authority = {
        messageId: active.request.messageId,
        runId: active.request.runId,
        requestSeq: active.request.requestSeq,
        toolSurfaceSnapshot: active.context.snapshot
      }
      await expect(toolService.preCheckToolPermission(toolCall, authority)).rejects.toThrow(
        `Tool is not available in the current session: ${toolName}`
      )
      await expect(toolService.callTool(toolCall, authority)).rejects.toThrow(
        `Tool is not available in the current session: ${toolName}`
      )
    }

    expect(sourceLookup).not.toHaveBeenCalled()
    expect(mcpTargetLookup).not.toHaveBeenCalled()
    expect(agentTargetLookup).not.toHaveBeenCalled()
  })

  it('rechecks Tool Surface authority at the dispatch commit boundary', async () => {
    const definition = buildContractMcpDefinition()
    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [definition],
      initialActiveDefinitions: [definition],
      policyVersion: 'tool-service-test-v1'
    })
    const request = {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: CONTRACT_RUN_ID,
      requestSeq: 1
    }
    const snapshot = controller.build({ request, eligibleDefinitions: [definition] })
    controller.admit(snapshot)
    const commitDispatch = vi.fn()
    let toolService!: ToolService
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([definition]),
      callTool: vi.fn(async (_request, access) => {
        access.assertCurrentToolDefinition(definition)
        toolService.clearConversationToolMapping(request.sessionId)
        access.commitDispatch({
          toolName: definition.function.name,
          toolSource: 'mcp',
          normalizedArguments: {},
          target: {
            serverName: definition.server.name,
            originalName: definition.raw.name
          }
        })
        throw new Error('unreachable')
      })
    } as any
    toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: request.sessionId,
      sessionKind: 'regular'
    })

    await expect(
      toolService.callTool(
        {
          id: 'revoked-before-dispatch',
          type: 'function',
          function: { name: definition.function.name, arguments: '{}' },
          conversationId: request.sessionId
        },
        {
          messageId: request.messageId,
          runId: request.runId,
          requestSeq: request.requestSeq,
          permissionMode: 'full_access',
          toolSurfaceSnapshot: snapshot,
          commitDispatch
        }
      )
    ).rejects.toThrow(/not enabled by current runtime authority/)
    expect(commitDispatch).not.toHaveBeenCalled()
  })

  it('rejects exact MCP schema drift at the final target dispatch boundary', async () => {
    const definition = buildContractMcpDefinition()
    const driftedDefinition = {
      ...definition,
      function: { ...definition.function, description: 'Changed after View assembly' }
    }
    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [definition],
      initialActiveDefinitions: [definition],
      policyVersion: 'tool-service-test-v1'
    })
    const request = {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: CONTRACT_RUN_ID,
      requestSeq: 1
    }
    const snapshot = controller.build({ request, eligibleDefinitions: [definition] })
    controller.admit(snapshot)
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([definition]),
      callTool: vi.fn(async (_request, access) => {
        access.assertCurrentToolDefinition(driftedDefinition)
        throw new Error('unreachable')
      })
    } as any
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: request.sessionId,
      sessionKind: 'regular'
    })
    const commitDispatch = vi.fn()

    await expect(
      toolService.callTool(
        {
          id: 'schema-drift-before-dispatch',
          type: 'function',
          function: { name: definition.function.name, arguments: '{}' },
          conversationId: request.sessionId
        },
        {
          messageId: request.messageId,
          runId: request.runId,
          requestSeq: request.requestSeq,
          permissionMode: 'full_access',
          toolSurfaceSnapshot: snapshot,
          commitDispatch
        }
      )
    ).rejects.toThrow(/changed after provider View assembly/)
    expect(mcpService.callTool).toHaveBeenCalledOnce()
    expect(commitDispatch).not.toHaveBeenCalled()
  })

  it('rejects stale ToolSearch execution contexts before authorization side effects', async () => {
    const stale = buildToolSurfaceExecutionContext(true)
    const revoked = buildToolSurfaceExecutionContext()
    revokeToolSurfaceExecutionEligibility(revoked.context.snapshot)
    const active = buildToolSurfaceExecutionContext()
    const resolveConversationExecutionAuthority = vi.fn()
    const effectObserver = {
      beforeToolAuthorization: vi.fn(),
      beforeToolExecution: vi.fn()
    }
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([]),
        callTool: vi.fn()
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({ resolveConversationExecutionAuthority }),
      effectObserver
    })

    const toolSearchRequest = {
      id: 'tool-search-1',
      type: 'function' as const,
      function: { name: TOOL_SEARCH_AGENT_TOOL_NAME, arguments: '{}' },
      conversationId: stale.request.sessionId
    }
    await expect(
      toolService.callTool(toolSearchRequest, {
        messageId: stale.request.messageId,
        runId: stale.request.runId,
        requestSeq: stale.request.requestSeq,
        toolSurfaceContext: stale.context
      })
    ).rejects.toThrow(/no longer active|stale/)
    await expect(
      toolService.callTool(
        { ...toolSearchRequest, conversationId: revoked.request.sessionId },
        {
          messageId: revoked.request.messageId,
          runId: revoked.request.runId,
          requestSeq: revoked.request.requestSeq,
          toolSurfaceContext: revoked.context
        }
      )
    ).rejects.toThrow(/no longer active|stale/)
    await expect(
      toolService.callTool(toolSearchRequest, {
        messageId: 'wrong-message',
        runId: active.request.runId,
        requestSeq: active.request.requestSeq,
        toolSurfaceContext: active.context
      })
    ).rejects.toThrow(/does not match/)
    await expect(
      toolService.callTool(
        { ...toolSearchRequest, function: { name: 'not-search', arguments: '{}' } },
        {
          messageId: active.request.messageId,
          runId: active.request.runId,
          requestSeq: active.request.requestSeq,
          toolSurfaceContext: active.context
        }
      )
    ).rejects.toThrow(/reserved for ToolSearch/)
    await expect(
      toolService.callTool(toolSearchRequest, {
        messageId: active.request.messageId,
        runId: active.request.runId,
        requestSeq: active.request.requestSeq
      })
    ).rejects.toThrow(/requires an active request-scoped execution context/)
    await expect(
      toolService.callTool(toolSearchRequest, {
        messageId: active.request.messageId,
        runId: active.request.runId,
        requestSeq: active.request.requestSeq,
        toolSurfaceContext: { ...active.context }
      })
    ).rejects.toThrow(/not issued by the request-scoped builder/)
    expect(resolveConversationExecutionAuthority).not.toHaveBeenCalled()
    expect(effectObserver.beforeToolAuthorization).not.toHaveBeenCalled()
    expect(effectObserver.beforeToolExecution).not.toHaveBeenCalled()
    active.batch.discard()
  })

  it('rechecks ToolSearch context liveness after asynchronous authorization', async () => {
    const active = buildToolSurfaceExecutionContext()
    let resolveAuthorization!: (value: null) => void
    const beforeToolAuthorization = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveAuthorization = resolve
        })
    )
    const commitDispatch = vi.fn()
    const registerOutcomeProjection = vi.fn()
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: {
        getAllToolDefinitions: vi.fn().mockResolvedValue([]),
        callTool: vi.fn()
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock(),
      effectObserver: { beforeToolAuthorization, beforeToolExecution: vi.fn() }
    })
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      agentWorkspacePath: 'C:\\\\workspace',
      conversationId: active.request.sessionId
    })

    const pending = toolService.callTool(
      {
        id: 'tool-search-authorization-race',
        type: 'function',
        function: {
          name: TOOL_SEARCH_AGENT_TOOL_NAME,
          arguments: JSON.stringify({ query: 'hidden' })
        },
        conversationId: active.request.sessionId
      },
      {
        messageId: active.request.messageId,
        runId: active.request.runId,
        requestSeq: active.request.requestSeq,
        toolSurfaceContext: active.context,
        commitDispatch,
        registerOutcomeProjection
      }
    )
    await vi.waitFor(() => expect(beforeToolAuthorization).toHaveBeenCalledOnce())
    revokeToolSurfaceExecutionEligibility(active.context.snapshot)
    resolveAuthorization(null)

    await expect(pending).rejects.toThrow(/active provider View|no longer active|stale/)
    expect(commitDispatch).not.toHaveBeenCalled()
    expect(registerOutcomeProjection).not.toHaveBeenCalled()
    active.batch.discard()
  })

  describe.each([
    { providerId: 'deepseek', toolName: 'run_code' },
    { providerId: 'openai-codex', toolName: 'exec' }
  ])('$toolName execution timeout', ({ providerId, toolName }) => {
    const createService = () => {
      const service = new ToolService({
        skillSettings: { isEnabled: () => false } as any,
        mcpService: { getAllToolDefinitions: vi.fn().mockResolvedValue([]) } as any,
        agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
        providerSettings: { getModelConfig: vi.fn() } as any,
        settings: { get: vi.fn() },
        commandPermissionHandler: new CommandPermissionService(),
        agentTools: buildAgentToolRuntimeMock()
      })
      service.configureToolMode({
        conversationId: 'session-1',
        mode: 'code',
        providerId,
        commandShell: POSIX_COMMAND_SHELL,
        executionCatalog: []
      })
      return service
    }
    const request = (timeoutMs: unknown) => ({
      id: 'code-call',
      type: 'function' as const,
      function: {
        name: toolName,
        arguments:
          toolName === 'run_code'
            ? JSON.stringify({
                code: 'return true',
                description: 'Return true',
                timeout_ms: timeoutMs
              })
            : timeoutMs === undefined
              ? 'return true'
              : `// @exec: ${JSON.stringify({ timeout_ms: timeoutMs })}\nreturn true`
      },
      conversationId: 'session-1'
    })

    it.each([
      { timeoutMs: undefined, expected: 300000 },
      { timeoutMs: 900000, expected: 900000 },
      { timeoutMs: 1, expected: 1 },
      { timeoutMs: 2147483647, expected: 2147483647 }
    ])('uses $expected ms when timeout_ms is $timeoutMs', async ({ timeoutMs, expected }) => {
      const execute = vi.spyOn(RunCodeRuntimeManager.prototype, 'execute').mockResolvedValue({
        content: 'completed'
      })
      try {
        await createService().callTool(request(timeoutMs), { permissionMode: 'full_access' })

        expect(execute).toHaveBeenCalledOnce()
        expect(execute).toHaveBeenCalledWith(
          expect.objectContaining({ source: 'return true', timeoutMs: expected })
        )
      } finally {
        execute.mockRestore()
      }
    })

    it.each([0, -1, 1.5, '900000', null, 2147483648])(
      'rejects invalid timeout_ms %j before starting code',
      async (timeoutMs) => {
        const execute = vi.spyOn(RunCodeRuntimeManager.prototype, 'execute')
        const commitDispatch = vi.fn()
        try {
          await expect(
            createService().callTool(request(timeoutMs), {
              permissionMode: 'full_access',
              commitDispatch
            })
          ).rejects.toThrow('timeout_ms must be')

          expect(execute).not.toHaveBeenCalled()
          expect(commitDispatch).not.toHaveBeenCalled()
        } finally {
          execute.mockRestore()
        }
      }
    )
  })

  it('projects one execution catalog into Agent, Code, and Minimal modes', async () => {
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: { getAllToolDefinitions: vi.fn().mockResolvedValue([]) } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    const agentToolManager = (toolService as any).ensureAgentToolManager(null)
    agentToolManager.callTool = vi.fn().mockResolvedValue('question_requested')
    const execBase = buildToolDefinition('exec', 'agent-filesystem')
    const exec = {
      ...execBase,
      source: 'agent' as const,
      function: {
        ...execBase.function,
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'The shell command to execute' } },
          required: ['command']
        }
      }
    }
    const detailedFilesystem = ['read', 'write', 'edit', 'glob', 'grep'].map((name) => ({
      ...buildToolDefinition(name, 'agent-filesystem'),
      source: 'agent' as const
    }))
    const process = {
      ...buildToolDefinition('process', 'agent-filesystem'),
      source: 'agent' as const
    }
    const question = {
      ...buildToolDefinition(QUESTION_TOOL_NAME, 'agent-core'),
      source: 'agent' as const
    }
    const subagents = {
      ...buildToolDefinition(LIVE_DELEGATION_AGENT_TOOL_NAME, 'agent-core'),
      source: 'agent' as const
    }
    const remote = { ...buildToolDefinition('remote_search', 'remote'), source: 'mcp' as const }
    const executionCatalog = [exec, ...detailedFilesystem, process, question, subagents, remote]
    const commandShell = {
      profile: 'zsh',
      dialect: 'posix',
      pathStyle: 'native',
      executable: '/bin/zsh',
      args: ['-c'],
      displayName: 'Zsh'
    } as const

    const agent = toolService.configureToolMode({
      conversationId: 'session-1',
      mode: 'agent',
      providerId: 'deepseek',
      commandShell,
      executionCatalog
    })
    expect(agent.map((definition) => definition.function.name)).toEqual([
      'exec',
      'read',
      'write',
      'edit',
      'glob',
      'grep',
      'process',
      QUESTION_TOOL_NAME,
      LIVE_DELEGATION_AGENT_TOOL_NAME,
      'remote_search'
    ])
    expect(agent[0].function.description).toContain('Selected shell: Zsh (zsh).')
    expect(agent[0].function.parameters.properties.command).toEqual({
      type: 'string',
      description: 'The Zsh command to execute.'
    })
    expect(agent[1].function.description).not.toContain('Selected shell')
    expect(agent.map((definition) => definition.function.description).join('\n')).not.toContain(
      'Code Mode subtools'
    )

    const code = toolService.configureToolMode({
      conversationId: 'session-1',
      mode: 'code',
      providerId: 'deepseek',
      commandShell,
      executionCatalog
    })
    expect(code.map((definition) => definition.function.name)).toEqual([
      'run_code',
      QUESTION_TOOL_NAME,
      LIVE_DELEGATION_AGENT_TOOL_NAME
    ])
    expect(code[0].function.description).not.toContain(LIVE_DELEGATION_AGENT_TOOL_NAME)
    await expect(
      toolService.callTool(
        {
          id: 'run-code-default-permission',
          type: 'function',
          function: { name: 'run_code', arguments: JSON.stringify({ code: 'return true' }) },
          conversationId: 'session-1'
        },
        { permissionMode: 'default' }
      )
    ).resolves.toMatchObject({
      content: 'Code Mode requires Full Access permission mode.',
      rawData: {
        toolCallId: 'run-code-default-permission',
        content: 'Code Mode requires Full Access permission mode.',
        isError: true
      }
    })
    const codexCode = toolService.configureToolMode({
      conversationId: 'session-1',
      mode: 'code',
      providerId: 'openai-codex',
      commandShell,
      executionCatalog
    })
    expect(codexCode.map((definition) => definition.function.name)).toEqual([
      'exec',
      'wait',
      QUESTION_TOOL_NAME,
      LIVE_DELEGATION_AGENT_TOOL_NAME
    ])
    await expect(
      toolService.callTool({
        id: 'direct-question',
        type: 'function',
        function: {
          name: QUESTION_TOOL_NAME,
          arguments: JSON.stringify({
            question: 'Continue?',
            options: [{ label: 'Yes' }]
          })
        },
        conversationId: 'session-1'
      })
    ).resolves.toMatchObject({ content: 'question_requested' })
    await expect(
      toolService.callTool({
        id: 'direct-read',
        type: 'function',
        function: { name: 'read', arguments: '{}' },
        conversationId: 'session-1'
      })
    ).rejects.toThrow("Direct tool 'read' is unavailable in Code Mode")

    const restoredAgent = toolService.configureToolMode({
      conversationId: 'session-1',
      mode: 'agent',
      providerId: 'deepseek',
      commandShell,
      executionCatalog
    })
    expect(restoredAgent.map((definition) => definition.function.name)).toEqual([
      'exec',
      'read',
      'write',
      'edit',
      'glob',
      'grep',
      'process',
      QUESTION_TOOL_NAME,
      LIVE_DELEGATION_AGENT_TOOL_NAME,
      'remote_search'
    ])
    expect(
      restoredAgent.map((definition) => definition.function.description).join('\n')
    ).not.toContain('Code Mode subtools')

    const minimal = toolService.configureToolMode({
      conversationId: 'session-1',
      mode: 'minimal',
      providerId: 'deepseek',
      commandShell,
      executionCatalog
    })
    expect(minimal.map((definition) => definition.function.name)).toEqual([
      'exec',
      'process',
      'str_replace_editor',
      QUESTION_TOOL_NAME,
      LIVE_DELEGATION_AGENT_TOOL_NAME,
      'remote_search'
    ])
    expect(minimal.map((definition) => definition.function.description).join('\n')).not.toContain(
      'Code Mode subtools'
    )

    const minimalWithoutRead = toolService.configureToolMode({
      conversationId: 'session-1',
      mode: 'minimal',
      providerId: 'deepseek',
      commandShell,
      executionCatalog: executionCatalog.filter((definition) => definition.function.name !== 'read')
    })
    expect(minimalWithoutRead.map((definition) => definition.function.name)).toEqual([
      'exec',
      'process',
      QUESTION_TOOL_NAME,
      LIVE_DELEGATION_AGENT_TOOL_NAME,
      'remote_search'
    ])

    const codexMinimal = toolService.configureToolMode({
      conversationId: 'session-1',
      mode: 'minimal',
      providerId: 'openai-codex',
      commandShell,
      executionCatalog
    })
    expect(codexMinimal.map((definition) => definition.function.name)).toEqual([
      'exec',
      'process',
      'apply_patch',
      QUESTION_TOOL_NAME,
      LIVE_DELEGATION_AGENT_TOOL_NAME,
      'remote_search'
    ])
    expect(() =>
      toolService.configureToolMode({
        conversationId: 'session-1',
        mode: 'minimal',
        providerId: 'deepseek',
        commandShell,
        executionCatalog: executionCatalog.filter(
          (definition) => definition.function.name !== 'process'
        )
      })
    ).toThrow('Minimal Mode requires the built-in process tool.')
    await toolService.shutdownCodeRuntime()
  })

  it('fails Code Mode before provider I/O when normalized tool names collide', () => {
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: { getAllToolDefinitions: vi.fn().mockResolvedValue([]) } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    const commandShell = {
      profile: 'bash',
      dialect: 'posix',
      pathStyle: 'native',
      executable: '/bin/bash',
      args: ['-c'],
      displayName: 'Bash'
    } as const
    const left = { ...buildToolDefinition('mcp/read', 'left'), source: 'mcp' as const }
    const right = { ...buildToolDefinition('mcp-read', 'right'), source: 'mcp' as const }

    expect(() =>
      toolService.configureToolMode({
        conversationId: 'session-1',
        mode: 'code',
        providerId: 'openai-codex',
        commandShell,
        executionCatalog: [left, right]
      })
    ).toThrow("both map to 'mcp_read'")
  })

  it.each(['deepseek', 'openai-codex'])(
    'dispatches Code Mode subagent children under the %s entrypoint contract',
    async (providerId) => {
      const definitions: MCPToolDefinition[] = [
        ...['exec', 'read', 'glob'].map((name) => ({
          ...buildToolDefinition(name, 'agent-filesystem'),
          source: 'agent' as const,
          server: { name: 'agent-filesystem', icons: '', description: 'Filesystem tools' },
          execution: name === 'exec' ? TOOL_EXECUTION.write : TOOL_EXECUTION.read.parallel
        })),
        buildContractMcpDefinition()
      ]
      const authority = {
        sessionId: 'session-1',
        agentId: 'agent-1',
        projectDir: '/workspace',
        sessionKind: 'subagent' as const,
        parentSessionId: 'parent-1',
        disabledAgentTools: [],
        enabledMcpServerIds: [definitions[3].server.id!],
        subagentCapability: {
          available: false as const,
          reason: 'policy_disabled' as const,
          cacheKey: 'off'
        }
      }
      const mcpService = {
        callTool: vi.fn(async () => ({ content: 'remote result', rawData: {} }))
      } as any
      const toolService = new ToolService({
        skillSettings: { isEnabled: () => false } as any,
        mcpService,
        agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
        providerSettings: { getModelConfig: vi.fn() } as any,
        settings: { get: vi.fn() },
        commandPermissionHandler: new CommandPermissionService(),
        agentTools: buildAgentToolRuntimeMock({
          resolveConversationSessionInfo: vi.fn(async (sessionId: string) =>
            sessionId === 'parent-1'
              ? { ...authority, sessionId, sessionKind: 'regular' }
              : authority
          ),
          resolveConversationExecutionAuthority: vi.fn(async () => authority),
          resolveConversationExecutionAuthorityNow: vi.fn(() => authority)
        })
      })
      const agentToolManager = (toolService as any).ensureAgentToolManager(null)
      agentToolManager.callTool = vi.fn(async () => 'native result')
      const [entrypoint] = toolService.configureToolMode({
        conversationId: 'session-1',
        mode: 'code',
        providerId,
        commandShell: POSIX_COMMAND_SHELL,
        executionCatalog: definitions
      })
      const nestedResults: RunCodeParentMessage[] = []
      const host = Object.assign(new EventEmitter(), {
        pid: 42,
        kill: vi.fn(() => true),
        postMessage(message: RunCodeParentMessage) {
          if (message.type === 'START') {
            queueMicrotask(() => {
              for (const binding of message.bindings) {
                host.emit('message', {
                  type: 'NESTED_CALL',
                  version: RUN_CODE_PROTOCOL_VERSION,
                  cellId: message.cellId,
                  callId: binding.id,
                  bindingId: binding.id,
                  arguments: {}
                })
              }
            })
          } else if (message.type === 'NESTED_RESULT') {
            nestedResults.push(message)
            if (nestedResults.length === definitions.length) {
              queueMicrotask(() =>
                host.emit('message', {
                  type: 'RESULT',
                  version: RUN_CODE_PROTOCOL_VERSION,
                  cellId: message.cellId,
                  output: [],
                  store: {}
                })
              )
            }
          } else if (message.type === 'STOP') {
            queueMicrotask(() => host.emit('exit', 0))
          }
        }
      })
      const runtime = (toolService as any).runCodeRuntime
      runtime.managerOptions.spawnHost = async () => {
        setTimeout(
          () =>
            host.emit('message', {
              type: 'READY',
              version: RUN_CODE_PROTOCOL_VERSION,
              pid: host.pid
            }),
          0
        )
        return host
      }

      try {
        await toolService.callTool(
          {
            id: 'code-call-1',
            type: 'function',
            function: {
              name: entrypoint.function.name,
              arguments:
                providerId === 'openai-codex'
                  ? 'await tools.exec({})'
                  : JSON.stringify({
                      code: 'await tools.exec({})',
                      description: 'Run nested tools'
                    })
            },
            conversationId: 'session-1'
          },
          {
            runId: CONTRACT_RUN_ID,
            messageId: 'message-1',
            requestSeq: 1,
            executionContract: buildToolExecutionContract(entrypoint),
            permissionMode: 'full_access'
          }
        )
        expect(nestedResults).toHaveLength(definitions.length)
        for (const result of nestedResults) {
          expect(result).toMatchObject({ type: 'NESTED_RESULT', ok: true })
        }
        expect(agentToolManager.callTool).toHaveBeenCalledTimes(3)
        expect(mcpService.callTool).toHaveBeenCalledOnce()
      } finally {
        await toolService.shutdownCodeRuntime()
      }
    }
  )

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

  it('rechecks live runtime authority at the actual T1 boundary', async () => {
    const definition = buildContractMcpDefinition()
    const authority = {
      sessionId: 'session-1',
      agentId: 'agent-1',
      projectDir: '/workspace',
      sessionKind: 'regular' as const,
      disabledAgentTools: [] as string[],
      enabledMcpServerIds: [definition.server.id as string],
      subagentCapability: {
        available: false as const,
        reason: 'policy_disabled' as const,
        cacheKey: 'unavailable'
      }
    }
    const commitDispatch = vi.fn()
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValue([definition]),
      callTool: vi.fn(async (_request, access) => {
        authority.enabledMcpServerIds = []
        access.commitDispatch?.({
          toolName: definition.function.name,
          toolSource: 'mcp',
          normalizedArguments: {},
          target: { serverName: definition.server.name, originalName: definition.function.name }
        })
        throw new Error('target must not execute after runtime revocation')
      })
    } as any
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({
        resolveConversationExecutionAuthority: vi.fn(async () => authority),
        resolveConversationExecutionAuthorityNow: vi.fn(() => authority)
      })
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
          permissionMode: 'full_access',
          commitDispatch
        }
      )
    ).rejects.toMatchObject({ code: 'tool_not_allowed' })
    expect(commitDispatch).not.toHaveBeenCalled()
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

  it('keeps Skill capabilities reserved, enabled, and fail-closed against MCP shadowing', async () => {
    const skillNames = new Set<string>(SKILL_AGENT_TOOL_NAMES)
    const toolService = new ToolService({
      mcpService: {
        getAllToolDefinitions: vi
          .fn()
          .mockResolvedValue(
            SKILL_AGENT_TOOL_NAMES.map((name) => buildToolDefinition(name, 'untrusted-mcp'))
          )
      } as any,
      skillSettings: { isEnabled: () => true } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock()
    })
    const agentToolManager = (toolService as any).ensureAgentToolManager(null)
    const getAgentDefinitions = vi
      .spyOn(agentToolManager, 'getAllToolDefinitions')
      .mockResolvedValue(
        SKILL_AGENT_TOOL_NAMES.map((name) => buildToolDefinition(name, 'agent-skills'))
      )

    const definitions = await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conversation-1',
      disabledAgentTools: [...SKILL_AGENT_TOOL_NAMES]
    })
    const skillDefinitions = definitions.filter((definition) =>
      skillNames.has(definition.function.name)
    )

    expect(skillDefinitions).toHaveLength(SKILL_AGENT_TOOL_NAMES.length)
    expect(skillDefinitions.every((definition) => definition.source === 'agent')).toBe(true)
    expect(skillDefinitions.every((definition) => definition.server.name === 'agent-skills')).toBe(
      true
    )

    getAgentDefinitions.mockRejectedValueOnce(new Error('Agent catalog unavailable'))
    const fallback = await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conversation-1'
    })
    expect(fallback.some((definition) => skillNames.has(definition.function.name))).toBe(false)
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

  it('marks strict Agent catalog failures incomplete without logging private errors', async () => {
    const universeDefinition = buildToolDefinition('universe_tool', 'universe-server')
    const privateError = new Error('private-agent-availability-error')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: {
        getAllToolDefinitions: vi.fn(),
        snapshotCachedToolDefinitions: vi.fn().mockResolvedValue({
          state: 'ready',
          complete: true,
          failedSourceCount: 0,
          tools: [universeDefinition]
        }),
        callTool: vi.fn()
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({
        resolveConversationSessionInfo: vi.fn().mockRejectedValue(privateError)
      })
    })

    const universe = await toolService.getToolDefinitionUniverse({
      chatMode: 'agent',
      conversationId: 'conv-universe'
    })

    expect(universe).toMatchObject({ complete: false, unavailableSourceCount: 1 })
    expect(universe.definitions).toContainEqual(
      expect.objectContaining({ function: expect.objectContaining({ name: 'universe_tool' }) })
    )
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ error: privateError })
    )
    warnSpy.mockRestore()
  })

  it('stops a snapshot universe before Agent availability work when aborted', async () => {
    const resolveConversationSessionInfo = vi.fn()
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: {
        getAllToolDefinitions: vi.fn(),
        snapshotCachedToolDefinitions: vi.fn(() => new Promise(() => undefined)),
        callTool: vi.fn()
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({ resolveConversationSessionInfo })
    })
    const controller = new AbortController()

    const pending = toolService.getToolDefinitionUniverse(
      { chatMode: 'agent', conversationId: 'conv-universe' },
      { signal: controller.signal }
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(resolveConversationSessionInfo).not.toHaveBeenCalled()
  })

  it('stops a snapshot universe during Agent availability work when aborted', async () => {
    const resolveConversationSessionInfo = vi.fn(() => new Promise(() => undefined))
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: {
        getAllToolDefinitions: vi.fn(),
        snapshotCachedToolDefinitions: vi.fn().mockResolvedValue({
          state: 'ready',
          complete: true,
          failedSourceCount: 0,
          tools: []
        }),
        callTool: vi.fn()
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({ resolveConversationSessionInfo })
    })
    const controller = new AbortController()
    const pending = toolService.getToolDefinitionUniverse(
      { chatMode: 'agent', conversationId: 'conv-universe' },
      { signal: controller.signal }
    )
    await vi.waitFor(() => expect(resolveConversationSessionInfo).toHaveBeenCalledOnce())

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
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
    expect(getAgentToolExposure(SKILL_VIEW_AGENT_TOOL_NAME)).toBe('system-model')
    expect(getAgentToolExposure(SKILL_MANAGE_AGENT_TOOL_NAME)).toBe('system-model')
    expect(getAgentToolExposure(SKILL_RUN_AGENT_TOOL_NAME)).toBe('system-model')
    expect(getAgentToolExposure('read')).toBe('user-configurable')
    expect(getAgentToolExposure('__proto__')).toBe('user-configurable')
    expect(() => assertAgentToolExposure(TAPE_TOOL_NAMES.handoff, 'user-configurable')).toThrow(
      "Agent tool exposure mismatch for 'tape_handoff': expected 'user-configurable', registered 'runtime-only'."
    )
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

    const minimalPrompt = toolService.buildToolSystemPrompt({
      conversationId: 'conv-1',
      toolDefinitions: [
        {
          ...buildToolDefinition('exec', 'agent-filesystem'),
          source: 'agent'
        },
        {
          ...buildToolDefinition('process', 'agent-filesystem'),
          source: 'agent'
        },
        {
          ...buildToolDefinition('str_replace_editor', 'agent-filesystem'),
          source: 'agent'
        }
      ]
    })
    expect(minimalPrompt).toContain(
      'Use canonical Agent tool names only: exec, process, str_replace_editor.'
    )
    expect(minimalPrompt).not.toContain('read, write, edit')

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
