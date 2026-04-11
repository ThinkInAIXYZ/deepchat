import type { IConfigPresenter, MCPToolDefinition } from '@shared/presenter'
import type { AgentToolProgressUpdate } from '@shared/types/presenters/tool.presenter'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { app, nativeImage } from 'electron'
import logger from '@shared/logger'
import type { ChatMessage } from '@shared/types/core/chat-message'
import { buildBinaryReadGuidance, shouldRejectAgentBinaryRead } from '@/lib/binaryReadGuard'
import { AgentFileSystemHandler } from './agentFileSystemHandler'
import { AgentBashHandler } from './agentBashHandler'
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

// Consider moving to a shared handlers location in future refactoring
import {
  CommandPermissionRequiredError,
  CommandPermissionService
} from '../../permission/commandPermissionService'
import { FilePermissionRequiredError } from '../../permission/filePermissionService'

export interface AgentToolCallResult {
  content: string
  rawData?: {
    content?: string
    isError?: boolean
    toolResult?: unknown
    rtkApplied?: boolean
    rtkMode?: 'rewrite' | 'direct' | 'bypass'
    rtkFallbackReason?: string
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
    ls: z.object({
      path: z.string(),
      depth: z.number().int().min(0).max(3).default(1),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
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
    find: z.object({
      pattern: z.string().describe('Glob pattern (e.g., **/*.ts, src/**/*.js)'),
      path: z
        .string()
        .optional()
        .describe('Root directory for search (defaults to workspace root)'),
      exclude: z
        .array(z.string())
        .optional()
        .default([])
        .describe('Patterns to exclude (e.g., ["node_modules", ".git"])'),
      maxResults: z.number().default(1000).describe('Maximum number of results to return'),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
    }),
    grep: z.object({
      pattern: z
        .string()
        .max(1000)
        .describe(
          'Regular expression pattern (max 1000 characters, must be safe and not cause ReDoS)'
        ),
      path: z.string().optional().default('.'),
      filePattern: z.string().optional(),
      recursive: z.boolean().default(true),
      caseSensitive: z.boolean().default(false),
      contextLines: z.number().default(0),
      maxResults: z.number().default(100),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
    }),
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
    if (this.agentWorkspacePath) {
      this.fileSystemHandler = new AgentFileSystemHandler([this.agentWorkspacePath])
      this.bashHandler = new AgentBashHandler(
        [this.agentWorkspacePath],
        this.commandPermissionHandler,
        this.configPresenter
      )
    }
  }

  /**
   * Get all Agent tool definitions in MCP format
   */
  async getAllToolDefinitions(context: {
    chatMode: 'agent' | 'acp agent'
    supportsVision: boolean
    agentWorkspacePath: string | null
    conversationId?: string
  }): Promise<MCPToolDefinition[]> {
    const defs: MCPToolDefinition[] = []
    const isAgentMode = context.chatMode === 'agent'
    const effectiveWorkspacePath = isAgentMode
      ? context.agentWorkspacePath?.trim() || this.getDefaultAgentWorkspacePath()
      : null

    // Update filesystem handler if workspace path changed
    if (effectiveWorkspacePath !== this.agentWorkspacePath) {
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

    // 1. FileSystem tools (agent mode only)
    if (isAgentMode && this.fileSystemHandler) {
      const fsDefs = this.getFileSystemToolDefinitions()
      defs.push(...fsDefs)
    }

    // 2. Built-in question tool (all modes)
    defs.push(...this.getQuestionToolDefinitions())

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

      if (context.conversationId && (await this.hasRunnableSkillScripts(context.conversationId))) {
        defs.push(this.getSkillRunToolDefinition())
      }
    }

    // 4. DeepChat settings tools (agent mode only, skill gated)
    if (isAgentMode && this.isSkillsEnabled() && context.conversationId) {
      try {
        const activeSkills = await this.getSkillPresenter().getActiveSkills(context.conversationId)
        if (activeSkills.includes(CHAT_SETTINGS_SKILL_NAME)) {
          const allowedTools = await this.getSkillPresenter().getActiveSkillsAllowedTools(
            context.conversationId
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
    options?: {
      toolCallId?: string
      onProgress?: (update: AgentToolProgressUpdate) => void
      signal?: AbortSignal
    }
  ): Promise<AgentToolCallResult | string> {
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
      return await this.callSkillTool(toolName, args, conversationId)
    }

    if (this.isSkillExecutionTool(toolName)) {
      return await this.callSkillExecutionTool(toolName, args, conversationId)
    }

    // Route to DeepChat settings tools
    if (this.isChatSettingsTool(toolName)) {
      return await this.callChatSettingsTool(toolName, args, conversationId)
    }

    // Route to YoBrowser CDP tools
    if (AgentToolManager.YO_BROWSER_TOOL_NAME_SET.has(toolName)) {
      const response = await this.getYoBrowserToolHandler().callTool(toolName, args, conversationId)
      return {
        content: response
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
          parameters: zodToJsonSchema(schemas.read) as {
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
          parameters: zodToJsonSchema(schemas.write) as {
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
          parameters: zodToJsonSchema(schemas.edit) as {
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
          name: 'exec',
          description:
            'Execute a shell command in the workspace directory. Use background: true when you know the command should detach immediately. Otherwise foreground exec waits briefly, and long-running commands may auto-background and return a session ID for use with the process tool.',
          parameters: zodToJsonSchema(schemas.exec) as {
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
          parameters: zodToJsonSchema(schemas.process) as {
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
          parameters: zodToJsonSchema(questionToolSchema) as {
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
    const filesystemTools = ['read', 'write', 'ls', 'edit', 'find', 'grep', 'exec', 'process']
    return filesystemTools.includes(toolName)
  }

  private isProcessTool(toolName: string): boolean {
    return toolName === 'process'
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
        const sessions = backgroundExecSessionManager.list(conversationId)
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
        backgroundExecSessionManager.write(conversationId, sessionId, data ?? '', eof)
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
        backgroundExecSessionManager.clear(conversationId, sessionId)
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

  private async callFileSystemTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    options?: {
      signal?: AbortSignal
    }
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

    if (toolName === 'exec') {
      if (!this.bashHandler) {
        throw new Error('Bash handler not initialized for exec tool')
      }
      const execArgs = parsedArgs as {
        command: string
        timeoutMs?: number
        description?: string
        cwd?: string
        background?: boolean
        yieldMs?: number
      }
      const commandResult = await this.bashHandler.executeCommand(
        {
          command: execArgs.command,
          timeout: execArgs.timeoutMs,
          description: execArgs.description ?? 'Execute command',
          cwd: execArgs.cwd,
          background: execArgs.background,
          yieldMs: execArgs.yieldMs
        },
        {
          conversationId
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

    // Priority: explicit base_directory → conversation workdir → default
    const explicitBaseDirectory = (parsedArgs as any).base_directory
    const baseDirectory = explicitBaseDirectory ?? dynamicWorkdir ?? undefined
    const workspaceRoot =
      dynamicWorkdir ?? this.agentWorkspacePath ?? this.getDefaultAgentWorkspacePath()
    const allowedDirectories = await this.buildAllowedDirectories(workspaceRoot, conversationId)
    const fileSystemHandler = new AgentFileSystemHandler(allowedDirectories, { conversationId })

    try {
      switch (toolName) {
        case 'read': {
          const readArgs = parsedArgs as {
            path: string
            offset?: number
            limit?: number
          }
          const validPath = await this.resolveValidatedReadPath(
            fileSystemHandler,
            readArgs.path,
            baseDirectory
          )
          const mimeType = await this.getFilePresenter().getMimeType(validPath)

          if (await shouldRejectAgentBinaryRead(validPath, mimeType)) {
            return {
              content: buildBinaryReadGuidance(validPath, mimeType, 'agent')
            }
          }

          if (this.isImageMimeType(mimeType)) {
            return {
              content: await this.readImageWithVisionFallback(
                validPath,
                mimeType,
                conversationId,
                options?.signal
              )
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
          this.assertWritePermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId
          )
          return { content: await fileSystemHandler.writeFile(parsedArgs, baseDirectory) }
        case 'ls': {
          const lsArgs = parsedArgs as {
            path: string
            depth?: number
          }
          if ((lsArgs.depth ?? 1) > 1) {
            return {
              content: await fileSystemHandler.directoryTree(
                { path: lsArgs.path, depth: lsArgs.depth },
                baseDirectory
              )
            }
          }
          return {
            content: await fileSystemHandler.listDirectory(
              { path: lsArgs.path, showDetails: false, sortBy: 'name' },
              baseDirectory
            )
          }
        }
        case 'edit': {
          this.assertWritePermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId
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
        case 'find': {
          const findArgs = parsedArgs as {
            pattern: string
            path?: string
            exclude?: string[]
            maxResults?: number
          }
          return {
            content: await fileSystemHandler.globSearch(
              {
                pattern: findArgs.pattern,
                root: findArgs.path,
                excludePatterns: findArgs.exclude,
                maxResults: findArgs.maxResults,
                sortBy: 'name'
              },
              baseDirectory
            )
          }
        }
        case 'grep': {
          const grepArgs = parsedArgs as {
            pattern: string
            path?: string
            filePattern?: string
            recursive?: boolean
            caseSensitive?: boolean
            contextLines?: number
            maxResults?: number
          }
          return {
            content: await fileSystemHandler.grepSearch(
              {
                path: grepArgs.path ?? '.',
                pattern: grepArgs.pattern,
                filePattern: grepArgs.filePattern,
                recursive: grepArgs.recursive ?? true,
                caseSensitive: grepArgs.caseSensitive ?? false,
                includeLineNumbers: true,
                contextLines: grepArgs.contextLines ?? 0,
                maxResults: grepArgs.maxResults ?? 100
              },
              baseDirectory
            )
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
    conversationId?: string
  ): Promise<string[]> {
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

    if (conversationId) {
      const activeSkillRoots = await this.resolveActiveSkillRoots(conversationId)
      for (const skillRoot of activeSkillRoots) {
        addPath(skillRoot)
      }
    }

    addPath(path.join(app.getPath('home'), '.deepchat'))
    addPath(app.getPath('temp'))

    if (conversationId) {
      const approved = this.runtimePort.getApprovedFilePaths(conversationId)
      for (const approvedPath of approved) {
        addPath(approvedPath)
      }
    }

    return ordered
  }

  private async resolveActiveSkillRoots(conversationId: string): Promise<string[]> {
    const skillPresenter = this.getSkillPresenter()
    if (!skillPresenter?.getActiveSkills || !skillPresenter?.getMetadataList) {
      return []
    }

    let activeSkillNames: string[]
    let metadataList: Awaited<ReturnType<typeof skillPresenter.getMetadataList>>

    try {
      ;[activeSkillNames, metadataList] = await Promise.all([
        skillPresenter.getActiveSkills(conversationId),
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
    baseDirectory?: string
  ): Promise<string> {
    const resolvedPath = fileSystemHandler.resolvePath(requestedPath, baseDirectory)
    if (!fileSystemHandler.isPathAllowedAbsolute(resolvedPath)) {
      throw new Error(`Access denied - path outside allowed directories: ${requestedPath}`)
    }

    const stats = await fs.promises.stat(resolvedPath)
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${requestedPath}`)
    }

    return resolvedPath
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
  ): Promise<string> {
    throwIfAbortRequested(signal)
    const fileBuffer = await fs.promises.readFile(filePath)
    throwIfAbortRequested(signal)
    const metadata = this.buildImageMetadataBlock(filePath, mimeType, fileBuffer.length)
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
      return `${metadata}\n\nImage analysis unavailable because neither the current session model nor the agent vision model can analyze images.`
    }

    try {
      throwIfAbortRequested(signal)
      const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`
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
        return `${metadata}\n\nImage analysis returned no usable description.`
      }
      return normalized
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      return `${metadata}\n\nVision analysis failed, downgraded to metadata.\nerror: ${message}`
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

  private assertWritePermission(
    toolName: string,
    args: Record<string, unknown>,
    baseDirectory: string | undefined,
    fileSystemHandler: AgentFileSystemHandler,
    conversationId?: string
  ): void {
    if (!conversationId) return
    const targets = this.collectWriteTargets(toolName, args)
    if (targets.length === 0) return

    const denied = targets.filter((target) => {
      const resolved = fileSystemHandler.resolvePath(target, baseDirectory)
      return !fileSystemHandler.isPathAllowedAbsolute(resolved)
    })

    if (denied.length === 0) return

    throw new FilePermissionRequiredError(
      'components.messageBlockPermissionRequest.description.write',
      {
        toolName,
        serverName: 'agent-filesystem',
        permissionType: 'write',
        description: 'Write access requires approval.',
        paths: denied,
        conversationId
      }
    )
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
            this.runtimePort.sendToWindow(windowId, channel, ...args)
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
          parameters: zodToJsonSchema(schemas.skill_list) as {
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
          parameters: zodToJsonSchema(schemas.skill_view) as {
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
          parameters: zodToJsonSchema(schemas.skill_manage) as {
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
          'Run a bundled script from a pinned skill. This is the preferred way to execute skill-local Python, Node, or shell helpers without guessing paths.',
        parameters: zodToJsonSchema(this.skillSchemas.skill_run) as {
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

  private async hasRunnableSkillScripts(conversationId: string): Promise<boolean> {
    try {
      const activeSkills = await this.getSkillPresenter().getActiveSkills(conversationId)
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
    conversationId?: string
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
    // Only file system write operations and command execution need pre-check
    const writeTools = ['write', 'edit']
    const readTools = ['read', 'ls', 'find', 'grep']

    // Check for file system write operations
    if (this.isFileSystemTool(toolName)) {
      if (!this.fileSystemHandler) {
        throw new Error('FileSystem handler not initialized')
      }

      // Handle command tools separately (they use command permission service)
      if (toolName === 'exec') {
        if (!this.bashHandler) {
          return null
        }

        const command = (args.command as string) || ''
        if (!command) {
          return null
        }

        // Use bash handler's checkCommandPermission if available
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

      // For file system operations, check if write permission is needed
      const isWriteOperation = writeTools.includes(toolName)
      const isReadOperation = readTools.includes(toolName)

      if (!isWriteOperation && !isReadOperation) {
        return null
      }

      // Get workdir and allowed directories
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
      const allowedDirectories = await this.buildAllowedDirectories(workspaceRoot, conversationId)
      const fileSystemHandler = new AgentFileSystemHandler(allowedDirectories, { conversationId })
      const explicitBaseDirectory =
        typeof args.base_directory === 'string' && args.base_directory.trim().length > 0
          ? args.base_directory
          : undefined
      const baseDirectory = explicitBaseDirectory ?? dynamicWorkdir ?? undefined

      // Collect target paths
      const targets = this.collectWriteTargets(toolName, args)
      if (targets.length === 0 && isWriteOperation) {
        const pathArg = args.path as string | undefined
        if (pathArg) {
          targets.push(pathArg)
        }
      }

      // Check each path
      const denied: string[] = []
      for (const target of targets) {
        const resolved = fileSystemHandler.resolvePath(target, baseDirectory)
        if (!fileSystemHandler.isPathAllowedAbsolute(resolved)) {
          denied.push(target)
        }
      }

      if (denied.length > 0) {
        return {
          needsPermission: true,
          toolName,
          serverName: 'agent-filesystem',
          permissionType: isWriteOperation ? 'write' : 'read',
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

  private async callSkillTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string
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

    if (toolName === 'skill_list') {
      const result = await skillTools.handleSkillList(conversationId)
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
      const previousActiveSkills =
        conversationId && !isLinkedFileView
          ? await this.getSkillPresenter().getActiveSkills(conversationId)
          : []
      const result = await skillTools.handleSkillView(conversationId, validationResult.data)
      const nextActiveSkills =
        conversationId && !isLinkedFileView
          ? await this.getSkillPresenter().getActiveSkills(conversationId)
          : previousActiveSkills
      const activationApplied =
        Boolean(conversationId) &&
        !isLinkedFileView &&
        !previousActiveSkills.includes(validationResult.data.name) &&
        nextActiveSkills.includes(validationResult.data.name)
      const activationSource =
        !conversationId || result.success !== true
          ? 'none'
          : activationApplied
            ? 'skill_md'
            : isLinkedFileView
              ? 'file'
              : 'none'
      const content = JSON.stringify(result)

      return {
        content,
        rawData: {
          content,
          toolResult: {
            activationApplied,
            activationSource,
            ...(activationApplied ? { activatedSkill: validationResult.data.name } : {})
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
      return { content: JSON.stringify(result) }
    }

    throw new Error(`Unknown skill tool: ${toolName}`)
  }

  private async callSkillExecutionTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string
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
      conversationId
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
