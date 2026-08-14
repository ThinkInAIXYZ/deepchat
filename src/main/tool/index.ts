import type { ProviderSettingsPort } from '@/provider/settings'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import {
  type McpServicePort,
  type McpExpectedToolTarget,
  type MCPToolCall,
  type MCPToolDefinition,
  type MCPToolDefinitionBase,
  type MCPToolResponse,
  type ToolExecutionContract
} from '@shared/types/mcp'
import type {
  ToolCallOptions,
  ToolDefinitionContext,
  ToolModeConfiguration,
  ToolPermissionPreCheckResult,
  ToolServicePort
} from '@shared/types/tool'
import type { PermissionMode, SessionKind } from '@shared/types/agent-interface'
import { resolveToolOffloadTemplatePath } from '@/agent/shared/storage/sessionPaths'
import { QUESTION_TOOL_NAME } from '@/tool/agentTools/questionTool'
import { ToolMapper, type ToolSource } from './toolMapper'
import {
  CRON_JOB_AGENT_TOOL_NAME,
  LIVE_DELEGATION_AGENT_TOOL_NAME,
  LIVE_DELEGATION_AGENT_TOOL_SERVER_NAME,
  SKILL_LIST_AGENT_TOOL_NAME,
  SUBAGENT_ORCHESTRATOR_TOOL_NAME,
  TAPE_TOOL_NAMES,
  getAgentToolExposure,
  isUserConfigurableAgentTool
} from '@shared/agentTools'
import {
  AgentToolManager,
  IMAGE_GENERATE_TOOL_NAME,
  UPDATE_PLAN_TOOL_NAME,
  AGENT_TAPE_TOOL_SERVER_NAME,
  CRON_JOB_TOOL_SERVER_NAME,
  type AgentToolCallResult
} from './agentTools'
import type {
  AgentDisplaySettingsPort,
  AgentToolDependencies,
  LiveDelegationStartAuthorization
} from './runtimePorts'
import {
  createAgentToolErrorResult,
  createAgentToolSuccessResult
} from '@shared/lib/agentToolResultEnvelope'
import { jsonrepair } from 'jsonrepair'
import { CommandPermissionService } from './permission'
import { ToolPermissionBroker, type ToolPermissionContext } from './permission'
import { YO_BROWSER_TOOL_NAMES } from './browser/definitions'
import type { SkillSettingsPort } from '@/skill/settings'
import type { AgentSettingsPort } from '@/agent/settings'
import type { SettingsStore } from '@/config/settingsStore'
import type { AgentCommandEnvironmentPort } from './agentTools/agentBashHandler'
import type { ToolEffectObserver } from './effectObserver'
import { resolvePluginToolPolicy } from '@/plugin/toolPolicyStore'
import { composeSubagentAuthority } from '@/session/subagentAuthority'
import type { LiveDelegationConsentIssuer } from '@/orchestration/liveDelegationConsent'
import { parseChildAgentResultEnvelopeText } from '@shared/orchestration/resultSafety'
import {
  ExecutionContractDispatchError,
  assertExecutionContractAllowsDispatch
} from '@/tape/domain/executionContract'
import { RunCodeRuntimeManager } from './codeMode/runCodeRuntimeManager'
import {
  APPLY_PATCH_TOOL_NAME,
  CODE_MODE_EXEC_TOOL_NAME,
  CODE_MODE_WAIT_TOOL_NAME,
  RUN_CODE_TOOL_NAME,
  createApplyPatchToolDefinition,
  createCodexCodeModeToolDefinitions,
  createRunCodeToolDefinition,
  createStrReplaceEditorToolDefinition,
  decorateExecForShell,
  filterCodeModeExecutionCatalog,
  isCodexToolFrontend,
  normalizeCodexToolName
} from './codeMode/toolModeTools'

type McpToolPort = Pick<McpServicePort, 'getAllToolDefinitions' | 'callTool'>

interface ToolServiceOptions {
  mcpService: McpToolPort
  providerSettings: Pick<ProviderSettingsPort, 'getModelConfig' | 'isKnownModel'>
  settings: Pick<SettingsStore, 'get'>
  agentSettings: Pick<AgentSettingsPort, 'resolveDeepChatAgentConfig'>
  skillSettings: SkillSettingsPort
  desktopSettings: AgentDisplaySettingsPort
  commandPermissionHandler: CommandPermissionService
  commandEnvironment?: AgentCommandEnvironmentPort
  permissionBroker?: ToolPermissionBroker
  liveDelegationConsent?: LiveDelegationConsentIssuer
  agentTools: AgentToolDependencies
  effectObserver?: ToolEffectObserver
}

const FILESYSTEM_TOOL_ORDER = ['read', 'write', 'edit', 'glob', 'grep', 'exec', 'process']
const OFFLOAD_TOOL_NAMES = new Set(['exec', 'cdp_send'])
const UNSAFE_CODE_MODE_TOOL_NAMES = new Set(['__proto__', 'constructor', 'prototype'])
const RESERVED_AGENT_TOOL_NAMES = new Set<string>([
  ...YO_BROWSER_TOOL_NAMES,
  IMAGE_GENERATE_TOOL_NAME,
  UPDATE_PLAN_TOOL_NAME,
  CRON_JOB_AGENT_TOOL_NAME,
  LIVE_DELEGATION_AGENT_TOOL_NAME,
  SUBAGENT_ORCHESTRATOR_TOOL_NAME,
  ...Object.values(TAPE_TOOL_NAMES)
])

const withToolSource = (tools: MCPToolDefinition[], source: 'mcp' | 'agent'): MCPToolDefinition[] =>
  tools.map((tool) => ({
    ...tool,
    source
  }))

const normalizeToolNames = (toolNames?: string[]): string[] => {
  if (!Array.isArray(toolNames)) {
    return []
  }

  return Array.from(
    new Set(
      toolNames
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

const normalizeOptionalToolNames = (toolNames?: string[]): string[] | undefined =>
  Array.isArray(toolNames) ? normalizeToolNames(toolNames) : undefined

const allowsExternalFileAccess = (mode?: PermissionMode): boolean =>
  mode === 'full_access' || mode === 'auto_approve'

type StoredMcpAccessContext = {
  agentId?: string
  enabledMcpServerIds?: string[]
  sessionKind?: SessionKind
}

type SubagentExecutionToolPolicy = {
  disabledAgentTools: string[]
  enabledMcpServerIds: string[] | undefined
}

type ConversationToolModeContext = {
  mode: ToolModeConfiguration['mode']
  frontend: 'codex' | 'function'
  executionCatalog: readonly MCPToolDefinition[]
}

type InternalToolCallOptions = ToolCallOptions & {
  codeModeNested?: boolean
}

type CodexExecInput = {
  source: string
  yieldTimeMs: number
  maxOutputTokens: number
}

type CodexWaitInput = {
  cellId: string
  yieldTimeMs: number
  maxTokens: number
  terminate: boolean
}

const CODE_MODE_DEFAULT_YIELD_TIME_MS = 10_000
const CODE_MODE_DEFAULT_MAX_OUTPUT_TOKENS = 10_000
const CODE_MODE_MIN_YIELD_TIME_MS = 250
const CODE_MODE_MAX_YIELD_TIME_MS = 300_000
const CODE_MODE_MAX_OUTPUT_TOKENS = 100_000

/**
 * Owns the merged Tool catalog and routes calls to MCP or built-in handlers.
 */
export class ToolService implements ToolServicePort {
  private readonly mapper: ToolMapper
  private readonly conversationMappers: Map<string, ToolMapper>
  private globalMapperConversationId: string | null = null
  private readonly conversationMcpAccessContexts = new Map<string, StoredMcpAccessContext>()
  private readonly conversationAgentDefinitions = new Map<string, Map<string, MCPToolDefinition>>()
  private readonly options: ToolServiceOptions
  private readonly permissionBroker: ToolPermissionBroker
  private readonly conversationMcpDefinitions = new Map<string, Map<string, MCPToolDefinition>>()
  private globalMcpDefinitions = new Map<string, MCPToolDefinition>()
  private agentToolManager: AgentToolManager | null = null
  private globalAgentDefinitions = new Map<string, MCPToolDefinition>()
  private readonly conversationToolModes = new Map<string, ConversationToolModeContext>()
  private readonly runCodeRuntime: RunCodeRuntimeManager

  constructor(options: ToolServiceOptions) {
    this.options = options
    this.permissionBroker = options.permissionBroker ?? new ToolPermissionBroker()
    this.mapper = new ToolMapper()
    this.conversationMappers = new Map()
    this.runCodeRuntime = new RunCodeRuntimeManager({
      executeNested: async (input) =>
        await this.callTool(
          {
            id: input.callId,
            type: 'function',
            function: {
              name: input.definition.function.name,
              arguments:
                input.definition.providerPresentation?.type === 'freeform' &&
                typeof input.arguments === 'string'
                  ? input.arguments
                  : JSON.stringify(input.arguments ?? {})
            },
            conversationId: input.sessionId
          },
          {
            ...input.options,
            runId: input.runId ?? input.options.runId,
            codeModeNested: true
          } as InternalToolCallOptions
        )
    })
  }

  private createAgentToolManager(agentWorkspacePath: string | null): AgentToolManager {
    return new AgentToolManager({
      agentWorkspacePath,
      providerSettings: this.options.providerSettings,
      settings: this.options.settings,
      agentSettings: this.options.agentSettings,
      skillSettings: this.options.skillSettings,
      desktopSettings: this.options.desktopSettings,
      commandPermissionHandler: this.options.commandPermissionHandler,
      commandEnvironment: this.options.commandEnvironment,
      dependencies: this.options.agentTools
    })
  }

  private ensureAgentToolManager(agentWorkspacePath: string | null): AgentToolManager {
    if (!this.agentToolManager) {
      this.agentToolManager = this.createAgentToolManager(agentWorkspacePath)
    }

    return this.agentToolManager
  }

  /**
   * Get all tool definitions from all sources
   * Returns unified MCP-format tool definitions
   */
  async getAllToolDefinitions(context: ToolDefinitionContext): Promise<MCPToolDefinition[]> {
    const defs: MCPToolDefinition[] = []
    const mapper = new ToolMapper()

    const chatMode = context.chatMode || 'agent'
    const supportsVision = context.supportsVision || false
    const agentWorkspacePath = context.agentWorkspacePath || null
    const skillsEnabled = this.options.skillSettings.isEnabled()
    this.rememberConversationMcpAccessContext(context.conversationId, {
      agentId: context.agentId,
      enabledMcpServerIds: context.enabledMcpServerIds,
      sessionKind: context.sessionKind
    })
    // 1. Get MCP tools
    const candidateMcpDefs = withToolSource(
      (
        await this.options.mcpService.getAllToolDefinitions({
          enabledTools: context.enabledMcpTools,
          enabledServerIds: context.enabledMcpServerIds,
          agentId: context.agentId,
          conversationId: context.conversationId
        })
      ).filter((tool) => !RESERVED_AGENT_TOOL_NAMES.has(tool.function.name)),
      'mcp'
    )

    // 2. Get Agent tools (always load in agent or acp agent mode)
    const agentToolManager = this.ensureAgentToolManager(agentWorkspacePath)
    let agentDefs: MCPToolDefinition[] = []

    try {
      agentDefs = withToolSource(
        await agentToolManager.getAllToolDefinitions({
          chatMode,
          supportsVision,
          agentWorkspacePath,
          conversationId: context.conversationId,
          activeSkillNames: context.activeSkillNames,
          subagentCapability: context.subagentCapability,
          skillsEnabled,
          ...(context.requireCompleteCatalog ? { requireCompleteCatalog: true } : {})
        }),
        'agent'
      )
    } catch (error) {
      console.warn('[Tool] Failed to load Agent tool definitions', error)
      if (context.requireCompleteCatalog) throw error
    }

    const hasBuiltInSkillDiscovery = agentDefs.some(
      (tool) =>
        tool.function.name === SKILL_LIST_AGENT_TOOL_NAME &&
        getAgentToolExposure(tool.function.name) === 'system-model'
    )
    const mcpDefs = hasBuiltInSkillDiscovery
      ? candidateMcpDefs.filter((tool) => tool.function.name !== SKILL_LIST_AGENT_TOOL_NAME)
      : candidateMcpDefs
    defs.push(...mcpDefs)
    mapper.registerTools(mcpDefs, 'mcp')
    this.rememberMcpDefinitions(context.conversationId, mcpDefs)

    try {
      const disabledAgentToolSet = new Set(normalizeToolNames(context.disabledAgentTools))
      const dedupedAgentDefs = agentDefs.filter((tool) => {
        if (!mapper.hasTool(tool.function.name)) return true
        console.warn(`[Tool] Tool name conflict for '${tool.function.name}', preferring MCP tool.`)
        return false
      })
      const filteredAgentDefs = dedupedAgentDefs.filter(
        (tool) =>
          !isUserConfigurableAgentTool(tool.function.name) ||
          !disabledAgentToolSet.has(tool.function.name)
      )
      defs.push(...filteredAgentDefs)
      mapper.registerTools(filteredAgentDefs, 'agent')
    } catch (error) {
      console.warn('[Tool] Failed to merge Agent tool definitions', error)
      if (context.requireCompleteCatalog) throw error
    }

    this.publishMapper(context.conversationId, mapper, defs)
    return defs
  }

  /**
   * Get only user-configurable Agent tool definitions for renderer settings.
   * This query intentionally does not touch runtime mappings or MCP access context.
   */
  async getConfigurableAgentToolDefinitions(
    context: ToolDefinitionContext
  ): Promise<MCPToolDefinition[]> {
    const chatMode = context.chatMode || 'agent'
    const supportsVision = context.supportsVision || false
    const agentWorkspacePath = context.agentWorkspacePath || null
    const agentToolManager = this.createAgentToolManager(null)

    try {
      const agentDefs = withToolSource(
        await agentToolManager.getAllToolDefinitions({
          chatMode,
          supportsVision,
          agentWorkspacePath,
          conversationId: context.conversationId,
          activeSkillNames: context.activeSkillNames,
          catalogPurpose: 'configurable'
        }),
        'agent'
      )

      return agentDefs.filter((tool) => isUserConfigurableAgentTool(tool.function.name))
    } catch (error) {
      console.warn('[ToolPresenter] Failed to load configurable Agent tool definitions', error)
      return []
    }
  }

  syncAgentToolContext(context: {
    chatMode?: 'agent' | 'acp agent'
    agentWorkspacePath?: string | null
  }): void {
    const chatMode = context.chatMode || 'agent'
    const agentWorkspacePath = context.agentWorkspacePath || null
    const agentToolManager = this.ensureAgentToolManager(agentWorkspacePath)

    agentToolManager.syncContext({
      chatMode,
      agentWorkspacePath
    })
  }

  configureToolMode(input: ToolModeConfiguration): MCPToolDefinition[] {
    const conversationId = input.conversationId.trim()
    if (!conversationId) throw new Error('Tool mode configuration requires a conversation ID.')

    const executionCatalog = (
      input.mode === 'code'
        ? filterCodeModeExecutionCatalog(input.executionCatalog)
        : input.executionCatalog
    ).map((definition) => decorateExecForShell(definition, input.commandShell))
    const frontend = isCodexToolFrontend(input.providerId) ? 'codex' : 'function'
    const previousMode = this.conversationToolModes.get(conversationId)
    if (
      previousMode?.mode === 'code' &&
      (input.mode !== 'code' || previousMode.frontend !== frontend)
    ) {
      this.runCodeRuntime.cancelSession(conversationId, 'Tool Mode changed.')
    }

    if (input.mode === 'minimal') {
      const execDefinition = executionCatalog.find(
        (definition) =>
          definition.source === 'agent' && definition.function.name === CODE_MODE_EXEC_TOOL_NAME
      )
      if (!execDefinition) {
        throw new Error('Minimal Mode requires the built-in exec tool.')
      }
      const editorDefinition =
        frontend === 'codex'
          ? createApplyPatchToolDefinition()
          : createStrReplaceEditorToolDefinition()
      const minimalCatalog = [execDefinition, editorDefinition]
      this.publishConfiguredCatalog(conversationId, minimalCatalog)
      this.conversationToolModes.set(conversationId, {
        mode: input.mode,
        frontend,
        executionCatalog: minimalCatalog
      })
      return minimalCatalog
    }

    if (input.mode === 'code') this.assertCodeModeCatalog(frontend, executionCatalog)
    this.publishConfiguredCatalog(conversationId, executionCatalog)
    this.conversationToolModes.set(conversationId, {
      mode: input.mode,
      frontend,
      executionCatalog
    })

    if (input.mode === 'agent') return executionCatalog
    return frontend === 'codex'
      ? createCodexCodeModeToolDefinitions(executionCatalog)
      : [createRunCodeToolDefinition()]
  }

  async shutdownCodeRuntime(): Promise<void> {
    await this.runCodeRuntime.shutdown()
  }

  clearConversationToolMapping(conversationId: string): void {
    const normalizedConversationId = conversationId.trim()
    if (!normalizedConversationId) {
      return
    }

    this.conversationMappers.delete(normalizedConversationId)
    this.conversationAgentDefinitions.delete(normalizedConversationId)
    this.conversationMcpAccessContexts.delete(normalizedConversationId)
    this.conversationMcpDefinitions.delete(normalizedConversationId)
    this.conversationToolModes.delete(normalizedConversationId)
    this.runCodeRuntime.cancelSession(normalizedConversationId)
    this.permissionBroker.cancelConversation(normalizedConversationId)
    this.clearAgentPlanState(normalizedConversationId)
  }

  clearAgentPlanState(conversationId: string): void {
    const normalizedConversationId = conversationId.trim()
    if (!normalizedConversationId) {
      return
    }

    this.agentToolManager?.clearPlanState(normalizedConversationId)
  }

  /**
   * Call a tool, routing to the appropriate source based on mapping
   */
  async callTool(
    request: MCPToolCall,
    options?: ToolCallOptions
  ): Promise<{ content: unknown; rawData: MCPToolResponse }> {
    options?.signal?.throwIfAborted()
    const internalOptions = options as InternalToolCallOptions | undefined
    if (!internalOptions?.codeModeNested) {
      const codeModeResult = await this.callCodeModeEntry(request, options)
      if (codeModeResult) return codeModeResult
      const sessionId = request.conversationId?.trim()
      if (sessionId && this.conversationToolModes.get(sessionId)?.mode === 'code') {
        throw new Error(
          `Direct tool '${request.function.name}' is unavailable in Code Mode; use the code entrypoint.`
        )
      }
    }
    const toolName = request.function.name
    const source = this.getToolSource(toolName, request.conversationId)

    if (!source) {
      throw new Error(`Tool ${toolName} not found in any source`)
    }
    await this.assertExecutionContractDispatchAllowed(request, source, options)
    const permissionMode =
      (await this.observeToolAuthorization(request, source, options?.signal))?.permissionMode ??
      options?.permissionMode

    if (source === 'agent') {
      if (!this.agentToolManager) {
        throw new Error(`Agent tool manager not initialized for tool ${toolName}`)
      }
      const args = this.parseAgentToolArguments(request.function.arguments, toolName)
      const preflightPolicy = await this.resolveSubagentExecutionToolPolicy(
        request.conversationId,
        options?.signal
      )
      this.assertSubagentAgentToolAllowed(preflightPolicy, toolName)

      let liveDelegationAuthorization: LiveDelegationStartAuthorization | undefined
      if (toolName === LIVE_DELEGATION_AGENT_TOOL_NAME) {
        const preChecked = await awaitWithAbort(
          this.agentToolManager.preCheckToolPermission(toolName, args, request.conversationId, {
            allowExternalFileAccess: allowsExternalFileAccess(permissionMode)
          }),
          options?.signal
        )
        const permissionContext = this.createRequiredAgentApprovalContext(
          request,
          args,
          preChecked,
          permissionMode
        )
        if (permissionContext) {
          const authorization = this.permissionBroker.authorizeExecution(
            permissionContext,
            options?.signal
          )
          if (!authorization.allowed) {
            return this.createPermissionRequiredResponse(request.id, authorization.request)
          }
          const operation = resolveLiveDelegationStartOperation(args.operation)
          const parentSessionId = request.conversationId?.trim()
          if (operation && parentSessionId) {
            if (!this.options.liveDelegationConsent) {
              throw new Error('Live delegation consent authority is unavailable.')
            }
            liveDelegationAuthorization = this.options.liveDelegationConsent.issue({
              parentSessionId,
              operation,
              executionId: request.id
            })
          }
        }
      }

      await this.observeToolExecution(request, source, permissionMode, options?.signal)
      const dispatchPolicy = await this.resolveSubagentExecutionToolPolicy(
        request.conversationId,
        options?.signal
      )
      this.assertSubagentAgentToolAllowed(dispatchPolicy, toolName)
      await this.assertExecutionContractDispatchAllowed(request, source, options)
      // Route to Agent tool manager
      const response = await this.agentToolManager.callTool(
        toolName,
        args,
        request.conversationId,
        {
          toolCallId: request.id,
          runId: options?.runId,
          requestSeq: options?.requestSeq,
          manifestHash: options?.manifestHash,
          tapeIncarnationId: options?.tapeIncarnationId,
          onProgress: options?.onProgress,
          signal: options?.signal,
          allowExternalFileAccess: allowsExternalFileAccess(permissionMode),
          activeSkillNames: options?.activeSkillNames,
          commandShell: options?.commandShell,
          oneShotCommandGrantId: options?.oneShotCommandGrantId,
          liveDelegationAuthorization,
          commitDispatch: options?.commitDispatch
        }
      )
      const resolvedResponse = this.resolveAgentToolResponse(response)
      const rawData = resolvedResponse.rawData ?? {}
      const content = rawData.content ?? resolvedResponse.content
      if (
        toolName === LIVE_DELEGATION_AGENT_TOOL_NAME &&
        !parseChildAgentResultEnvelopeText(content)
      ) {
        throw new Error('Live delegation returned an invalid child-result envelope.')
      }
      return {
        content,
        rawData: {
          ...rawData,
          toolCallId: request.id,
          content,
          toolResult:
            rawData.toolResult ??
            (rawData.isError === true
              ? createAgentToolErrorResult(toolName, String(content), {
                  recoverable: true,
                  data: {
                    content,
                    source: 'agent'
                  }
                })
              : createAgentToolSuccessResult(toolName, content, {
                  data: {
                    content,
                    source: 'agent'
                  }
                }))
        }
      }
    }

    // Route to MCP (default)
    const storedAccess = this.getConversationMcpAccessContext(request.conversationId)
    const definition = this.getMcpDefinition(toolName, request.conversationId)
    const expectedTarget = this.createExpectedMcpTarget(toolName, definition)
    const configuredServerIds = options?.enabledMcpServerIds ?? storedAccess?.enabledMcpServerIds
    const preflightPolicy = await this.resolveSubagentExecutionToolPolicy(
      request.conversationId,
      options?.signal
    )
    this.resolveAllowedMcpServerIds(preflightPolicy, configuredServerIds, definition, toolName)

    const permissionContext = this.createMcpPermissionContext(request, definition, permissionMode)
    if (permissionContext && this.shouldBrokerMcpTool(definition)) {
      const authorization = this.permissionBroker.authorizeExecution(
        permissionContext,
        options?.signal
      )
      if (!authorization.allowed) {
        return this.createPermissionRequiredResponse(request.id, authorization.request)
      }
    }

    await this.observeToolExecution(request, source, permissionMode, options?.signal)
    const dispatchPolicy = await this.resolveSubagentExecutionToolPolicy(
      request.conversationId,
      options?.signal
    )
    const enabledServerIds = this.resolveAllowedMcpServerIds(
      dispatchPolicy,
      configuredServerIds,
      definition,
      toolName
    )
    await this.assertExecutionContractDispatchAllowed(request, source, options)
    return await this.options.mcpService.callTool(request, {
      agentId: options?.agentId ?? storedAccess?.agentId,
      enabledServerIds,
      runId: options?.runId,
      signal: options?.signal,
      expectedTarget,
      commitDispatch: options?.commitDispatch,
      registerOutcomeProjection: options?.registerOutcomeProjection
    })
  }

  /**
   * Pre-check tool permissions without executing the tool
   * Routes to the appropriate source based on tool mapping
   */
  async preCheckToolPermission(
    request: MCPToolCall,
    options?: {
      permissionMode?: PermissionMode
      signal?: AbortSignal
      activeSkillNames?: ToolCallOptions['activeSkillNames']
      commandShell?: ToolCallOptions['commandShell']
    }
  ): Promise<ToolPermissionPreCheckResult | null> {
    options?.signal?.throwIfAborted()
    const toolMode = request.conversationId
      ? this.conversationToolModes.get(request.conversationId)
      : undefined
    if (
      toolMode?.mode === 'code' &&
      (request.function.name === RUN_CODE_TOOL_NAME ||
        request.function.name === CODE_MODE_EXEC_TOOL_NAME ||
        request.function.name === CODE_MODE_WAIT_TOOL_NAME)
    ) {
      return null
    }
    const toolName = request.function.name
    const source = this.getToolSource(toolName, request.conversationId)

    if (!source) {
      console.warn(`[Tool] Tool ${toolName} not found for permission check`)
      return null
    }
    const permissionMode =
      (await this.observeToolAuthorization(request, source, options?.signal))?.permissionMode ??
      options?.permissionMode

    if (source === 'agent') {
      // Agent tools: delegate to AgentToolManager for pre-check
      if (!this.agentToolManager) {
        return null
      }

      const args = this.parseAgentToolArguments(request.function.arguments, toolName)

      const result = await awaitWithAbort(
        this.agentToolManager.preCheckToolPermission(toolName, args, request.conversationId, {
          allowExternalFileAccess: allowsExternalFileAccess(permissionMode),
          activeSkillNames: options?.activeSkillNames,
          commandShell: options?.commandShell
        }),
        options?.signal
      )
      if (!result) {
        return null
      }
      const permissionContext = this.createRequiredAgentApprovalContext(
        request,
        args,
        result,
        permissionMode
      )
      if (permissionContext) {
        return this.permissionBroker.evaluateModel(permissionContext, options?.signal)
      }
      return result
    }

    const definition = this.getMcpDefinition(toolName, request.conversationId)
    this.createExpectedMcpTarget(toolName, definition)
    if (!this.shouldBrokerMcpTool(definition)) {
      return null
    }
    const permissionContext = this.createMcpPermissionContext(request, definition, permissionMode)
    return permissionContext
      ? this.permissionBroker.evaluateModel(permissionContext, options?.signal)
      : null
  }

  private resolveAgentToolResponse(response: AgentToolCallResult | string): AgentToolCallResult {
    if (typeof response === 'string') {
      return { content: response }
    }
    return response
  }

  private publishConfiguredCatalog(conversationId: string, definitions: MCPToolDefinition[]): void {
    const mapper = new ToolMapper()
    const names = new Set<string>()
    for (const definition of definitions) {
      const name = definition.function.name.trim()
      if (!name) throw new Error('Tool catalog contains an empty tool name.')
      if (names.has(name)) throw new Error(`Tool catalog contains duplicate name '${name}'.`)
      names.add(name)
      mapper.registerTools([definition], definition.source === 'mcp' ? 'mcp' : 'agent')
    }
    this.rememberMcpDefinitions(
      conversationId,
      definitions.filter((definition) => definition.source === 'mcp')
    )
    this.publishMapper(conversationId, mapper, definitions)
  }

  private assertCodeModeCatalog(
    frontend: ConversationToolModeContext['frontend'],
    definitions: readonly MCPToolDefinition[]
  ): void {
    const exposedNames = new Map<string, string>()
    for (const definition of definitions) {
      const rawName = definition.function.name.trim()
      if (UNSAFE_CODE_MODE_TOOL_NAMES.has(rawName)) {
        throw new Error(`Code Mode execution catalog rejects unsafe tool name '${rawName}'.`)
      }
      if (frontend === 'function' && rawName === RUN_CODE_TOOL_NAME) {
        throw new Error(`Code Mode execution catalog reserves '${RUN_CODE_TOOL_NAME}'.`)
      }

      const exposedName = frontend === 'codex' ? normalizeCodexToolName(rawName) : rawName
      const conflictingName = exposedNames.get(exposedName)
      if (conflictingName) {
        throw new Error(
          `Code Mode tool names '${conflictingName}' and '${rawName}' both map to '${exposedName}'.`
        )
      }
      exposedNames.set(exposedName, rawName)
    }
  }

  private async callCodeModeEntry(
    request: MCPToolCall,
    options?: ToolCallOptions
  ): Promise<{ content: unknown; rawData: MCPToolResponse } | null> {
    const sessionId = request.conversationId?.trim()
    if (!sessionId) return null
    const context = this.conversationToolModes.get(sessionId)
    if (!context || context.mode !== 'code') return null

    const toolName = request.function.name
    const isExec = context.frontend === 'codex' && toolName === CODE_MODE_EXEC_TOOL_NAME
    const isWait = context.frontend === 'codex' && toolName === CODE_MODE_WAIT_TOOL_NAME
    const isRunCode = context.frontend === 'function' && toolName === RUN_CODE_TOOL_NAME
    if (!isExec && !isWait && !isRunCode) return null
    if (options?.permissionMode !== 'full_access') {
      throw new Error('Code Mode requires Full Access permission mode.')
    }

    const waitInput = isWait ? this.requireCodeModeWaitInput(request.function.arguments) : null
    const execInput = isExec ? this.requireCodexExecInput(request.function.arguments) : null
    const result = waitInput
      ? await this.runCodeRuntime.wait({
          sessionId,
          cellId: waitInput.cellId,
          toolCallId: request.id,
          yieldTimeMs: waitInput.yieldTimeMs,
          maxTokens: waitInput.maxTokens,
          terminate: waitInput.terminate,
          options: options ?? {}
        })
      : await this.runCodeRuntime.execute({
          sessionId,
          runId: options?.runId,
          toolCallId: request.id,
          frontend: context.frontend,
          source: execInput?.source ?? this.requireRunCodeSource(request.function.arguments),
          ...(execInput
            ? {
                yieldTimeMs: execInput.yieldTimeMs,
                maxOutputTokens: execInput.maxOutputTokens
              }
            : {}),
          executionCatalog: context.executionCatalog,
          options: options ?? {}
        })
    const rawData = result.rawData ?? {
      content: result.content,
      isError: false,
      toolResult: createAgentToolSuccessResult(toolName, result.content, {
        data: { content: result.content, source: 'agent' }
      })
    }
    return {
      content: rawData.content ?? result.content,
      rawData: {
        ...rawData,
        toolCallId: request.id,
        content: rawData.content ?? result.content
      }
    }
  }

  private requireRunCodeSource(argumentsText: string): string {
    const args = this.parseAgentToolArguments(argumentsText)
    const code = typeof args.code === 'string' ? args.code : ''
    const description = typeof args.description === 'string' ? args.description.trim() : ''
    if (!code) throw new Error('run_code requires a non-empty code string.')
    if (!description) throw new Error('run_code requires a non-empty description string.')
    return code
  }

  private requireCodexExecInput(argumentsText: string): CodexExecInput {
    const match = argumentsText.match(/^\s*\/\/\s*@exec:\s*([^\r\n]+)(?:\r?\n|$)/)
    if (!match) {
      if (!argumentsText.trim()) throw new Error('exec requires non-empty JavaScript source.')
      return {
        source: argumentsText,
        yieldTimeMs: CODE_MODE_DEFAULT_YIELD_TIME_MS,
        maxOutputTokens: CODE_MODE_DEFAULT_MAX_OUTPUT_TOKENS
      }
    }

    let pragma: Record<string, unknown>
    try {
      pragma = JSON.parse(match[1]) as Record<string, unknown>
    } catch {
      throw new Error('exec pragma must contain a valid JSON object.')
    }
    if (!pragma || typeof pragma !== 'object' || Array.isArray(pragma)) {
      throw new Error('exec pragma must contain a JSON object.')
    }
    const source = argumentsText.slice(match[0].length)
    if (!source.trim()) throw new Error('exec requires non-empty JavaScript source.')
    return {
      source,
      yieldTimeMs: this.readBoundedCodeModeNumber(
        pragma.yield_time_ms,
        'yield_time_ms',
        CODE_MODE_DEFAULT_YIELD_TIME_MS,
        CODE_MODE_MIN_YIELD_TIME_MS,
        CODE_MODE_MAX_YIELD_TIME_MS
      ),
      maxOutputTokens: this.readBoundedCodeModeNumber(
        pragma.max_output_tokens,
        'max_output_tokens',
        CODE_MODE_DEFAULT_MAX_OUTPUT_TOKENS,
        1,
        CODE_MODE_MAX_OUTPUT_TOKENS
      )
    }
  }

  private requireCodeModeWaitInput(argumentsText: string): CodexWaitInput {
    const args = this.parseAgentToolArguments(argumentsText)
    const cellId = typeof args.cell_id === 'string' ? args.cell_id.trim() : ''
    if (!cellId) throw new Error('wait requires a non-empty cell_id.')
    return {
      cellId,
      yieldTimeMs: this.readBoundedCodeModeNumber(
        args.yield_time_ms,
        'yield_time_ms',
        CODE_MODE_DEFAULT_YIELD_TIME_MS,
        CODE_MODE_MIN_YIELD_TIME_MS,
        CODE_MODE_MAX_YIELD_TIME_MS
      ),
      maxTokens: this.readBoundedCodeModeNumber(
        args.max_tokens,
        'max_tokens',
        CODE_MODE_DEFAULT_MAX_OUTPUT_TOKENS,
        1,
        CODE_MODE_MAX_OUTPUT_TOKENS
      ),
      terminate: args.terminate === true
    }
  }

  private readBoundedCodeModeNumber(
    value: unknown,
    name: string,
    fallback: number,
    minimum: number,
    maximum: number
  ): number {
    if (value === undefined) return fallback
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${name} must be an integer.`)
    }
    const parsed = value as number
    if (parsed < minimum || parsed > maximum) {
      throw new Error(`${name} must be between ${minimum} and ${maximum}.`)
    }
    return parsed
  }

  private parseAgentToolArguments(
    argumentsText: string | undefined,
    toolName?: string
  ): Record<string, unknown> {
    const raw = argumentsText ?? ''
    if (toolName === APPLY_PATCH_TOOL_NAME) return { patch: raw }
    if (!raw.trim()) return {}

    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch (error) {
      console.warn('[Tool] Failed to parse Agent tool arguments, trying jsonrepair:', error)
      try {
        return JSON.parse(jsonrepair(raw)) as Record<string, unknown>
      } catch (repairError) {
        console.warn(
          '[Tool] Failed to repair Agent tool arguments, using empty arguments.',
          repairError
        )
        return {}
      }
    }
  }

  private createRequiredAgentApprovalContext(
    request: MCPToolCall,
    args: Record<string, unknown>,
    permission: ToolPermissionPreCheckResult | null,
    permissionMode: PermissionMode | undefined
  ): ToolPermissionContext | null {
    if (!permission?.requiresUserConfirmation) return null

    const conversationId = request.conversationId?.trim()
    if (!conversationId) {
      throw new Error(`${request.function.name} requires a conversationId for user confirmation.`)
    }

    return {
      conversationId,
      serverId: LIVE_DELEGATION_AGENT_TOOL_SERVER_NAME,
      serverName: permission.serverName,
      toolName: permission.toolName,
      executionId: request.id,
      arguments: args,
      source: 'model',
      permissionType: 'write',
      permissionMode,
      approvalMode: 'explicit_user',
      description: permission.description
    }
  }

  private createPermissionRequiredResponse(
    toolCallId: string,
    request: ToolPermissionPreCheckResult
  ): { content: string; rawData: MCPToolResponse } {
    return {
      content: request.description,
      rawData: {
        toolCallId,
        content: request.description,
        isError: false,
        requiresPermission: true,
        permissionRequest: request
      }
    }
  }

  private async observeToolExecution(
    request: MCPToolCall,
    source: ToolSource,
    authorizedPermissionMode?: PermissionMode,
    signal?: AbortSignal
  ): Promise<void> {
    const conversationId = request.conversationId?.trim()
    if (!conversationId || !this.options.effectObserver) {
      return
    }

    await this.options.effectObserver.beforeToolExecution(
      {
        conversationId,
        toolCallId: request.id,
        toolName: request.function.name,
        source,
        reviewedExecution: this.getReviewedExecution(request.function.name, conversationId),
        authorizedPermissionMode
      },
      signal
    )
  }

  private async observeToolAuthorization(
    request: MCPToolCall,
    source: ToolSource,
    signal?: AbortSignal
  ): Promise<{ permissionMode: PermissionMode } | null> {
    const conversationId = request.conversationId?.trim()
    if (!conversationId || !this.options.effectObserver?.beforeToolAuthorization) {
      return null
    }
    return await this.options.effectObserver.beforeToolAuthorization(
      {
        conversationId,
        toolCallId: request.id,
        toolName: request.function.name,
        source,
        reviewedExecution: this.getReviewedExecution(request.function.name, conversationId)
      },
      signal
    )
  }

  private async assertExecutionContractDispatchAllowed(
    request: MCPToolCall,
    expectedSource: ToolSource,
    options?: ToolCallOptions
  ): Promise<void> {
    const contract = options?.executionContract
    if (!contract) return

    const sessionId = request.conversationId?.trim()
    const messageId = options.messageId?.trim()
    const runId = options.runId?.trim()
    const requestSeq = options.requestSeq
    if (
      !sessionId ||
      !messageId ||
      !runId ||
      !Number.isSafeInteger(requestSeq) ||
      (requestSeq as number) <= 0
    ) {
      throw new ExecutionContractDispatchError(
        'Contract-bearing tool dispatch requires complete provider View identity.',
        'identity_mismatch'
      )
    }

    options.signal?.throwIfAborted()
    let currentAuthority
    try {
      currentAuthority = await awaitWithAbort(
        this.options.agentTools.sessions.resolveConversationExecutionAuthority(sessionId),
        options.signal
      )
    } catch (error) {
      options.signal?.throwIfAborted()
      throw new ExecutionContractDispatchError(
        `Session ${sessionId} runtime authority could not be resolved.`,
        'invalid_runtime_authority',
        { cause: error }
      )
    }
    options.signal?.throwIfAborted()
    if (!currentAuthority || currentAuthority.sessionId.trim() !== sessionId) {
      throw new ExecutionContractDispatchError(
        `Session ${sessionId} runtime authority is unavailable.`,
        'invalid_runtime_authority'
      )
    }

    const currentSource = this.getToolSource(request.function.name, sessionId)
    const currentDefinition =
      currentSource === 'mcp'
        ? this.getMcpDefinition(request.function.name, sessionId)
        : currentSource === 'agent'
          ? this.getAgentDefinition(request.function.name, sessionId)
          : undefined
    if (currentSource !== expectedSource || !currentDefinition) {
      throw new ExecutionContractDispatchError(
        `Tool '${request.function.name}' no longer resolves to its provider View target.`,
        'target_mismatch'
      )
    }
    if (
      currentSource === 'agent' &&
      isUserConfigurableAgentTool(request.function.name) &&
      normalizeToolNames(currentAuthority.disabledAgentTools).includes(request.function.name)
    ) {
      throw new ExecutionContractDispatchError(
        `Tool '${request.function.name}' is disabled by current runtime authority.`,
        'tool_not_allowed'
      )
    }
    if (currentSource === 'mcp' && Array.isArray(currentAuthority.enabledMcpServerIds)) {
      const serverId = currentDefinition.server.id?.trim()
      const enabledServerIds = normalizeToolNames(currentAuthority.enabledMcpServerIds)
      if (!serverId || !enabledServerIds.includes(serverId)) {
        throw new ExecutionContractDispatchError(
          `Tool '${request.function.name}' is disabled by current runtime authority.`,
          'tool_not_allowed'
        )
      }
    }

    const currentProjectDir = currentAuthority.projectDir
    assertExecutionContractAllowsDispatch(contract, {
      request: {
        sessionId,
        messageId,
        runId,
        requestSeq: requestSeq as number
      },
      currentTool: currentDefinition,
      currentWorkspace: currentProjectDir
        ? { kind: 'path', path: currentProjectDir }
        : { kind: 'runtime_default' },
      currentMaxSubagentDepth: currentAuthority.subagentCapability.available ? 1 : 0,
      requestedSubagentDepth: request.function.name === LIVE_DELEGATION_AGENT_TOOL_NAME ? 1 : 0
    })
  }

  private async resolveSubagentExecutionToolPolicy(
    conversationId: string | undefined,
    signal?: AbortSignal
  ): Promise<SubagentExecutionToolPolicy | null> {
    const childSessionId = conversationId?.trim()
    if (!childSessionId) return null
    const catalogContext = this.getConversationMcpAccessContext(childSessionId)
    if (catalogContext?.sessionKind === 'regular') return null
    const child = await awaitWithAbort(
      this.options.agentTools.sessions.resolveConversationSessionInfo(childSessionId),
      signal
    )
    if (!child) {
      throw new Error(`Session ${childSessionId} execution identity is unavailable.`)
    }
    if (child.sessionKind === 'regular') {
      if (catalogContext?.sessionKind === 'subagent') {
        throw new Error(`Session ${childSessionId} execution identity changed unexpectedly.`)
      }
      this.rememberResolvedRegularSession(childSessionId)
      return null
    }
    if (child.sessionKind !== 'subagent') {
      throw new Error(`Session ${childSessionId} execution identity is invalid.`)
    }

    const parentSessionId = child.parentSessionId?.trim()
    if (!parentSessionId) {
      throw new Error(`Subagent Session ${childSessionId} has no parent authority.`)
    }
    const parent = await awaitWithAbort(
      this.options.agentTools.sessions.resolveConversationSessionInfo(parentSessionId),
      signal
    )
    if (!parent || parent.sessionKind !== 'regular') {
      throw new Error(`Subagent Session ${childSessionId} parent authority is unavailable.`)
    }

    let configs
    try {
      configs = await awaitWithAbort(
        Promise.all([
          this.options.agentSettings.resolveDeepChatAgentConfig(parent.agentId),
          this.options.agentSettings.resolveDeepChatAgentConfig(child.agentId)
        ]),
        signal
      )
    } catch (error) {
      console.warn(
        `[Tool] Failed to resolve execution authority for subagent ${childSessionId}:`,
        error
      )
      throw new Error(`Subagent Session ${childSessionId} tool authority is unavailable.`)
    }
    const [parentConfig, childConfig] = configs

    return composeSubagentAuthority(parent, child, parentConfig, childConfig)
  }

  private assertSubagentAgentToolAllowed(
    policy: SubagentExecutionToolPolicy | null,
    toolName: string
  ): void {
    if (
      policy &&
      isUserConfigurableAgentTool(toolName) &&
      policy.disabledAgentTools.includes(toolName)
    ) {
      throw new Error(`Tool '${toolName}' is disabled by the current Subagent authority.`)
    }
  }

  private resolveAllowedMcpServerIds(
    policy: SubagentExecutionToolPolicy | null,
    configuredServerIds: string[] | undefined,
    definition: MCPToolDefinition | undefined,
    toolName: string
  ): string[] | undefined {
    if (!policy) return configuredServerIds

    const enabledServerIds = composeSubagentAuthority(policy, {
      enabledMcpServerIds: configuredServerIds
    }).enabledMcpServerIds
    if (enabledServerIds !== undefined) {
      const serverId = definition?.server.id?.trim()
      if (!serverId || !enabledServerIds.includes(serverId)) {
        throw new Error(`MCP tool '${toolName}' is disabled by the current Subagent authority.`)
      }
    }
    return enabledServerIds
  }

  private rememberResolvedRegularSession(conversationId: string): void {
    const current = this.conversationMcpAccessContexts.get(conversationId)
    this.conversationMcpAccessContexts.set(conversationId, {
      ...current,
      sessionKind: 'regular'
    })
  }

  private rememberConversationMcpAccessContext(
    conversationId: string | undefined,
    context: StoredMcpAccessContext
  ): void {
    const normalizedConversationId = conversationId?.trim()
    if (!normalizedConversationId) {
      return
    }

    this.conversationMcpAccessContexts.set(normalizedConversationId, {
      agentId: context.agentId?.trim() || undefined,
      enabledMcpServerIds: normalizeOptionalToolNames(context.enabledMcpServerIds),
      sessionKind: context.sessionKind
    })
  }

  private getConversationMcpAccessContext(
    conversationId?: string
  ): StoredMcpAccessContext | undefined {
    const normalizedConversationId = conversationId?.trim()
    return normalizedConversationId
      ? this.conversationMcpAccessContexts.get(normalizedConversationId)
      : undefined
  }

  private publishMapper(
    conversationId: string | undefined,
    mapper: ToolMapper,
    definitions: MCPToolDefinition[]
  ): void {
    const normalizedConversationId = conversationId?.trim()
    const agentDefinitions = new Map(
      definitions
        .filter((definition) => definition.source === 'agent')
        .map((definition) => [definition.function.name, definition])
    )
    if (normalizedConversationId) {
      this.conversationMappers.set(normalizedConversationId, mapper)
      this.conversationAgentDefinitions.set(normalizedConversationId, agentDefinitions)
    }

    this.mapper.clear()
    for (const mapping of mapper.getAllMappings()) {
      this.mapper.registerTool(mapping.toolName, mapping.source, mapping.originalName)
    }
    this.globalMapperConversationId = normalizedConversationId || null
    this.globalAgentDefinitions = agentDefinitions
  }

  private rememberMcpDefinitions(
    conversationId: string | undefined,
    definitions: MCPToolDefinition[]
  ): void {
    const byName = new Map(definitions.map((definition) => [definition.function.name, definition]))
    const normalizedConversationId = conversationId?.trim()
    if (normalizedConversationId) {
      this.conversationMcpDefinitions.set(normalizedConversationId, byName)
    }
    this.globalMcpDefinitions = byName
  }

  private getMcpDefinition(
    toolName: string,
    conversationId?: string
  ): MCPToolDefinition | undefined {
    const normalizedConversationId = conversationId?.trim()
    if (normalizedConversationId) {
      const definitions = this.conversationMcpDefinitions.get(normalizedConversationId)
      if (definitions) {
        return definitions.get(toolName)
      }
      if (this.globalMapperConversationId !== null) {
        return undefined
      }
    }
    return this.globalMcpDefinitions.get(toolName)
  }

  private getAgentDefinition(
    toolName: string,
    conversationId?: string
  ): MCPToolDefinition | undefined {
    const normalizedConversationId = conversationId?.trim()
    if (normalizedConversationId) {
      const definitions = this.conversationAgentDefinitions.get(normalizedConversationId)
      if (definitions) {
        return definitions.get(toolName)
      }
      if (this.globalMapperConversationId !== null) {
        return undefined
      }
    }
    return this.globalAgentDefinitions.get(toolName)
  }

  private createExpectedMcpTarget(
    finalName: string,
    definition: MCPToolDefinition | undefined
  ): McpExpectedToolTarget {
    const serverId = definition?.server.id
    const configGeneration = definition?.server.configGeneration
    const bindingHash = definition?.server.bindingHash
    const originalName = definition?.raw?.name
    if (
      !definition ||
      !serverId ||
      !configGeneration ||
      !bindingHash ||
      !originalName ||
      definition.function.name !== finalName
    ) {
      throw new Error(`MCP tool '${finalName}' has no stable execution binding; refresh tools`)
    }
    return {
      finalName,
      serverName: definition.server.name,
      serverId,
      configGeneration,
      bindingHash,
      originalName
    }
  }

  private shouldBrokerMcpTool(definition?: MCPToolDefinition): boolean {
    const serverName = definition?.server.name
    if (!serverName) {
      return true
    }
    const policy = resolvePluginToolPolicy(
      serverName,
      definition.raw?.name ?? definition.function.name
    )
    return !policy.managed || policy.decision === 'ask'
  }

  private createMcpPermissionContext(
    request: MCPToolCall,
    definition: MCPToolDefinition | undefined,
    permissionMode: PermissionMode | undefined
  ) {
    const conversationId = request.conversationId?.trim()
    if (!conversationId) {
      return null
    }

    let parsedArguments: unknown = {}
    try {
      parsedArguments = request.function.arguments ? JSON.parse(request.function.arguments) : {}
    } catch {
      try {
        parsedArguments = JSON.parse(jsonrepair(request.function.arguments))
      } catch {
        parsedArguments = request.function.arguments
      }
    }

    const policy = definition
      ? resolvePluginToolPolicy(
          definition.server.name,
          definition.raw?.name ?? definition.function.name
        )
      : undefined

    return {
      conversationId,
      serverId: definition?.server.id ?? definition?.server.name ?? 'unknown',
      configGeneration: definition?.server.configGeneration,
      bindingHash: definition?.server.bindingHash,
      serverName: definition?.server.name ?? request.server?.name ?? 'MCP',
      toolName: definition?.raw?.name ?? request.function.name,
      arguments: parsedArguments,
      source: 'model' as const,
      // Remote MCP annotations are not trusted to downgrade host permission checks.
      permissionType: 'write' as const,
      permissionMode: policy?.managed && policy.decision === 'ask' ? undefined : permissionMode
    }
  }

  private getToolSource(toolName: string, conversationId?: string): ToolSource | undefined {
    const normalizedConversationId = conversationId?.trim()
    if (normalizedConversationId) {
      const mapper = this.conversationMappers.get(normalizedConversationId)
      if (mapper) {
        return mapper.getToolSource(toolName)
      }
      if (this.globalMapperConversationId !== null) {
        return undefined
      }
    }

    return this.mapper.getToolSource(toolName)
  }

  private getReviewedExecution(
    toolName: string,
    conversationId?: string
  ): ToolExecutionContract | null {
    return this.getAgentDefinition(toolName, conversationId)?.execution ?? null
  }

  buildToolSystemPrompt(context: {
    conversationId?: string
    toolDefinitions?: MCPToolDefinition[]
  }): string {
    const conversationId = context.conversationId || '<conversationId>'
    const offloadPath =
      resolveToolOffloadTemplatePath(conversationId) ??
      '~/.deepchat/sessions/<conversationId>/tool_<toolCallId>.offload'
    const toolDefinitions: MCPToolDefinitionBase[] =
      context.toolDefinitions?.filter((tool) => tool.source === 'agent') ??
      this.getFallbackPromptToolDefinitions()
    const toolNames = new Set(toolDefinitions.map((tool) => tool.function.name))
    const groupedTools = new Map<string, MCPToolDefinitionBase[]>()

    for (const tool of toolDefinitions) {
      const existing = groupedTools.get(tool.server.name) ?? []
      existing.push(tool)
      groupedTools.set(tool.server.name, existing)
    }

    const sections = [
      this.buildFilesystemPrompt(toolNames, offloadPath),
      this.buildQuestionPrompt(toolNames),
      this.buildImageGenerationPrompt(toolNames),
      this.buildProgressPrompt(toolNames),
      this.buildTapePrompt(groupedTools.get(AGENT_TAPE_TOOL_SERVER_NAME) ?? []),
      this.buildCronJobPrompt(groupedTools.get(CRON_JOB_TOOL_SERVER_NAME) ?? []),
      this.buildSkillsPrompt(toolNames),
      this.buildSettingsPrompt(groupedTools.get('deepchat-settings') ?? []),
      this.buildYoBrowserPrompt(groupedTools.get('yobrowser') ?? [])
    ]

    return sections.filter(Boolean).join('\n\n')
  }

  private getFallbackPromptToolDefinitions(): MCPToolDefinitionBase[] {
    return FILESYSTEM_TOOL_ORDER.map((name) => ({
      type: 'function' as const,
      source: 'agent' as const,
      function: {
        name,
        description: '',
        parameters: { type: 'object', properties: {} }
      },
      server: {
        name: 'agent-filesystem',
        icons: '',
        description: ''
      }
    })).concat([
      {
        type: 'function' as const,
        source: 'agent' as const,
        function: {
          name: QUESTION_TOOL_NAME,
          description: '',
          parameters: { type: 'object', properties: {} }
        },
        server: {
          name: 'agent-core',
          icons: '',
          description: ''
        }
      }
    ])
  }

  private buildFilesystemPrompt(toolNames: Set<string>, offloadPath: string): string {
    const filesystemTools = FILESYSTEM_TOOL_ORDER.filter((toolName) => toolNames.has(toolName))
    if (filesystemTools.length === 0) {
      return ''
    }

    const lines = [
      '## File and Command Tools',
      `Use canonical Agent tool names only: ${filesystemTools.join(', ')}.`,
      'Legacy or disabled Agent tool names are not available.'
    ]

    if (toolNames.has('exec')) {
      lines.push(
        'Use `exec` for git, build, test, lint, package manager, and other non-search CLI workflows.'
      )
      lines.push(
        '`exec.cwd` may target paths outside the workspace in Full Access mode; default mode asks before using external paths.'
      )
      lines.push(
        'Use `background: true` when you know a command should detach immediately; otherwise a foreground `exec` may yield a running `sessionId` after `yieldMs`.'
      )
    }
    const hasGlob = toolNames.has('glob')
    const hasGrep = toolNames.has('grep')
    if (hasGlob || hasGrep) {
      if (hasGlob && hasGrep) {
        lines.push(
          'Use `glob` for file discovery and `grep` for content search; both return structured JSON.'
        )
        lines.push(
          'Search order: `glob(query)` -> choose relevant `pathScope` -> `grep(query, pathScope, contextLines)` -> `read` concrete files.'
        )
      } else if (hasGlob) {
        lines.push('Use `glob` for file discovery; it returns structured JSON.')
      } else {
        lines.push(
          'Use `grep` for content search; it returns structured JSON and supports `mode: "regex"` for regular expressions.'
        )
      }
      lines.push(
        'Do not call shell commands for search, do not generate shell search commands (`rg`, shell `grep`, `find`, `fd`, or `ls`), and do not use `exec` for code search.'
      )
    }
    if (toolNames.has('read')) {
      lines.push(
        'When `read` targets an image file, it returns an English description of the visible content and any legible text.'
      )
    }
    if (
      toolNames.has('glob') &&
      toolNames.has('grep') &&
      toolNames.has('read') &&
      toolNames.has('edit')
    ) {
      lines.push('Recommended file task flow: `glob` / `grep` -> `read` -> `edit`/`write`.')
    }
    if (toolNames.has('process')) {
      lines.push(
        'Use `process` to monitor, write to, or terminate long-running `exec` tasks that returned a running `sessionId`.'
      )
    }

    const hasOffloadTools = Array.from(toolNames).some((toolName) =>
      OFFLOAD_TOOL_NAMES.has(toolName)
    )
    if (hasOffloadTools) {
      lines.push('Tool outputs may be offloaded when large.')
      lines.push(`When you see an offload stub, the full output is stored at: ${offloadPath}`)
      if (toolNames.has('read')) {
        lines.push('Use `read` to inspect that path when you need the full output.')
      }
    }

    return lines.join('\n')
  }

  private buildQuestionPrompt(toolNames: Set<string>): string {
    if (!toolNames.has(QUESTION_TOOL_NAME)) {
      return ''
    }

    return [
      '## User Interaction',
      `Use \`${QUESTION_TOOL_NAME}\` when missing user preferences, implementation direction, output shape, or risk decisions would materially change the result.`,
      'If the answer would meaningfully change the work, prefer asking instead of guessing.',
      'Do not ask for facts you can discover from the repo, tools, or existing conversation context.',
      `Ask exactly one question per \`${QUESTION_TOOL_NAME}\` call. If multiple clarifications are needed, split them into multiple tool calls.`,
      'Use only the top-level fields `header`, `question`, `options`, `multiple`, and `custom`.',
      'Each `options` item must be `{ "label": string, "description"?: string }`.',
      'Use `header` only as the optional top-level question title, never inside `options`.',
      'Do not send `questions`, `allowOther`, or stringified `options` JSON.'
    ].join('\n')
  }

  private buildSkillsPrompt(toolNames: Set<string>): string {
    const lines = ['## Skill Tools']
    let hasContent = false

    if (toolNames.has('skill_list')) {
      lines.push('- Use `skill_list` to inspect installed skills and manual pin status.')
      hasContent = true
    }
    if (toolNames.has('skill_view')) {
      lines.push(
        '- Use `skill_view` to inspect a skill or one of its linked files before relying on it. Root skill views activate the skill for the current message/tool loop only; they do not pin it to the conversation.'
      )
      hasContent = true
    }
    if (toolNames.has('skill_manage')) {
      lines.push(
        '- Use `skill_manage` only for temporary draft skills after the main task is complete.'
      )
      hasContent = true
    }
    if (toolNames.has('skill_run')) {
      lines.push(
        '- Use `skill_run` to execute bundled scripts from skills active in the current message/tool loop.'
      )
      hasContent = true
    }

    return hasContent ? lines.join('\n') : ''
  }

  private buildImageGenerationPrompt(toolNames: Set<string>): string {
    if (!toolNames.has(IMAGE_GENERATE_TOOL_NAME)) {
      return ''
    }

    return [
      '## Image Generation Tool',
      `Use \`${IMAGE_GENERATE_TOOL_NAME}\` when the user asks to create, draw, render, or generate a new image.`,
      'Keep the prompt visual and specific. Include subject, style, composition, lighting, mood, and important constraints from the user.',
      'Do not use this tool for describing an existing image or reading image files; use the appropriate vision or file tool for that.'
    ].join('\n')
  }

  private buildProgressPrompt(toolNames: Set<string>): string {
    if (!toolNames.has(UPDATE_PLAN_TOOL_NAME)) {
      return ''
    }

    return [
      '## Progress Checklist Tool',
      `Use \`${UPDATE_PLAN_TOOL_NAME}\` for non-trivial multi-step tasks.`,
      'Skip it for simple one-shot answers or trivial edits.',
      'Each call must provide the complete current checklist snapshot.',
      'Keep each step short, concrete, and verifiable.',
      'Keep the checklist current as work progresses.',
      'At most one step may be in_progress at a time.',
      'When a step completes, update the checklist immediately and move the next active step to in_progress in the same call.',
      'Before ending the turn, reconcile the checklist so no step remains in_progress.',
      'Use explanation only when the plan changes materially or progress would otherwise be unclear.'
    ].join('\n')
  }

  private buildTapePrompt(tools: MCPToolDefinitionBase[]): string {
    const modelTools = tools.filter(
      (tool) => getAgentToolExposure(tool.function.name) === 'system-model'
    )
    if (modelTools.length === 0) {
      return ''
    }

    const toolNames = new Set(modelTools.map((tool) => tool.function.name))
    const names = modelTools.map((tool) => `\`${tool.function.name}\``).join(', ')
    const lines = ['## Tape Tools', `DeepChat tape tools are available in this session: ${names}.`]

    if (toolNames.has(TAPE_TOOL_NAMES.search)) {
      lines.push(
        '`tape_search` supports `query`, `limit`, `kinds`, `start`, `end`, and `scope`; each result includes its source `sessionId`.'
      )
    }
    if (toolNames.has(TAPE_TOOL_NAMES.context)) {
      lines.push(
        '`tape_context` expands selected `entryIds` from exactly one source into bounded evidence/context without dumping raw payloads; pass the result `sessionId` as `sourceSessionId` for linked Tapes and omit it for the current Tape.'
      )
    }
    return lines.join('\n')
  }

  private buildCronJobPrompt(tools: MCPToolDefinitionBase[]): string {
    if (tools.length === 0) {
      return ''
    }

    return [
      '## Scheduled Task Tool',
      `Use \`${CRON_JOB_AGENT_TOOL_NAME}\` only when the user explicitly asks to create, inspect, run, pause, resume, update, delete, or preview Scheduled tasks.`,
      'Scheduled task deliveries are notification-only and do not continue normal Remote conversations.'
    ].join('\n')
  }

  private buildSettingsPrompt(tools: MCPToolDefinitionBase[]): string {
    if (tools.length === 0) {
      return ''
    }

    const names = tools.map((tool) => `\`${tool.function.name}\``).join(', ')
    return [
      '## DeepChat Settings Tools',
      `DeepChat settings tools are available in this session: ${names}.`,
      'Prefer these tools over describing manual settings steps when a direct change is possible.'
    ].join('\n')
  }

  private buildYoBrowserPrompt(tools: MCPToolDefinitionBase[]): string {
    if (tools.length === 0) {
      return ''
    }

    const toolNames = new Set(tools.map((tool) => tool.function.name))
    const lines = [
      '## YoBrowser Tools',
      `Available YoBrowser tools: ${tools.map((tool) => `\`${tool.function.name}\``).join(', ')}.`
    ]

    if (toolNames.has('get_browser_status')) {
      lines.push('- Use `get_browser_status` to inspect the current session browser state.')
    }
    if (toolNames.has('load_url')) {
      lines.push('- Prefer `load_url` to create the session browser and handle navigation.')
    }
    if (toolNames.has('cdp_send')) {
      lines.push(
        '- Use `cdp_send` for DOM inspection, scripted interaction, screenshots, and low-level CDP commands.'
      )
      lines.push('- Avoid using `cdp_send` `Page.navigate` for normal navigation unless needed.')
      lines.push(
        '- If `cdp_send` reports `yobrowser_unavailable`, call `get_browser_status`, then use `load_url` with the target URL when available.'
      )
    }

    return lines.join('\n')
  }
}

function resolveLiveDelegationStartOperation(value: unknown): 'spawn' | 'follow_up' | null {
  return value === 'spawn' || value === 'follow_up' ? value : null
}
