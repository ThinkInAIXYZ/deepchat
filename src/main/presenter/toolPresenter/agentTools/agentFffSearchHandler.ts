import path from 'path'
import { statSync } from 'fs'
import { z } from 'zod'
import { AgentFileSystemHandler } from './agentFileSystemHandler'
import {
  FffSearchService,
  type FffFileSearchHit,
  type FffFindFilesOptions,
  type FffGrepHit,
  type FffGrepOptions,
  type FffSearchMetadata
} from '@/lib/agentRuntime/fffSearchService'

export const GLOB_TOOL_NAME = 'glob'
export const GREP_TOOL_NAME = 'grep'

export const FffGlobArgsSchema = z.object({
  query: z.string().min(1).describe('File-name or path query to search'),
  options: z
    .object({
      pathScope: z.array(z.string()).optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
      currentFile: z.string().optional()
    })
    .optional()
})

export const FffGrepArgsSchema = z.object({
  query: z.string().min(1).describe('Content query, identifier, or phrase to search for'),
  pathScope: z.array(z.string()).optional(),
  contextLines: z.number().int().min(0).max(5).default(0),
  maxResults: z.number().int().min(1).max(200).optional(),
  mode: z.enum(['plain', 'regex', 'fuzzy']).optional()
})

type FffGlobArgs = z.infer<typeof FffGlobArgsSchema>
type FffGrepArgs = z.infer<typeof FffGrepArgsSchema>

type AgentFffSearchHandlerOptions = {
  workspaceRoot: string
  allowedDirectories: string[]
  baseDirectory?: string
  conversationId?: string
  allowExternalFileAccess?: boolean
  signal?: AbortSignal
  service?: FffSearchService
}

export type AgentFffSearchToolResult = {
  content: string
  metadata: FffSearchMetadata
}

const GLOB_PATTERN = /[*?[{]/

const toPosixPath = (value: string): string => value.replace(/\\/g, '/')

function hasGlob(value: string): boolean {
  return GLOB_PATTERN.test(value)
}

export class AgentFffSearchHandler {
  private readonly workspaceRoot: string
  private readonly baseDirectory?: string
  private readonly signal?: AbortSignal
  private readonly service: FffSearchService
  private readonly fileSystemHandler: AgentFileSystemHandler

  constructor(options: AgentFffSearchHandlerOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot)
    this.baseDirectory = options.baseDirectory
    this.signal = options.signal
    this.service = options.service ?? new FffSearchService()
    this.fileSystemHandler = new AgentFileSystemHandler(options.allowedDirectories, {
      conversationId: options.conversationId,
      allowExternalAccess: options.allowExternalFileAccess
    })
  }

  async glob(args: unknown): Promise<AgentFffSearchToolResult> {
    const parsed = FffGlobArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments for ${GLOB_TOOL_NAME}: ${parsed.error.message}`)
    }

    const options = this.buildFindOptions(parsed.data)
    return await this.runFff(() => this.service.findFiles(parsed.data.query, options))
  }

  async grep(args: unknown): Promise<AgentFffSearchToolResult> {
    const parsed = FffGrepArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments for ${GREP_TOOL_NAME}: ${parsed.error.message}`)
    }

    const options = this.buildGrepOptions(parsed.data)
    return await this.runFff(() => this.service.grep(parsed.data.query, options))
  }

  private buildFindOptions(args: FffGlobArgs): FffFindFilesOptions {
    return {
      workspaceRoot: this.workspaceRoot,
      pathScope: this.normalizePathScope(args.options?.pathScope),
      maxResults: args.options?.maxResults,
      currentFile: args.options?.currentFile,
      signal: this.signal
    }
  }

  private buildGrepOptions(args: FffGrepArgs): FffGrepOptions {
    return {
      workspaceRoot: this.workspaceRoot,
      pathScope: this.normalizePathScope(args.pathScope),
      contextLines: args.contextLines,
      maxResults: args.maxResults,
      mode: args.mode,
      signal: this.signal
    }
  }

  private normalizePathScope(pathScope?: string[]): string[] | undefined {
    if (!pathScope || pathScope.length === 0) {
      return undefined
    }

    const normalized = pathScope
      .map((scope) => scope.trim())
      .filter(Boolean)
      .map((scope) => this.normalizeSingleScope(scope))

    return normalized.length > 0 ? normalized : undefined
  }

  private normalizeSingleScope(scope: string): string {
    if (hasGlob(scope)) {
      if (path.isAbsolute(scope) || scope.includes('..')) {
        throw new Error(`Invalid search path scope: ${scope}`)
      }
      return toPosixPath(scope.replace(/^\.\//, ''))
    }

    const resolved = this.fileSystemHandler.resolvePath(scope, this.baseDirectory)
    this.fileSystemHandler.assertReadAllowedAbsolute(resolved)
    if (!this.fileSystemHandler.isPathAllowedAbsolute(resolved)) {
      throw new Error(`Access denied - path outside allowed directories: ${scope}`)
    }

    const relative = path.relative(this.workspaceRoot, resolved)
    if (relative === '') {
      return '.'
    }
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`FFF path scope must be inside the workspace: ${scope}`)
    }
    const relativePath = toPosixPath(relative)
    try {
      if (statSync(resolved).isDirectory()) {
        return relativePath.endsWith('/') ? relativePath : `${relativePath}/`
      }
    } catch {
      // Non-existent scopes stay exact; FFF will return no matches if they are invalid.
    }
    return relativePath
  }

  private async runFff<T extends FffFileSearchHit | FffGrepHit>(
    runFff: () => Promise<T[]>
  ): Promise<AgentFffSearchToolResult> {
    const startedAt = Date.now()
    const hits = await runFff()
    return {
      content: JSON.stringify(hits, null, 2),
      metadata: {
        source: 'fff',
        elapsedMs: Date.now() - startedAt,
        resultCount: hits.length
      }
    }
  }
}
