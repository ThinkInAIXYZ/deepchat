import * as fs from 'fs/promises'
import * as path from 'path'
import { RequestError } from '@agentclientprotocol/sdk'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'

export interface FsHandlerOptions {
  /** Session's working directory (workspace root). Null = allow all. */
  workspaceRoot: string | null
  /** Maximum file size in bytes to read (default: 10MB) */
  maxReadSize?: number
  /** Callback when a file is written */
  onFileChange?: (filePath: string) => void
}

/**
 * Handles file system operations requested by ACP agents.
 *
 * This handler implements `fs/read_text_file` and `fs/write_text_file` methods
 * as specified in the ACP protocol. It enforces workspace boundaries for security.
 *
 * @see https://agentclientprotocol.com/protocol/file-system
 */
export class AcpFsHandler {
  private readonly workspaceRoot: string | null
  private readonly maxReadSize: number
  private readonly onFileChange?: (filePath: string) => void

  constructor(options: FsHandlerOptions) {
    this.workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : null
    this.maxReadSize = options.maxReadSize ?? 10 * 1024 * 1024 // 10MB default
    this.onFileChange = options.onFileChange
  }

  /**
   * Validate that the path is within the workspace boundary.
   * Throws RequestError if path escapes workspace.
   */
  private validatePath(filePath: string): string {
    const resolved = path.resolve(filePath)

    if (this.workspaceRoot) {
      const relative = path.relative(this.workspaceRoot, resolved)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw RequestError.invalidParams({ path: filePath }, `Path escapes workspace: ${filePath}`)
      }
    }

    return resolved
  }

  /**
   * Read content from a text file.
   *
   * Supports optional line offset and limit for reading portions of large files.
   */
  async readTextFile(params: schema.ReadTextFileRequest): Promise<schema.ReadTextFileResponse> {
    const filePath = this.validatePath(params.path)

    try {
      const stat = await fs.stat(filePath)
      if (stat.size > this.maxReadSize) {
        throw RequestError.invalidParams(
          { path: params.path, size: stat.size },
          `File too large: ${stat.size} bytes exceeds limit of ${this.maxReadSize}`
        )
      }

      const content = await fs.readFile(filePath, 'utf-8')
      const lines = content.split('\n')

      // Handle optional line/limit parameters (1-based line numbers per ACP spec)
      const startLine = params.line ?? 1
      const limit = params.limit ?? lines.length

      const startIndex = Math.max(0, startLine - 1)
      const endIndex = startIndex + limit
      const selectedLines = lines.slice(startIndex, endIndex)

      return { content: selectedLines.join('\n') }
    } catch (error) {
      if (error instanceof RequestError) {
        throw error
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw RequestError.resourceNotFound(params.path)
      }
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        throw RequestError.invalidParams({ path: params.path }, `Permission denied: ${params.path}`)
      }
      throw error
    }
  }

  /**
   * Write content to a text file.
   *
   * Creates parent directories if they don't exist.
   */
  async writeTextFile(params: schema.WriteTextFileRequest): Promise<schema.WriteTextFileResponse> {
    const filePath = this.validatePath(params.path)

    try {
      // Ensure parent directory exists
      const dir = path.dirname(filePath)
      await fs.mkdir(dir, { recursive: true })

      await fs.writeFile(filePath, params.content, 'utf-8')

      // Notify file change
      if (this.onFileChange) {
        this.onFileChange(filePath)
      }

      return {}
    } catch (error) {
      if (error instanceof RequestError) {
        throw error
      }
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        throw RequestError.invalidParams({ path: params.path }, `Permission denied: ${params.path}`)
      }
      throw error
    }
  }
}
