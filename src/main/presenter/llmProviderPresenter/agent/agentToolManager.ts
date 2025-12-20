import type { MCPToolDefinition } from '@shared/presenter'
import type { IYoBrowserPresenter } from '@shared/presenter'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import { AgentFileSystemHandler } from './agentFileSystemHandler'

interface AgentToolManagerOptions {
  yoBrowserPresenter: IYoBrowserPresenter
  agentWorkspacePath: string | null
}

export class AgentToolManager {
  private readonly yoBrowserPresenter: IYoBrowserPresenter
  private agentWorkspacePath: string | null
  private fileSystemHandler: AgentFileSystemHandler | null = null

  constructor(options: AgentToolManagerOptions) {
    this.yoBrowserPresenter = options.yoBrowserPresenter
    this.agentWorkspacePath = options.agentWorkspacePath
    if (this.agentWorkspacePath) {
      this.fileSystemHandler = new AgentFileSystemHandler([this.agentWorkspacePath])
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

    // Update filesystem handler if workspace path changed
    if (context.agentWorkspacePath !== this.agentWorkspacePath) {
      if (context.agentWorkspacePath) {
        this.fileSystemHandler = new AgentFileSystemHandler([context.agentWorkspacePath])
      } else {
        this.fileSystemHandler = null
      }
      this.agentWorkspacePath = context.agentWorkspacePath
    }

    // 1. Yo Browser tools (only when browser window is open)
    if (context.chatMode !== 'chat') {
      const hasBrowserWindow = await this.yoBrowserPresenter.hasWindow()
      if (hasBrowserWindow) {
        try {
          const yoDefs = await this.yoBrowserPresenter.getToolDefinitions(context.supportsVision)
          defs.push(...yoDefs)
        } catch (error) {
          console.warn('[AgentToolManager] Failed to load Yo Browser tool definitions', error)
        }
      }
    }

    // 2. FileSystem tools (only when workspace path is set)
    if (context.chatMode !== 'chat' && this.fileSystemHandler) {
      const fsDefs = this.getFileSystemToolDefinitions()
      defs.push(...fsDefs)
    }

    return defs
  }

  /**
   * Call an Agent tool
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    // Route to Yo Browser tools
    if (toolName.startsWith('browser_')) {
      const response = await this.yoBrowserPresenter.callTool(
        toolName,
        args as Record<string, unknown>
      )
      return typeof response === 'string' ? response : JSON.stringify(response)
    }

    // Route to FileSystem tools
    if (this.fileSystemHandler) {
      return await this.callFileSystemTool(toolName, args)
    }

    throw new Error(`Unknown Agent tool: ${toolName}`)
  }

  private getFileSystemToolDefinitions(): MCPToolDefinition[] {
    const ReadFileSchema = z.object({
      paths: z.array(z.string()).min(1)
    })

    const WriteFileSchema = z.object({
      path: z.string(),
      content: z.string()
    })

    const ListDirectorySchema = z.object({
      path: z.string(),
      showDetails: z.boolean().default(false),
      sortBy: z.enum(['name', 'size', 'modified']).default('name')
    })

    const CreateDirectorySchema = z.object({
      path: z.string()
    })

    const MoveFilesSchema = z.object({
      sources: z.array(z.string()).min(1),
      destination: z.string()
    })

    const EditTextSchema = z.object({
      path: z.string(),
      operation: z.enum(['replace_pattern', 'edit_lines']),
      pattern: z.string().optional(),
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
    })

    const FileSearchSchema = z.object({
      path: z.string().optional(),
      pattern: z.string(),
      searchType: z.enum(['glob', 'name']).default('glob'),
      excludePatterns: z.array(z.string()).optional().default([]),
      caseSensitive: z.boolean().default(false),
      maxResults: z.number().default(1000)
    })

    return [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read the contents of one or more files',
          parameters: zodToJsonSchema(ReadFileSchema) as {
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
          parameters: zodToJsonSchema(WriteFileSchema) as {
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
          parameters: zodToJsonSchema(ListDirectorySchema) as {
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
          parameters: zodToJsonSchema(CreateDirectorySchema) as {
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
          parameters: zodToJsonSchema(MoveFilesSchema) as {
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
          description: 'Edit text files using pattern replacement or line-based editing',
          parameters: zodToJsonSchema(EditTextSchema) as {
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
          name: 'search_files',
          description: 'Search for files matching a pattern',
          parameters: zodToJsonSchema(FileSearchSchema) as {
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

  private async callFileSystemTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    if (!this.fileSystemHandler) {
      throw new Error('FileSystem handler not initialized')
    }

    switch (toolName) {
      case 'read_file':
        return await this.fileSystemHandler.readFile(args)
      case 'write_file':
        return await this.fileSystemHandler.writeFile(args)
      case 'list_directory':
        return await this.fileSystemHandler.listDirectory(args)
      case 'create_directory':
        return await this.fileSystemHandler.createDirectory(args)
      case 'move_files':
        return await this.fileSystemHandler.moveFiles(args)
      case 'edit_text':
        return await this.fileSystemHandler.editText(args)
      case 'search_files':
        return await this.fileSystemHandler.searchFiles(args)
      default:
        throw new Error(`Unknown FileSystem tool: ${toolName}`)
    }
  }
}
