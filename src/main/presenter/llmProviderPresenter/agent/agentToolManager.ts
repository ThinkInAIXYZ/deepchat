import type { MCPToolDefinition } from '@shared/presenter'
import type { IYoBrowserPresenter } from '@shared/presenter'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import logger from '@shared/logger'
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
    const isAgentMode = context.chatMode === 'agent'
    const effectiveWorkspacePath = isAgentMode
      ? context.agentWorkspacePath?.trim() || this.getDefaultAgentWorkspacePath()
      : null

    // Update filesystem handler if workspace path changed
    if (effectiveWorkspacePath !== this.agentWorkspacePath) {
      if (effectiveWorkspacePath) {
        this.fileSystemHandler = new AgentFileSystemHandler([effectiveWorkspacePath])
      } else {
        this.fileSystemHandler = null
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
    if (this.isFileSystemTool(toolName)) {
      if (!this.fileSystemHandler) {
        throw new Error(`FileSystem handler not initialized for tool: ${toolName}`)
      }
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
    })

    const FileSearchSchema = z.object({
      path: z.string().optional(),
      pattern: z.string(),
      searchType: z.enum(['glob', 'name']).default('glob'),
      excludePatterns: z.array(z.string()).optional().default([]),
      caseSensitive: z.boolean().default(false),
      maxResults: z.number().default(1000)
    })

    const GrepSearchSchema = z.object({
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
    })

    const TextReplaceSchema = z.object({
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
    })

    const DirectoryTreeSchema = z.object({
      path: z.string()
    })

    const GetFileInfoSchema = z.object({
      path: z.string()
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
          description:
            'Edit text files using pattern replacement or line-based editing. When using "replace_pattern" operation, the pattern must be safe and not exceed 1000 characters to prevent ReDoS (Regular Expression Denial of Service) attacks.',
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
      },
      {
        type: 'function',
        function: {
          name: 'directory_tree',
          description: 'Get a recursive directory tree as JSON',
          parameters: zodToJsonSchema(DirectoryTreeSchema) as {
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
          parameters: zodToJsonSchema(GetFileInfoSchema) as {
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
          parameters: zodToJsonSchema(GrepSearchSchema) as {
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
          parameters: zodToJsonSchema(TextReplaceSchema) as {
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
      'search_files',
      'directory_tree',
      'get_file_info',
      'grep_search',
      'text_replace'
    ]
    return filesystemTools.includes(toolName)
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
      case 'directory_tree':
        return await this.fileSystemHandler.directoryTree(args)
      case 'get_file_info':
        return await this.fileSystemHandler.getFileInfo(args)
      case 'grep_search':
        return await this.fileSystemHandler.grepSearch(args)
      case 'text_replace':
        return await this.fileSystemHandler.textReplace(args)
      default:
        throw new Error(`Unknown FileSystem tool: ${toolName}`)
    }
  }

  private getDefaultAgentWorkspacePath(): string {
    const tempDir = path.join(app.getPath('temp'), 'deepchat-agent', 'workspaces')
    try {
      fs.mkdirSync(tempDir, { recursive: true })
    } catch (error) {
      console.warn(
        '[AgentToolManager] Failed to create default workspace, using system temp:',
        error
      )
      return app.getPath('temp')
    }
    return tempDir
  }
}
