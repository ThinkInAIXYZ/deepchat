import type { ProviderSettingsPort } from '@/provider/settings'
import {
  TOOL_EXECUTION,
  type MCPToolDefinition,
  type ToolDispatchCommit,
  type ToolOutcomeProjectionRegistrar
} from '@shared/types/mcp'
import type { AgentSettingsPort } from '@/agent/settings'
import type { SettingsStore } from '@/config/settingsStore'
import type { AgentToolProgressUpdate, ToolPermissionLeaseCapability } from '@shared/types/tool'
import { toDeepChatJsonSchema } from '@shared/lib/zodJsonSchema'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { app, nativeImage } from 'electron'
import logger from '@shared/logger'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { ToolCallImagePreview } from '@shared/types/core/mcp'
import {
  SKILL_EXECUTION_PACKAGE_MAX_PATH_BYTES,
  SKILL_NAME_MAX_LENGTH,
  SKILL_RUN_MAX_ARGUMENTS,
  SKILL_RUN_MAX_ARGUMENT_CHARS,
  SKILL_RUN_MAX_STDIN_CHARS,
  SKILL_RUN_MAX_TOTAL_ARGUMENT_CHARS,
  SKILL_RUNTIME_VIEW_RESULT_MAX_BYTES,
  type SkillManageResult
} from '@shared/types/skill'
import { isDocumentReadMime } from '@/file/mime'
import {
  buildBinaryReadGuidance,
  buildEmptyDocumentReadGuidance,
  buildOversizedReadGuidance,
  DEFAULT_DOCUMENT_READ_MAX_BYTES,
  paginateReadContent,
  shouldRejectAgentBinaryRead
} from '@/lib/binaryReadGuard'
import { AgentFileSystemHandler, type ProtectedDirectoryRule } from './agentFileSystemHandler'
import { AgentBashHandler, type AgentCommandEnvironmentPort } from './agentBashHandler'
import {
  AgentFffSearchHandler,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  FffGlobArgsSchema,
  FffGrepArgsSchema
} from './agentFffSearchHandler'
import { FffSearchService, type FffSearchMetadata } from '@/platform/fileSearch/fffSearchService'
import { SkillTools } from '../../skill/skillTools'
import {
  SKILL_LIST_CURSOR_MAX_BYTES,
  SKILL_LIST_DEFAULT_LIMIT,
  SKILL_LIST_MAX_LIMIT,
  SKILL_LIST_QUERY_MAX_BYTES
} from '../../skill/routingCatalog'
import { SkillExecutionService } from '../../skill/skillExecutionService'
import { parseQuestionToolInput, questionToolSchema, QUESTION_TOOL_NAME } from './questionTool'
import {
  ChatSettingsToolHandler,
  buildChatSettingsToolDefinitions,
  CHAT_SETTINGS_SKILL_NAME,
  CHAT_SETTINGS_TOOL_NAMES
} from './chatSettingsTools'
import type {
  AgentDisplaySettingsPort,
  AgentToolDependencies,
  LiveDelegationStartAuthorization
} from '../runtimePorts'
import { YO_BROWSER_TOOL_NAMES } from '../browser/definitions'
import { resolveSessionVisionTarget } from '@/agent/vision/sessionVisionResolver'
import {
  AgentImageGenerationTool,
  IMAGE_GENERATE_TOOL_NAME,
  IMAGE_GENERATION_TOOL_SERVER_NAME
} from './agentImageGenerationTool'
import { AGENT_CORE_TOOL_SERVER_NAME, AgentPlanTool, UPDATE_PLAN_TOOL_NAME } from './agentPlanTool'
import { AgentTapeToolHandler } from './agentTapeTools'
import { AGENT_MEMORY_TOOL_SERVER_NAME, AgentMemoryToolHandler } from './agentMemoryTools'
import {
  createAgentToolErrorResult,
  createAgentToolSuccessResult
} from '@shared/lib/agentToolResultEnvelope'
import {
  CRON_JOB_AGENT_TOOL_NAME,
  LIVE_DELEGATION_AGENT_TOOL_NAME,
  LIVE_DELEGATION_AGENT_TOOL_SERVER_NAME,
  SKILL_AGENT_TOOL_NAMES,
  SKILL_LIST_AGENT_TOOL_NAME,
  SKILL_MANAGE_AGENT_TOOL_NAME,
  SKILL_RUN_AGENT_TOOL_NAME,
  SKILL_VIEW_AGENT_TOOL_NAME,
  TOOL_SEARCH_AGENT_TOOL_NAME,
  assertAgentToolExposure,
  isTapeToolName,
  type AgentToolExposure
} from '@shared/agentTools'
import {
  CRON_JOB_TOOL_SERVER_NAME,
  CronJobToolHandler,
  cronJobActionNeedsPermission
} from './cronJobTool'
import { isYoBrowserUnavailableError } from '../browser/errors'
import type { SkillSettingsPort } from '@/skill/settings'
import type { DeepChatSubagentCapability } from '@shared/types/agent-interface'
import { resolveSessionDir } from '@/agent/shared/storage/sessionPaths'
import { LiveDelegationAgentTool } from './liveDelegationTool'
import { normalizeOrchestrationPolicy } from '@shared/orchestration/policy'
import { ResolvedCommandShellSchema, type ResolvedCommandShell } from '@shared/commandShell'
import { resolveAgentOutputLimits, type AgentOutputLimits } from '@shared/lib/agentOutputLimits'
import {
  assertActiveToolSurfaceExecutionContext,
  type ToolSurfaceExecutionContext
} from '@/agent/deepchat/runtime/toolSurface'
import { recordToolSurfaceCanaryDiscovery } from '@/agent/deepchat/runtime/toolSurfaceCanaryDiagnostics'
import {
  MAX_PROGRAMMATIC_TOOL_INPUT_BYTES,
  PROGRAMMATIC_EXEC_STDIN_DESCRIPTION,
  type ProgrammaticToolCapabilityV1
} from '@/agent/deepchat/runtime/programmaticToolSurface'
import {
  TOOL_SEARCH_TOOL_SERVER_NAME,
  parseToolSearchInput,
  searchToolSurfaceSnapshot
} from './toolSearchTool'
import type { ProgrammaticToolParentRegistration } from '@/cli/programmaticToolParentRegistry'
import { APPLY_PATCH_TOOL_NAME, STR_REPLACE_EDITOR_TOOL_NAME } from '@/tool/codeMode/toolModeTools'
import {
  applyUpdateChunks,
  collectApplyPatchPaths,
  formatApplyPatchSummary,
  formatStrReplaceFileView,
  lineNumbersAt,
  matchOffsets,
  parseApplyPatch,
  truncateEditorOutput,
  type ApplyPatchOperation
} from './minimalEditorAdapter'

// Consider moving to a shared handlers location in future refactoring
import {
  CommandPermissionRequiredError,
  CommandPermissionService
} from '../permission/commandPermissionService'
import {
  FilePermissionRequiredError,
  type FilePermissionLevel
} from '../permission/filePermissionService'

export interface AgentToolCallResult {
  content: string
  rawData?: {
    content?: string
    isError?: boolean
    toolResult?: unknown
    rtkApplied?: boolean
    rtkMode?: 'rewrite' | 'direct' | 'bypass'
    rtkFallbackReason?: string
    outputOffloadPath?: string
    fffSearch?: FffSearchMetadata
    imagePreviews?: ToolCallImagePreview[]
    requiresPermission?: boolean
    permissionRequest?: {
      toolName: string
      serverName: string
      permissionType: 'read' | 'write' | 'all' | 'command'
      description: string
      command?: string
      commandSignature?: string
      shellProfile?: import('@shared/commandShell').CommandShellProfile
      paths?: string[]
      commandInfo?: {
        command: string
        riskLevel: 'low' | 'medium' | 'high' | 'critical'
        suggestion: string
        signature?: string
        baseCommand?: string
      }
      conversationId?: string
      rememberable?: boolean
      requiresUserConfirmation?: boolean
    }
  }
}

interface AgentToolManagerOptions {
  agentWorkspacePath: string | null
  providerSettings: Pick<ProviderSettingsPort, 'getModelConfig' | 'isKnownModel'>
  settings: Pick<SettingsStore, 'get'>
  agentSettings: Pick<AgentSettingsPort, 'resolveDeepChatAgentConfig'>
  skillSettings: SkillSettingsPort
  desktopSettings: AgentDisplaySettingsPort
  commandPermissionHandler: CommandPermissionService
  commandEnvironment?: AgentCommandEnvironmentPort
  dependencies: AgentToolDependencies
}

interface AgentToolExecutionOptions {
  toolCallId?: string
  runId?: string
  messageId?: string
  requestSeq?: number
  manifestHash?: string
  tapeIncarnationId?: string
  onProgress?: (update: AgentToolProgressUpdate) => void
  signal?: AbortSignal
  allowExternalFileAccess?: boolean
  activeSkillNames?: string[]
  toolSurfaceContext?: ToolSurfaceExecutionContext
  programmaticToolCapability?: ProgrammaticToolCapabilityV1
  programmaticToolParent?: ProgrammaticToolParentRegistration
  registerOutcomeProjection?: ToolOutcomeProjectionRegistrar
  liveDelegationAuthorization?: LiveDelegationStartAuthorization
  commitDispatch?: ToolDispatchCommit
  commandShell?: ResolvedCommandShell
  oneShotCommandGrantId?: string
  permissionLease?: ToolPermissionLeaseCapability
}

type AgentFileSystemExecutionOptions = AgentToolExecutionOptions & {
  commandShell: ResolvedCommandShell
}

interface AgentToolPermissionCheckOptions {
  allowExternalFileAccess?: boolean
  activeSkillNames?: string[]
  commandShell?: ResolvedCommandShell
}

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

const throwIfAbortRequested = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')

export class AgentToolManager {
  private static readonly YO_BROWSER_TOOL_NAME_SET = new Set<string>(YO_BROWSER_TOOL_NAMES)
  private agentWorkspacePath: string | null
  private fileSystemHandler: AgentFileSystemHandler | null = null
  private bashHandler: AgentBashHandler | null = null
  private readonly commandPermissionHandler: CommandPermissionService
  private readonly providerSettings: Pick<ProviderSettingsPort, 'getModelConfig' | 'isKnownModel'>
  private readonly settings: Pick<SettingsStore, 'get'>
  private readonly agentSettings: Pick<AgentSettingsPort, 'resolveDeepChatAgentConfig'>
  private readonly skillSettings: SkillSettingsPort
  private readonly desktopSettings: AgentDisplaySettingsPort
  private readonly commandEnvironment?: AgentCommandEnvironmentPort
  private readonly dependencies: AgentToolDependencies
  private skillTools: SkillTools | null = null
  private skillExecutionService: SkillExecutionService | null = null
  private chatSettingsHandler: ChatSettingsToolHandler | null = null
  private readonly liveDelegationTool: LiveDelegationAgentTool | null
  private readonly imageGenerationTool: AgentImageGenerationTool
  private readonly planTool: AgentPlanTool
  private readonly tapeToolHandler: AgentTapeToolHandler
  private readonly memoryToolHandler: AgentMemoryToolHandler
  private readonly cronJobToolHandler: CronJobToolHandler
  private readonly fffSearchService = new FffSearchService()

  private createAgentDispatchCommit(
    toolName: string,
    serverName: string,
    normalizedArguments: Record<string, unknown>,
    options?: AgentToolExecutionOptions
  ):
    | ((
        resolvedArguments?: Record<string, unknown>
      ) => ReturnType<ProgrammaticToolParentRegistration['takeArmedToken']> | void)
    | undefined {
    const commitDispatch = options?.commitDispatch
    if (!commitDispatch) return undefined
    return (resolvedArguments = normalizedArguments) => {
      throwIfAbortRequested(options?.signal)
      commitDispatch({
        toolName,
        toolSource: 'agent',
        normalizedArguments: resolvedArguments,
        target: { serverName, originalName: toolName }
      })
      return options?.programmaticToolParent?.takeArmedToken()
    }
  }

  private readonly fileSystemSchemas = {
    read: z.object({
      path: z.string(),
      offset: z.number().int().min(0).optional().describe('Starting character offset (0-based)'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum characters to read. Large files are auto-truncated if not specified'),
      base_directory: z
        .string()
        .optional()
        .describe(
          "Base directory for resolving relative paths. Required when using skills with relative paths. For skill-based operations, provide the skill's root directory path."
        )
    }),
    write: z.object({
      path: z.string(),
      content: z.string(),
      base_directory: z
        .string()
        .optional()
        .describe(
          'Base directory for resolving relative paths. Required when using skills with relative paths.'
        )
    }),
    edit: z.object({
      path: z.string(),
      oldText: z
        .string()
        .max(10000)
        .describe('The exact text to find and replace (case-sensitive)'),
      newText: z.string().max(10000).describe('The replacement text'),
      replaceAll: z.boolean().default(true),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
    }),
    [APPLY_PATCH_TOOL_NAME]: z.object({
      patch: z.string().min(1)
    }),
    [STR_REPLACE_EDITOR_TOOL_NAME]: z.object({
      command: z.enum(['view', 'create', 'str_replace', 'insert']),
      path: z.string().min(1),
      file_text: z.string().optional(),
      insert_line: z.number().int().optional(),
      new_str: z.string().optional(),
      old_str: z.string().optional(),
      view_range: z.array(z.number().int()).optional()
    }),
    [GLOB_TOOL_NAME]: FffGlobArgsSchema,
    [GREP_TOOL_NAME]: FffGrepArgsSchema,
    exec: z.object({
      command: z.string().min(1).describe('The shell command to execute'),
      stdin: z
        .string()
        .min(1)
        .max(MAX_PROGRAMMATIC_TOOL_INPUT_BYTES)
        .refine(
          (value) => Buffer.byteLength(value, 'utf8') <= MAX_PROGRAMMATIC_TOOL_INPUT_BYTES,
          `stdin must not exceed ${MAX_PROGRAMMATIC_TOOL_INPUT_BYTES} UTF-8 bytes`
        )
        .optional()
        .describe(PROGRAMMATIC_EXEC_STDIN_DESCRIPTION),
      timeoutMs: z
        .number()
        .min(100)
        .max(600000)
        .optional()
        .describe('Optional timeout in milliseconds'),
      description: z
        .string()
        .min(5)
        .max(100)
        .optional()
        .describe(
          'Brief description of what the command does (e.g., "Install dependencies", "Start dev server")'
        ),
      cwd: z.string().optional().describe('Optional working directory for command execution.'),
      background: z
        .boolean()
        .optional()
        .describe(
          'Run the command in the background (recommended for commands taking >10s). Returns immediately with sessionId for use with process tool.'
        ),
      yieldMs: z
        .number()
        .min(100)
        .optional()
        .describe(
          'Foreground grace window in milliseconds before auto-backgrounding the command and returning a sessionId (defaults to PI_BASH_YIELD_MS or 10000). Ignored when background is true.'
        )
    }),
    process: z.object({
      action: z
        .enum(['list', 'poll', 'log', 'write', 'kill', 'clear', 'remove'])
        .describe(
          'Action to perform: list (all sessions), poll (recent output), log (full output with pagination), write (send to stdin), kill (terminate), clear (empty buffer), remove (cleanup)'
        ),
      sessionId: z
        .string()
        .optional()
        .describe('Session ID (required for most actions except list)'),
      offset: z.number().int().min(0).optional().describe('Starting offset for log action'),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Maximum characters to return for log action'),
      data: z.string().optional().describe('Data to write to stdin (write action only)'),
      eof: z.boolean().optional().describe('Send EOF after writing data (write action only)')
    })
  }

  private readonly skillSchemas = {
    skill_list: z.object({
      query: z
        .string()
        .max(SKILL_LIST_QUERY_MAX_BYTES)
        .refine(
          (value) => Buffer.byteLength(value, 'utf8') <= SKILL_LIST_QUERY_MAX_BYTES,
          `Query may contain at most ${SKILL_LIST_QUERY_MAX_BYTES} UTF-8 bytes`
        )
        .optional()
        .describe(
          `Optional local lexical search over skill names, categories, and descriptions (up to ${SKILL_LIST_QUERY_MAX_BYTES} UTF-8 bytes).`
        ),
      cursor: z
        .string()
        .max(SKILL_LIST_CURSOR_MAX_BYTES)
        .refine(
          (value) => Buffer.byteLength(value, 'utf8') <= SKILL_LIST_CURSOR_MAX_BYTES,
          `Cursor may contain at most ${SKILL_LIST_CURSOR_MAX_BYTES} UTF-8 bytes`
        )
        .optional()
        .describe('Opaque cursor from a previous skill_list response.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(SKILL_LIST_MAX_LIMIT)
        .optional()
        .default(SKILL_LIST_DEFAULT_LIMIT)
        .describe(`Maximum cards to return, up to ${SKILL_LIST_MAX_LIMIT}.`)
    }),
    skill_view: z.object({
      name: z.string().min(1).describe('Skill name to inspect'),
      file_path: z
        .string()
        .min(1)
        .optional()
        .describe('Optional file path under the skill root to inspect')
    }),
    skill_run: z.object({
      skill: z
        .string()
        .min(1)
        .max(SKILL_NAME_MAX_LENGTH)
        .describe('Active skill name that owns the script'),
      script: z
        .string()
        .min(1)
        .max(SKILL_EXECUTION_PACKAGE_MAX_PATH_BYTES)
        .refine(
          (value) => Buffer.byteLength(value, 'utf8') <= SKILL_EXECUTION_PACKAGE_MAX_PATH_BYTES,
          `Script path may contain at most ${SKILL_EXECUTION_PACKAGE_MAX_PATH_BYTES} UTF-8 bytes`
        )
        .describe(
          'Exact canonical script path from the active skill inventory (scripts/<name>.<ext>)'
        ),
      args: z
        .array(z.string().max(SKILL_RUN_MAX_ARGUMENT_CHARS))
        .max(SKILL_RUN_MAX_ARGUMENTS)
        .refine(
          (args) =>
            args.reduce((total, argument) => total + argument.length, 0) <=
            SKILL_RUN_MAX_TOTAL_ARGUMENT_CHARS,
          `Arguments may contain at most ${SKILL_RUN_MAX_TOTAL_ARGUMENT_CHARS} characters in total`
        )
        .optional()
        .default([])
        .describe('Arguments passed to the script'),
      stdin: z
        .string()
        .max(SKILL_RUN_MAX_STDIN_CHARS)
        .optional()
        .describe('Optional stdin payload sent to the script'),
      background: z
        .boolean()
        .optional()
        .default(false)
        .describe('Run the script in the background and manage it with process tool'),
      timeoutMs: z
        .number()
        .min(100)
        .max(600000)
        .optional()
        .describe('Optional timeout in milliseconds for the script run')
    }),
    skill_manage: z.discriminatedUnion('action', [
      z.object({
        action: z.literal('create').describe('Draft-only skill management action'),
        content: z.string().describe('Complete SKILL.md document including frontmatter and body')
      }),
      z.object({
        action: z.literal('edit').describe('Draft-only skill management action'),
        draftId: z.string().describe('Opaque draft ID returned by skill_manage create'),
        content: z.string().describe('Complete SKILL.md document including frontmatter and body')
      }),
      z.object({
        action: z.literal('write_file').describe('Draft-only skill management action'),
        draftId: z.string().describe('Opaque draft ID returned by skill_manage create'),
        filePath: z
          .string()
          .describe('Relative file path under references/, templates/, scripts/, or assets/'),
        fileContent: z.string().describe('Text content for write_file')
      }),
      z.object({
        action: z.literal('remove_file').describe('Draft-only skill management action'),
        draftId: z.string().describe('Opaque draft ID returned by skill_manage create'),
        filePath: z
          .string()
          .describe('Relative file path under references/, templates/, scripts/, or assets/')
      }),
      z.object({
        action: z.literal('delete').describe('Draft-only skill management action'),
        draftId: z.string().describe('Opaque draft ID returned by skill_manage create')
      })
    ])
  }

  constructor(options: AgentToolManagerOptions) {
    this.agentWorkspacePath = options.agentWorkspacePath
    this.providerSettings = options.providerSettings
    this.settings = options.settings
    this.agentSettings = options.agentSettings
    this.skillSettings = options.skillSettings
    this.desktopSettings = options.desktopSettings
    this.commandPermissionHandler = options.commandPermissionHandler
    this.commandEnvironment = options.commandEnvironment
    this.dependencies = options.dependencies
    this.liveDelegationTool = this.dependencies.liveDelegation
      ? new LiveDelegationAgentTool(this.dependencies.liveDelegation)
      : null
    this.imageGenerationTool = new AgentImageGenerationTool({
      providerSettings: this.providerSettings,
      agentSettings: this.agentSettings,
      sessions: this.dependencies.sessions,
      provider: this.dependencies.provider
    })
    this.planTool = new AgentPlanTool()
    this.tapeToolHandler = new AgentTapeToolHandler(
      this.dependencies.sessions,
      this.dependencies.tape
    )
    this.memoryToolHandler = new AgentMemoryToolHandler(
      this.dependencies.sessions,
      this.dependencies.memory
    )
    this.cronJobToolHandler = new CronJobToolHandler(this.dependencies.cronJobs)
    if (this.agentWorkspacePath) {
      this.fileSystemHandler = new AgentFileSystemHandler([this.agentWorkspacePath])
      this.bashHandler = new AgentBashHandler(
        [this.agentWorkspacePath],
        this.settings,
        this.commandPermissionHandler,
        this.commandEnvironment
      )
    }
  }

  public syncContext(context: {
    chatMode: 'agent' | 'acp agent'
    agentWorkspacePath: string | null
  }): void {
    const isAgentMode = context.chatMode === 'agent'
    const effectiveWorkspacePath = isAgentMode
      ? context.agentWorkspacePath?.trim() || this.getDefaultAgentWorkspacePath()
      : null

    if (effectiveWorkspacePath === this.agentWorkspacePath) {
      return
    }

    if (effectiveWorkspacePath) {
      this.fileSystemHandler = new AgentFileSystemHandler([effectiveWorkspacePath])
      this.bashHandler = new AgentBashHandler(
        [effectiveWorkspacePath],
        this.settings,
        this.commandPermissionHandler,
        this.commandEnvironment
      )
    } else {
      this.fileSystemHandler = null
      this.bashHandler = null
    }

    this.agentWorkspacePath = effectiveWorkspacePath
  }

  /**
   * Get all Agent tool definitions in MCP format
   */
  async getAllToolDefinitions(context: {
    chatMode: 'agent' | 'acp agent'
    supportsVision: boolean
    agentWorkspacePath: string | null
    conversationId?: string
    activeSkillNames?: string[]
    subagentCapability?: DeepChatSubagentCapability
    catalogPurpose?: 'runtime' | 'configurable' | 'universe'
    signal?: AbortSignal
    skillsEnabled?: boolean
    requireCompleteCatalog?: boolean
  }): Promise<MCPToolDefinition[]> {
    context.signal?.throwIfAborted()
    const defs: MCPToolDefinition[] = []
    const isAgentMode = context.chatMode === 'agent'
    const skillsEnabled = context.skillsEnabled ?? this.isSkillsEnabled()
    const isConfigurableCatalog = context.catalogPurpose === 'configurable'
    const isUniverseCatalog = context.catalogPurpose === 'universe'
    const isDefinitionOnlyCatalog = isConfigurableCatalog || isUniverseCatalog
    const acceptsExposure = (exposure: AgentToolExposure): boolean =>
      !isConfigurableCatalog || exposure === 'user-configurable'
    const handleAvailabilityError = (message: string, error: unknown): void => {
      if (isUniverseCatalog || context.requireCompleteCatalog) throw error
      logger.warn(message, { error })
    }
    const appendDefinitions = (
      definitions: MCPToolDefinition[],
      expectedExposure: AgentToolExposure
    ): void => {
      for (const definition of definitions) {
        assertAgentToolExposure(definition.function.name, expectedExposure)
      }
      if (acceptsExposure(expectedExposure)) {
        defs.push(...definitions)
      }
    }

    if (!isDefinitionOnlyCatalog) {
      this.syncContext(context)
    }

    // 1. FileSystem tools (agent mode only)
    if (isAgentMode && (isDefinitionOnlyCatalog || this.fileSystemHandler)) {
      const fsDefs = this.getFileSystemToolDefinitions()
      appendDefinitions(fsDefs, 'user-configurable')
    }

    // 2. Built-in question tool (all modes)
    appendDefinitions(this.getQuestionToolDefinitions(), 'user-configurable')

    // 2.1. Progress checklist tool (deepchat regular sessions only)
    if (isAgentMode) {
      appendDefinitions([this.planTool.getToolDefinition()], 'user-configurable')
    }

    // 2.15. Session tape tools (DeepChat sessions only)
    if (isAgentMode && acceptsExposure('system-model')) {
      try {
        if (
          await awaitWithAbort(this.tapeToolHandler.canUse(context.conversationId), context.signal)
        ) {
          appendDefinitions(this.tapeToolHandler.getToolDefinitions(), 'system-model')
        }
      } catch (error) {
        context.signal?.throwIfAborted()
        handleAvailabilityError(
          '[AgentToolManager] Failed to resolve tape tool availability',
          error
        )
      }
    }

    // 2.16. Long-term memory tools (only when the agent has memory enabled)
    if (isAgentMode) {
      try {
        if (
          await awaitWithAbort(
            this.memoryToolHandler.canUse(context.conversationId),
            context.signal
          )
        ) {
          appendDefinitions(this.memoryToolHandler.getToolDefinitions(), 'user-configurable')
        }
      } catch (error) {
        context.signal?.throwIfAborted()
        handleAvailabilityError(
          '[AgentToolManager] Failed to resolve memory tool availability',
          error
        )
      }
    }

    // 2.25. Image generation tool (deepchat agent sessions with an image model)
    if (isAgentMode) {
      try {
        if (
          await awaitWithAbort(
            this.imageGenerationTool.canUse(
              context.conversationId,
              isUniverseCatalog ? { strict: true, reportDiagnostics: false } : undefined
            ),
            context.signal
          )
        ) {
          appendDefinitions([this.imageGenerationTool.getToolDefinition()], 'user-configurable')
        }
      } catch (error) {
        context.signal?.throwIfAborted()
        handleAvailabilityError(
          '[AgentToolManager] Failed to resolve image generation tool availability',
          error
        )
      }
    }

    // 2.3. Scheduled task tool (disabled by default in DeepChat agent settings)
    if (isAgentMode) {
      appendDefinitions([this.cronJobToolHandler.getToolDefinition()], 'user-configurable')
    }

    // 2.5. Persistent live delegation (regular DeepChat sessions only)
    if (
      isAgentMode &&
      acceptsExposure('system-model') &&
      context.conversationId &&
      this.liveDelegationTool
    ) {
      try {
        const subagentToolDefinition = this.liveDelegationTool.getToolDefinition(
          context.subagentCapability
        )
        if (subagentToolDefinition) {
          appendDefinitions([subagentToolDefinition], 'system-model')
        }
      } catch (error) {
        handleAvailabilityError(
          '[AgentToolManager] Failed to resolve subagent tool availability',
          error
        )
      }
    }

    // 3. Skill tools (agent mode only)
    if (isAgentMode && skillsEnabled) {
      const skillDefs = this.getSkillToolDefinitions()
      appendDefinitions(skillDefs, 'system-model')

      if (
        isUniverseCatalog ||
        (context.conversationId &&
          (await this.hasRunnableSkillScripts(
            context.conversationId,
            context.activeSkillNames,
            context.requireCompleteCatalog
          )))
      ) {
        appendDefinitions([this.getSkillRunToolDefinition()], 'system-model')
      }
    }

    // 4. DeepChat settings tools (agent mode only, skill gated)
    if (isAgentMode && skillsEnabled && context.conversationId) {
      try {
        const activeSkills = isUniverseCatalog
          ? (context.activeSkillNames ?? [])
          : (context.activeSkillNames ??
            (await this.getSkillService().getActiveSkills(context.conversationId)))
        if (activeSkills.includes(CHAT_SETTINGS_SKILL_NAME)) {
          const requiredSettingsTools = Object.values(CHAT_SETTINGS_TOOL_NAMES)
          let effectiveAllowedTools: string[] = requiredSettingsTools
          if (!isUniverseCatalog) {
            const allowedTools = await this.getSkillService().getActiveSkillsAllowedTools(
              context.conversationId,
              activeSkills
            )
            const nonOpenSettingsTools = requiredSettingsTools.filter(
              (tool) => tool !== CHAT_SETTINGS_TOOL_NAMES.open
            )
            const hasNonOpenSettingsTool = nonOpenSettingsTools.some((tool) =>
              allowedTools.includes(tool)
            )
            effectiveAllowedTools = hasNonOpenSettingsTool
              ? allowedTools
              : Array.from(new Set([...allowedTools, ...requiredSettingsTools]))
          }

          const settingsDefs = buildChatSettingsToolDefinitions(effectiveAllowedTools)
          appendDefinitions(settingsDefs, 'user-configurable')
        }
      } catch (error) {
        handleAvailabilityError('[AgentToolManager] Failed to load DeepChat settings tools', error)
      }
    }

    // 5. YoBrowser CDP tools (agent mode only)
    if (isAgentMode) {
      try {
        appendDefinitions(this.getYoBrowserToolHandler().getToolDefinitions(), 'user-configurable')
      } catch (error) {
        handleAvailabilityError('[AgentToolManager] Failed to load YoBrowser tools', error)
      }
    }

    return defs
  }

  /**
   * Call an Agent tool
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    options?: AgentToolExecutionOptions
  ): Promise<AgentToolCallResult | string> {
    if (toolName === UPDATE_PLAN_TOOL_NAME) {
      return this.planTool.call(args, conversationId, {
        toolCallId: options?.toolCallId,
        onProgress: options?.onProgress,
        beforeMutation: this.createAgentDispatchCommit(
          toolName,
          AGENT_CORE_TOOL_SERVER_NAME,
          args,
          options
        )
      })
    }

    if (toolName === QUESTION_TOOL_NAME) {
      const parsedQuestion = parseQuestionToolInput(args)
      if (!parsedQuestion.success) {
        throw new Error(parsedQuestion.error)
      }
      return {
        content: 'question_requested',
        rawData: {
          content: 'question_requested',
          isError: false,
          toolResult: parsedQuestion.data
        }
      }
    }

    if (toolName === TOOL_SEARCH_AGENT_TOOL_NAME) {
      const context = options?.toolSurfaceContext
      const parsed = parseToolSearchInput(args)
      if (!parsed.success) {
        if (context) {
          recordToolSurfaceCanaryDiscovery(context.snapshot, {
            kind: 'search',
            stableTargetKeys: Object.freeze([]),
            failed: true
          })
        }
        throw new Error(parsed.error)
      }
      if (!context) {
        throw new Error('ToolSearch requires an active Tool Surface execution context.')
      }
      assertActiveToolSurfaceExecutionContext(context, context.snapshot.request)
      const commitDispatch = this.createAgentDispatchCommit(
        toolName,
        TOOL_SEARCH_TOOL_SERVER_NAME,
        parsed.data,
        options
      )
      if (!commitDispatch || !options?.registerOutcomeProjection) {
        throw new Error('ToolSearch requires dispatch and outcome projection capabilities.')
      }
      options.signal?.throwIfAborted()
      commitDispatch(parsed.data)
      let execution: ReturnType<typeof searchToolSurfaceSnapshot>
      try {
        execution = searchToolSurfaceSnapshot(parsed.data, context)
      } catch (error) {
        recordToolSurfaceCanaryDiscovery(context.snapshot, {
          kind: 'search',
          stableTargetKeys: Object.freeze([]),
          failed: true
        })
        throw error
      }
      options.registerOutcomeProjection(() => {
        try {
          context.submitActivationCandidates(execution.candidates)
          recordToolSurfaceCanaryDiscovery(context.snapshot, {
            kind: 'search',
            stableTargetKeys: execution.candidates.map((candidate) => candidate.stableTargetKey)
          })
        } catch (error) {
          recordToolSurfaceCanaryDiscovery(context.snapshot, {
            kind: 'search',
            stableTargetKeys: Object.freeze([]),
            failed: true
          })
          throw error
        }
      })
      const content = JSON.stringify(execution.result, null, 2)
      return {
        content,
        rawData: {
          content,
          isError: false,
          toolResult: createAgentToolSuccessResult(TOOL_SEARCH_AGENT_TOOL_NAME, execution.result, {
            summary: `Found ${execution.result.results.length} discoverable tool candidate${execution.result.results.length === 1 ? '' : 's'}.`,
            data: execution.result,
            meta: { resultCount: execution.result.results.length }
          })
        }
      }
    }

    if (toolName === LIVE_DELEGATION_AGENT_TOOL_NAME) {
      if (!this.liveDelegationTool) {
        throw new Error('Live delegation is unavailable.')
      }
      return await this.liveDelegationTool.call(args, conversationId, {
        ...options,
        beforeMutation: this.createAgentDispatchCommit(
          toolName,
          LIVE_DELEGATION_AGENT_TOOL_SERVER_NAME,
          args,
          options
        )
      })
    }

    if (toolName === IMAGE_GENERATE_TOOL_NAME) {
      return await this.imageGenerationTool.call(args, conversationId, {
        signal: options?.signal,
        beforeGenerate: this.createAgentDispatchCommit(
          toolName,
          IMAGE_GENERATION_TOOL_SERVER_NAME,
          args,
          options
        )
      })
    }

    if (this.tapeToolHandler.isModelTool(toolName)) {
      return await this.tapeToolHandler.call(toolName, args, conversationId)
    }

    if (isTapeToolName(toolName)) {
      throw new Error(`Tape tool '${toolName}' is not available to the model.`)
    }

    if (this.memoryToolHandler.isMemoryTool(toolName)) {
      return await this.memoryToolHandler.call(toolName, args, conversationId, {
        beforeMutation: this.createAgentDispatchCommit(
          toolName,
          AGENT_MEMORY_TOOL_SERVER_NAME,
          args,
          options
        )
      })
    }

    if (this.cronJobToolHandler.isCronJobTool(toolName)) {
      return await this.cronJobToolHandler.call(args, {
        beforeMutation: this.createAgentDispatchCommit(
          toolName,
          CRON_JOB_TOOL_SERVER_NAME,
          args,
          options
        )
      })
    }

    // Route to process tool
    if (this.isProcessTool(toolName)) {
      return await this.callProcessTool(toolName, args, conversationId, options)
    }

    // Route to FileSystem tools
    if (this.isFileSystemTool(toolName)) {
      if (!this.fileSystemHandler) {
        throw new Error(`FileSystem handler not initialized for tool: ${toolName}`)
      }
      const commandShell = this.requireCommandShell(options?.commandShell)
      return await this.callFileSystemTool(toolName, args, conversationId, {
        ...options,
        commandShell
      })
    }

    // Route to Skill tools
    if (this.isSkillTool(toolName)) {
      return await this.callSkillTool(toolName, args, conversationId, options)
    }

    if (this.isSkillExecutionTool(toolName)) {
      return await this.callSkillExecutionTool(toolName, args, conversationId, options)
    }

    // Route to DeepChat settings tools
    if (this.isChatSettingsTool(toolName)) {
      return await this.callChatSettingsTool(toolName, args, conversationId, options)
    }

    // Route to YoBrowser CDP tools
    if (AgentToolManager.YO_BROWSER_TOOL_NAME_SET.has(toolName)) {
      try {
        const response = await this.getYoBrowserToolHandler().callTool(
          toolName,
          args,
          conversationId,
          options?.runId,
          this.createAgentDispatchCommit(toolName, 'yobrowser', args, options)
        )
        return {
          content: response
        }
      } catch (error) {
        if (!isYoBrowserUnavailableError(error)) {
          throw error
        }

        const payload = error.payload
        const content = JSON.stringify(payload)
        return {
          content,
          rawData: {
            content,
            isError: true,
            toolResult: createAgentToolErrorResult(toolName, payload.error.message, {
              code: payload.error.code,
              recoverable: payload.error.recoverable,
              data: payload
            })
          }
        }
      }
    }

    throw new Error(`Unknown Agent tool: ${toolName}`)
  }

  private async getWorkdirForConversation(conversationId: string): Promise<string | null> {
    try {
      return await this.dependencies.sessions.resolveConversationWorkdir(conversationId)
    } catch (error) {
      if (!this.isConversationNotFoundError(error)) {
        logger.warn('[AgentToolManager] Failed to resolve conversation workdir:', {
          conversationId,
          error
        })
      }
    }

    return null
  }

  private async resolveOutputLimitsForConversation(
    conversationId?: string
  ): Promise<AgentOutputLimits> {
    if (!conversationId) return resolveAgentOutputLimits()

    try {
      const sessionInfo =
        await this.dependencies.sessions.resolveConversationSessionInfo(conversationId)
      if (!sessionInfo?.agentId) return resolveAgentOutputLimits()
      return resolveAgentOutputLimits(
        await this.agentSettings.resolveDeepChatAgentConfig(sessionInfo.agentId)
      )
    } catch (error) {
      logger.warn('[AgentToolManager] Failed to resolve Agent output limits', {
        conversationId,
        error
      })
      return resolveAgentOutputLimits()
    }
  }

  private isConversationNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return /Conversation\s+.+\s+not found/i.test(error.message)
  }

  private getFileSystemToolDefinitions(): MCPToolDefinition[] {
    const schemas = this.fileSystemSchemas
    const execParameters = toDeepChatJsonSchema(schemas.exec) as {
      type: string
      properties: Record<string, unknown>
      required?: string[]
    }
    const { stdin: _programmaticStdin, ...execProviderProperties } = execParameters.properties
    const defs: MCPToolDefinition[] = [
      {
        execution: TOOL_EXECUTION.read.parallel,
        type: 'function',
        function: {
          name: 'read',
          description: [
            'Read the contents of a file.',
            'Supports pagination via offset/limit for large files',
            '(auto-truncated using the configured Agent output limit if not specified).',
            'Raw text reads return only the first 10MB.',
            'Office and PDF files return extracted text, not the original binary,',
            'and follow the configured document size limit.',
            'For image files, returns an English description of visible content instead of raw pixels.',
            'When invoked from a skill context with relative paths, provide base_directory as the skill root directory.'
          ].join(' '),
          parameters: toDeepChatJsonSchema(schemas.read) as {
            type: string
            properties: Record<string, unknown>
            required?: string[]
          }
        },
        server: {
          name: 'agent-filesystem',
          icons: '📁',
          description: 'Agent FileSystem tools'
        }
      },
      {
        execution: TOOL_EXECUTION.write,
        type: 'function',
        function: {
          name: 'write',
          description:
            "Write content to a file. For skill files, provide base_directory as the skill's root directory.",
          parameters: toDeepChatJsonSchema(schemas.write) as {
            type: string
            properties: Record<string, unknown>
            required?: string[]
          }
        },
        server: {
          name: 'agent-filesystem',
          icons: '📁',
          description: 'Agent FileSystem tools'
        }
      },
      {
        execution: TOOL_EXECUTION.write,
        type: 'function',
        function: {
          name: 'edit',
          description:
            'Make precise text or line replacements in a file by matching exact text strings. Set replaceAll=false to replace only the first match.',
          parameters: toDeepChatJsonSchema(schemas.edit) as {
            type: string
            properties: Record<string, unknown>
            required?: string[]
          }
        },
        server: {
          name: 'agent-filesystem',
          icons: '📁',
          description: 'Agent FileSystem tools'
        }
      },
      {
        execution: TOOL_EXECUTION.read.parallel,
        type: 'function',
        function: {
          name: GLOB_TOOL_NAME,
          description:
            'Search file paths in the workspace. Use this before content search. Returns JSON Array<{path, score}>.',
          parameters: toDeepChatJsonSchema(schemas[GLOB_TOOL_NAME]) as {
            type: string
            properties: Record<string, unknown>
            required?: string[]
          }
        },
        server: {
          name: 'agent-filesystem',
          icons: '🔎',
          description: 'Agent FileSystem tools'
        }
      },
      {
        execution: TOOL_EXECUTION.read.parallel,
        type: 'function',
        function: {
          name: GREP_TOOL_NAME,
          description:
            'Search file contents in the workspace. Prefer passing pathScope from glob. Use mode=regex for regular expressions. Returns JSON Array<{path, lineNumber, snippet, score}>.',
          parameters: toDeepChatJsonSchema(schemas[GREP_TOOL_NAME]) as {
            type: string
            properties: Record<string, unknown>
            required?: string[]
          }
        },
        server: {
          name: 'agent-filesystem',
          icons: '🔎',
          description: 'Agent FileSystem tools'
        }
      },
      {
        execution: TOOL_EXECUTION.write,
        type: 'function',
        function: {
          name: 'exec',
          description:
            'Execute a shell command in the current working directory or an explicit cwd. External cwd paths are allowed in Full Access mode; default mode asks for approval. Use background: true when you know the command should detach immediately. Otherwise foreground exec waits briefly, and long-running commands may auto-background and return a session ID for use with the process tool.',
          parameters: {
            ...execParameters,
            properties: execProviderProperties
          }
        },
        server: {
          name: 'agent-filesystem',
          icons: '📁',
          description: 'Agent FileSystem tools'
        }
      },
      {
        execution: TOOL_EXECUTION.write,
        type: 'function',
        function: {
          name: 'process',
          description:
            'Manage background exec sessions created by explicit background exec calls or by long-running foreground exec calls that yielded a sessionId. Use poll to check output and status, log to get full output with pagination, write to send input to stdin, kill to terminate, and remove to clean up completed sessions.',
          parameters: toDeepChatJsonSchema(schemas.process) as {
            type: string
            properties: Record<string, unknown>
            required?: string[]
          }
        },
        server: {
          name: 'agent-filesystem',
          icons: '⚙️',
          description: 'Agent FileSystem tools'
        }
      }
    ]
    return defs
  }

  private getQuestionToolDefinitions(): MCPToolDefinition[] {
    return [
      {
        execution: TOOL_EXECUTION.write,
        type: 'function',
        function: {
          name: QUESTION_TOOL_NAME,
          description:
            'Pause the agent loop and ask the user one structured clarification question when missing user preferences, implementation direction, output shape, or risk decisions would materially change the result. Do not use this for casual conversation or for facts you can discover from the repo, tools, or existing context. The loop resumes only after the user responds.',
          parameters: toDeepChatJsonSchema(questionToolSchema) as {
            type: string
            properties: Record<string, unknown>
            required?: string[]
          }
        },
        server: {
          name: 'agent-core',
          icons: '❓',
          description: 'Agent core tools'
        }
      }
    ]
  }

  private isFileSystemTool(toolName: string): boolean {
    const filesystemTools = [
      'read',
      'write',
      'edit',
      APPLY_PATCH_TOOL_NAME,
      STR_REPLACE_EDITOR_TOOL_NAME,
      GLOB_TOOL_NAME,
      GREP_TOOL_NAME,
      'exec',
      'process'
    ]
    return filesystemTools.includes(toolName)
  }

  private isProcessTool(toolName: string): boolean {
    return toolName === 'process'
  }

  private getRequiredFilePermission(
    toolName: string,
    args?: Record<string, unknown>
  ): FilePermissionLevel {
    if (toolName === 'exec') return 'all'
    if (
      toolName === 'write' ||
      toolName === 'edit' ||
      toolName === APPLY_PATCH_TOOL_NAME ||
      (toolName === STR_REPLACE_EDITOR_TOOL_NAME && args?.command !== 'view')
    ) {
      return 'write'
    }
    return 'read'
  }

  private async callProcessTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    options?: AgentToolExecutionOptions
  ): Promise<AgentToolCallResult> {
    if (!conversationId) {
      throw new Error('process tool requires a conversation ID')
    }

    const { backgroundExecSessionManager } =
      await import('@/agent/shared/process/backgroundExecSessionManager')

    const validationResult = this.fileSystemSchemas.process.safeParse(args)
    if (!validationResult.success) {
      throw new Error(`Invalid arguments for process: ${validationResult.error.message}`)
    }

    const { action, sessionId, offset, limit, data, eof } = validationResult.data
    const commitMutation = this.createAgentDispatchCommit(
      toolName,
      'agent-filesystem',
      validationResult.data,
      options
    )

    switch (action) {
      case 'list': {
        const sessions = await backgroundExecSessionManager.list(conversationId)
        return {
          content: JSON.stringify({ status: 'ok', sessions }, null, 2)
        }
      }

      case 'poll': {
        if (!sessionId) {
          throw new Error('sessionId is required for poll action')
        }
        const outputLimits = await this.resolveOutputLimitsForConversation(conversationId)
        const result = await backgroundExecSessionManager.poll(
          conversationId,
          sessionId,
          outputLimits.commandOutputInlineChars
        )
        return {
          content: JSON.stringify(result, null, 2)
        }
      }

      case 'log': {
        if (!sessionId) {
          throw new Error('sessionId is required for log action')
        }
        const result = await backgroundExecSessionManager.log(
          conversationId,
          sessionId,
          offset,
          limit
        )
        return {
          content: JSON.stringify(result, null, 2)
        }
      }

      case 'write': {
        if (!sessionId) {
          throw new Error('sessionId is required for write action')
        }
        await backgroundExecSessionManager.write(
          conversationId,
          sessionId,
          data ?? '',
          eof,
          commitMutation
        )
        return {
          content: JSON.stringify({ status: 'ok', sessionId })
        }
      }

      case 'kill': {
        if (!sessionId) {
          throw new Error('sessionId is required for kill action')
        }
        await backgroundExecSessionManager.kill(conversationId, sessionId, commitMutation)
        return {
          content: JSON.stringify({ status: 'ok', sessionId })
        }
      }

      case 'clear': {
        if (!sessionId) {
          throw new Error('sessionId is required for clear action')
        }
        await backgroundExecSessionManager.clear(conversationId, sessionId, commitMutation)
        return {
          content: JSON.stringify({ status: 'ok', sessionId })
        }
      }

      case 'remove': {
        if (!sessionId) {
          throw new Error('sessionId is required for remove action')
        }
        await backgroundExecSessionManager.remove(conversationId, sessionId, commitMutation)
        return {
          content: JSON.stringify({ status: 'ok', sessionId })
        }
      }

      default:
        throw new Error(`Unknown process action: ${action}`)
    }
  }

  public clearPlanState(conversationId: string): void {
    this.planTool.clearState(conversationId)
  }

  private async callFileSystemTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId: string | undefined,
    options: AgentFileSystemExecutionOptions
  ): Promise<AgentToolCallResult> {
    const schema = this.fileSystemSchemas[toolName as keyof typeof this.fileSystemSchemas]
    if (!schema) {
      throw new Error(`No schema found for FileSystem tool: ${toolName}`)
    }

    const validationResult = schema.safeParse(args)
    if (!validationResult.success) {
      throw new Error(`Invalid arguments for ${toolName}: ${validationResult.error.message}`)
    }

    const parsedArgs = validationResult.data
    const allowExternalFileAccess = options.allowExternalFileAccess === true

    // Get dynamic workdir from conversation settings
    let dynamicWorkdir: string | null = null
    if (conversationId) {
      try {
        dynamicWorkdir = await this.getWorkdirForConversation(conversationId)
      } catch (error) {
        logger.warn('[AgentToolManager] Failed to get workdir for conversation:', {
          conversationId,
          error
        })
      }
    }

    const workspaceRoot = this.resolveCallWorkspaceRoot(dynamicWorkdir, conversationId)
    const allowedDirectories = await this.buildAllowedDirectories(workspaceRoot, conversationId, {
      includeSkillRoots: toolName !== 'exec',
      includeRuntimeRoots: toolName !== 'exec',
      requiredPermission: this.getRequiredFilePermission(toolName, parsedArgs),
      activeSkillNames: options.activeSkillNames,
      provisionalLeaseId:
        options.permissionLease?.kind === 'file' ? options.permissionLease.leaseId : undefined
    })
    const protectedDirectoryRules = await this.buildProtectedSkillDirectoryRules(
      conversationId,
      options.activeSkillNames
    )

    try {
      if (toolName === 'exec') {
        if (!this.bashHandler) {
          throw new Error('Bash handler not initialized for exec tool')
        }
        const outputLimits = await this.resolveOutputLimitsForConversation(conversationId)
        const bashHandler = new AgentBashHandler(
          allowedDirectories,
          this.settings,
          this.commandPermissionHandler,
          this.commandEnvironment
        )
        const execArgs = parsedArgs as {
          command: string
          stdin?: string
          timeoutMs?: number
          description?: string
          cwd?: string
          background?: boolean
          yieldMs?: number
        }
        const isProgrammaticInvocation = options.programmaticToolParent !== undefined
        if (isProgrammaticInvocation) {
          if (!options.programmaticToolCapability) {
            throw new Error('Programmatic exec requires an active Programmatic Tool capability.')
          }
          const invocationInput = execArgs.stdin ?? execArgs.command
          if (
            Buffer.byteLength(invocationInput, 'utf8') >
            options.programmaticToolCapability.quotas.maxInputBytes
          ) {
            throw new Error(
              'Programmatic exec input exceeds the active Programmatic Tool input quota.'
            )
          }
          if (execArgs.timeoutMs !== undefined) {
            throw new Error('Programmatic exec duration is owned by its active capability.')
          }
        } else if (execArgs.stdin !== undefined) {
          if (!options.programmaticToolCapability) {
            throw new Error('Owned exec stdin requires an active Programmatic Tool capability.')
          }
          throw new Error('Owned exec stdin requires an active Programmatic Tool parent operation.')
        }
        if (execArgs.cwd) {
          const skillScopeGuard = new AgentFileSystemHandler(allowedDirectories, {
            conversationId,
            allowExternalAccess: true,
            protectedDirectoryRules,
            commandShellPathStyle: options.commandShell.pathStyle
          })
          skillScopeGuard.assertReadAllowedAbsolute(
            skillScopeGuard.resolvePath(execArgs.cwd, workspaceRoot)
          )
        }
        if (isProgrammaticInvocation) {
          options.signal?.throwIfAborted()
        }
        const commandResult = await bashHandler.executeCommand(
          {
            command: execArgs.command,
            timeout: execArgs.timeoutMs,
            description: execArgs.description ?? 'Execute command',
            cwd: execArgs.cwd,
            background: execArgs.background,
            yieldMs: execArgs.yieldMs
          },
          {
            conversationId,
            commandShell: options.commandShell,
            oneShotCommandGrantId: options.oneShotCommandGrantId,
            stdin: execArgs.stdin,
            programmatic: isProgrammaticInvocation,
            signal: isProgrammaticInvocation ? options.signal : undefined,
            maxTimeoutMs: isProgrammaticInvocation
              ? options.programmaticToolCapability?.quotas.maxDurationMs
              : undefined,
            allowExternalCwd: allowExternalFileAccess,
            outputPreviewChars: outputLimits.commandOutputInlineChars,
            beforeExecute: this.createAgentDispatchCommit(
              toolName,
              'agent-filesystem',
              parsedArgs,
              options
            )
          }
        )
        const content =
          typeof commandResult.output === 'string'
            ? commandResult.output
            : JSON.stringify(commandResult.output)
        return {
          content,
          rawData: {
            content,
            rtkApplied: commandResult.rtkApplied,
            rtkMode: commandResult.rtkMode,
            rtkFallbackReason: commandResult.rtkFallbackReason,
            outputOffloadPath: commandResult.outputOffloadPath
          }
        }
      }

      if (!this.fileSystemHandler) {
        throw new Error('FileSystem handler not initialized')
      }

      // Priority: explicit base_directory → conversation workdir → default
      const explicitBaseDirectory = (parsedArgs as any).base_directory
      const baseDirectory = explicitBaseDirectory ?? dynamicWorkdir ?? undefined
      const fileSystemHandler = new AgentFileSystemHandler(allowedDirectories, {
        conversationId,
        allowExternalAccess: allowExternalFileAccess,
        protectedDirectoryRules,
        commandShellPathStyle: options.commandShell.pathStyle
      })

      switch (toolName) {
        case APPLY_PATCH_TOOL_NAME:
          await this.assertFileAccessPermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId,
            'write',
            allowExternalFileAccess
          )
          return {
            content: await this.applyMinimalPatch(
              (parsedArgs as { patch: string }).patch,
              baseDirectory,
              fileSystemHandler,
              options,
              parsedArgs
            )
          }
        case STR_REPLACE_EDITOR_TOOL_NAME: {
          const command = (parsedArgs as { command: 'view' | 'create' | 'str_replace' | 'insert' })
            .command
          await this.assertFileAccessPermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId,
            command === 'view' ? 'read' : 'write',
            allowExternalFileAccess
          )
          return {
            content: await this.callStrReplaceEditor(
              parsedArgs as {
                command: 'view' | 'create' | 'str_replace' | 'insert'
                path: string
                file_text?: string
                insert_line?: number
                new_str?: string
                old_str?: string
                view_range?: number[]
              },
              baseDirectory,
              fileSystemHandler,
              options
            )
          }
        }
        case 'read': {
          await this.assertFileAccessPermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId,
            'read',
            allowExternalFileAccess
          )
          const readArgs = parsedArgs as {
            path: string
            offset?: number
            limit?: number
          }
          const { path: validPath, size: fileSize } = await this.resolveValidatedReadPath(
            fileSystemHandler,
            readArgs.path,
            baseDirectory,
            allowExternalFileAccess
          )
          const mimeType = await this.getFileService().getMimeType(validPath)

          if (shouldRejectAgentBinaryRead(mimeType)) {
            return {
              content: buildBinaryReadGuidance(validPath, mimeType, 'agent')
            }
          }

          if (this.isImageMimeType(mimeType)) {
            const imageResult = await this.readImageWithVisionFallback(
              validPath,
              mimeType,
              conversationId,
              options?.signal,
              this.createAgentDispatchCommit(toolName, 'agent-filesystem', parsedArgs, options)
            )
            return {
              content: imageResult.content,
              rawData: {
                content: imageResult.content,
                imagePreviews: imageResult.imagePreviews
              }
            }
          }

          const readOutputLimits = await this.resolveOutputLimitsForConversation(conversationId)

          if (isDocumentReadMime(mimeType)) {
            const maxFileSize = this.resolveDocumentMaxFileSize()
            if (fileSize > maxFileSize) {
              return {
                content: buildOversizedReadGuidance(validPath, fileSize, maxFileSize)
              }
            }
            const prepared = await this.getFileService().prepareFileCompletely(
              validPath,
              mimeType,
              'llm-friendly'
            )
            const extracted = prepared.content ?? ''
            if (extracted.trim().length === 0) {
              return {
                content: buildEmptyDocumentReadGuidance(validPath, mimeType, fileSize, maxFileSize)
              }
            }
            return {
              content: paginateReadContent(
                readArgs.path,
                extracted,
                readArgs.offset,
                readArgs.limit,
                readOutputLimits.readFileAutoTruncateChars
              )
            }
          }

          return {
            content: await fileSystemHandler.readFile(
              {
                paths: [readArgs.path],
                offset: readArgs.offset,
                limit: readArgs.limit
              },
              baseDirectory,
              {
                mimeType,
                autoTruncateChars: readOutputLimits.readFileAutoTruncateChars
              }
            )
          }
        }
        case 'write':
          await this.assertFileAccessPermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId,
            'write',
            allowExternalFileAccess
          )
          return {
            content: await fileSystemHandler.writeFile(parsedArgs, baseDirectory, {
              beforeMutation: this.createAgentDispatchCommit(
                toolName,
                'agent-filesystem',
                parsedArgs,
                options
              )
            })
          }
        case 'edit': {
          await this.assertFileAccessPermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId,
            'write',
            allowExternalFileAccess
          )
          const editArgs = parsedArgs as {
            path: string
            oldText: string
            newText: string
            replaceAll?: boolean
          }
          if (editArgs.replaceAll === false) {
            return {
              content: await fileSystemHandler.editText(
                {
                  path: editArgs.path,
                  operation: 'edit_lines',
                  edits: [{ oldText: editArgs.oldText, newText: editArgs.newText }],
                  dryRun: false
                },
                baseDirectory,
                {
                  beforeMutation: this.createAgentDispatchCommit(
                    toolName,
                    'agent-filesystem',
                    parsedArgs,
                    options
                  )
                }
              )
            }
          }
          return {
            content: await fileSystemHandler.editFile(
              {
                path: editArgs.path,
                oldText: editArgs.oldText,
                newText: editArgs.newText
              },
              baseDirectory,
              {
                beforeMutation: this.createAgentDispatchCommit(
                  toolName,
                  'agent-filesystem',
                  parsedArgs,
                  options
                )
              }
            )
          }
        }
        case GLOB_TOOL_NAME: {
          await this.assertFileAccessPermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId,
            'read',
            allowExternalFileAccess
          )
          const fffHandler = new AgentFffSearchHandler({
            workspaceRoot,
            allowedDirectories,
            baseDirectory,
            conversationId,
            allowExternalFileAccess,
            protectedDirectoryRules,
            commandShellPathStyle: options.commandShell.pathStyle,
            signal: options.signal,
            service: this.fffSearchService
          })
          const result = await fffHandler.glob(parsedArgs)
          return {
            content: result.content,
            rawData: {
              content: result.content,
              fffSearch: result.metadata
            }
          }
        }
        case GREP_TOOL_NAME: {
          await this.assertFileAccessPermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId,
            'read',
            allowExternalFileAccess
          )
          const fffHandler = new AgentFffSearchHandler({
            workspaceRoot,
            allowedDirectories,
            baseDirectory,
            conversationId,
            allowExternalFileAccess,
            protectedDirectoryRules,
            commandShellPathStyle: options.commandShell.pathStyle,
            signal: options.signal,
            service: this.fffSearchService
          })
          const result = await fffHandler.grep(parsedArgs)
          return {
            content: result.content,
            rawData: {
              content: result.content,
              fffSearch: result.metadata
            }
          }
        }
        default:
          throw new Error(`Unknown FileSystem tool: ${toolName}`)
      }
    } catch (error) {
      if (error instanceof CommandPermissionRequiredError) {
        return {
          content: error.responseContent,
          rawData: {
            content: error.responseContent,
            isError: false,
            requiresPermission: true,
            permissionRequest: error.permissionRequest
          }
        }
      }
      if (error instanceof FilePermissionRequiredError) {
        const permissionRequest = {
          ...error.permissionRequest,
          shellProfile: options.commandShell.profile
        }
        return {
          content: error.responseContent,
          rawData: {
            content: error.responseContent,
            isError: false,
            requiresPermission: true,
            permissionRequest
          }
        }
      }
      throw error
    }
  }

  private async applyMinimalPatch(
    patch: string,
    baseDirectory: string | undefined,
    fileSystemHandler: AgentFileSystemHandler,
    options: AgentFileSystemExecutionOptions,
    parsedArgs: Record<string, unknown>
  ): Promise<string> {
    const operations = parseApplyPatch(patch)
    const commitDispatch = this.createAgentDispatchCommit(
      APPLY_PATCH_TOOL_NAME,
      'agent-filesystem',
      parsedArgs,
      options
    )
    let dispatchCommitted = false
    let applied = 0
    const commitOnce = () => {
      if (dispatchCommitted) return
      commitDispatch?.()
      dispatchCommitted = true
    }

    await this.validateMinimalPatchOperations(operations, baseDirectory, fileSystemHandler, options)

    try {
      for (const operation of operations) {
        options.signal?.throwIfAborted()
        await this.applyMinimalPatchOperation(
          operation,
          baseDirectory,
          fileSystemHandler,
          commitOnce
        )
        applied += 1
      }
    } catch (error) {
      if (!dispatchCommitted) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `${message}\n${applied} earlier patch operation${applied === 1 ? '' : 's'} completed before this failure; the current operation may also be partial. Re-view affected files before retrying.`
      )
    }

    return formatApplyPatchSummary(operations)
  }

  private async validateMinimalPatchOperations(
    operations: readonly ApplyPatchOperation[],
    baseDirectory: string | undefined,
    fileSystemHandler: AgentFileSystemHandler,
    options: AgentFileSystemExecutionOptions
  ): Promise<void> {
    type VirtualFile = {
      key: string
      source: string
      exists: boolean
      content: string
    }

    const files = new Map<string, VirtualFile>()
    const load = async (requestedPath: string): Promise<VirtualFile> => {
      const key = await fileSystemHandler.resolveValidatedCreatePath(requestedPath, baseDirectory)
      const cached = files.get(key)
      if (cached) return cached

      try {
        await fs.promises.stat(key)
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
          throw error
        }
        const missing = { key, source: key, exists: false, content: '' }
        files.set(key, missing)
        return missing
      }

      const source = await fileSystemHandler.resolveValidatedPath(
        requestedPath,
        baseDirectory,
        'write'
      )
      const sourceInfo = await fs.promises.stat(source)
      if (!sourceInfo.isFile()) throw new Error(`Path is not a regular file: ${source}`)
      const existing = {
        key,
        source,
        exists: true,
        content: await fs.promises.readFile(source, 'utf8')
      }
      files.set(key, existing)
      return existing
    }

    for (const operation of operations) {
      options.signal?.throwIfAborted()
      const source = await load(operation.path)
      if (operation.type === 'add') {
        if (source.exists) throw new Error(`Path already exists: ${source.key}`)
        source.exists = true
        source.content = operation.content
        continue
      }
      if (!source.exists) throw new Error(`Path does not exist: ${source.key}`)
      if (operation.type === 'delete') {
        source.exists = false
        source.content = ''
        continue
      }

      const updated = applyUpdateChunks(source.content, operation.path, operation.chunks)
      if (!operation.movePath) {
        source.content = updated
        continue
      }
      const destination = await load(operation.movePath)
      if (destination.key === source.source) {
        source.content = updated
        continue
      }
      if (destination.exists) throw new Error(`Path already exists: ${destination.key}`)
      destination.exists = true
      destination.content = updated
      source.exists = false
      source.content = ''
    }
  }

  private async applyMinimalPatchOperation(
    operation: ApplyPatchOperation,
    baseDirectory: string | undefined,
    fileSystemHandler: AgentFileSystemHandler,
    commitOnce: () => void
  ): Promise<void> {
    if (operation.type === 'add') {
      const target = await fileSystemHandler.resolveValidatedCreatePath(
        operation.path,
        baseDirectory
      )
      commitOnce()
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      await fs.promises.writeFile(target, operation.content, { encoding: 'utf8', flag: 'wx' })
      return
    }

    const source = await fileSystemHandler.resolveValidatedPath(
      operation.path,
      baseDirectory,
      'write'
    )
    const sourceInfo = await fs.promises.stat(source)
    if (!sourceInfo.isFile()) throw new Error(`Path is not a regular file: ${source}`)

    if (operation.type === 'delete') {
      commitOnce()
      await fs.promises.unlink(source)
      return
    }

    const original = await fs.promises.readFile(source, 'utf8')
    const updated = applyUpdateChunks(original, operation.path, operation.chunks)
    if (!operation.movePath) {
      commitOnce()
      await fs.promises.writeFile(source, updated, 'utf8')
      return
    }

    const destination = await fileSystemHandler.resolveValidatedCreatePath(
      operation.movePath,
      baseDirectory
    )
    if (destination === source) {
      commitOnce()
      await fs.promises.writeFile(source, updated, 'utf8')
      return
    }
    commitOnce()
    await fs.promises.mkdir(path.dirname(destination), { recursive: true })
    await fs.promises.writeFile(destination, updated, { encoding: 'utf8', flag: 'wx' })
    await fs.promises.unlink(source)
  }

  private async callStrReplaceEditor(
    args: {
      command: 'view' | 'create' | 'str_replace' | 'insert'
      path: string
      file_text?: string
      insert_line?: number
      new_str?: string
      old_str?: string
      view_range?: number[]
    },
    baseDirectory: string | undefined,
    fileSystemHandler: AgentFileSystemHandler,
    options: AgentFileSystemExecutionOptions
  ): Promise<string> {
    if (
      !path.isAbsolute(args.path) &&
      !path.posix.isAbsolute(args.path) &&
      !path.win32.isAbsolute(args.path)
    ) {
      throw new Error(
        `The path ${args.path} is not an absolute path, it should start with \`/\`. Maybe you meant /${args.path}?`
      )
    }

    const accessType = args.command === 'view' ? 'read' : 'write'
    const target =
      args.command === 'create'
        ? await fileSystemHandler.resolveValidatedCreatePath(args.path, baseDirectory)
        : await fileSystemHandler.resolveValidatedPath(args.path, baseDirectory, accessType)
    options.signal?.throwIfAborted()

    if (args.command === 'view') {
      const info = await fs.promises.stat(target)
      if (info.isDirectory()) {
        if (args.view_range !== undefined) {
          throw new Error(
            'The `view_range` parameter is not allowed when `path` points to a directory.'
          )
        }
        return await this.listStrReplaceDirectory(target, fileSystemHandler, options.signal)
      }
      if (!info.isFile()) {
        throw new Error(`cannot view "${target}": not a regular file or directory`)
      }
      return formatStrReplaceFileView(
        target,
        await fs.promises.readFile(target, 'utf8'),
        args.view_range
      )
    }

    const commitDispatch = this.createAgentDispatchCommit(
      STR_REPLACE_EDITOR_TOOL_NAME,
      'agent-filesystem',
      args,
      options
    )
    if (args.command === 'create') {
      if (args.file_text === undefined) {
        throw new Error('Parameter `file_text` is required for command: create')
      }
      try {
        await fs.promises.stat(target)
        throw new Error(
          `File already exists at: ${target}. Cannot overwrite files using command \`create\`.`
        )
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
      commitDispatch?.()
      await fs.promises.writeFile(target, args.file_text, { encoding: 'utf8', flag: 'wx' })
      return `New file created successfully at: ${target}`
    }

    const info = await fs.promises.stat(target)
    if (!info.isFile()) {
      throw new Error(
        `The path ${target} is a directory and only the \`view\` command can be used on directories`
      )
    }
    const before = await fs.promises.readFile(target, 'utf8')
    let after: string
    if (args.command === 'str_replace') {
      if (args.old_str === undefined) {
        throw new Error('Parameter `old_str` is required for command: str_replace')
      }
      if (!args.old_str) {
        throw new Error('Parameter `old_str` is empty for command: str_replace')
      }
      const offsets = matchOffsets(before, args.old_str)
      const offset = offsets[0]
      if (offset === undefined) {
        throw new Error(
          `No replacement was performed, old_str \`${args.old_str}\` did not appear verbatim in ${target}.`
        )
      }
      if (offsets.length > 1) {
        throw new Error(
          `No replacement was performed. Multiple occurrences of old_str \`${args.old_str}\` in lines [${lineNumbersAt(before, offsets).join(', ')}]. Please ensure it is unique`
        )
      }
      const replacement = args.new_str ?? ''
      after = before.slice(0, offset) + replacement + before.slice(offset + args.old_str.length)
    } else {
      if (args.insert_line === undefined) {
        throw new Error('Parameter `insert_line` is required for command: insert')
      }
      if (args.new_str === undefined) {
        throw new Error('Parameter `new_str` is required for command: insert')
      }
      const lines = before.split('\n')
      if (args.insert_line < 0 || args.insert_line > lines.length) {
        throw new Error(
          `Invalid \`insert_line\` parameter: ${args.insert_line}. It should be within the range of lines of the file: [0, ${lines.length}]`
        )
      }
      after = [
        ...lines.slice(0, args.insert_line),
        ...args.new_str.split('\n'),
        ...lines.slice(args.insert_line)
      ].join('\n')
    }
    commitDispatch?.()
    await fs.promises.writeFile(target, after, 'utf8')
    return `The file ${target} has been edited successfully.`
  }

  private async listStrReplaceDirectory(
    root: string,
    fileSystemHandler: AgentFileSystemHandler,
    signal?: AbortSignal
  ): Promise<string> {
    const rows = [`d\t${root}`]
    const visit = async (directory: string, depth: number): Promise<void> => {
      signal?.throwIfAborted()
      const entries = await fs.promises.readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === '__pycache__'
        ) {
          continue
        }
        const candidate = path.join(directory, entry.name)
        const validated = await fileSystemHandler.resolveValidatedPath(candidate, undefined, 'read')
        rows.push(`${entry.isDirectory() ? 'd' : entry.isFile() ? 'f' : '?'}\t${validated}`)
        if (entry.isDirectory() && depth < 2) await visit(validated, depth + 1)
      }
    }
    await visit(root, 1)
    rows.sort((left, right) => {
      const leftPath = left.slice(left.indexOf('\t') + 1)
      const rightPath = right.slice(right.indexOf('\t') + 1)
      return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0
    })
    return `Here're the files and directories up to 2 levels deep in ${root}, excluding hidden items, node_modules, and Python cache directories:\n${truncateEditorOutput(`${rows.join('\n')}\n`)}\n`
  }

  private async buildAllowedDirectories(
    workspacePath: string,
    conversationId?: string,
    options: {
      includeSkillRoots?: boolean
      includeRuntimeRoots?: boolean
      requiredPermission?: FilePermissionLevel
      activeSkillNames?: string[]
      provisionalLeaseId?: string
    } = {}
  ): Promise<string[]> {
    const includeSkillRoots = options.includeSkillRoots !== false
    const includeRuntimeRoots = options.includeRuntimeRoots !== false
    const ordered: string[] = []
    const seen = new Set<string>()
    const addPath = (value?: string | null) => {
      if (!value) return
      const resolved = path.resolve(value)
      const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved
      if (seen.has(normalized)) return
      seen.add(normalized)
      ordered.push(resolved)
    }

    // Only trust the call-scoped workspace path. Do not merge the manager's last
    // syncContext workspace — that leaks across concurrent multi-agent sessions.
    addPath(workspacePath)

    if (conversationId && includeSkillRoots) {
      const activeSkillRoots = await this.resolveActiveSkillRoots(
        conversationId,
        options.activeSkillNames
      )
      for (const skillRoot of activeSkillRoots) {
        addPath(skillRoot)
      }
    }

    if (includeRuntimeRoots) {
      addPath(conversationId ? resolveSessionDir(conversationId) : null)
      addPath(app.getPath('temp'))
      addPath(path.join(app.getPath('userData'), 'temp'))
    }

    if (conversationId) {
      const approved = this.dependencies.permissions.getApprovedFilePaths(
        conversationId,
        options.requiredPermission ?? 'read',
        options.provisionalLeaseId
      )
      for (const approvedPath of approved) {
        addPath(approvedPath)
      }
    }

    return ordered
  }

  private async resolveActiveSkillRoots(
    conversationId: string,
    activeSkillNamesOverride?: string[]
  ): Promise<string[]> {
    const skillService = this.getSkillService()

    let activeSkillNames: string[]
    let metadataList: Awaited<ReturnType<typeof skillService.getMetadataList>>

    try {
      const agentId = await skillService.resolveSessionAgentId(conversationId)
      if (!agentId) return []

      ;[activeSkillNames, metadataList] = await Promise.all([
        activeSkillNamesOverride ?? skillService.getActiveSkills(conversationId),
        activeSkillNamesOverride === undefined
          ? skillService.getMetadataList(agentId)
          : skillService.getAllSkills()
      ])
    } catch (error) {
      logger.warn('[AgentToolManager] Failed to resolve active skill roots', {
        conversationId,
        error
      })
      return []
    }

    const metadataByName = new Map(
      metadataList
        .filter((metadata) => metadata?.name?.trim())
        .map((metadata) => [metadata.name.trim(), metadata])
    )
    const roots: string[] = []

    for (const skillName of activeSkillNames) {
      const normalizedSkillName = skillName?.trim()
      if (!normalizedSkillName) {
        continue
      }

      const metadata = metadataByName.get(normalizedSkillName)
      if (!metadata) {
        logger.warn(
          '[AgentToolManager] Active skill metadata missing during file allowlist build',
          {
            conversationId,
            skillName: normalizedSkillName
          }
        )
        continue
      }

      const skillRoot = metadata.skillRoot?.trim()
      if (!skillRoot) {
        logger.warn('[AgentToolManager] Active skill root missing during file allowlist build', {
          conversationId,
          skillName: normalizedSkillName
        })
        continue
      }

      try {
        const resolvedRoot = path.resolve(skillRoot)
        if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
          logger.warn('[AgentToolManager] Active skill root is not a directory', {
            conversationId,
            skillName: normalizedSkillName,
            skillRoot: resolvedRoot
          })
          continue
        }
        roots.push(resolvedRoot)
      } catch (error) {
        logger.warn('[AgentToolManager] Failed to normalize active skill root', {
          conversationId,
          skillName: normalizedSkillName,
          skillRoot,
          error
        })
      }
    }

    return roots
  }

  private async buildProtectedSkillDirectoryRules(
    conversationId?: string,
    activeSkillNamesOverride?: string[]
  ): Promise<ProtectedDirectoryRule[]> {
    if (!conversationId) return []
    const skillService = this.getSkillService()
    const activeDirectories = await this.resolveActiveSkillRoots(
      conversationId,
      activeSkillNamesOverride
    )
    let skillsRoot: string
    try {
      skillsRoot = await skillService.getSkillsDir()
    } catch (error) {
      const configuredRoot = this.skillSettings.getPath?.()
      if (!configuredRoot) {
        logger.error('[AgentToolManager] Failed to resolve the protected Skills root.', {
          conversationId,
          error
        })
        throw new Error('Unable to resolve the protected Skills root', { cause: error })
      }
      skillsRoot = configuredRoot
    }
    return [
      {
        root: skillsRoot,
        allowedDirectories: activeDirectories
      }
    ]
  }

  private async resolveValidatedReadPath(
    fileSystemHandler: AgentFileSystemHandler,
    requestedPath: string,
    baseDirectory?: string,
    allowExternalFileAccess = false
  ): Promise<{ path: string; size: number }> {
    const resolvedPath = fileSystemHandler.resolvePath(requestedPath, baseDirectory)
    fileSystemHandler.assertReadAllowedAbsolute(resolvedPath)
    if (!allowExternalFileAccess && !fileSystemHandler.isPathAllowedAbsolute(resolvedPath)) {
      throw new Error(`Access denied - path outside allowed directories: ${requestedPath}`)
    }

    let pathForRead = resolvedPath
    try {
      const realPath = await fs.promises.realpath(resolvedPath)
      fileSystemHandler.assertReadAllowedAbsolute(realPath)
      if (!allowExternalFileAccess && !fileSystemHandler.isPathAllowedAbsolute(realPath)) {
        throw new Error(
          `Access denied - symlink target outside allowed directories: ${requestedPath}`
        )
      }
      pathForRead = realPath
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Access denied')) {
        throw error
      }
    }

    const stats = await fs.promises.stat(pathForRead)
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${requestedPath}`)
    }

    return { path: pathForRead, size: stats.size }
  }

  private resolveDocumentMaxFileSize(): number {
    return this.settings.get<number>('maxFileSize') ?? DEFAULT_DOCUMENT_READ_MAX_BYTES
  }

  private isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/')
  }

  private buildImageMetadataBlock(filePath: string, mimeType: string, fileSize: number): string {
    let width: number | null = null
    let height: number | null = null
    try {
      const image = nativeImage.createFromPath(filePath)
      const size = image.getSize()
      if (size.width > 0 && size.height > 0) {
        width = size.width
        height = size.height
      }
    } catch (error) {
      logger.warn('[AgentToolManager] Failed to read image dimensions', { filePath, error })
    }

    const lines = [
      '[Image Metadata]',
      `path: ${filePath}`,
      `mime: ${mimeType}`,
      `size: ${fileSize} bytes`,
      width !== null && height !== null ? `resolution: ${width}x${height}` : 'resolution: unknown'
    ]
    return lines.join('\n')
  }

  private async readImageWithVisionFallback(
    filePath: string,
    mimeType: string,
    conversationId?: string,
    signal?: AbortSignal,
    beforeAnalyze?: (normalizedArguments: Record<string, unknown>) => void
  ): Promise<{ content: string; imagePreviews: ToolCallImagePreview[] }> {
    throwIfAbortRequested(signal)
    const fileBuffer = await fs.promises.readFile(filePath)
    throwIfAbortRequested(signal)
    const metadata = this.buildImageMetadataBlock(filePath, mimeType, fileBuffer.length)
    const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`
    let previewData: string | undefined
    let dispatchCommitFailed = false
    try {
      const cachedPreviewData = await this.dependencies.cacheImage(dataUrl)
      if (cachedPreviewData && !cachedPreviewData.startsWith('data:image/')) {
        previewData = cachedPreviewData
      }
    } catch (error) {
      logger.warn('[AgentToolManager] Failed to cache image preview', { filePath, error })
    }
    const imagePreviews: ToolCallImagePreview[] = [
      {
        id: 'file_read-1',
        ...(previewData ? { data: previewData } : {}),
        mimeType,
        title: path.basename(filePath),
        source: 'file_read'
      }
    ]
    let visionTarget: Awaited<ReturnType<typeof this.resolveVisionTargetForConversation>>

    try {
      visionTarget = await this.resolveVisionTargetForConversation(conversationId, signal)
    } catch (error) {
      logger.warn('[AgentToolManager] Failed to resolve vision target for image read:', {
        conversationId,
        filePath,
        error
      })
      throw error
    }

    if (!visionTarget) {
      return {
        content: `${metadata}\n\nImage analysis unavailable because neither the current session model nor the agent vision model can analyze images.`,
        imagePreviews
      }
    }

    try {
      throwIfAbortRequested(signal)
      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: this.buildImageAnalysisPrompt()
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl, detail: 'auto' }
            }
          ]
        }
      ]

      const modelConfig = this.providerSettings.getModelConfig(
        visionTarget.modelId,
        visionTarget.providerId
      )
      const providerRuntime = this.getProviderRuntime()
      if (signal) {
        await providerRuntime.executeWithRateLimit(visionTarget.providerId, { signal })
      } else {
        await providerRuntime.executeWithRateLimit(visionTarget.providerId)
      }
      throwIfAbortRequested(signal)
      try {
        beforeAnalyze?.({
          path: filePath,
          mimeType,
          providerId: visionTarget.providerId,
          modelId: visionTarget.modelId
        })
      } catch (error) {
        dispatchCommitFailed = true
        throw error
      }
      const response = signal
        ? await providerRuntime.generateCompletionStandalone(
            visionTarget.providerId,
            messages,
            visionTarget.modelId,
            modelConfig?.temperature ?? 0.2,
            modelConfig?.maxTokens ?? 1200,
            { signal }
          )
        : await providerRuntime.generateCompletionStandalone(
            visionTarget.providerId,
            messages,
            visionTarget.modelId,
            modelConfig?.temperature ?? 0.2,
            modelConfig?.maxTokens ?? 1200
          )

      const normalized = (response || '').trim()
      if (!normalized) {
        return {
          content: `${metadata}\n\nImage analysis returned no usable description.`,
          imagePreviews
        }
      }
      return { content: normalized, imagePreviews }
    } catch (error) {
      if (dispatchCommitFailed) throw error
      if (isAbortError(error)) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: `${metadata}\n\nVision analysis failed, downgraded to metadata.\nerror: ${message}`,
        imagePreviews
      }
    }
  }

  private async resolveVisionTargetForConversation(conversationId?: string, signal?: AbortSignal) {
    if (!conversationId) {
      return null
    }

    try {
      const sessionInfo =
        await this.dependencies.sessions.resolveConversationSessionInfo(conversationId)
      return await resolveSessionVisionTarget({
        providerId: sessionInfo?.providerId,
        modelId: sessionInfo?.modelId,
        agentId: sessionInfo?.agentId,
        providerConfig: this.providerSettings,
        agentSettings: this.agentSettings,
        signal,
        logLabel: `read:${conversationId}`
      })
    } catch (error) {
      if (this.isConversationNotFoundError(error)) {
        return null
      }

      throw error
    }
  }

  private buildImageAnalysisPrompt(): string {
    return [
      'Analyze this image and respond in English only.',
      'Describe only what is clearly visible.',
      'Include the main subject, scene or layout, any legible text, UI elements if present, status indicators, warnings, errors, and any detail that matters for understanding the image.',
      'Do not speculate about hidden or unreadable content.',
      'Return detailed plain text in a single paragraph.'
    ].join('\n')
  }

  private async assertFileAccessPermission(
    toolName: string,
    args: Record<string, unknown>,
    baseDirectory: string | undefined,
    fileSystemHandler: AgentFileSystemHandler,
    conversationId: string | undefined,
    permissionType: 'read' | 'write',
    allowExternalFileAccess = false
  ): Promise<void> {
    if (!conversationId) return
    if (allowExternalFileAccess) return

    const targets =
      permissionType === 'write'
        ? this.collectWriteTargets(toolName, args)
        : this.collectReadTargets(toolName, args)
    if (targets.length === 0) return

    const denied = await this.collectDeniedFileTargets(targets, baseDirectory, fileSystemHandler)

    if (denied.length === 0) return

    throw new FilePermissionRequiredError(
      `components.messageBlockPermissionRequest.description.${permissionType}`,
      {
        toolName,
        serverName: 'agent-filesystem',
        permissionType,
        description: `${permissionType === 'write' ? 'Write' : 'Read'} access requires approval for: ${denied.join(', ')}`,
        paths: denied,
        conversationId
      }
    )
  }

  private async collectDeniedFileTargets(
    targets: string[],
    baseDirectory: string | undefined,
    fileSystemHandler: AgentFileSystemHandler
  ): Promise<string[]> {
    const denied: string[] = []
    for (const target of targets) {
      const resolved = fileSystemHandler.resolvePath(target, baseDirectory)
      const permissionTarget = await this.resolvePermissionTarget(resolved)
      const containmentTarget = await this.resolveContainmentTarget(resolved)
      if (!fileSystemHandler.isPathAllowedAbsolute(containmentTarget)) {
        denied.push(permissionTarget)
      }
    }
    return denied
  }

  private async resolvePermissionTarget(resolvedPath: string): Promise<string> {
    try {
      return await fs.promises.realpath(resolvedPath)
    } catch {
      return resolvedPath
    }
  }

  private async resolveContainmentTarget(resolvedPath: string): Promise<string> {
    try {
      return await fs.promises.realpath(resolvedPath)
    } catch {
      try {
        return await fs.promises.realpath(path.dirname(resolvedPath))
      } catch {
        return resolvedPath
      }
    }
  }

  private collectWriteTargets(toolName: string, args: Record<string, unknown>): string[] {
    switch (toolName) {
      case 'write':
      case 'edit':
      case STR_REPLACE_EDITOR_TOOL_NAME: {
        const pathArg = args.path
        return typeof pathArg === 'string' ? [pathArg] : []
      }
      case APPLY_PATCH_TOOL_NAME: {
        const patch = args.patch
        if (typeof patch !== 'string') return []
        try {
          return collectApplyPatchPaths(parseApplyPatch(patch))
        } catch {
          return []
        }
      }
      default:
        return []
    }
  }

  private collectReadTargets(toolName: string, args: Record<string, unknown>): string[] {
    switch (toolName) {
      case 'read':
      case 'ls': {
        const pathArg = args.path
        return typeof pathArg === 'string' ? [pathArg] : []
      }
      case STR_REPLACE_EDITOR_TOOL_NAME: {
        const pathArg = args.path
        return typeof pathArg === 'string' ? [pathArg] : []
      }
      case 'find': {
        const pathArg = args.path
        return typeof pathArg === 'string' && pathArg.trim().length > 0 ? [pathArg] : []
      }
      case GLOB_TOOL_NAME: {
        const options = args.options
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
          return []
        }
        return this.collectPathScopeReadTargets((options as Record<string, unknown>).pathScope)
      }
      case GREP_TOOL_NAME:
        return this.collectPathScopeReadTargets(args.pathScope)
      default:
        return []
    }
  }

  private collectPathScopeReadTargets(pathScope: unknown): string[] {
    if (!Array.isArray(pathScope)) {
      return []
    }

    return pathScope.filter(
      (scope): scope is string =>
        typeof scope === 'string' &&
        scope.trim().length > 0 &&
        !/[*?[{]/.test(scope) &&
        !scope.includes('..')
    )
  }

  private getDefaultAgentWorkspacePath(): string {
    const tempDir = path.join(app.getPath('temp'), 'deepchat-agent', 'workspaces')
    try {
      fs.mkdirSync(tempDir, { recursive: true })
    } catch (error) {
      logger.warn(
        '[AgentToolManager] Failed to create default workspace, using system temp:',
        error
      )
      return app.getPath('temp')
    }
    return tempDir
  }

  private resolveCallWorkspaceRoot(dynamicWorkdir: string | null, conversationId?: string): string {
    if (dynamicWorkdir) return dynamicWorkdir
    if (conversationId) return this.getDefaultAgentWorkspacePath()
    return this.agentWorkspacePath ?? this.getDefaultAgentWorkspacePath()
  }

  private isSkillsEnabled(): boolean {
    return this.skillSettings.isEnabled()
  }

  private getSkillService() {
    return this.dependencies.skills
  }

  private getYoBrowserToolHandler() {
    return this.dependencies.browser
  }

  private getFileService() {
    return this.dependencies.files
  }

  private getProviderRuntime() {
    return this.dependencies.provider
  }

  private async isChatSettingsSkillActive(
    conversationId?: string,
    activeSkillNames?: string[]
  ): Promise<boolean> {
    if (!conversationId || !this.isSkillsEnabled()) {
      return false
    }
    const activeSkills =
      activeSkillNames ?? (await this.getSkillService().getActiveSkills(conversationId))
    return activeSkills.includes(CHAT_SETTINGS_SKILL_NAME)
  }

  private getSkillTools(): SkillTools {
    if (!this.skillTools) {
      this.skillTools = new SkillTools(this.getSkillService())
    }
    return this.skillTools
  }

  private getChatSettingsHandler(): ChatSettingsToolHandler {
    if (!this.chatSettingsHandler) {
      this.chatSettingsHandler = new ChatSettingsToolHandler({
        desktopSettings: this.desktopSettings,
        skillSettings: this.skillSettings,
        skillService: this.getSkillService(),
        windowRuntime: {
          createSettingsWindow: () => this.dependencies.desktop.createSettingsWindow(),
          sendToWindow: (windowId, channel, ...args) =>
            this.dependencies.desktop.sendToWindow(windowId, channel, ...args),
          sendSettingsNavigation: (windowId, navigation) =>
            this.dependencies.desktop.sendSettingsNavigation(windowId, navigation)
        }
      })
    }
    return this.chatSettingsHandler
  }

  private getSkillExecutionService(): SkillExecutionService {
    if (!this.skillExecutionService) {
      this.skillExecutionService = new SkillExecutionService({
        resolveConversationWorkdir: (conversationId) =>
          this.getWorkdirForConversation(conversationId)
      })
    }
    return this.skillExecutionService
  }

  private getSkillToolDefinitions(): MCPToolDefinition[] {
    const schemas = this.skillSchemas
    return [
      {
        execution: TOOL_EXECUTION.read.parallel,
        type: 'function',
        function: {
          name: SKILL_LIST_AGENT_TOOL_NAME,
          description:
            'Search or browse available skills as bounded routing cards. Use query to find skills omitted from the system catalog and nextCursor to continue.',
          parameters: toDeepChatJsonSchema(schemas.skill_list) as {
            type: string
            properties: Record<string, unknown>
            required?: string[]
          }
        },
        server: {
          name: 'agent-skills',
          icons: '🎯',
          description: 'Agent Skills management'
        }
      },
      {
        execution: TOOL_EXECUTION.write,
        type: 'function',
        function: {
          name: SKILL_VIEW_AGENT_TOOL_NAME,
          description:
            'Inspect a specific skill before relying on it. Returns the rendered SKILL.md body or a requested supporting file under the skill root.',
          parameters: toDeepChatJsonSchema(schemas.skill_view) as {
            type: string
            properties: Record<string, unknown>
            required?: string[]
          }
        },
        server: {
          name: 'agent-skills',
          icons: '🎯',
          description: 'Agent Skills management'
        }
      },
      {
        execution: TOOL_EXECUTION.write,
        type: 'function',
        function: {
          name: SKILL_MANAGE_AGENT_TOOL_NAME,
          description:
            'Create or edit temporary draft skills in the conversation draft area. Use the returned draftId for follow-up draft operations. This cannot modify installed skills.',
          parameters: toDeepChatJsonSchema(schemas.skill_manage) as {
            type: string
            properties: Record<string, unknown>
            required?: string[]
          }
        },
        server: {
          name: 'agent-skills',
          icons: '🎯',
          description: 'Agent Skills management'
        }
      }
    ]
  }

  private getSkillRunToolDefinition(): MCPToolDefinition {
    return {
      execution: TOOL_EXECUTION.write,
      type: 'function',
      function: {
        name: SKILL_RUN_AGENT_TOOL_NAME,
        description:
          'Run a bundled script from a skill active in the current message/tool loop. This is the preferred way to execute skill-local Python, Node, or shell helpers without guessing paths.',
        parameters: toDeepChatJsonSchema(this.skillSchemas.skill_run) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: 'agent-skills',
        icons: '🎯',
        description: 'Agent Skills management'
      }
    }
  }

  private isSkillTool(toolName: string): boolean {
    return (
      toolName !== SKILL_RUN_AGENT_TOOL_NAME &&
      (SKILL_AGENT_TOOL_NAMES as readonly string[]).includes(toolName)
    )
  }

  private isSkillExecutionTool(toolName: string): boolean {
    return toolName === SKILL_RUN_AGENT_TOOL_NAME
  }

  private async hasRunnableSkillScripts(
    conversationId: string,
    activeSkillNames?: string[],
    failClosed = false
  ): Promise<boolean> {
    try {
      const skillService = this.getSkillService()
      const agentId = await skillService.resolveSessionAgentId(conversationId)
      if (!agentId) return false

      const activeSkills = activeSkillNames ?? (await skillService.getActiveSkills(conversationId))
      for (const skillName of activeSkills) {
        const scripts = await skillService.listSkillScriptsForAgent(agentId, skillName)
        if (scripts.some((script) => script.enabled)) {
          return true
        }
      }
    } catch (error) {
      logger.warn('[AgentToolManager] Failed to inspect runnable skill scripts', {
        conversationId,
        error
      })
      if (failClosed) throw error
    }

    return false
  }

  /**
   * Pre-check tool permissions for agent tools
   * Returns permission request info if permission is needed, null if no permission needed
   */
  async preCheckToolPermission(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    options: AgentToolPermissionCheckOptions = {}
  ): Promise<{
    needsPermission: true
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    paths?: string[]
    command?: string
    commandSignature?: string
    shellProfile?: import('@shared/commandShell').CommandShellProfile
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
    conversationId?: string
    rememberable?: boolean
    requiresUserConfirmation?: boolean
  } | null> {
    const writeTools = [
      'write',
      'edit',
      APPLY_PATCH_TOOL_NAME,
      ...(args.command === 'view' ? [] : [STR_REPLACE_EDITOR_TOOL_NAME])
    ]
    const readTools = [
      'read',
      GLOB_TOOL_NAME,
      GREP_TOOL_NAME,
      ...(args.command === 'view' ? [STR_REPLACE_EDITOR_TOOL_NAME] : [])
    ]
    const allowExternalFileAccess = options.allowExternalFileAccess === true

    if (toolName === CRON_JOB_AGENT_TOOL_NAME && cronJobActionNeedsPermission(args)) {
      return {
        needsPermission: true,
        toolName,
        serverName: CRON_JOB_TOOL_SERVER_NAME,
        permissionType: 'write',
        description: 'Scheduled task changes require approval.',
        conversationId
      }
    }

    if (
      toolName === LIVE_DELEGATION_AGENT_TOOL_NAME &&
      (args.operation === 'spawn' || args.operation === 'follow_up')
    ) {
      if (!conversationId) {
        throw new Error(`${LIVE_DELEGATION_AGENT_TOOL_NAME} requires a conversationId.`)
      }
      const session =
        await this.dependencies.sessions.resolveConversationSessionInfo(conversationId)
      if (!session) {
        throw new Error(`Conversation ${conversationId} is unavailable.`)
      }
      if (normalizeOrchestrationPolicy(session.orchestrationPolicy) === 'proactive') {
        return null
      }

      return {
        needsPermission: true,
        toolName,
        serverName: LIVE_DELEGATION_AGENT_TOOL_SERVER_NAME,
        permissionType: 'write',
        description: 'components.messageBlockPermissionRequest.description.subagentStart',
        conversationId,
        rememberable: false,
        requiresUserConfirmation: true
      }
    }

    if (this.isProcessTool(toolName)) {
      return null
    }

    if (this.isFileSystemTool(toolName)) {
      if (!this.fileSystemHandler) {
        throw new Error('FileSystem handler not initialized')
      }

      const commandShell = this.requireCommandShell(options.commandShell)

      let dynamicWorkdir: string | null = null
      if (conversationId) {
        try {
          dynamicWorkdir = await this.getWorkdirForConversation(conversationId)
        } catch (error) {
          logger.warn('[AgentToolManager] Failed to get workdir for permission check:', {
            conversationId,
            error
          })
        }
      }

      const workspaceRoot = this.resolveCallWorkspaceRoot(dynamicWorkdir, conversationId)
      const allowedDirectories = await this.buildAllowedDirectories(workspaceRoot, conversationId, {
        includeSkillRoots: toolName !== 'exec',
        includeRuntimeRoots: toolName !== 'exec',
        requiredPermission: this.getRequiredFilePermission(toolName, args),
        activeSkillNames: options.activeSkillNames
      })
      const protectedDirectoryRules = await this.buildProtectedSkillDirectoryRules(
        conversationId,
        options.activeSkillNames
      )
      const fileSystemHandler = new AgentFileSystemHandler(allowedDirectories, {
        conversationId,
        allowExternalAccess: allowExternalFileAccess,
        protectedDirectoryRules,
        commandShellPathStyle: commandShell.pathStyle
      })
      const explicitBaseDirectory =
        typeof args.base_directory === 'string' && args.base_directory.trim().length > 0
          ? args.base_directory
          : undefined
      const baseDirectory = explicitBaseDirectory ?? dynamicWorkdir ?? undefined

      if (toolName === 'exec') {
        if (!this.bashHandler) {
          return null
        }

        const command = (args.command as string) || ''
        if (!command) {
          return null
        }
        const requiredCommandShell = this.requireCommandShell(commandShell)

        const requestedCwd = typeof args.cwd === 'string' ? args.cwd.trim() : ''
        if (requestedCwd) {
          const defaultCwd = workspaceRoot
          const resolvedCwd = fileSystemHandler.resolvePath(requestedCwd, defaultCwd)
          fileSystemHandler.assertReadAllowedAbsolute(resolvedCwd)
          if (!allowExternalFileAccess && !fileSystemHandler.isPathAllowedAbsolute(resolvedCwd)) {
            return {
              needsPermission: true,
              toolName,
              serverName: 'agent-filesystem',
              permissionType: 'all',
              description: `Working directory access requires approval for: ${resolvedCwd}`,
              paths: [resolvedCwd],
              shellProfile: requiredCommandShell.profile,
              conversationId
            }
          }
        }

        if (this.bashHandler.checkCommandPermission) {
          const result = await this.bashHandler.checkCommandPermission(
            command,
            requiredCommandShell,
            conversationId
          )
          if (result.needsPermission) {
            return {
              needsPermission: true,
              toolName,
              serverName: 'agent-filesystem',
              permissionType: 'command',
              description: result.description || `Command "${command}" requires permission`,
              command,
              commandSignature: result.signature,
              shellProfile: requiredCommandShell.profile,
              commandInfo: result.commandInfo,
              conversationId
            }
          }
        }
        return null
      }

      const isWriteOperation = writeTools.includes(toolName)
      const isReadOperation = readTools.includes(toolName)

      if (!isWriteOperation && !isReadOperation) {
        return null
      }

      if (allowExternalFileAccess) {
        return null
      }

      const targets = isWriteOperation
        ? this.collectWriteTargets(toolName, args)
        : this.collectReadTargets(toolName, args)

      const permissionType = isWriteOperation ? 'write' : 'read'
      const denied = await this.collectDeniedFileTargets(targets, baseDirectory, fileSystemHandler)

      if (denied.length > 0) {
        return {
          needsPermission: true,
          toolName,
          serverName: 'agent-filesystem',
          permissionType,
          description: `${isWriteOperation ? 'Write' : 'Read'} access requires approval for: ${denied.join(', ')}`,
          paths: denied,
          shellProfile: commandShell.profile,
          conversationId
        }
      }
    }

    return null
  }

  private requireCommandShell(commandShell?: ResolvedCommandShell): ResolvedCommandShell {
    if (!commandShell) {
      throw new Error('Agent tool requires a resolved command shell.')
    }
    return ResolvedCommandShellSchema.parse(commandShell)
  }

  private isChatSettingsTool(toolName: string): boolean {
    return (
      toolName === CHAT_SETTINGS_TOOL_NAMES.toggle ||
      toolName === CHAT_SETTINGS_TOOL_NAMES.setLanguage ||
      toolName === CHAT_SETTINGS_TOOL_NAMES.setTheme ||
      toolName === CHAT_SETTINGS_TOOL_NAMES.setFontSize ||
      toolName === CHAT_SETTINGS_TOOL_NAMES.open
    )
  }

  private normalizeActiveSkillOption(activeSkillNames?: string[]): string[] | undefined {
    if (!Array.isArray(activeSkillNames)) {
      return undefined
    }

    return this.normalizeSkillNameList(activeSkillNames)
  }

  private normalizeSkillNameList(skillNames: string[]): string[] {
    return Array.from(
      new Set(
        skillNames.map((skillName) => skillName.trim()).filter((skillName) => skillName.length > 0)
      )
    )
  }

  private async callSkillTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    options?: AgentToolExecutionOptions
  ): Promise<AgentToolCallResult> {
    if (!this.isSkillsEnabled() && toolName !== SKILL_LIST_AGENT_TOOL_NAME) {
      return {
        content: JSON.stringify({
          success: false,
          error: 'Skills are disabled'
        })
      }
    }

    const skillTools = this.getSkillTools()
    const effectiveActiveSkills = this.normalizeActiveSkillOption(options?.activeSkillNames)

    if (toolName === SKILL_LIST_AGENT_TOOL_NAME) {
      const validationResult = this.skillSchemas.skill_list.safeParse(args)
      if (!validationResult.success) {
        throw new Error(`Invalid arguments for skill_list: ${validationResult.error.message}`)
      }
      const result = await skillTools.handleSkillList(
        conversationId,
        effectiveActiveSkills,
        validationResult.data
      )
      return { content: JSON.stringify(result) }
    }

    if (toolName === SKILL_VIEW_AGENT_TOOL_NAME) {
      const schema = this.skillSchemas.skill_view
      const validationResult = schema.safeParse(args)
      if (!validationResult.success) {
        throw new Error(`Invalid arguments for skill_view: ${validationResult.error.message}`)
      }
      const normalizedFilePath =
        typeof validationResult.data.file_path === 'string'
          ? validationResult.data.file_path.trim()
          : ''
      const isLinkedFileView = normalizedFilePath.length > 0
      const requestedSkillName = validationResult.data.name.trim()
      if (!isLinkedFileView && effectiveActiveSkills?.includes(requestedSkillName)) {
        const isPinned = conversationId
          ? (await this.getSkillService().getActiveSkills(conversationId)).includes(
              requestedSkillName
            )
          : false
        const content = JSON.stringify({
          success: true,
          name: requestedSkillName,
          isPinned,
          activeForCurrentMessage: true,
          activatedForMessage: false,
          activationScope: 'none',
          message: 'Skill is already active for the current message.'
        })
        return {
          content,
          rawData: {
            content,
            toolResult: {
              activationApplied: false,
              activationSource: 'none'
            }
          }
        }
      }
      if (conversationId && !isLinkedFileView) {
        this.createAgentDispatchCommit(
          toolName,
          'agent-skills',
          { name: requestedSkillName },
          options
        )?.()
      }
      const result = await skillTools.handleSkillView(
        conversationId,
        validationResult.data,
        effectiveActiveSkills
      )
      const { contentIdentity, contentResolution, ...publicResult } = result
      const normalizedViewedSkill = result.name?.trim() || validationResult.data.name.trim()
      const activeSkillNamesForResult = effectiveActiveSkills ?? []
      const activationApplied =
        Boolean(conversationId) &&
        result.success === true &&
        !isLinkedFileView &&
        Boolean(normalizedViewedSkill) &&
        !activeSkillNamesForResult.includes(normalizedViewedSkill)
      const activationSource =
        !conversationId || result.success !== true
          ? 'none'
          : activationApplied
            ? 'skill_md'
            : isLinkedFileView
              ? 'file'
              : 'none'
      const skillContext = activationApplied ? contentIdentity : null
      const skillResolution = activationApplied ? contentResolution : null
      if (activationApplied && (!skillContext || !skillResolution)) {
        const content = JSON.stringify({
          success: false,
          name: normalizedViewedSkill,
          error: 'Skill execution snapshot could not be resolved safely; activation was refused'
        })
        return { content, rawData: { content, isError: true } }
      }
      const content = JSON.stringify({
        ...publicResult,
        isPinned: result.isPinned === true,
        activeForCurrentMessage:
          result.isPinned === true ||
          (!isLinkedFileView &&
            Boolean(normalizedViewedSkill) &&
            (activationApplied || activeSkillNamesForResult.includes(normalizedViewedSkill))),
        activatedForMessage: activationApplied,
        activationScope: activationApplied ? 'message' : 'none',
        ...(activationApplied ? { activationEvidenceVersion: 1 } : {})
      })
      if (
        activationApplied &&
        Buffer.byteLength(content, 'utf8') > SKILL_RUNTIME_VIEW_RESULT_MAX_BYTES
      ) {
        const errorContent = JSON.stringify({
          success: false,
          name: normalizedViewedSkill,
          error: `Rendered Skill view exceeds ${SKILL_RUNTIME_VIEW_RESULT_MAX_BYTES} bytes and cannot be activated inline`
        })
        return { content: errorContent, rawData: { content: errorContent, isError: true } }
      }

      return {
        content,
        rawData: {
          content,
          toolResult: {
            activationApplied,
            activationSource,
            ...(activationApplied
              ? { activatedSkill: normalizedViewedSkill, skillContext, skillResolution }
              : {})
          }
        }
      }
    }

    if (toolName === SKILL_MANAGE_AGENT_TOOL_NAME) {
      const schema = this.skillSchemas.skill_manage
      const validationResult = schema.safeParse(args)
      if (!validationResult.success) {
        throw new Error(`Invalid arguments for skill_manage: ${validationResult.error.message}`)
      }
      const result = await skillTools.handleSkillManage(conversationId, validationResult.data, {
        beforeMutation: this.createAgentDispatchCommit(
          toolName,
          'agent-skills',
          validationResult.data,
          options
        )
      })
      return {
        content: JSON.stringify(result),
        rawData: {
          content: JSON.stringify(result),
          isError: result.success !== true,
          toolResult: this.buildSkillManageToolResult(result)
        }
      }
    }

    throw new Error(`Unknown skill tool: ${toolName}`)
  }

  private buildSkillManageToolResult(result: SkillManageResult): Record<string, unknown> {
    return {
      toolName: SKILL_MANAGE_AGENT_TOOL_NAME,
      ...result,
      ...(result.success === true &&
      result.action === 'create' &&
      result.draftId &&
      result.skillName
        ? {
            skillDraft: {
              status: 'created',
              draftId: result.draftId,
              skillName: result.skillName
            }
          }
        : {})
    }
  }

  private async callSkillExecutionTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    options?: AgentToolExecutionOptions
  ): Promise<AgentToolCallResult> {
    if (toolName !== SKILL_RUN_AGENT_TOOL_NAME) {
      throw new Error(`Unknown skill execution tool: ${toolName}`)
    }

    if (!conversationId) {
      throw new Error('skill_run requires a conversation ID')
    }

    const validationResult = this.skillSchemas.skill_run.safeParse(args)
    if (!validationResult.success) {
      throw new Error(`Invalid arguments for skill_run: ${validationResult.error.message}`)
    }

    const requestSeq = options?.requestSeq
    if (
      !options?.runId ||
      requestSeq === undefined ||
      !Number.isSafeInteger(requestSeq) ||
      requestSeq <= 0 ||
      !options.manifestHash ||
      !options.tapeIncarnationId
    ) {
      throw new Error('skill_run requires exact request-bound Skill execution authority')
    }
    throwIfAbortRequested(options.signal)
    const authority = await this.dependencies.skillExecutionAuthority.resolve({
      sessionId: conversationId,
      runId: options.runId,
      requestSeq,
      manifestHash: options.manifestHash,
      tapeIncarnationId: options.tapeIncarnationId,
      skillName: validationResult.data.skill
    })
    throwIfAbortRequested(options.signal)
    const result = await this.getSkillExecutionService().execute(validationResult.data, authority, {
      conversationId,
      commandShell: this.requireCommandShell(options.commandShell),
      signal: options.signal,
      outputPreviewChars: (await this.resolveOutputLimitsForConversation(conversationId))
        .commandOutputInlineChars,
      assertAuthorityCurrent: async () => {
        throwIfAbortRequested(options.signal)
        await this.dependencies.skillExecutionAuthority.assertCurrent(authority)
        throwIfAbortRequested(options.signal)
      },
      beforeExecute: this.createAgentDispatchCommit(
        toolName,
        'agent-skills',
        validationResult.data,
        options
      )
    })
    const content =
      typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)

    return {
      content,
      rawData: {
        content,
        isError: result.outputLimited === true,
        rtkApplied: result.rtkApplied,
        rtkMode: result.rtkMode,
        rtkFallbackReason: result.rtkFallbackReason,
        outputOffloadPath: result.outputOffloadPath
      }
    }
  }

  private async callChatSettingsTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    options?: AgentToolExecutionOptions
  ): Promise<AgentToolCallResult> {
    const handler = this.getChatSettingsHandler()
    const commitMutation = this.createAgentDispatchCommit(
      toolName,
      CHAT_SETTINGS_SKILL_NAME,
      args,
      options
    )
    if (toolName === CHAT_SETTINGS_TOOL_NAMES.toggle) {
      const result = await handler.toggle(
        args,
        conversationId,
        options?.activeSkillNames,
        commitMutation
      )
      return { content: JSON.stringify(result) }
    }
    if (toolName === CHAT_SETTINGS_TOOL_NAMES.setLanguage) {
      const result = await handler.setLanguage(
        args,
        conversationId,
        options?.activeSkillNames,
        commitMutation
      )
      return { content: JSON.stringify(result) }
    }
    if (toolName === CHAT_SETTINGS_TOOL_NAMES.setTheme) {
      const result = await handler.setTheme(
        args,
        conversationId,
        options?.activeSkillNames,
        commitMutation
      )
      return { content: JSON.stringify(result) }
    }
    if (toolName === CHAT_SETTINGS_TOOL_NAMES.setFontSize) {
      const result = await handler.setFontSize(
        args,
        conversationId,
        options?.activeSkillNames,
        commitMutation
      )
      return { content: JSON.stringify(result) }
    }
    if (toolName === CHAT_SETTINGS_TOOL_NAMES.open) {
      const shouldCheckPermission = await this.isChatSettingsSkillActive(
        conversationId,
        options?.activeSkillNames
      )
      if (shouldCheckPermission && conversationId) {
        const approved = this.dependencies.permissions.consumeSettingsApproval(
          conversationId,
          toolName,
          options?.permissionLease?.kind === 'settings'
            ? options.permissionLease.leaseId
            : undefined
        )
        if (!approved) {
          const responseContent = 'components.messageBlockPermissionRequest.description.write'
          return {
            content: responseContent,
            rawData: {
              content: responseContent,
              isError: false,
              requiresPermission: true,
              permissionRequest: {
                toolName,
                serverName: CHAT_SETTINGS_SKILL_NAME,
                permissionType: 'write',
                description: 'Opening DeepChat settings requires approval.',
                conversationId,
                rememberable: false
              }
            }
          }
        }
      }
      const result = await handler.open(
        args,
        conversationId,
        options?.activeSkillNames,
        commitMutation
      )
      return { content: JSON.stringify(result) }
    }
    throw new Error(`Unknown DeepChat settings tool: ${toolName}`)
  }
}
