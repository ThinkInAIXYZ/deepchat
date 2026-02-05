import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { getSessionsRoot } from '../../sessionPresenter/sessionPaths'
import { z } from 'zod'
import { minimatch } from 'minimatch'
import { diffLines } from 'diff'
import logger from '@shared/logger'
import { validateGlobPattern, validateRegexPattern } from '@shared/regexValidator'
import { getLanguageFromFilename } from '@shared/utils/codeLanguage'
import { spawn } from 'child_process'
import { RuntimeHelper } from '../../../lib/runtimeHelper'
import { glob } from 'glob'

// Auto-truncate threshold for read_file to avoid triggering tool output offload
const READ_FILE_AUTO_TRUNCATE_THRESHOLD = 4500

const ReadFileArgsSchema = z.object({
  paths: z.array(z.string()).min(1).describe('Array of file paths to read'),
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
    )
})

const WriteFileArgsSchema = z.object({
  path: z.string(),
  content: z.string()
})

const ListDirectoryArgsSchema = z.object({
  path: z.string(),
  showDetails: z.boolean().default(false),
  sortBy: z.enum(['name', 'size', 'modified']).default('name')
})

const CreateDirectoryArgsSchema = z.object({
  path: z.string()
})

const MoveFilesArgsSchema = z.object({
  sources: z.array(z.string()).min(1),
  destination: z.string()
})

const EditTextArgsSchema = z.object({
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

const GlobSearchArgsSchema = z.object({
  pattern: z.string().describe('Glob pattern (e.g., **/*.ts, src/**/*.js)'),
  root: z.string().optional().describe('Root directory for search (defaults to workspace root)'),
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
})

const GrepSearchArgsSchema = z.object({
  path: z.string(),
  pattern: z.string(),
  filePattern: z.string().optional(),
  recursive: z.boolean().default(true),
  caseSensitive: z.boolean().default(false),
  includeLineNumbers: z.boolean().default(true),
  contextLines: z.number().default(0),
  maxResults: z.number().default(100)
})

const TextReplaceArgsSchema = z.object({
  path: z.string(),
  pattern: z.string(),
  replacement: z.string(),
  global: z.boolean().default(true),
  caseSensitive: z.boolean().default(false),
  dryRun: z.boolean().default(false)
})

const DirectoryTreeArgsSchema = z.object({
  path: z.string(),
  depth: z.number().int().min(0).max(3).default(1)
})

const GetFileInfoArgsSchema = z.object({
  path: z.string()
})

interface GrepMatch {
  file: string
  line: number
  content: string
  beforeContext?: string[]
  afterContext?: string[]
}

interface GrepResult {
  totalMatches: number
  files: string[]
  matches: GrepMatch[]
}

interface TextReplaceResult {
  success: boolean
  replacements: number
  diff?: string
  error?: string
  originalContent?: string
  modifiedContent?: string
}

interface DiffToolSuccessResponse {
  success: true
  originalCode: string
  updatedCode: string
  language: string
  replacements?: number
}

interface DiffToolErrorResponse {
  success: false
  error: string
}

type DiffToolResponse = DiffToolSuccessResponse | DiffToolErrorResponse

interface TreeEntry {
  name: string
  type: 'file' | 'directory'
  children?: TreeEntry[]
}

interface GlobMatch {
  path: string
  name: string
  modified?: Date
  size?: number
}

interface LineRange {
  start: number
  end: number
}

interface PathValidationOptions {
  enforceAllowed?: boolean
  accessType?: 'read' | 'write'
}

export class AgentFileSystemHandler {
  private allowedDirectories: string[]
  private allowedDirectoriesRealPaths?: string[]
  private conversationId?: string
  private readonly sessionsRoot: string

  constructor(allowedDirectories: string[], options: { conversationId?: string } = {}) {
    if (allowedDirectories.length === 0) {
      throw new Error('At least one allowed directory must be provided')
    }
    this.allowedDirectories = allowedDirectories.map((dir) =>
      this.normalizePath(path.resolve(this.expandHome(dir)))
    )
    this.conversationId = options.conversationId
    this.sessionsRoot = this.normalizePath(getSessionsRoot())
  }

  private normalizePath(p: string): string {
    return path.normalize(p)
  }

  private normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n')
  }

  private isPathAllowedIn(candidatePath: string, allowedDirectories: string[]): boolean {
    return allowedDirectories.some((dir) => {
      if (candidatePath === dir) return true
      const dirWithSeparator = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`
      return candidatePath.startsWith(dirWithSeparator)
    })
  }

  private isPathAllowed(candidatePath: string): boolean {
    return this.isPathAllowedIn(candidatePath, this.allowedDirectories)
  }

  private async getAllowedDirectoriesRealPaths(): Promise<string[]> {
    if (this.allowedDirectoriesRealPaths) return this.allowedDirectoriesRealPaths
    const resolved = await Promise.all(
      this.allowedDirectories.map(async (dir) => {
        try {
          return this.normalizePath(await fs.realpath(dir))
        } catch {
          return dir
        }
      })
    )
    this.allowedDirectoriesRealPaths = resolved
    return resolved
  }

  private expandHome(filepath: string): string {
    if (filepath.startsWith('~/') || filepath === '~') {
      return path.join(os.homedir(), filepath.slice(1))
    }
    return filepath
  }

  resolvePath(requestedPath: string, baseDirectory?: string): string {
    const expandedPath = this.expandHome(requestedPath)
    const absolute = path.isAbsolute(expandedPath)
      ? path.resolve(expandedPath)
      : path.resolve(baseDirectory ?? this.allowedDirectories[0], expandedPath)
    return this.normalizePath(absolute)
  }

  isPathAllowedAbsolute(candidatePath: string): boolean {
    const normalized = this.normalizePath(path.resolve(candidatePath))
    return this.isPathAllowed(normalized)
  }

  private async validatePath(
    requestedPath: string,
    baseDirectory?: string,
    options: PathValidationOptions = {}
  ): Promise<string> {
    const enforceAllowed = options.enforceAllowed ?? true
    const normalizedRequested = this.resolvePath(requestedPath, baseDirectory)
    if (options.accessType === 'read') {
      this.assertSessionReadAllowed(normalizedRequested)
    }

    const isNotFoundError = (error: unknown): boolean => {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      return code === 'ENOENT' || code === 'ENOTDIR'
    }

    const allowedDirectories = enforceAllowed ? await this.getAllowedDirectoriesRealPaths() : []
    const assertAllowed = (candidatePath: string, message: string) => {
      if (!enforceAllowed) return
      if (this.isPathAllowedIn(candidatePath, allowedDirectories)) return
      throw new Error(message)
    }

    try {
      const realPath = await fs.realpath(normalizedRequested)
      const normalizedReal = this.normalizePath(realPath)
      if (options.accessType === 'read') {
        this.assertSessionReadAllowed(normalizedReal)
      }
      assertAllowed(normalizedReal, 'Access denied - symlink target outside allowed directories')
      return realPath
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error
      }

      const parentDir = path.dirname(normalizedRequested)
      try {
        const realParentPath = await fs.realpath(parentDir)
        const normalizedParent = this.normalizePath(realParentPath)
        assertAllowed(
          normalizedParent,
          'Access denied - parent directory outside allowed directories'
        )
        return normalizedRequested
      } catch (parentError) {
        if (isNotFoundError(parentError)) {
          throw new Error(`Parent directory does not exist: ${parentDir}`)
        }
        throw parentError
      }
    }
  }

  private isWithinSessionsRoot(candidatePath: string): boolean {
    if (candidatePath === this.sessionsRoot) return true
    const rootWithSeparator = this.sessionsRoot.endsWith(path.sep)
      ? this.sessionsRoot
      : `${this.sessionsRoot}${path.sep}`
    return candidatePath.startsWith(rootWithSeparator)
  }

  private assertSessionReadAllowed(candidatePath: string): void {
    if (!this.isWithinSessionsRoot(candidatePath)) return
    if (!this.conversationId) {
      throw new Error('Access denied - session files require an active conversation')
    }
    const sessionDir = this.normalizePath(path.join(this.sessionsRoot, this.conversationId))
    if (candidatePath === sessionDir) return
    const sessionWithSeparator = sessionDir.endsWith(path.sep)
      ? sessionDir
      : `${sessionDir}${path.sep}`
    if (!candidatePath.startsWith(sessionWithSeparator)) {
      throw new Error('Access denied - session files outside current conversation')
    }
  }

  private countLines(value: string): number {
    if (value.length === 0) return 0
    const lineCount = value.split('\n').length
    return value.endsWith('\n') ? lineCount - 1 : lineCount
  }

  private addContextRange(ranges: LineRange[], index: number, totalLines: number): void {
    if (totalLines <= 0) return
    const clamped = Math.min(Math.max(index, 0), totalLines - 1)
    ranges.push({ start: clamped, end: clamped })
  }

  private expandRanges(ranges: LineRange[], totalLines: number, contextLines: number): LineRange[] {
    if (totalLines <= 0 || ranges.length === 0) return []
    const expanded = ranges.map((range) => ({
      start: Math.max(0, range.start - contextLines),
      end: Math.min(totalLines - 1, range.end + contextLines)
    }))
    expanded.sort((a, b) => a.start - b.start)
    const merged: LineRange[] = []
    for (const range of expanded) {
      const last = merged[merged.length - 1]
      if (!last || range.start > last.end + 1) {
        merged.push({ ...range })
        continue
      }
      last.end = Math.max(last.end, range.end)
    }
    return merged
  }

  private formatNoChanges(count: number): string {
    return `... [No changes: ${count} lines] ...`
  }

  private buildCollapsedText(lines: string[], ranges: LineRange[]): string {
    if (lines.length === 0) return ''
    if (ranges.length === 0) {
      return this.formatNoChanges(lines.length)
    }
    const output: string[] = []
    let cursor = 0
    for (const range of ranges) {
      if (range.start > cursor) {
        const gap = range.start - cursor
        if (gap > 0) {
          output.push(this.formatNoChanges(gap))
        }
      }
      output.push(...lines.slice(range.start, range.end + 1))
      cursor = range.end + 1
    }
    if (cursor < lines.length) {
      const remaining = lines.length - cursor
      if (remaining > 0) {
        output.push(this.formatNoChanges(remaining))
      }
    }
    return output.join('\n')
  }

  private buildTruncatedDiff(
    originalContent: string,
    updatedContent: string,
    contextLines: number
  ): { originalCode: string; updatedCode: string } {
    const normalizedOriginal = this.normalizeLineEndings(originalContent)
    const normalizedUpdated = this.normalizeLineEndings(updatedContent)
    const originalLines = normalizedOriginal.split('\n')
    const updatedLines = normalizedUpdated.split('\n')
    const originalRanges: LineRange[] = []
    const updatedRanges: LineRange[] = []

    let originalIndex = 0
    let updatedIndex = 0
    const parts = diffLines(normalizedOriginal, normalizedUpdated)

    for (const part of parts) {
      const lineCount = this.countLines(part.value)
      if (part.added) {
        if (lineCount > 0) {
          updatedRanges.push({ start: updatedIndex, end: updatedIndex + lineCount - 1 })
        }
        this.addContextRange(originalRanges, originalIndex, originalLines.length)
        updatedIndex += lineCount
        continue
      }
      if (part.removed) {
        if (lineCount > 0) {
          originalRanges.push({ start: originalIndex, end: originalIndex + lineCount - 1 })
        }
        this.addContextRange(updatedRanges, updatedIndex, updatedLines.length)
        originalIndex += lineCount
        continue
      }
      originalIndex += lineCount
      updatedIndex += lineCount
    }

    const expandedOriginal = this.expandRanges(originalRanges, originalLines.length, contextLines)
    const expandedUpdated = this.expandRanges(updatedRanges, updatedLines.length, contextLines)

    return {
      originalCode: this.buildCollapsedText(originalLines, expandedOriginal),
      updatedCode: this.buildCollapsedText(updatedLines, expandedUpdated)
    }
  }

  private async getFileStats(filePath: string): Promise<{
    size: number
    created: Date
    modified: Date
    accessed: Date
    isDirectory: boolean
    isFile: boolean
    permissions: string
  }> {
    const stats = await fs.stat(filePath)
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      permissions: stats.mode.toString(8).slice(-3)
    }
  }

  private async runGrepSearch(
    rootPath: string,
    pattern: string,
    options: {
      filePattern?: string
      recursive?: boolean
      caseSensitive?: boolean
      includeLineNumbers?: boolean
      contextLines?: number
      maxResults?: number
    } = {}
  ): Promise<GrepResult> {
    const {
      filePattern,
      recursive = true,
      caseSensitive = false,
      includeLineNumbers = true,
      contextLines = 0,
      maxResults = 100
    } = options

    // Validate pattern for ReDoS safety
    validateRegexPattern(pattern)

    // Try to use ripgrep if available
    const runtimeHelper = RuntimeHelper.getInstance()
    runtimeHelper.initializeRuntimes()
    const ripgrepPath = runtimeHelper.getRipgrepRuntimePath()

    if (ripgrepPath) {
      try {
        return await this.runRipgrepSearch(rootPath, pattern, {
          filePattern,
          recursive,
          caseSensitive,
          includeLineNumbers,
          contextLines,
          maxResults
        })
      } catch (error) {
        // Fall back to JavaScript implementation if ripgrep fails
        logger.warn('[AgentFileSystemHandler] Ripgrep search failed, falling back to JS', {
          error
        })
      }
    }

    // Fallback to JavaScript implementation
    return this.runJavaScriptGrepSearch(rootPath, pattern, {
      filePattern: filePattern || '*',
      recursive,
      caseSensitive,
      includeLineNumbers,
      contextLines,
      maxResults
    })
  }

  private async runRipgrepSearch(
    rootPath: string,
    pattern: string,
    options: {
      filePattern?: string
      recursive?: boolean
      caseSensitive?: boolean
      includeLineNumbers?: boolean
      contextLines?: number
      maxResults?: number
    }
  ): Promise<GrepResult> {
    const {
      filePattern,
      recursive = true,
      caseSensitive = false,
      includeLineNumbers = true,
      contextLines = 0,
      maxResults = 100
    } = options

    const result: GrepResult = {
      totalMatches: 0,
      files: [],
      matches: []
    }

    const runtimeHelper = RuntimeHelper.getInstance()
    const ripgrepPath = runtimeHelper.getRipgrepRuntimePath()
    if (!ripgrepPath) {
      throw new Error('Ripgrep runtime path not found')
    }

    const rgExecutable =
      process.platform === 'win32' ? path.join(ripgrepPath, 'rg.exe') : path.join(ripgrepPath, 'rg')

    // Build ripgrep arguments
    const args: string[] = []

    // Search pattern
    args.push('-e', pattern)

    // Case sensitivity
    if (caseSensitive) {
      args.push('--case-sensitive')
    } else {
      args.push('-i')
    }

    // Context lines
    if (contextLines > 0) {
      args.push(`-C${contextLines}`)
    }

    // Max count
    args.push('-m', String(maxResults))

    // File pattern (glob)
    if (filePattern) {
      args.push('-g', filePattern)
    }

    // Recursive (default for rg, but add --no-recursive if not wanted)
    if (!recursive) {
      args.push('--no-recursive')
    }

    // Output format with line numbers
    args.push('--with-filename')
    args.push('--line-number')
    args.push('--no-heading')

    // Search path
    const validatedPath = await this.validatePath(rootPath, undefined, {
      enforceAllowed: false,
      accessType: 'read'
    })
    args.push(validatedPath)

    return new Promise((resolve, reject) => {
      const ripgrep = spawn(rgExecutable, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        ripgrep.kill('SIGKILL')
        reject(new Error('Ripgrep search timed out after 30000ms'))
      }, 30_000)

      ripgrep.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      ripgrep.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      ripgrep.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (code === 0 || code === 1) {
          // 0 = matches found, 1 = no matches (both are OK)
          // Parse ripgrep output
          const lines = stdout.split('\n').filter((line) => line.trim())
          const currentFileMatches = new Map<string, GrepMatch[]>()
          const uniqueFiles = new Set<string>()

          for (const line of lines) {
            // Parse ripgrep output format: file:line:content
            const lastColonIndex = line.lastIndexOf(':')
            const lineNumberSeparator = line.lastIndexOf(':', lastColonIndex - 1)
            if (lineNumberSeparator !== -1 && lastColonIndex !== -1) {
              const file = line.slice(0, lineNumberSeparator)
              const lineNum = line.slice(lineNumberSeparator + 1, lastColonIndex)
              const content = line.slice(lastColonIndex + 1)
              if (!/^\d+$/.test(lineNum)) {
                continue
              }
              uniqueFiles.add(file)

              const grepMatch: GrepMatch = {
                file,
                line: includeLineNumbers ? parseInt(lineNum, 10) : 0,
                content
              }

              if (!currentFileMatches.has(file)) {
                currentFileMatches.set(file, [])
              }
              currentFileMatches.get(file)!.push(grepMatch)
              result.totalMatches++
            }
          }

          result.files = Array.from(uniqueFiles)
          result.matches = Array.from(currentFileMatches.values()).flat()

          resolve(result)
        } else {
          reject(new Error(`Ripgrep failed with code ${code}: ${stderr}`))
        }
      })

      ripgrep.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(new Error(`Ripgrep spawn error: ${error.message}`))
      })
    })
  }

  private async runJavaScriptGrepSearch(
    rootPath: string,
    pattern: string,
    options: {
      filePattern?: string
      recursive?: boolean
      caseSensitive?: boolean
      includeLineNumbers?: boolean
      contextLines?: number
      maxResults?: number
    }
  ): Promise<GrepResult> {
    const {
      filePattern = '*',
      recursive = true,
      caseSensitive = false,
      includeLineNumbers = true,
      contextLines = 0,
      maxResults = 100
    } = options

    const result: GrepResult = {
      totalMatches: 0,
      files: [],
      matches: []
    }

    const regexFlags = caseSensitive ? 'g' : 'gi'
    let regex: RegExp
    try {
      regex = new RegExp(pattern, regexFlags)
    } catch (error) {
      throw new Error(`Invalid regular expression pattern: ${pattern}. Error: ${error}`)
    }

    const searchInFile = async (filePath: string): Promise<void> => {
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        const lines = content.split('\n')
        const fileMatches: GrepMatch[] = []

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          regex.lastIndex = 0
          const matches = Array.from(line.matchAll(regex))
          if (matches.length === 0) continue

          const match: GrepMatch = {
            file: filePath,
            line: includeLineNumbers ? i + 1 : 0,
            content: line
          }

          if (contextLines > 0) {
            const startContext = Math.max(0, i - contextLines)
            const endContext = Math.min(lines.length - 1, i + contextLines)
            if (startContext < i) {
              match.beforeContext = lines.slice(startContext, i)
            }
            if (endContext > i) {
              match.afterContext = lines.slice(i + 1, endContext + 1)
            }
          }

          fileMatches.push(match)
          result.totalMatches += matches.length
          if (result.totalMatches >= maxResults) {
            break
          }
        }

        if (fileMatches.length > 0) {
          result.files.push(filePath)
          result.matches.push(...fileMatches)
        }
      } catch {
        // Skip unreadable files.
      }
    }

    const searchDirectory = async (currentPath: string): Promise<void> => {
      if (result.totalMatches >= maxResults) return
      let entries
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        if (result.totalMatches >= maxResults) break
        const fullPath = path.join(currentPath, entry.name)
        try {
          await this.validatePath(fullPath, undefined, {
            enforceAllowed: false,
            accessType: 'read'
          })
          if (entry.isFile()) {
            if (minimatch(entry.name, filePattern, { nocase: !caseSensitive })) {
              await searchInFile(fullPath)
            }
          } else if (entry.isDirectory() && recursive) {
            await searchDirectory(fullPath)
          }
        } catch {
          continue
        }
      }
    }

    const validatedPath = await this.validatePath(rootPath, undefined, {
      enforceAllowed: false,
      accessType: 'read'
    })
    const stats = await fs.stat(validatedPath)

    if (stats.isFile()) {
      if (minimatch(path.basename(validatedPath), filePattern, { nocase: true })) {
        await searchInFile(validatedPath)
      }
    } else if (stats.isDirectory()) {
      await searchDirectory(validatedPath)
    }

    return result
  }

  private async replaceTextInFile(
    filePath: string,
    pattern: string,
    replacement: string,
    options: {
      global?: boolean
      caseSensitive?: boolean
      dryRun?: boolean
    } = {}
  ): Promise<TextReplaceResult> {
    const { global = true, caseSensitive = false, dryRun = false } = options
    try {
      // Validate pattern for ReDoS safety before constructing RegExp
      try {
        validateRegexPattern(pattern)
      } catch (error) {
        return {
          success: false,
          replacements: 0,
          error: error instanceof Error ? error.message : String(error)
        }
      }

      const originalContent = await fs.readFile(filePath, 'utf-8')
      const normalizedOriginal = this.normalizeLineEndings(originalContent)
      const regexFlags = global ? (caseSensitive ? 'g' : 'gi') : caseSensitive ? '' : 'i'
      let regex: RegExp
      try {
        regex = new RegExp(pattern, regexFlags)
      } catch (error) {
        return {
          success: false,
          replacements: 0,
          error: `Invalid regular expression pattern: ${pattern}. Error: ${error}`
        }
      }

      // Pattern already validated above, safe to create count regex
      const countRegex = new RegExp(pattern, caseSensitive ? 'g' : 'gi')
      const matches = Array.from(normalizedOriginal.matchAll(countRegex))
      const replacements = global ? matches.length : Math.min(1, matches.length)

      if (replacements === 0) {
        return {
          success: true,
          replacements: 0,
          originalContent: normalizedOriginal,
          modifiedContent: normalizedOriginal
        }
      }

      const modifiedContent = normalizedOriginal.replace(regex, replacement)
      if (!dryRun) {
        await fs.writeFile(filePath, modifiedContent, 'utf-8')
      }

      return {
        success: true,
        replacements,
        originalContent: normalizedOriginal,
        modifiedContent
      }
    } catch (error) {
      return {
        success: false,
        replacements: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async readFile(args: unknown, baseDirectory?: string): Promise<string> {
    const parsed = ReadFileArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const { offset = 0, limit } = parsed.data

    const results = await Promise.all(
      parsed.data.paths.map(async (filePath: string) => {
        try {
          const validPath = await this.validatePath(filePath, baseDirectory, {
            enforceAllowed: false,
            accessType: 'read'
          })
          const fullContent = await fs.readFile(validPath, 'utf-8')
          const totalLength = fullContent.length

          // Determine effective limit
          let effectiveLimit = limit
          let autoTruncated = false

          // Auto-truncate large files when no explicit limit specified
          if (limit === undefined && totalLength - offset > READ_FILE_AUTO_TRUNCATE_THRESHOLD) {
            effectiveLimit = READ_FILE_AUTO_TRUNCATE_THRESHOLD
            autoTruncated = true
          }

          // Apply offset and limit
          const content =
            effectiveLimit !== undefined
              ? fullContent.slice(offset, offset + effectiveLimit)
              : fullContent.slice(offset)

          const endOffset = offset + content.length

          // Build result with metadata when pagination is active or auto-truncated
          if (offset > 0 || limit !== undefined || autoTruncated) {
            let header = `${filePath} [chars ${offset}-${endOffset} of ${totalLength}]`
            if (autoTruncated) {
              header += ` (auto-truncated, use offset/limit to read more)`
            }
            return `${header}:\n${content}\n`
          }

          return `${filePath}:\n${content}\n`
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          return `${filePath}: Error - ${errorMessage}`
        }
      })
    )
    return results.join('\n---\n')
  }

  async writeFile(args: unknown, baseDirectory?: string): Promise<string> {
    const parsed = WriteFileArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const validPath = await this.validatePath(parsed.data.path, baseDirectory)
    await fs.writeFile(validPath, parsed.data.content, 'utf-8')
    return `Successfully wrote to ${parsed.data.path}`
  }

  async listDirectory(args: unknown, baseDirectory?: string): Promise<string> {
    const parsed = ListDirectoryArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const validPath = await this.validatePath(parsed.data.path, baseDirectory, {
      enforceAllowed: false,
      accessType: 'read'
    })
    const entries = await fs.readdir(validPath, { withFileTypes: true })
    const formatted = entries
      .map((entry) => {
        const prefix = entry.isDirectory() ? '[DIR]' : '[FILE]'
        return `${prefix} ${entry.name}`
      })
      .join('\n')
    return `Directory listing for ${parsed.data.path}:\n\n${formatted}`
  }

  async createDirectory(args: unknown, baseDirectory?: string): Promise<string> {
    const parsed = CreateDirectoryArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const validPath = await this.validatePath(parsed.data.path, baseDirectory)
    await fs.mkdir(validPath, { recursive: true })
    return `Successfully created directory ${parsed.data.path}`
  }

  async moveFiles(args: unknown, baseDirectory?: string): Promise<string> {
    const parsed = MoveFilesArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const results = await Promise.all(
      parsed.data.sources.map(async (source) => {
        const validSourcePath = await this.validatePath(source, baseDirectory)
        const validDestPath = await this.validatePath(
          path.join(parsed.data.destination, path.basename(source)),
          baseDirectory
        )
        try {
          await fs.rename(validSourcePath, validDestPath)
          return `Successfully moved ${source} to ${parsed.data.destination}`
        } catch (e) {
          return `Move ${source} failed: ${JSON.stringify(e)}`
        }
      })
    )
    return results.join('\n')
  }

  async editText(args: unknown, baseDirectory?: string): Promise<string> {
    const parsed = EditTextArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const validPath = await this.validatePath(parsed.data.path, baseDirectory)
    const content = await fs.readFile(validPath, 'utf-8')
    let modifiedContent = content

    if (parsed.data.operation === 'edit_lines' && parsed.data.edits) {
      for (const edit of parsed.data.edits) {
        if (!modifiedContent.includes(edit.oldText)) {
          throw new Error(`Cannot find exact matching content: ${edit.oldText}`)
        }
        modifiedContent = modifiedContent.replace(edit.oldText, edit.newText)
      }
    } else if (parsed.data.operation === 'replace_pattern' && parsed.data.pattern) {
      // Validate pattern for ReDoS safety before constructing RegExp
      try {
        validateRegexPattern(parsed.data.pattern)
      } catch (error) {
        throw new Error(
          error instanceof Error ? error.message : `Invalid pattern: ${String(error)}`
        )
      }

      const flags = parsed.data.caseSensitive ? 'g' : 'gi'
      const regex = new RegExp(parsed.data.pattern, flags)
      modifiedContent = modifiedContent.replace(regex, parsed.data.replacement || '')
    }

    const { originalCode, updatedCode } = this.buildTruncatedDiff(content, modifiedContent, 3)
    const language = getLanguageFromFilename(validPath)
    if (!parsed.data.dryRun) {
      await fs.writeFile(validPath, modifiedContent, 'utf-8')
    }
    const response: DiffToolResponse = {
      success: true,
      originalCode,
      updatedCode,
      language
    }
    return JSON.stringify(response)
  }

  async grepSearch(args: unknown, baseDirectory?: string): Promise<string> {
    const parsed = GrepSearchArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const validPath = await this.validatePath(parsed.data.path, baseDirectory, {
      enforceAllowed: false,
      accessType: 'read'
    })
    const result = await this.runGrepSearch(validPath, parsed.data.pattern, {
      filePattern: parsed.data.filePattern,
      recursive: parsed.data.recursive,
      caseSensitive: parsed.data.caseSensitive,
      includeLineNumbers: parsed.data.includeLineNumbers,
      contextLines: parsed.data.contextLines,
      maxResults: parsed.data.maxResults
    })

    if (result.totalMatches === 0) {
      return 'No matches found'
    }

    const formattedResults = result.matches
      .map((match) => {
        let output = `${match.file}:${match.line}: ${match.content}`
        if (match.beforeContext && match.beforeContext.length > 0) {
          const beforeLines = match.beforeContext
            .map(
              (line, i) => `${match.file}:${match.line - match.beforeContext!.length + i}: ${line}`
            )
            .join('\n')
          output = beforeLines + '\n' + output
        }
        if (match.afterContext && match.afterContext.length > 0) {
          const afterLines = match.afterContext
            .map((line, i) => `${match.file}:${match.line + i + 1}: ${line}`)
            .join('\n')
          output = output + '\n' + afterLines
        }
        return output
      })
      .join('\n--\n')

    return `Found ${result.totalMatches} matches in ${result.files.length} files:\n\n${formattedResults}`
  }

  async textReplace(args: unknown, baseDirectory?: string): Promise<string> {
    const parsed = TextReplaceArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const validPath = await this.validatePath(parsed.data.path, baseDirectory)
    const result = await this.replaceTextInFile(
      validPath,
      parsed.data.pattern,
      parsed.data.replacement,
      {
        global: parsed.data.global,
        caseSensitive: parsed.data.caseSensitive,
        dryRun: parsed.data.dryRun
      }
    )

    if (!result.success) {
      return result.error || 'Text replacement failed'
    }

    const { originalCode, updatedCode } = this.buildTruncatedDiff(
      result.originalContent ?? '',
      result.modifiedContent ?? '',
      3
    )
    const language = getLanguageFromFilename(validPath)
    const response: DiffToolResponse = {
      success: true,
      originalCode,
      updatedCode,
      language,
      replacements: result.replacements
    }
    return JSON.stringify(response)
  }

  async directoryTree(args: unknown, baseDirectory?: string): Promise<string> {
    const parsed = DirectoryTreeArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const depth = parsed.data.depth
    const buildTree = async (currentPath: string, currentDepth: number): Promise<TreeEntry[]> => {
      const validPath = await this.validatePath(currentPath, baseDirectory, {
        enforceAllowed: false,
        accessType: 'read'
      })
      const entries = await fs.readdir(validPath, { withFileTypes: true })
      const result: TreeEntry[] = []

      for (const entry of entries) {
        const entryData: TreeEntry = {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file'
        }

        if (entry.isDirectory()) {
          const subPath = path.join(currentPath, entry.name)
          if (currentDepth < depth) {
            entryData.children = await buildTree(subPath, currentDepth + 1)
          }
        }

        result.push(entryData)
      }

      return result
    }

    const treeData = await buildTree(parsed.data.path, 0)
    return JSON.stringify(treeData, null, 2)
  }

  async getFileInfo(args: unknown, baseDirectory?: string): Promise<string> {
    const parsed = GetFileInfoArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const validPath = await this.validatePath(parsed.data.path, baseDirectory, {
      enforceAllowed: false,
      accessType: 'read'
    })
    const info = await this.getFileStats(validPath)
    return Object.entries(info)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')
  }

  async globSearch(args: unknown, baseDirectory?: string): Promise<string> {
    const parsed = GlobSearchArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const { pattern, root, excludePatterns = [], maxResults = 1000, sortBy = 'name' } = parsed.data
    validateGlobPattern(pattern)

    // Determine root directory
    const searchRoot = root
      ? await this.validatePath(root, baseDirectory, { enforceAllowed: false, accessType: 'read' })
      : await this.validatePath(baseDirectory ?? this.allowedDirectories[0], undefined, {
          enforceAllowed: false,
          accessType: 'read'
        })

    // Default exclusions
    const defaultExclusions = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**'
    ]
    const allExclusions = [...defaultExclusions, ...excludePatterns]

    // Use glob library for fast file matching
    const globOptions = {
      cwd: searchRoot,
      ignore: allExclusions,
      absolute: true,
      nodir: true,
      maxResults: maxResults + 100 // Get extra results for filtering
    }

    try {
      const matches = await glob(pattern, globOptions)

      // Preserve matches without allowlist filtering for read operations.
      const validMatches = await Promise.all(
        matches.map(async (filePath) => {
          return filePath
        })
      )

      const filteredMatches = validMatches.filter((match): match is string => match !== null)

      // Get file stats for sorting
      const matchesWithStats: GlobMatch[] = await Promise.all(
        filteredMatches.slice(0, maxResults).map(async (filePath) => {
          try {
            const stats = await fs.stat(filePath)
            return {
              path: filePath,
              name: path.basename(filePath),
              modified: stats.mtime,
              size: stats.size
            }
          } catch {
            return {
              path: filePath,
              name: path.basename(filePath)
            }
          }
        })
      )

      // Sort results
      if (sortBy === 'modified') {
        matchesWithStats.sort((a, b) => {
          const aTime = a.modified?.getTime() || 0
          const bTime = b.modified?.getTime() || 0
          return bTime - aTime // Descending (newest first)
        })
      } else {
        // Sort by name (default)
        matchesWithStats.sort((a, b) => a.path.localeCompare(b.path))
      }

      // Format output
      const formatted = matchesWithStats.map((match) => {
        let output = match.path
        if (match.modified !== undefined && sortBy === 'modified') {
          output += ` (${match.modified.toISOString()})`
        }
        if (match.size !== undefined) {
          output += ` [${match.size} bytes]`
        }
        return output
      })

      return `Found ${formatted.length} files matching pattern "${pattern}":\n\n${formatted.join('\n')}`
    } catch (error) {
      throw new Error(
        `Glob search failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
