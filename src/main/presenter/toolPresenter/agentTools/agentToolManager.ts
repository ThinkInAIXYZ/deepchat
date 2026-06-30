import type { IConfigPresenter, MCPToolDefinition } from '@shared/presenter'
import type { AgentToolProgressUpdate } from '@shared/types/presenters/tool.presenter'
import { toDeepChatJsonSchema } from '@shared/lib/zodJsonSchema'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { app, nativeImage } from 'electron'
import logger from '@shared/logger'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { ToolCallImagePreview } from '@shared/types/core/mcp'
import type { SkillManageResult } from '@shared/types/skill'
import { buildBinaryReadGuidance, shouldRejectAgentBinaryRead } from '@/lib/binaryReadGuard'
import { AgentFileSystemHandler } from './agentFileSystemHandler'
import { AgentBashHandler } from './agentBashHandler'
import {
  AgentFffSearchHandler,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  FffGlobArgsSchema,
  FffGrepArgsSchema
} from './agentFffSearchHandler'
import { FffSearchService, type FffSearchMetadata } from '@/lib/agentRuntime/fffSearchService'
import { SkillTools } from '../../skillPresenter/skillTools'
import { SkillExecutionService } from '../../skillPresenter/skillExecutionService'
import { questionToolSchema, QUESTION_TOOL_NAME } from '@/lib/agentRuntime/questionTool'
import {
  ChatSettingsToolHandler,
  buildChatSettingsToolDefinitions,
  CHAT_SETTINGS_SKILL_NAME,
  CHAT_SETTINGS_TOOL_NAMES
} from './chatSettingsTools'
import type { AgentToolRuntimePort } from '../runtimePorts'
import { YO_BROWSER_TOOL_NAMES } from '../../browser/YoBrowserToolDefinitions'
import { resolveSessionVisionTarget } from '../../vision/sessionVisionResolver'
import {
  SUBAGENT_ORCHESTRATOR_TOOL_NAME,
  SubagentOrchestratorTool
} from './subagentOrchestratorTool'
import { AgentImageGenerationTool, IMAGE_GENERATE_TOOL_NAME } from './agentImageGenerationTool'
import { AgentPlanTool, UPDATE_PLAN_TOOL_NAME } from './agentPlanTool'
import { AgentTapeToolHandler } from './agentTapeTools'
import { AgentMemoryToolHandler } from './agentMemoryTools'
import { createAgentToolErrorResult } from '@shared/lib/agentToolResultEnvelope'
import { isYoBrowserUnavailableError } from '../../browser/YoBrowserErrors'

// Consider moving to a shared handlers location in future refactoring
import {
  CommandPermissionRequiredError,
  CommandPermissionService
} from '../../permission/commandPermissionService'
import {
  FilePermissionRequiredError,
  type FilePermissionLevel
} from '../../permission/filePermissionService'

export interface AgentToolCallResult {
  content: string
  rawData?: {
    content?: string
    isError?: boolean
    toolResult?: unknown
    rtkApplied?: boolean
    rtkMode?: 'rewrite' | 'direct' | 'bypass'
    rtkFallbackReason?: string
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
    }
  }
}

interface AgentToolManagerOptions {
  agentWorkspacePath: string | null
  configPresenter: IConfigPresenter
  commandPermissionHandler?: CommandPermissionService
  runtimePort: AgentToolRuntimePort
}

interface AgentToolExecutionOptions {
  toolCallId?: string
  onProgress?: (update: AgentToolProgressUpdate) => void
  signal?: AbortSignal
  allowExternalFileAccess?: boolean
  activeSkillNames?: string[]
}

interface AgentToolPermissionCheckOptions {
  allowExternalFileAccess?: boolean
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
  private readonly commandPermissionHandler?: CommandPermissionService
  private readonly configPresenter: IConfigPresenter
  private readonly runtimePort: AgentToolRuntimePort
  private skillTools: SkillTools | null = null
  private skillExecutionService: SkillExecutionService | null = null
  private chatSettingsHandler: ChatSettingsToolHandler | null = null
  private subagentOrchestratorTool: SubagentOrchestratorTool | null = null
  private imageGenerationTool: AgentImageGenerationTool | null = null
  private planTool: AgentPlanTool | null = null
  private tapeToolHandler: AgentTapeToolHandler | null = null
  private memoryToolHandler: AgentMemoryToolHandler | null = null
  private readonly fffSearchService = new FffSearchService()
  private static readonly READ_FILE_AUTO_TRUNCATE_THRESHOLD = 4500

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
    [GLOB_TOOL_NAME]: FffGlobArgsSchema,
    [GREP_TOOL_NAME]: FffGrepArgsSchema,
    exec: z.object({
      command: z.string().min(1).describe('The shell command to execute'),
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
    skill_list: z.object({}),
    skill_view: z.object({
      name: z.string().min(1).describe('Skill name to inspect'),
      file_path: z
        .string()
        .min(1)
        .optional()
        .describe('Optional file path under the skill root to inspect')
    }),
    skill_run: z.object({
      skill: z.string().min(1).describe('Active skill name that owns the script'),
      script: z
        .string()
        .min(1)
        .describe('Script path under the skill root, usually scripts/<name>.<ext>'),
      args: z.array(z.string()).optional().default([]).describe('Arguments passed to the script'),
      stdin: z.string().optional().describe('Optional stdin payload sent to the script'),
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
    this.configPresenter = options.configPresenter
    this.commandPermissionHandler = options.commandPermissionHandler
    this.runtimePort = options.runtimePort
    this.subagentOrchestratorTool = new SubagentOrchestratorTool(this.runtimePort)
    this.imageGenerationTool = new AgentImageGenerationTool({
      configPresenter: this.configPresenter,
      runtimePort: this.runtimePort
    })
    this.planTool = new AgentPlanTool()
    this.tapeToolHandler = new AgentTapeToolHandler(this.runtimePort)
    this.memoryToolHandler = new AgentMemoryToolHandler(this.runtimePort)
    if (this.agentWorkspacePath) {
      this.fileSystemHandler = new AgentFileSystemHandler([this.agentWorkspacePath])
      this.bashHandler = new AgentBashHandler(
        [this.agentWorkspacePath],
        this.commandPermissionHandler,
        this.configPresenter
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
        this.commandPermissionHandler,
        this.configPresenter
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
  }): Promise<MCPToolDefinition[]> {
    const defs: MCPToolDefinition[] = []
    const isAgentMode = context.chatMode === 'agent'
    this.syncContext(context)

    // 1. FileSystem tools (agent mode only)
    if (isAgentMode && this.fileSystemHandler) {
      const fsDefs = this.getFileSystemToolDefinitions()
      defs.push(...fsDefs)
    }

    // 2. Built-in question tool (all modes)
    defs.push(...this.getQuestionToolDefinitions())

    // 2.1. Progress checklist tool (deepchat regular sessions only)
    if (isAgentMode && this.planTool) {
      defs.push(this.planTool.getToolDefinition())
    }

    // 2.15. Session tape tools (DeepChat sessions only)
    if (isAgentMode && this.tapeToolHandler) {
      try {
        if (await this.tapeToolHandler.canUse(context.conversationId)) {
          defs.push(...this.tapeToolHandler.getToolDefinitions())
        }
      } catch (error) {
        logger.warn('[AgentToolManager] Failed to resolve tape tool availability', { error })
      }
    }

    // 2.16. Long-term memory tools (only when the agent has memory enabled)
    if (isAgentMode && this.memoryToolHandler) {
      try {
        if (await this.memoryToolHandler.canUse(context.conversationId)) {
          defs.push(...this.memoryToolHandler.getToolDefinitions())
        }
      } catch (error) {
        logger.warn('[AgentToolManager] Failed to resolve memory tool availability', { error })
      }
    }

    // 2.25. Image generation tool (deepchat agent sessions with an image model)
    if (isAgentMode && this.imageGenerationTool) {
      try {
        if (await this.imageGenerationTool.canUse(context.conversationId)) {
          defs.push(this.imageGenerationTool.getToolDefinition())
        }
      } catch (error) {
        logger.warn('[AgentToolManager] Failed to resolve image generation tool availability', {
          error
        })
      }
    }

    // 2.5. Subagent orchestration tool (deepchat regular sessions only)
    if (isAgentMode && context.conversationId && this.subagentOrchestratorTool) {
      try {
        const subagentToolDefinition = await this.subagentOrchestratorTool.getToolDefinition(
          context.conversationId
        )
        if (subagentToolDefinition) {
          defs.push(subagentToolDefinition)
        }
      } catch (error) {
        logger.warn('[AgentToolManager] Failed to resolve subagent tool availability', { error })
      }
    }

    // 3. Skill tools (agent mode only)
    if (isAgentMode && this.isSkillsEnabled()) {
      const skillDefs = this.getSkillToolDefinitions()
      defs.push(...skillDefs)

      if (
        context.conversationId &&
        (await this.hasRunnableSkillScripts(context.conversationId, context.activeSkillNames))
      ) {
        defs.push(this.getSkillRunToolDefinition())
      }
    }

    // 4. DeepChat settings tools (agent mode only, skill gated)
    if (isAgentMode && this.isSkillsEnabled() && context.conversationId) {
      try {
        const activeSkills =
          context.activeSkillNames ??
          (await this.getSkillPresenter().getActiveSkills(context.conversationId))
        if (activeSkills.includes(CHAT_SETTINGS_SKILL_NAME)) {
          const allowedTools = await this.getSkillPresenter().getActiveSkillsAllowedTools(
            context.conversationId,
            activeSkills
          )
          const requiredSettingsTools = Object.values(CHAT_SETTINGS_TOOL_NAMES)
          const nonOpenSettingsTools = requiredSettingsTools.filter(
            (tool) => tool !== CHAT_SETTINGS_TOOL_NAMES.open
          )
          const hasNonOpenSettingsTool = nonOpenSettingsTools.some((tool) =>
            allowedTools.includes(tool)
          )
          const effectiveAllowedTools = hasNonOpenSettingsTool
            ? allowedTools
            : Array.from(new Set([...allowedTools, ...requiredSettingsTools]))

          const settingsDefs = buildChatSettingsToolDefinitions(effectiveAllowedTools)
          defs.push(...settingsDefs)
        }
      } catch (error) {
        logger.warn('[AgentToolManager] Failed to load DeepChat settings tools', { error })
      }
    }

    // 5. YoBrowser CDP tools (agent mode only)
    if (isAgentMode) {
      try {
        defs.push(...this.getYoBrowserToolHandler().getToolDefinitions())
      } catch (error) {
        logger.warn('[AgentToolManager] Failed to load YoBrowser tools', { error })
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
      if (!this.planTool) {
        throw new Error('Progress tool is not available.')
      }

      return this.planTool.call(args, conversationId, {
        toolCallId: options?.toolCallId,
        onProgress: options?.onProgress
      })
    }

    if (toolName === QUESTION_TOOL_NAME) {
      const validationResult = questionToolSchema.safeParse(args)
      if (!validationResult.success) {
        throw new Error(
          `Invalid arguments for ${QUESTION_TOOL_NAME}. Use a single object with \`header?\`, \`question\`, \`options\`, \`multiple?\`, and \`custom?\`. Ask exactly one question per tool call. Do not use \`questions\` or \`allowOther\`, and do not pass stringified \`options\` JSON. Validation details: ${validationResult.error.message}`
        )
      }
      return {
        content: 'question_requested',
        rawData: {
          content: 'question_requested',
          isError: false,
          toolResult: validationResult.data
        }
      }
    }

    if (toolName === SUBAGENT_ORCHESTRATOR_TOOL_NAME) {
      if (!this.subagentOrchestratorTool) {
        throw new Error('Subagent orchestrator is not available.')
      }

      return await this.subagentOrchestratorTool.call(args, conversationId, options)
    }

    if (toolName === IMAGE_GENERATE_TOOL_NAME) {
      if (!this.imageGenerationTool) {
        throw new Error('Image generation tool is not available.')
      }

      return await this.imageGenerationTool.call(args, conversationId, options)
    }

    if (this.tapeToolHandler?.isTapeTool(toolName)) {
      return await this.tapeToolHandler.call(toolName, args, conversationId)
    }

    if (this.memoryToolHandler?.isMemoryTool(toolName)) {
      return await this.memoryToolHandler.call(toolName, args, conversationId)
    }

    // Route to process tool
    if (this.isProcessTool(toolName)) {
      return await this.callProcessTool(toolName, args, conversationId)
    }

    // Route to FileSystem tools
    if (this.isFileSystemTool(toolName)) {
      if (!this.fileSystemHandler) {
        throw new Error(`FileSystem handler not initialized for tool: ${toolName}`)
      }
      return await this.callFileSystemTool(toolName, args, conversationId, options)
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
      return await this.callChatSettingsTool(toolName, args, conversationId)
    }

    // Route to YoBrowser CDP tools
    if (AgentToolManager.YO_BROWSER_TOOL_NAME_SET.has(toolName)) {
      try {
        const response = await this.getYoBrowserToolHandler().callTool(
          toolName,
          args,
          conversationId
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
      return await this.runtimePort.resolveConversationWorkdir(conversationId)
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

  private isConversationNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return /Conversation\s+.+\s+not found/i.test(error.message)
  }

  private getFileSystemToolDefinitions(): MCPToolDefinition[] {
    const schemas = this.fileSystemSchemas
    const defs: MCPToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'read',
          description:
            "Read the contents of a file. Supports pagination via offset/limit for large files (auto-truncated at 4500 chars if not specified). For image files, returns an English description of visible content instead of raw pixels. When invoked from a skill context with relative paths, provide base_directory as the skill's root directory.",
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
        type: 'function',
        function: {
          name: 'exec',
          description:
            'Execute a shell command in the current working directory or an explicit cwd. External cwd paths are allowed in Full Access mode; default mode asks for approval. Use background: true when you know the command should detach immediately. Otherwise foreground exec waits briefly, and long-running commands may auto-background and return a session ID for use with the process tool.',
          parameters: toDeepChatJsonSchema(schemas.exec) as {
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

  private getRequiredFilePermission(toolName: string): FilePermissionLevel {
    if (toolName === 'exec') return 'all'
    if (toolName === 'write' || toolName === 'edit') return 'write'
    return 'read'
  }

  private async callProcessTool(
    _toolName: string,
    args: Record<string, unknown>,
    conversationId?: string
  ): Promise<AgentToolCallResult> {
    if (!conversationId) {
      throw new Error('process tool requires a conversation ID')
    }

    const { backgroundExecSessionManager } =
      await import('@/lib/agentRuntime/backgroundExecSessionManager')

    const validationResult = this.fileSystemSchemas.process.safeParse(args)
    if (!validationResult.success) {
      throw new Error(`Invalid arguments for process: ${validationResult.error.message}`)
    }

    const { action, sessionId, offset, limit, data, eof } = validationResult.data

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
        const result = await backgroundExecSessionManager.poll(conversationId, sessionId)
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
        await backgroundExecSessionManager.write(conversationId, sessionId, data ?? '', eof)
        return {
          content: JSON.stringify({ status: 'ok', sessionId })
        }
      }

      case 'kill': {
        if (!sessionId) {
          throw new Error('sessionId is required for kill action')
        }
        await backgroundExecSessionManager.kill(conversationId, sessionId)
        return {
          content: JSON.stringify({ status: 'ok', sessionId })
        }
      }

      case 'clear': {
        if (!sessionId) {
          throw new Error('sessionId is required for clear action')
        }
        await backgroundExecSessionManager.clear(conversationId, sessionId)
        return {
          content: JSON.stringify({ status: 'ok', sessionId })
        }
      }

      case 'remove': {
        if (!sessionId) {
          throw new Error('sessionId is required for remove action')
        }
        await backgroundExecSessionManager.remove(conversationId, sessionId)
        return {
          content: JSON.stringify({ status: 'ok', sessionId })
        }
      }

      default:
        throw new Error(`Unknown process action: ${action}`)
    }
  }

  public clearPlanState(conversationId: string): void {
    this.planTool?.clearState(conversationId)
  }

  private async callFileSystemTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    options?: AgentToolExecutionOptions
  ): Promise<AgentToolCallResult> {
    // Handle process tool separately
    if (this.isProcessTool(toolName)) {
      return this.callProcessTool(toolName, args, conversationId)
    }

    const schema = this.fileSystemSchemas[toolName as keyof typeof this.fileSystemSchemas]
    if (!schema) {
      throw new Error(`No schema found for FileSystem tool: ${toolName}`)
    }

    const validationResult = schema.safeParse(args)
    if (!validationResult.success) {
      throw new Error(`Invalid arguments for ${toolName}: ${validationResult.error.message}`)
    }

    const parsedArgs = validationResult.data
    const allowExternalFileAccess = options?.allowExternalFileAccess === true

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

    const workspaceRoot =
      dynamicWorkdir ?? this.agentWorkspacePath ?? this.getDefaultAgentWorkspacePath()
    const allowedDirectories = await this.buildAllowedDirectories(workspaceRoot, conversationId, {
      includeSkillRoots: toolName !== 'exec',
      includeRuntimeRoots: toolName !== 'exec',
      requiredPermission: this.getRequiredFilePermission(toolName),
      activeSkillNames: options?.activeSkillNames
    })

    if (toolName === 'exec') {
      if (!this.bashHandler) {
        throw new Error('Bash handler not initialized for exec tool')
      }
      const bashHandler = new AgentBashHandler(
        allowedDirectories,
        this.commandPermissionHandler,
        this.configPresenter
      )
      const execArgs = parsedArgs as {
        command: string
        timeoutMs?: number
        description?: string
        cwd?: string
        background?: boolean
        yieldMs?: number
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
          allowExternalCwd: allowExternalFileAccess
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
          rtkFallbackReason: commandResult.rtkFallbackReason
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
      allowExternalAccess: allowExternalFileAccess
    })

    try {
      switch (toolName) {
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
          const validPath = await this.resolveValidatedReadPath(
            fileSystemHandler,
            readArgs.path,
            baseDirectory,
            allowExternalFileAccess
          )
          const mimeType = await this.getFilePresenter().getMimeType(validPath)

          if (await shouldRejectAgentBinaryRead(validPath, mimeType)) {
            return {
              content: buildBinaryReadGuidance(validPath, mimeType, 'agent')
            }
          }

          if (this.isImageMimeType(mimeType)) {
            const imageResult = await this.readImageWithVisionFallback(
              validPath,
              mimeType,
              conversationId,
              options?.signal
            )
            return {
              content: imageResult.content,
              rawData: {
                content: imageResult.content,
                imagePreviews: imageResult.imagePreviews
              }
            }
          }

          if (this.shouldUseRawTextRead(mimeType)) {
            return {
              content: await fileSystemHandler.readFile(
                {
                  paths: [readArgs.path],
                  offset: readArgs.offset,
                  limit: readArgs.limit
                },
                baseDirectory
              )
            }
          }

          const prepared = await this.getFilePresenter().prepareFileCompletely(
            validPath,
            mimeType,
            'llm-friendly'
          )
          return {
            content: this.paginateReadContent(
              readArgs.path,
              prepared.content || '',
              readArgs.offset,
              readArgs.limit
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
          return { content: await fileSystemHandler.writeFile(parsedArgs, baseDirectory) }
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
                baseDirectory
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
              baseDirectory
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
            signal: options?.signal,
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
            signal: options?.signal,
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
      throw error
    }
  }

  private async buildAllowedDirectories(
    workspacePath: string,
    conversationId?: string,
    options: {
      includeSkillRoots?: boolean
      includeRuntimeRoots?: boolean
      requiredPermission?: FilePermissionLevel
      activeSkillNames?: string[]
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

    addPath(workspacePath)
    addPath(this.agentWorkspacePath)

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
      addPath(path.join(app.getPath('home'), '.deepchat'))
      addPath(app.getPath('temp'))
      addPath(path.join(app.getPath('userData'), 'temp'))
    }

    if (conversationId) {
      const approved = this.runtimePort.getApprovedFilePaths(
        conversationId,
        options.requiredPermission ?? 'read'
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
    const skillPresenter = this.getSkillPresenter()
    if (!skillPresenter?.getActiveSkills || !skillPresenter?.getMetadataList) {
      return []
    }

    let activeSkillNames: string[]
    let metadataList: Awaited<ReturnType<typeof skillPresenter.getMetadataList>>

    try {
      ;[activeSkillNames, metadataList] = await Promise.all([
        activeSkillNamesOverride ?? skillPresenter.getActiveSkills(conversationId),
        skillPresenter.getMetadataList()
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

  private async resolveValidatedReadPath(
    fileSystemHandler: AgentFileSystemHandler,
    requestedPath: string,
    baseDirectory?: string,
    allowExternalFileAccess = false
  ): Promise<string> {
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

    return pathForRead
  }

  private isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/')
  }

  private shouldUseRawTextRead(mimeType: string): boolean {
    if (mimeType === 'text/csv') {
      return false
    }
    if (mimeType.startsWith('text/')) {
      return true
    }

    const codeLikeMimes = new Set([
      'application/json',
      'application/xml',
      'application/javascript',
      'application/x-javascript',
      'application/typescript',
      'application/x-typescript'
    ])
    return codeLikeMimes.has(mimeType)
  }

  private paginateReadContent(
    pathLabel: string,
    fullContent: string,
    offset?: number,
    limit?: number
  ): string {
    const start = Math.max(0, offset ?? 0)
    const totalLength = fullContent.length

    let effectiveLimit = limit
    let autoTruncated = false
    if (
      effectiveLimit === undefined &&
      totalLength - start > AgentToolManager.READ_FILE_AUTO_TRUNCATE_THRESHOLD
    ) {
      effectiveLimit = AgentToolManager.READ_FILE_AUTO_TRUNCATE_THRESHOLD
      autoTruncated = true
    }

    const content =
      effectiveLimit !== undefined
        ? fullContent.slice(start, start + effectiveLimit)
        : fullContent.slice(start)
    const endOffset = start + content.length

    if (start > 0 || limit !== undefined || autoTruncated) {
      let header = `${pathLabel} [chars ${start}-${endOffset} of ${totalLength}]`
      if (autoTruncated) {
        header += ' (auto-truncated, use offset/limit to read more)'
      }
      return `${header}:\n${content}\n`
    }

    return `${pathLabel}:\n${content}\n`
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
    signal?: AbortSignal
  ): Promise<{ content: string; imagePreviews: ToolCallImagePreview[] }> {
    throwIfAbortRequested(signal)
    const fileBuffer = await fs.promises.readFile(filePath)
    throwIfAbortRequested(signal)
    const metadata = this.buildImageMetadataBlock(filePath, mimeType, fileBuffer.length)
    const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`
    let previewData: string | undefined
    if (this.runtimePort.cacheImage) {
      try {
        const cachedPreviewData = await this.runtimePort.cacheImage(dataUrl)
        if (cachedPreviewData && !cachedPreviewData.startsWith('data:image/')) {
          previewData = cachedPreviewData
        }
      } catch (error) {
        logger.warn('[AgentToolManager] Failed to cache image preview', { filePath, error })
      }
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

      const modelConfig = this.configPresenter.getModelConfig(
        visionTarget.modelId,
        visionTarget.providerId
      )
      const llmProviderPresenter = this.getLlmProviderPresenter()
      if (signal) {
        await llmProviderPresenter.executeWithRateLimit(visionTarget.providerId, { signal })
      } else {
        await llmProviderPresenter.executeWithRateLimit(visionTarget.providerId)
      }
      throwIfAbortRequested(signal)
      const response = signal
        ? await llmProviderPresenter.generateCompletionStandalone(
            visionTarget.providerId,
            messages,
            visionTarget.modelId,
            modelConfig?.temperature ?? 0.2,
            modelConfig?.maxTokens ?? 1200,
            { signal }
          )
        : await llmProviderPresenter.generateCompletionStandalone(
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
      const sessionInfo = await this.runtimePort.resolveConversationSessionInfo(conversationId)
      return await resolveSessionVisionTarget({
        providerId: sessionInfo?.providerId,
        modelId: sessionInfo?.modelId,
        agentId: sessionInfo?.agentId,
        configPresenter: this.configPresenter,
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
      case 'edit': {
        const pathArg = args.path
        return typeof pathArg === 'string' ? [pathArg] : []
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

  private isSkillsEnabled(): boolean {
    return this.configPresenter.getSkillsEnabled()
  }

  private getSkillPresenter() {
    return this.runtimePort.getSkillPresenter()
  }

  private getYoBrowserToolHandler() {
    return this.runtimePort.getYoBrowserToolHandler()
  }

  private getFilePresenter() {
    return this.runtimePort.getFilePresenter()
  }

  private getLlmProviderPresenter() {
    return this.runtimePort.getLlmProviderPresenter()
  }

  private async isChatSettingsSkillActive(conversationId?: string): Promise<boolean> {
    if (!conversationId || !this.isSkillsEnabled()) {
      return false
    }
    const activeSkills = await this.getSkillPresenter().getActiveSkills(conversationId)
    return activeSkills.includes(CHAT_SETTINGS_SKILL_NAME)
  }

  private getSkillTools(): SkillTools {
    if (!this.skillTools) {
      this.skillTools = new SkillTools(this.getSkillPresenter())
    }
    return this.skillTools
  }

  private getChatSettingsHandler(): ChatSettingsToolHandler {
    if (!this.chatSettingsHandler) {
      this.chatSettingsHandler = new ChatSettingsToolHandler({
        configPresenter: this.configPresenter,
        skillPresenter: this.getSkillPresenter(),
        windowRuntime: {
          createSettingsWindow: () => this.runtimePort.createSettingsWindow(),
          sendToWindow: (windowId, channel, ...args) =>
            this.runtimePort.sendToWindow(windowId, channel, ...args),
          sendSettingsNavigation: (windowId, navigation) =>
            this.runtimePort.sendSettingsNavigation(windowId, navigation)
        }
      })
    }
    return this.chatSettingsHandler
  }

  private getSkillExecutionService(): SkillExecutionService {
    if (!this.skillExecutionService) {
      this.skillExecutionService = new SkillExecutionService(
        this.getSkillPresenter(),
        this.configPresenter,
        {
          resolveConversationWorkdir: (conversationId) =>
            this.getWorkdirForConversation(conversationId)
        }
      )
    }
    return this.skillExecutionService
  }

  private getSkillToolDefinitions(): MCPToolDefinition[] {
    const schemas = this.skillSchemas
    return [
      {
        type: 'function',
        function: {
          name: 'skill_list',
          description:
            'List all available skills and their activation status. Skills provide specialized expertise and behavioral guidance.',
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
        type: 'function',
        function: {
          name: 'skill_view',
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
        type: 'function',
        function: {
          name: 'skill_manage',
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
      type: 'function',
      function: {
        name: 'skill_run',
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
    return toolName === 'skill_list' || toolName === 'skill_view' || toolName === 'skill_manage'
  }

  private isSkillExecutionTool(toolName: string): boolean {
    return toolName === 'skill_run'
  }

  private async hasRunnableSkillScripts(
    conversationId: string,
    activeSkillNames?: string[]
  ): Promise<boolean> {
    try {
      const activeSkills =
        activeSkillNames ?? (await this.getSkillPresenter().getActiveSkills(conversationId))
      for (const skillName of activeSkills) {
        const scripts = await this.getSkillPresenter().listSkillScripts(skillName)
        if (scripts.some((script) => script.enabled)) {
          return true
        }
      }
    } catch (error) {
      logger.warn('[AgentToolManager] Failed to inspect runnable skill scripts', {
        conversationId,
        error
      })
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
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
    conversationId?: string
  } | null> {
    const writeTools = ['write', 'edit']
    const readTools = ['read', GLOB_TOOL_NAME, GREP_TOOL_NAME]
    const allowExternalFileAccess = options.allowExternalFileAccess === true

    if (this.isFileSystemTool(toolName)) {
      if (!this.fileSystemHandler) {
        throw new Error('FileSystem handler not initialized')
      }

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

      const workspaceRoot =
        dynamicWorkdir ?? this.agentWorkspacePath ?? this.getDefaultAgentWorkspacePath()
      const allowedDirectories = await this.buildAllowedDirectories(workspaceRoot, conversationId, {
        includeSkillRoots: toolName !== 'exec',
        includeRuntimeRoots: toolName !== 'exec',
        requiredPermission: this.getRequiredFilePermission(toolName)
      })
      const fileSystemHandler = new AgentFileSystemHandler(allowedDirectories, {
        conversationId,
        allowExternalAccess: allowExternalFileAccess
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

        const requestedCwd = typeof args.cwd === 'string' ? args.cwd.trim() : ''
        if (!allowExternalFileAccess && requestedCwd) {
          const defaultCwd = workspaceRoot
          const resolvedCwd = fileSystemHandler.resolvePath(requestedCwd, defaultCwd)
          if (!fileSystemHandler.isPathAllowedAbsolute(resolvedCwd)) {
            return {
              needsPermission: true,
              toolName,
              serverName: 'agent-filesystem',
              permissionType: 'all',
              description: `Working directory access requires approval for: ${resolvedCwd}`,
              paths: [resolvedCwd],
              conversationId
            }
          }
        }

        if (this.bashHandler.checkCommandPermission) {
          const result = await this.bashHandler.checkCommandPermission(command, conversationId)
          if (result.needsPermission) {
            return {
              needsPermission: true,
              toolName,
              serverName: 'agent-filesystem',
              permissionType: 'command',
              description: result.description || `Command "${command}" requires permission`,
              command,
              commandSignature: result.signature,
              commandInfo: result.commandInfo,
              conversationId
            }
          }
        }
        return null
      }

      // Handle process tool
      if (toolName === 'process') {
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
          conversationId
        }
      }
    }

    return null
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

    return Array.from(
      new Set(
        activeSkillNames
          .map((skillName) => skillName.trim())
          .filter((skillName) => skillName.length > 0)
      )
    )
  }

  private async callSkillTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    options?: AgentToolExecutionOptions
  ): Promise<AgentToolCallResult> {
    if (!this.isSkillsEnabled()) {
      return {
        content: JSON.stringify({
          success: false,
          error: 'Skills are disabled'
        })
      }
    }

    const skillTools = this.getSkillTools()
    const effectiveActiveSkills = this.normalizeActiveSkillOption(options?.activeSkillNames)

    if (toolName === 'skill_list') {
      const result = await skillTools.handleSkillList(conversationId, effectiveActiveSkills)
      return { content: JSON.stringify(result) }
    }

    if (toolName === 'skill_view') {
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
      const result = await skillTools.handleSkillView(
        conversationId,
        validationResult.data,
        effectiveActiveSkills
      )
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
      const content = JSON.stringify({
        ...result,
        isPinned: result.isPinned === true,
        activeForCurrentMessage:
          result.isPinned === true ||
          (!isLinkedFileView &&
            Boolean(normalizedViewedSkill) &&
            (activationApplied || activeSkillNamesForResult.includes(normalizedViewedSkill))),
        activatedForMessage: activationApplied,
        activationScope: activationApplied ? 'message' : 'none'
      })

      return {
        content,
        rawData: {
          content,
          toolResult: {
            activationApplied,
            activationSource,
            ...(activationApplied ? { activatedSkill: normalizedViewedSkill } : {})
          }
        }
      }
    }

    if (toolName === 'skill_manage') {
      const schema = this.skillSchemas.skill_manage
      const validationResult = schema.safeParse(args)
      if (!validationResult.success) {
        throw new Error(`Invalid arguments for skill_manage: ${validationResult.error.message}`)
      }
      const result = await skillTools.handleSkillManage(conversationId, validationResult.data)
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
      toolName: 'skill_manage',
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
    if (toolName !== 'skill_run') {
      throw new Error(`Unknown skill execution tool: ${toolName}`)
    }

    if (!conversationId) {
      throw new Error('skill_run requires a conversation ID')
    }

    const validationResult = this.skillSchemas.skill_run.safeParse(args)
    if (!validationResult.success) {
      throw new Error(`Invalid arguments for skill_run: ${validationResult.error.message}`)
    }

    const result = await this.getSkillExecutionService().execute(validationResult.data, {
      conversationId,
      activeSkillNames: options?.activeSkillNames
    })
    const content =
      typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)

    return {
      content,
      rawData: {
        content,
        rtkApplied: result.rtkApplied,
        rtkMode: result.rtkMode,
        rtkFallbackReason: result.rtkFallbackReason
      }
    }
  }

  private async callChatSettingsTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string
  ): Promise<AgentToolCallResult> {
    const handler = this.getChatSettingsHandler()
    if (toolName === CHAT_SETTINGS_TOOL_NAMES.toggle) {
      const result = await handler.toggle(args, conversationId)
      return { content: JSON.stringify(result) }
    }
    if (toolName === CHAT_SETTINGS_TOOL_NAMES.setLanguage) {
      const result = await handler.setLanguage(args, conversationId)
      return { content: JSON.stringify(result) }
    }
    if (toolName === CHAT_SETTINGS_TOOL_NAMES.setTheme) {
      const result = await handler.setTheme(args, conversationId)
      return { content: JSON.stringify(result) }
    }
    if (toolName === CHAT_SETTINGS_TOOL_NAMES.setFontSize) {
      const result = await handler.setFontSize(args, conversationId)
      return { content: JSON.stringify(result) }
    }
    if (toolName === CHAT_SETTINGS_TOOL_NAMES.open) {
      const shouldCheckPermission = await this.isChatSettingsSkillActive(conversationId)
      if (shouldCheckPermission && conversationId) {
        const approved = this.runtimePort.consumeSettingsApproval(conversationId, toolName)
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
      const result = await handler.open(args, conversationId)
      return { content: JSON.stringify(result) }
    }
    throw new Error(`Unknown DeepChat settings tool: ${toolName}`)
  }
}
