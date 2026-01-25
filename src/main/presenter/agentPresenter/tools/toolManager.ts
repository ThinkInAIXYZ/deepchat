import type { IConfigPresenter, MCPToolDefinition } from '@shared/presenter'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import logger from '@shared/logger'
import { presenter } from '@/presenter'
import { AgentFileSystemHandler } from './fileSystemHandler'
import { AgentBashHandler } from './bashHandler'
import { SkillTools } from '../../skillPresenter/skillTools'
import {
  ChatSettingsToolHandler,
  buildChatSettingsToolDefinitions,
  CHAT_SETTINGS_SKILL_NAME,
  CHAT_SETTINGS_TOOL_NAMES
} from './settingsTools'

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
}

export class AgentToolManager {
  private agentWorkspacePath: string | null
  private fileSystemHandler: AgentFileSystemHandler | null = null
  private bashHandler: AgentBashHandler | null = null
  private readonly commandPermissionHandler?: CommandPermissionService
  private readonly configPresenter: IConfigPresenter
  private skillTools: SkillTools | null = null
  private chatSettingsHandler: ChatSettingsToolHandler | null = null
  private readonly fileSystemSchemas = {
    read_file: z.object({
      paths: z.array(z.string()).min(1),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Starting character offset (0-based), applied to each file independently'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Maximum characters to read per file. Large files are auto-truncated if not specified'
        ),
      base_directory: z
        .string()
        .optional()
        .describe(
          "Base directory for resolving relative paths. Required when using skills with relative paths. For skill-based operations, provide the skill's root directory path."
        )
    }),
    write_file: z.object({
      path: z.string(),
      content: z.string(),
      base_directory: z
        .string()
        .optional()
        .describe(
          'Base directory for resolving relative paths. Required when using skills with relative paths.'
        )
    }),
    list_directory: z.object({
      path: z.string(),
      showDetails: z.boolean().default(false),
      sortBy: z.enum(['name', 'size', 'modified']).default('name'),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
    }),
    create_directory: z.object({
      path: z.string(),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
    }),
    move_files: z.object({
      sources: z.array(z.string()).min(1),
      destination: z.string(),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
    }),
    edit_text: z.object({
      path: z.string(),
      operation: z.enum(['replace_pattern', 'edit_lines']),
      pattern: z
        .string()
        .max(1000)
        .describe(
          'Regular expression pattern (max 1000 characters, must be safe and not cause ReDoS). Required when operation is "replace_pattern"'
        )
        .optional(),
      replacement: z.string().optional(),
      global: z.boolean().default(true),
      caseSensitive: z.boolean().default(false),
      edits: z
        .array(
          z.object({
            oldText: z.string(),
            newText: z.string()
          })
        )
        .optional(),
      dryRun: z.boolean().default(false),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
    }),
    glob_search: z.object({
      pattern: z.string().describe('Glob pattern (e.g., **/*.ts, src/**/*.js)'),
      root: z
        .string()
        .optional()
        .describe('Root directory for search (defaults to workspace root)'),
      excludePatterns: z
        .array(z.string())
        .optional()
        .default([])
        .describe('Patterns to exclude (e.g., ["node_modules", ".git"])'),
      maxResults: z.number().default(1000).describe('Maximum number of results to return'),
      sortBy: z
        .enum(['name', 'modified'])
        .default('name')
        .describe('Sort results by name or modification time')
    }),
    grep_search: z.object({
      path: z.string(),
      pattern: z
        .string()
        .max(1000)
        .describe(
          'Regular expression pattern (max 1000 characters, must be safe and not cause ReDoS)'
        ),
      filePattern: z.string().optional(),
      recursive: z.boolean().default(true),
      caseSensitive: z.boolean().default(false),
      includeLineNumbers: z.boolean().default(true),
      contextLines: z.number().default(0),
      maxResults: z.number().default(100),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
    }),
    text_replace: z.object({
      path: z.string(),
      pattern: z
        .string()
        .max(1000)
        .describe(
          'Regular expression pattern (max 1000 characters, must be safe and not cause ReDoS)'
        ),
      replacement: z.string(),
      global: z.boolean().default(true),
      caseSensitive: z.boolean().default(false),
      dryRun: z.boolean().default(false),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
    }),
    directory_tree: z.object({
      path: z.string(),
      depth: z
        .number()
        .int()
        .min(0)
        .max(3)
        .default(1)
        .describe('Directory depth (root=0). Maximum is 3.'),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
    }),
    get_file_info: z.object({
      path: z.string(),
      base_directory: z.string().optional().describe('Base directory for resolving relative paths.')
    }),
    execute_command: z.object({
      command: z.string().min(1).describe('The shell command to execute'),
      timeout: z
        .number()
        .min(100)
        .max(600000)
        .optional()
        .describe('Optional timeout in milliseconds'),
      description: z.string().min(5).max(100).describe('Brief description of what the command does')
    })
  }

  private readonly skillSchemas = {
    skill_list: z.object({}),
    skill_control: z
      .object({
        action: z.enum(['activate', 'deactivate']).describe('The action to perform'),
        skill_name: z.string().min(1).optional().describe('Skill name to activate or deactivate'),
        skills: z
          .array(z.string())
          .min(1)
          .optional()
          .describe('List of skill names to activate or deactivate')
      })
      .refine((data) => Boolean(data.skill_name || (data.skills && data.skills.length > 0)), {
        message: 'Either skill_name or skills must be provided'
      })
  }

  constructor(options: AgentToolManagerOptions) {
    this.agentWorkspacePath = options.agentWorkspacePath
    this.configPresenter = options.configPresenter
    this.commandPermissionHandler = options.commandPermissionHandler
    if (this.agentWorkspacePath) {
      this.fileSystemHandler = new AgentFileSystemHandler([this.agentWorkspacePath])
      this.bashHandler = new AgentBashHandler(
        [this.agentWorkspacePath],
        this.commandPermissionHandler
      )
    }
  }

  /**
   * Get all Agent tool definitions in MCP format
   */
  async getAllToolDefinitions(context: {
    supportsVision: boolean
    agentWorkspacePath: string | null
    conversationId?: string
  }): Promise<MCPToolDefinition[]> {
    const defs: MCPToolDefinition[] = []
    const effectiveWorkspacePath =
      context.agentWorkspacePath?.trim() || this.getDefaultAgentWorkspacePath()

    // Update filesystem handler if workspace path changed
    if (effectiveWorkspacePath !== this.agentWorkspacePath) {
      if (effectiveWorkspacePath) {
        this.fileSystemHandler = new AgentFileSystemHandler([effectiveWorkspacePath])
        this.bashHandler = new AgentBashHandler(
          [effectiveWorkspacePath],
          this.commandPermissionHandler
        )
      } else {
        this.fileSystemHandler = null
        this.bashHandler = null
      }
      this.agentWorkspacePath = effectiveWorkspacePath
    }

    // 1. FileSystem tools
    if (this.fileSystemHandler) {
      const fsDefs = this.getFileSystemToolDefinitions()
      defs.push(...fsDefs)
    }

    // 3. Skill tools
    if (this.isSkillsEnabled()) {
      const skillDefs = this.getSkillToolDefinitions()
      defs.push(...skillDefs)
    }

    // 4. DeepChat settings tools (skill gated)
    if (this.isSkillsEnabled() && context.conversationId) {
      try {
        const activeSkills = await presenter.skillPresenter.getActiveSkills(context.conversationId)
        if (activeSkills.includes(CHAT_SETTINGS_SKILL_NAME)) {
          const allowedTools = await presenter.skillPresenter.getActiveSkillsAllowedTools(
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

    // 5. YoBrowser CDP tools (always included)
    try {
      defs.push(...presenter.yoBrowserPresenter.toolHandler.getToolDefinitions())
    } catch (error) {
      logger.warn('[AgentToolManager] Failed to load YoBrowser tools', { error })
    }

    return defs
  }

  /**
   * Call an Agent tool
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string
  ): Promise<AgentToolCallResult | string> {
    // Route to FileSystem tools
    if (this.isFileSystemTool(toolName)) {
      if (!this.fileSystemHandler) {
        throw new Error(`FileSystem handler not initialized for tool: ${toolName}`)
      }
      return await this.callFileSystemTool(toolName, args, conversationId)
    }

    // Route to Skill tools
    if (this.isSkillTool(toolName)) {
      return await this.callSkillTool(toolName, args, conversationId)
    }

    // Route to DeepChat settings tools
    if (this.isChatSettingsTool(toolName)) {
      return await this.callChatSettingsTool(toolName, args, conversationId)
    }

    // Route to YoBrowser CDP tools
    if (toolName.startsWith('yo_browser_')) {
      const response = await presenter.yoBrowserPresenter.toolHandler.callTool(toolName, args)
      return {
        content: response
      }
    }

    throw new Error(`Unknown Agent tool: ${toolName}`)
  }

  private async getWorkdirForConversation(conversationId: string): Promise<string | null> {
    try {
      const session = await presenter?.sessionManager?.getSession(conversationId)
      if (!session?.resolved) {
        return null
      }

      const resolved = session.resolved

      return resolved.agentWorkspacePath ?? null
    } catch (error) {
      logger.warn('[AgentToolManager] Failed to get workdir for conversation:', {
        conversationId,
        error
      })
      return null
    }
  }

  private getFileSystemToolDefinitions(): MCPToolDefinition[] {
    const schemas = this.fileSystemSchemas
    return [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description:
            "Read the contents of one or more files. Supports pagination via offset/limit for large files (auto-truncated at 4500 chars if not specified). When invoked from a skill context with relative paths, provide base_directory as the skill's root directory.",
          parameters: zodToJsonSchema(schemas.read_file) as {
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
          name: 'write_file',
          description:
            "Write content to a file. For skill files, provide base_directory as the skill's root directory.",
          parameters: zodToJsonSchema(schemas.write_file) as {
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
          name: 'list_directory',
          description:
            'List files and directories in a path. Provide base_directory for skill-relative paths.',
          parameters: zodToJsonSchema(schemas.list_directory) as {
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
          name: 'create_directory',
          description: 'Create a directory. Provide base_directory for skill-relative paths.',
          parameters: zodToJsonSchema(schemas.create_directory) as {
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
          name: 'move_files',
          description:
            'Move or rename files and directories. Provide base_directory for skill-relative paths.',
          parameters: zodToJsonSchema(schemas.move_files) as {
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
          name: 'edit_text',
          description:
            'Edit text files using pattern replacement or line-based editing. When using "replace_pattern" operation, the pattern must be safe and not exceed 1000 characters to prevent ReDoS (Regular Expression Denial of Service) attacks. Provide base_directory for skill-relative paths.',
          parameters: zodToJsonSchema(schemas.edit_text) as {
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
          name: 'glob_search',
          description:
            'Search for files using glob patterns (e.g., **/*.ts, src/**/*.js). Automatically excludes common directories like node_modules and .git.',
          parameters: zodToJsonSchema(schemas.glob_search) as {
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
          name: 'directory_tree',
          description:
            'Get a directory tree as JSON with optional depth (root=0, max=3). Provide base_directory for skill-relative paths.',
          parameters: zodToJsonSchema(schemas.directory_tree) as {
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
          name: 'get_file_info',
          description:
            'Get detailed metadata about a file or directory. Provide base_directory for skill-relative paths.',
          parameters: zodToJsonSchema(schemas.get_file_info) as {
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
          name: 'grep_search',
          description:
            'Search file contents using a regular expression. The pattern must be safe and not exceed 1000 characters to prevent ReDoS (Regular Expression Denial of Service) attacks. Provide base_directory for skill-relative paths.',
          parameters: zodToJsonSchema(schemas.grep_search) as {
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
          name: 'text_replace',
          description:
            'Replace text in a file using a regular expression. The pattern must be safe and not exceed 1000 characters to prevent ReDoS (Regular Expression Denial of Service) attacks. Provide base_directory for skill-relative paths.',
          parameters: zodToJsonSchema(schemas.text_replace) as {
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
          name: 'execute_command',
          description:
            'Execute a shell command in the workspace directory. Prefer file system tools for read/write/search operations.',
          parameters: zodToJsonSchema(schemas.execute_command) as {
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
      }
    ]
  }

  private isFileSystemTool(toolName: string): boolean {
    const filesystemTools = [
      'read_file',
      'write_file',
      'list_directory',
      'create_directory',
      'move_files',
      'edit_text',
      'glob_search',
      'directory_tree',
      'get_file_info',
      'grep_search',
      'text_replace',
      'execute_command'
    ]
    return filesystemTools.includes(toolName)
  }

  private async callFileSystemTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string
  ): Promise<AgentToolCallResult> {
    if (!this.fileSystemHandler) {
      throw new Error('FileSystem handler not initialized')
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
    const allowedDirectories = this.buildAllowedDirectories(workspaceRoot, conversationId)
    const fileSystemHandler = new AgentFileSystemHandler(allowedDirectories, { conversationId })

    try {
      switch (toolName) {
        case 'read_file':
          return { content: await fileSystemHandler.readFile(parsedArgs, baseDirectory) }
        case 'write_file':
          this.assertWritePermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId
          )
          return { content: await fileSystemHandler.writeFile(parsedArgs, baseDirectory) }
        case 'list_directory':
          return { content: await fileSystemHandler.listDirectory(parsedArgs, baseDirectory) }
        case 'create_directory':
          this.assertWritePermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId
          )
          return {
            content: await fileSystemHandler.createDirectory(parsedArgs, baseDirectory)
          }
        case 'move_files':
          this.assertWritePermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId
          )
          return { content: await fileSystemHandler.moveFiles(parsedArgs, baseDirectory) }
        case 'edit_text':
          this.assertWritePermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId
          )
          return { content: await fileSystemHandler.editText(parsedArgs, baseDirectory) }
        case 'glob_search':
          return { content: await fileSystemHandler.globSearch(parsedArgs, baseDirectory) }
        case 'directory_tree':
          return { content: await fileSystemHandler.directoryTree(parsedArgs, baseDirectory) }
        case 'get_file_info':
          return { content: await fileSystemHandler.getFileInfo(parsedArgs, baseDirectory) }
        case 'grep_search':
          return { content: await fileSystemHandler.grepSearch(parsedArgs, baseDirectory) }
        case 'text_replace':
          this.assertWritePermission(
            toolName,
            parsedArgs,
            baseDirectory,
            fileSystemHandler,
            conversationId
          )
          return { content: await fileSystemHandler.textReplace(parsedArgs, baseDirectory) }
        case 'execute_command':
          if (!this.bashHandler) {
            throw new Error('Bash handler not initialized for execute_command tool')
          }
          return {
            content: await this.bashHandler.executeCommand(parsedArgs, { conversationId })
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

  private buildAllowedDirectories(workspacePath: string, conversationId?: string): string[] {
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
    addPath(this.configPresenter.getSkillsPath())
    addPath(path.join(app.getPath('home'), '.deepchat'))
    addPath(app.getPath('temp'))

    if (conversationId) {
      const approved = presenter.filePermissionService?.getApprovedPaths(conversationId) ?? []
      for (const approvedPath of approved) {
        addPath(approvedPath)
      }
    }

    return ordered
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
      case 'write_file': {
        const pathArg = args.path
        return typeof pathArg === 'string' ? [pathArg] : []
      }
      case 'create_directory': {
        const pathArg = args.path
        return typeof pathArg === 'string' ? [pathArg] : []
      }
      case 'edit_text': {
        const pathArg = args.path
        return typeof pathArg === 'string' ? [pathArg] : []
      }
      case 'text_replace': {
        const pathArg = args.path
        return typeof pathArg === 'string' ? [pathArg] : []
      }
      case 'move_files': {
        const sources = Array.isArray(args.sources)
          ? args.sources.filter((source): source is string => typeof source === 'string')
          : []
        const destination = typeof args.destination === 'string' ? args.destination : undefined
        if (!destination) return sources
        const destinations = sources.map((source) => path.join(destination, path.basename(source)))
        return [...sources, ...destinations]
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

  private async isChatSettingsSkillActive(conversationId?: string): Promise<boolean> {
    if (!conversationId || !this.isSkillsEnabled()) {
      return false
    }
    const activeSkills = await presenter.skillPresenter.getActiveSkills(conversationId)
    return activeSkills.includes(CHAT_SETTINGS_SKILL_NAME)
  }

  private getSkillTools(): SkillTools {
    if (!this.skillTools) {
      this.skillTools = new SkillTools(presenter.skillPresenter)
    }
    return this.skillTools
  }

  private getChatSettingsHandler(): ChatSettingsToolHandler {
    if (!this.chatSettingsHandler) {
      this.chatSettingsHandler = new ChatSettingsToolHandler({
        configPresenter: this.configPresenter,
        skillPresenter: presenter.skillPresenter,
        sessionPresenter: presenter.sessionPresenter,
        windowPresenter: presenter.windowPresenter
      })
    }
    return this.chatSettingsHandler
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
          name: 'skill_control',
          description:
            'Activate or deactivate skills. Activated skills inject their expertise into the conversation context.',
          parameters: zodToJsonSchema(schemas.skill_control) as {
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

  private isSkillTool(toolName: string): boolean {
    return toolName === 'skill_list' || toolName === 'skill_control'
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

    if (toolName === 'skill_control') {
      const schema = this.skillSchemas.skill_control
      const validationResult = schema.safeParse(args)
      if (!validationResult.success) {
        throw new Error(`Invalid arguments for skill_control: ${validationResult.error.message}`)
      }

      const { action, skill_name: skillName, skills } = validationResult.data
      const skillNames = skillName ? [skillName] : (skills ?? [])
      const result = await skillTools.handleSkillControl(conversationId, action, skillNames)
      return { content: JSON.stringify(result) }
    }

    throw new Error(`Unknown skill tool: ${toolName}`)
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
        const approved =
          presenter.settingsPermissionService?.consumeApproval(conversationId, toolName) ?? false
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
