import type { MCPToolDefinition } from '@shared/presenter'
import type { IYoBrowserPresenter } from '@shared/presenter'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import logger from '@shared/logger'
import { presenter } from '@/presenter'
import { AgentFileSystemHandler } from './agentFileSystemHandler'
import { AgentBashHandler } from './agentBashHandler'
import type { IContextFilePresenter } from '@shared/types/presenters/contextFiles.presenter'

// Consider moving to a shared handlers location in future refactoring
import {
  CommandPermissionRequiredError,
  CommandPermissionService
} from '../../permission/commandPermissionService'

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
      commandInfo?: {
        command: string
        riskLevel: 'low' | 'medium' | 'high' | 'critical'
        suggestion: string
        signature?: string
        baseCommand?: string
      }
      conversationId?: string
    }
  }
}

interface AgentToolManagerOptions {
  yoBrowserPresenter: IYoBrowserPresenter
  contextFilePresenter: IContextFilePresenter
  agentWorkspacePath: string | null
  commandPermissionHandler?: CommandPermissionService
}

export class AgentToolManager {
  private readonly yoBrowserPresenter: IYoBrowserPresenter
  private readonly contextFilePresenter: IContextFilePresenter
  private agentWorkspacePath: string | null
  private fileSystemHandler: AgentFileSystemHandler | null = null
  private bashHandler: AgentBashHandler | null = null
  private readonly commandPermissionHandler?: CommandPermissionService
  private readonly fileSystemSchemas = {
    read_file: z.object({
      paths: z.array(z.string()).min(1)
    }),
    write_file: z.object({
      path: z.string(),
      content: z.string()
    }),
    list_directory: z.object({
      path: z.string(),
      showDetails: z.boolean().default(false),
      sortBy: z.enum(['name', 'size', 'modified']).default('name')
    }),
    create_directory: z.object({
      path: z.string()
    }),
    move_files: z.object({
      sources: z.array(z.string()).min(1),
      destination: z.string()
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
      dryRun: z.boolean().default(false)
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
      maxResults: z.number().default(100)
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
      dryRun: z.boolean().default(false)
    }),
    directory_tree: z.object({
      path: z.string()
    }),
    get_file_info: z.object({
      path: z.string()
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

  constructor(options: AgentToolManagerOptions) {
    this.yoBrowserPresenter = options.yoBrowserPresenter
    this.contextFilePresenter = options.contextFilePresenter
    this.agentWorkspacePath = options.agentWorkspacePath
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
    chatMode: 'chat' | 'agent' | 'acp agent'
    supportsVision: boolean
    agentWorkspacePath: string | null
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
          this.commandPermissionHandler
        )
      } else {
        this.fileSystemHandler = null
        this.bashHandler = null
      }
      this.agentWorkspacePath = effectiveWorkspacePath
    }

    // 1. Yo Browser tools (agent mode only)
    if (isAgentMode) {
      try {
        const yoDefs = await this.yoBrowserPresenter.getToolDefinitions(context.supportsVision)
        defs.push(...yoDefs)
      } catch (error) {
        logger.warn('[AgentToolManager] Failed to load Yo Browser tool definitions', { error })
      }
    }

    // 2. FileSystem tools (agent mode only)
    if (isAgentMode && this.fileSystemHandler) {
      const fsDefs = this.getFileSystemToolDefinitions()
      defs.push(...fsDefs)
    }

    // 3. Context File tools (所有模式可用)
    try {
      const contextDefs = await this.contextFilePresenter.getToolDefinitions()
      defs.push(...contextDefs)
    } catch (error) {
      logger.warn('[AgentToolManager] Failed to load Context File tool definitions', { error })
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
    // Route to Yo Browser tools
    if (toolName.startsWith('browser_')) {
      const response = await this.yoBrowserPresenter.callTool(
        toolName,
        args as Record<string, unknown>
      )
      return {
        content: typeof response === 'string' ? response : JSON.stringify(response)
      }
    }

    // Route to FileSystem tools
    if (this.isFileSystemTool(toolName)) {
      if (!this.fileSystemHandler) {
        throw new Error(`FileSystem handler not initialized for tool: ${toolName}`)
      }
      return await this.callFileSystemTool(toolName, args, conversationId)
    }

    // Route to Context File tools
    if (toolName.startsWith('context_')) {
      if (!conversationId) {
        throw new Error(`conversationId is required for context tools`)
      }
      const response = await this.contextFilePresenter.callTool(toolName, args, conversationId)
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

      if (resolved.chatMode === 'acp agent') {
        const modelId = resolved.modelId
        const map = resolved.acpWorkdirMap
        return modelId && map ? (map[modelId] ?? null) : null
      }

      if (resolved.chatMode === 'agent') {
        return resolved.agentWorkspacePath ?? null
      }

      return null
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
          description: 'Read the contents of one or more files',
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
          description: 'Write content to a file',
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
          description: 'List files and directories in a path',
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
          description: 'Create a directory',
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
          description: 'Move or rename files and directories',
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
            'Edit text files using pattern replacement or line-based editing. When using "replace_pattern" operation, the pattern must be safe and not exceed 1000 characters to prevent ReDoS (Regular Expression Denial of Service) attacks.',
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
          description: 'Get a recursive directory tree as JSON',
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
          description: 'Get detailed metadata about a file or directory',
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
            'Search file contents using a regular expression. The pattern must be safe and not exceed 1000 characters to prevent ReDoS (Regular Expression Denial of Service) attacks.',
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
            'Replace text in a file using a regular expression. The pattern must be safe and not exceed 1000 characters to prevent ReDoS (Regular Expression Denial of Service) attacks.',
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

    const baseDirectory = dynamicWorkdir ?? undefined

    try {
      switch (toolName) {
        case 'read_file':
          return { content: await this.fileSystemHandler.readFile(parsedArgs, baseDirectory) }
        case 'write_file':
          return { content: await this.fileSystemHandler.writeFile(parsedArgs, baseDirectory) }
        case 'list_directory':
          return { content: await this.fileSystemHandler.listDirectory(parsedArgs, baseDirectory) }
        case 'create_directory':
          return {
            content: await this.fileSystemHandler.createDirectory(parsedArgs, baseDirectory)
          }
        case 'move_files':
          return { content: await this.fileSystemHandler.moveFiles(parsedArgs, baseDirectory) }
        case 'edit_text':
          return { content: await this.fileSystemHandler.editText(parsedArgs, baseDirectory) }
        case 'glob_search':
          return { content: await this.fileSystemHandler.globSearch(parsedArgs, baseDirectory) }
        case 'directory_tree':
          return { content: await this.fileSystemHandler.directoryTree(parsedArgs, baseDirectory) }
        case 'get_file_info':
          return { content: await this.fileSystemHandler.getFileInfo(parsedArgs, baseDirectory) }
        case 'grep_search':
          return { content: await this.fileSystemHandler.grepSearch(parsedArgs, baseDirectory) }
        case 'text_replace':
          return { content: await this.fileSystemHandler.textReplace(parsedArgs, baseDirectory) }
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
      throw error
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
}
