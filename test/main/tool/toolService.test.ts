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
import { createOpaquePromptAssembly } from '@/agent/deepchat/resources/promptAssembly'
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
} from '@/agent/deepchat/runtime/toolSurface'
import {
  buildProgrammaticToolCapabilityV1,
  createProgrammaticToolSurfaceRunControllerV1,
  assertProgrammaticToolCapabilityViewCommitted,
  markProgrammaticToolCapabilityProvenanceCommitted,
  projectProgrammaticExecDefinition
} from '@/agent/deepchat/runtime/programmaticToolSurface'
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
} from '@/agent/deepchat/runtime/toolSurfaceCanaryDiagnostics'

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
  it('carries only the active frozen Programmatic capability to native exec', async () => {
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
      agentTools: buildAgentToolRuntimeMock()
    })
    const definitions = await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'session-1',
      sessionKind: 'regular',
      agentWorkspacePath: '/workspace'
    })
    const exec = definitions.find((definition) => definition.function.name === 'exec')
    if (!exec) throw new Error('Expected native exec definition')
    const projectedExec = projectProgrammaticExecDefinition([exec])[0]
    const remote = buildContractMcpDefinition()
    const controller = createProgrammaticToolSurfaceRunControllerV1({
      ceilingDefinitions: [projectedExec, remote],
      providerActiveDefinitions: [projectedExec],
      policyVersion: 'tool-service-programmatic-v1'
    })
    const request = {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: CONTRACT_RUN_ID,
      requestSeq: 1
    }
    const snapshot = controller.build({
      request,
      eligibleDefinitions: [projectedExec, remote]
    })
    controller.admit(snapshot)
    const capability = buildProgrammaticToolCapabilityV1({
      snapshot,
      taskContractContext: null,
      ceilings: {
        maxToolEffect: 'write',
        workspace: { kind: 'runtime_default' },
        maxSubagentDepth: 0
      },
      quotas: {
        maxChildren: 4,
        maxBatchSteps: 4,
        maxInputBytes: 1024,
        maxOutputBytes: 2048,
        maxDurationMs: 30_000
      }
    })
    markProgrammaticToolCapabilityProvenanceCommitted(capability, snapshot)
    const agentToolManager = (toolService as any).agentToolManager
    const callTool = vi.fn().mockResolvedValue('done')
    agentToolManager.callTool = callTool
    const programmaticToolParent = { takeArmedToken: vi.fn() } as never

    await expect(
      toolService.callTool(
        {
          id: 'exec-1',
          type: 'function',
          function: {
            name: 'exec',
            arguments: '{"command":"deepchat tool call","stdin":"{}"}'
          },
          conversationId: request.sessionId
        },
        {
          messageId: request.messageId,
          runId: request.runId,
          requestSeq: request.requestSeq,
          permissionMode: 'full_access',
          toolSurfaceSnapshot: snapshot,
          programmaticToolCapability: capability,
          programmaticToolParent,
          commitDispatch: vi.fn()
        }
      )
    ).resolves.toMatchObject({ content: 'done' })
    expect(callTool).toHaveBeenCalledWith(
      'exec',
      { command: 'deepchat tool call', stdin: '{}' },
      request.sessionId,
      expect.objectContaining({
        toolCallId: 'exec-1',
        runId: request.runId,
        messageId: request.messageId,
        requestSeq: request.requestSeq,
        programmaticToolCapability: capability,
        programmaticToolParent
      })
    )

    await expect(
      toolService.callTool(
        {
          id: 'read-1',
          type: 'function',
          function: { name: 'read', arguments: '{"path":"README.md"}' },
          conversationId: request.sessionId
        },
        {
          messageId: request.messageId,
          runId: request.runId,
          requestSeq: request.requestSeq,
          toolSurfaceSnapshot: snapshot,
          programmaticToolCapability: capability,
          programmaticToolParent,
          commitDispatch: vi.fn()
        }
      )
    ).rejects.toThrow(/requires active request-scoped exec dispatch with durable parent authority/)
    expect(callTool).toHaveBeenCalledOnce()

    await expect(
      toolService.callTool(
        {
          id: 'exec-without-commit',
          type: 'function',
          function: { name: 'exec', arguments: '{"command":"pwd"}' },
          conversationId: request.sessionId
        },
        {
          messageId: request.messageId,
          runId: request.runId,
          requestSeq: request.requestSeq,
          toolSurfaceSnapshot: snapshot,
          programmaticToolCapability: capability,
          programmaticToolParent
        }
      )
    ).rejects.toThrow(/requires active request-scoped exec dispatch with durable parent authority/)
    expect(callTool).toHaveBeenCalledOnce()
  })

  it('dispatches Programmatic MCP children only through frozen and live authority gates', async () => {
    let currentDefinition = buildContractMcpDefinition('remote_write')
    let enabledMcpServerIds: string[] | undefined
    const projection = vi.fn()
    const mcpCallTool = vi.fn(async (request, access) => {
      access.assertCurrentToolDefinition(currentDefinition)
      access.commitDispatch({
        toolName: request.function.name,
        toolSource: 'mcp',
        normalizedArguments: JSON.parse(request.function.arguments),
        target: {
          serverName: currentDefinition.server.name,
          originalName: currentDefinition.raw?.name
        }
      })
      access.registerOutcomeProjection(projection)
      return {
        content: 'written',
        rawData: { toolCallId: request.id, content: 'written' }
      }
    })
    const getAllToolDefinitions = vi.fn(async () => [currentDefinition])
    const resolveAuthority = (sessionId: string) => ({
      sessionId,
      agentId: 'agent-1',
      projectDir: null,
      sessionKind: 'regular' as const,
      disabledAgentTools: [],
      enabledMcpServerIds,
      subagentCapability: {
        available: false as const,
        reason: 'policy_disabled' as const,
        cacheKey: 'unavailable'
      }
    })
    const resolveConversationExecutionAuthority = vi.fn(async (sessionId: string) =>
      resolveAuthority(sessionId)
    )
    const resolveConversationExecutionAuthorityNow = vi.fn((sessionId: string) =>
      resolveAuthority(sessionId)
    )
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService: {
        getAllToolDefinitions,
        callTool: mcpCallTool
      } as any,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({
        resolveConversationExecutionAuthority,
        resolveConversationExecutionAuthorityNow
      })
    })
    const definitions = await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: 'session-1',
      sessionKind: 'regular',
      agentWorkspacePath: null
    })
    const exec = definitions.find((definition) => definition.function.name === 'exec')
    const remote = definitions.find(
      (definition) => definition.function.name === currentDefinition.function.name
    )
    if (!exec || !remote) throw new Error('Expected exec and remote Programmatic fixtures')
    const controller = createProgrammaticToolSurfaceRunControllerV1({
      ceilingDefinitions: [exec, remote],
      providerActiveDefinitions: [exec],
      policyVersion: 'tool-service-child-v1'
    })
    const requestIdentity = {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: CONTRACT_RUN_ID,
      requestSeq: 1
    }
    const snapshot = controller.build({
      request: requestIdentity,
      eligibleDefinitions: [exec, remote]
    })
    controller.admit(snapshot)
    const capability = buildProgrammaticToolCapabilityV1({
      snapshot,
      taskContractContext: null,
      ceilings: {
        maxToolEffect: 'write',
        workspace: { kind: 'runtime_default' },
        maxSubagentDepth: 1
      },
      quotas: {
        maxChildren: 4,
        maxBatchSteps: 4,
        maxInputBytes: 1024,
        maxOutputBytes: 2048,
        maxDurationMs: 30_000
      }
    })
    markProgrammaticToolCapabilityProvenanceCommitted(capability, snapshot)
    const entry = capability.entries[0]
    if (!entry) throw new Error('Expected one Programmatic child entry')
    const { table } = createTapeTableMock()
    const executionJournal = new ExecutionJournalService(() => table)
    const tokenAuthority = new AgentCliTokenAuthority({
      createToken: () => 'd'.repeat(43),
      createTokenId: () => 'deferred-child-authority'
    })
    const parentRegistry = new ProgrammaticToolParentRegistry({
      tokenAuthority,
      executionJournal
    })
    executionJournal.commitRunStarted({
      sessionId: requestIdentity.sessionId,
      runId: requestIdentity.runId,
      messageId: requestIdentity.messageId,
      runKind: 'deferred_tool'
    })
    const parent = parentRegistry.prepare({
      binding: {
        schemaVersion: AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
        surfaceVersion: LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
        operation: {
          ...requestIdentity,
          providerToolCallId: 'exec-deferred-1'
        },
        command: { domain: 'tool', verb: 'call' },
        route: 'tool.call',
        canonicalInvocationHash: 'd'.repeat(64),
        adapterMode: capability.adapterMode,
        capabilityHash: capability.capabilityHash,
        programmaticSurfaceHash: capability.programmaticSurfaceHash,
        quotas: capability.quotas
      },
      invocationAuthority: { capability, snapshot, permissionMode: 'full_access' },
      assertAuthorityActive: () =>
        assertProgrammaticToolCapabilityViewCommitted(capability, snapshot)
    })
    const outerDispatch = executionJournal.commitDispatch({
      sessionId: requestIdentity.sessionId,
      messageId: requestIdentity.messageId,
      operation: {
        runId: requestIdentity.runId,
        requestSeq: requestIdentity.requestSeq,
        providerToolCallId: 'exec-deferred-1'
      },
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'deepchat tool call', stdin: '{}' },
      target: { serverName: 'agent-filesystem', originalName: 'exec' }
    })
    parent.armOuterDispatch({
      ...outerDispatch,
      operation: parent.operation
    })
    const invocation = parentRegistry.resolveInvocation(
      parent.takeArmedToken().programmaticOperation
    )
    const childRequest = {
      id: 'programmatic-child-1',
      type: 'function' as const,
      function: {
        name: entry.target.providerVisibleName,
        arguments: '{"query":"calendar"}'
      },
      conversationId: requestIdentity.sessionId
    }
    const childAccess = {
      request: childRequest,
      capability,
      snapshot,
      entry,
      assertAuthorityActive: invocation.assertAuthorityActive,
      signal: new AbortController().signal,
      commitDispatch: vi.fn(),
      registerOutcomeProjection: vi.fn()
    }

    const permission = await toolService.callProgrammaticToolChild({
      ...childAccess,
      permissionMode: 'default'
    })
    expect(permission.rawData).toMatchObject({ requiresPermission: true })
    expect(mcpCallTool).not.toHaveBeenCalled()
    expect(childAccess.commitDispatch).not.toHaveBeenCalled()

    const distinctPermission = await toolService.callProgrammaticToolChild({
      ...childAccess,
      request: { ...childRequest, id: 'programmatic-child-2' },
      permissionMode: 'default'
    })
    expect(distinctPermission.rawData).toMatchObject({ requiresPermission: true })
    expect(distinctPermission.rawData.permissionRequest?.requestId).not.toBe(
      permission.rawData.permissionRequest?.requestId
    )

    await expect(
      toolService.callProgrammaticToolChild({
        ...childAccess,
        entry: { ...entry },
        permissionMode: 'full_access'
      })
    ).rejects.toThrow(/does not belong to its active frozen View/)
    expect(mcpCallTool).not.toHaveBeenCalled()

    await expect(
      toolService.callProgrammaticToolChild({
        ...childAccess,
        permissionMode: 'full_access'
      })
    ).resolves.toMatchObject({ content: 'written' })
    expect(mcpCallTool).toHaveBeenLastCalledWith(
      childRequest,
      expect.objectContaining({ throwPreDispatchErrors: true })
    )
    expect(resolveConversationExecutionAuthority).toHaveBeenCalledTimes(4)
    expect(resolveConversationExecutionAuthorityNow).toHaveBeenCalledOnce()
    expect(childAccess.commitDispatch).toHaveBeenCalledWith({
      toolName: entry.target.providerVisibleName,
      toolSource: 'mcp',
      normalizedArguments: { query: 'calendar' },
      target: {
        serverName: currentDefinition.server.name,
        originalName: currentDefinition.raw?.name
      }
    })
    expect(childAccess.registerOutcomeProjection).toHaveBeenCalledWith(projection)

    enabledMcpServerIds = []
    await expect(
      toolService.callProgrammaticToolChild({
        ...childAccess,
        permissionMode: 'full_access'
      })
    ).rejects.toMatchObject({
      code: 'tool_not_allowed',
      message: expect.stringMatching(/disabled by current runtime authority/)
    })
    expect(mcpCallTool).toHaveBeenCalledOnce()

    enabledMcpServerIds = undefined
    currentDefinition = {
      ...currentDefinition,
      function: {
        ...currentDefinition.function,
        description: 'definition changed after View assembly'
      }
    }
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: requestIdentity.sessionId,
      sessionKind: 'regular',
      agentWorkspacePath: null
    })
    await expect(
      toolService.callProgrammaticToolChild({
        ...childAccess,
        permissionMode: 'full_access'
      })
    ).rejects.toMatchObject({
      code: 'conflicting_tool',
      message: expect.stringMatching(/definition changed after provider View assembly/)
    })
    expect(mcpCallTool).toHaveBeenCalledOnce()

    getAllToolDefinitions.mockResolvedValueOnce([])
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: requestIdentity.sessionId,
      sessionKind: 'regular',
      agentWorkspacePath: null
    })
    await expect(
      toolService.callProgrammaticToolChild({
        ...childAccess,
        permissionMode: 'full_access'
      })
    ).rejects.toMatchObject({
      code: 'target_mismatch',
      message: expect.stringMatching(/no longer resolves to its frozen Programmatic target/)
    })
    expect(mcpCallTool).toHaveBeenCalledOnce()

    currentDefinition = remote
    await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: requestIdentity.sessionId,
      sessionKind: 'regular',
      agentWorkspacePath: null
    })
    revokeToolSurfaceExecutionEligibility(snapshot)
    await expect(
      toolService.callProgrammaticToolChild({
        ...childAccess,
        assertAuthorityActive: invocation.assertAuthorityActive,
        permissionMode: 'full_access'
      })
    ).resolves.toMatchObject({ content: 'written' })

    await expect(
      toolService.callProgrammaticToolChild({
        ...childAccess,
        assertAuthorityActive: undefined,
        permissionMode: 'full_access'
      } as never)
    ).rejects.toThrow(/authority assertion was not issued/)
    parentRegistry.releaseSession(requestIdentity.sessionId)
  })

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

  it('prevents MCP tools from shadowing the reserved ToolSearch identity', async () => {
    const mcpService = {
      getAllToolDefinitions: vi
        .fn()
        .mockResolvedValue([buildToolDefinition(TOOL_SEARCH_AGENT_TOOL_NAME, 'mcp-search')]),
      callTool: vi.fn()
    } as any
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
    const toolService = new ToolService({
      skillSettings: { isEnabled: () => false } as any,
      mcpService,
      agentSettings: { resolveDeepChatAgentConfig: vi.fn(async () => ({})) } as any,
      providerSettings: { getModelConfig: vi.fn() } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentTools: buildAgentToolRuntimeMock({
        resolveConversationExecutionAuthority,
        resolveConversationExecutionAuthorityNow: (sessionId: string) => ({
          sessionId,
          agentId: 'agent-1',
          projectDir: '/workspace',
          sessionKind: 'regular',
          disabledAgentTools: [],
          enabledMcpServerIds: undefined,
          subagentCapability: {
            available: false,
            reason: 'policy_disabled',
            cacheKey: 'unavailable'
          }
        })
      })
    })

    const definitions = await toolService.getAllToolDefinitions({
      chatMode: 'agent',
      agentWorkspacePath: 'C:\\\\workspace',
      conversationId: 'session-1'
    })
    expect(
      definitions.filter((definition) => definition.function.name === TOOL_SEARCH_AGENT_TOOL_NAME)
    ).toEqual([])

    const missingProjection = buildToolSurfaceExecutionContext()
    const missingProjectionCommit = vi.fn()
    await expect(
      toolService.callTool(
        {
          id: 'tool-search-missing-projection',
          type: 'function',
          function: {
            name: TOOL_SEARCH_AGENT_TOOL_NAME,
            arguments: JSON.stringify({ query: 'hidden' })
          },
          conversationId: missingProjection.request.sessionId
        },
        {
          messageId: missingProjection.request.messageId,
          runId: missingProjection.request.runId,
          requestSeq: missingProjection.request.requestSeq,
          toolSurfaceContext: missingProjection.context,
          commitDispatch: missingProjectionCommit
        }
      )
    ).rejects.toThrow(/dispatch and outcome projection capabilities/)
    expect(missingProjectionCommit).not.toHaveBeenCalled()
    missingProjection.batch.discard()

    const active = buildToolSurfaceExecutionContext()
    const evidence = createToolSurfaceCanaryRunEvidenceRecorder()
    bindToolSurfaceCanaryRunEvidence(active.context.snapshot, evidence)
    const order: string[] = []
    const commitDispatch = vi.fn(() => order.push('dispatch'))
    let projectOutcome: (() => void) | undefined
    const executionContract = buildToolExecutionContract(buildToolSearchDefinition())
    expect(
      executionContract.ceilings.tools.map((ceiling) => ceiling.target.providerVisibleName)
    ).toEqual([TOOL_SEARCH_AGENT_TOOL_NAME])
    const result = await toolService.callTool(
      {
        id: 'tool-search-1',
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
        executionContract,
        commitDispatch,
        registerOutcomeProjection: (projection) => {
          order.push('projection-registration')
          projectOutcome = projection
        }
      }
    )
    expect(JSON.parse(String(result.content))).toEqual({
      results: [expect.objectContaining({ name: 'hidden', state: 'pending' })]
    })
    expect(commitDispatch).toHaveBeenCalledWith({
      toolName: TOOL_SEARCH_AGENT_TOOL_NAME,
      toolSource: 'agent',
      normalizedArguments: { query: 'hidden', limit: 5 },
      target: {
        serverName: 'agent-tool-surface',
        originalName: TOOL_SEARCH_AGENT_TOOL_NAME
      }
    })
    expect(projectOutcome).toBeTypeOf('function')
    expect(order).toEqual(['dispatch', 'projection-registration'])
    projectOutcome?.()
    active.batch.acceptToolCallCandidates(0)
    expect(active.batch.seal()).toEqual([
      expect.objectContaining({ requestSeq: active.request.requestSeq, resultRank: 0 })
    ])
    expect(evidence.snapshot().discovery).toEqual({
      searchCalls: 1,
      describeCalls: 0,
      failedCalls: 0,
      zeroResultCalls: 0,
      returnedTargetResults: 1,
      repeatedSearchTargetResults: 0
    })
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

  it('resolves an owned definition universe without replacing runtime dispatch state', async () => {
    const publishedDefinition = buildToolDefinition('published_tool', 'published-server')
    const universeDefinition = buildToolDefinition('universe_tool', 'universe-server')
    const conflictingUniverseDefinition = buildToolDefinition('read', 'universe-server')
    const mcpService = {
      getAllToolDefinitions: vi.fn().mockResolvedValueOnce([publishedDefinition]),
      snapshotCachedToolDefinitions: vi.fn().mockResolvedValue({
        state: 'ready',
        complete: true,
        failedSourceCount: 0,
        tools: [universeDefinition, conflictingUniverseDefinition]
      }),
      callTool: vi.fn()
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
    const context = {
      chatMode: 'agent' as const,
      conversationId: 'conv-universe',
      agentWorkspacePath: 'C:\\\\workspace',
      enabledMcpServerIds: ['published-server']
    }

    await toolService.getAllToolDefinitions(context)
    const publishedAgentManager = (toolService as any).agentToolManager
    const publishedMapper = (toolService as any).conversationMappers.get('conv-universe')
    const publishedMcpDefinitions = (toolService as any).conversationMcpDefinitions.get(
      'conv-universe'
    )
    const publishedAccess = (toolService as any).conversationMcpAccessContexts.get('conv-universe')
    const syncContextSpy = vi.spyOn(AgentToolManager.prototype, 'syncContext')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const universe = await toolService.getToolDefinitionUniverse({
      ...context,
      enabledMcpServerIds: ['universe-server']
    })

    expect(universe).toMatchObject({ complete: true, unavailableSourceCount: 0 })
    expect(
      universe.definitions.some((definition) => definition.function.name === 'universe_tool')
    ).toBe(true)
    expect(
      universe.definitions.some((definition) => definition.function.name === 'published_tool')
    ).toBe(false)
    expect(
      universe.definitions.filter(
        (definition) => definition.function.name === 'read' && definition.source === 'mcp'
      )
    ).toHaveLength(1)
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Tool name conflict'))
    expect((toolService as any).agentToolManager).toBe(publishedAgentManager)
    expect((toolService as any).conversationMappers.get('conv-universe')).toBe(publishedMapper)
    expect((toolService as any).conversationMcpDefinitions.get('conv-universe')).toBe(
      publishedMcpDefinitions
    )
    expect((toolService as any).conversationMcpAccessContexts.get('conv-universe')).toBe(
      publishedAccess
    )
    expect(syncContextSpy).not.toHaveBeenCalled()
    expect(publishedMapper.getToolSource('published_tool')).toBe('mcp')
    expect(publishedMapper.getToolSource('universe_tool')).toBeUndefined()
    expect([...publishedMcpDefinitions.keys()]).toEqual(['published_tool'])

    mcpService.snapshotCachedToolDefinitions.mockResolvedValueOnce({ state: 'uninitialized' })
    await expect(toolService.getToolDefinitionUniverse(context)).resolves.toMatchObject({
      complete: false,
      unavailableSourceCount: 1
    })

    mcpService.snapshotCachedToolDefinitions.mockResolvedValueOnce({
      state: 'ready',
      complete: false,
      failedSourceCount: 2,
      tools: [universeDefinition]
    })
    const partialUniverse = await toolService.getToolDefinitionUniverse(context)
    expect(partialUniverse).toMatchObject({ complete: false, unavailableSourceCount: 2 })
    expect(
      partialUniverse.definitions.some((definition) => definition.function.name === 'universe_tool')
    ).toBe(true)

    mcpService.snapshotCachedToolDefinitions.mockResolvedValueOnce({
      state: 'ready',
      complete: true,
      failedSourceCount: 2,
      tools: [universeDefinition]
    })
    await expect(toolService.getToolDefinitionUniverse(context)).resolves.toMatchObject({
      complete: false,
      unavailableSourceCount: 1
    })

    mcpService.snapshotCachedToolDefinitions.mockResolvedValueOnce({
      state: 'ready',
      complete: false,
      failedSourceCount: Number.POSITIVE_INFINITY,
      tools: [universeDefinition]
    })
    await expect(toolService.getToolDefinitionUniverse(context)).resolves.toMatchObject({
      complete: false,
      unavailableSourceCount: 1
    })
    syncContextSpy.mockRestore()
    warnSpy.mockRestore()
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
        { signal: abortController.signal, activeSkillNames: ['message-skill'] }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(agentToolManager.preCheckToolPermission).toHaveBeenCalledWith(
      UPDATE_PLAN_TOOL_NAME,
      {},
      'permission-cancel-session',
      expect.objectContaining({ activeSkillNames: ['message-skill'] })
    )

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
