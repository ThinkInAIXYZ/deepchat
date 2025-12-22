import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { z } from 'zod'
import { minimatch } from 'minimatch'
import { createTwoFilesPatch } from 'diff'

const ReadFileArgsSchema = z.object({
  paths: z.array(z.string()).min(1).describe('Array of file paths to read')
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

const FileSearchArgsSchema = z.object({
  path: z.string().optional(),
  pattern: z.string(),
  searchType: z.enum(['glob', 'name']).default('glob'),
  excludePatterns: z.array(z.string()).optional().default([]),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().default(1000)
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
  path: z.string()
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
}

interface TreeEntry {
  name: string
  type: 'file' | 'directory'
  children?: TreeEntry[]
}

export class AgentFileSystemHandler {
  private allowedDirectories: string[]

  constructor(allowedDirectories: string[]) {
    if (allowedDirectories.length === 0) {
      throw new Error('At least one allowed directory must be provided')
    }
    this.allowedDirectories = allowedDirectories.map((dir) =>
      this.normalizePath(path.resolve(this.expandHome(dir)))
    )
  }

  private normalizePath(p: string): string {
    return path.normalize(p)
  }

  private normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n')
  }

  private expandHome(filepath: string): string {
    if (filepath.startsWith('~/') || filepath === '~') {
      return path.join(os.homedir(), filepath.slice(1))
    }
    return filepath
  }

  private async validatePath(requestedPath: string): Promise<string> {
    const expandedPath = this.expandHome(requestedPath)
    const absolute = path.isAbsolute(expandedPath)
      ? path.resolve(expandedPath)
      : path.resolve(process.cwd(), expandedPath)
    const normalizedRequested = this.normalizePath(absolute)
    const isAllowed = this.allowedDirectories.some((dir) => normalizedRequested.startsWith(dir))
    if (!isAllowed) {
      throw new Error(
        `Access denied - path outside allowed directories: ${absolute} not in ${this.allowedDirectories.join(', ')}`
      )
    }
    try {
      const realPath = await fs.realpath(absolute)
      const normalizedReal = this.normalizePath(realPath)
      const isRealPathAllowed = this.allowedDirectories.some((dir) =>
        normalizedReal.startsWith(dir)
      )
      if (!isRealPathAllowed) {
        throw new Error('Access denied - symlink target outside allowed directories')
      }
      return realPath
    } catch {
      const parentDir = path.dirname(absolute)
      try {
        const realParentPath = await fs.realpath(parentDir)
        const normalizedParent = this.normalizePath(realParentPath)
        const isParentAllowed = this.allowedDirectories.some((dir) =>
          normalizedParent.startsWith(dir)
        )
        if (!isParentAllowed) {
          throw new Error('Access denied - parent directory outside allowed directories')
        }
        return absolute
      } catch {
        throw new Error(`Parent directory does not exist: ${parentDir}`)
      }
    }
  }

  private createUnifiedDiff(originalContent: string, newContent: string, filePath: string): string {
    const normalizedOriginal = this.normalizeLineEndings(originalContent)
    const normalizedNew = this.normalizeLineEndings(newContent)
    return createTwoFilesPatch(filePath, filePath, normalizedOriginal, normalizedNew)
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
          await this.validatePath(fullPath)
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

    const validatedPath = await this.validatePath(rootPath)
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

      const modifiedContent = normalizedOriginal.replace(regex, replacement)
      const countRegex = new RegExp(pattern, caseSensitive ? 'g' : 'gi')
      const matches = Array.from(normalizedOriginal.matchAll(countRegex))
      const replacements = global ? matches.length : Math.min(1, matches.length)

      if (replacements === 0) {
        return {
          success: true,
          replacements: 0,
          diff: 'No matches found for the given pattern.'
        }
      }

      const diff = this.createUnifiedDiff(normalizedOriginal, modifiedContent, filePath)
      if (!dryRun) {
        await fs.writeFile(filePath, modifiedContent, 'utf-8')
      }

      return {
        success: true,
        replacements,
        diff
      }
    } catch (error) {
      return {
        success: false,
        replacements: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async readFile(args: unknown): Promise<string> {
    const parsed = ReadFileArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const results = await Promise.all(
      parsed.data.paths.map(async (filePath: string) => {
        try {
          const validPath = await this.validatePath(filePath)
          const content = await fs.readFile(validPath, 'utf-8')
          return `${filePath}:\n${content}\n`
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          return `${filePath}: Error - ${errorMessage}`
        }
      })
    )
    return results.join('\n---\n')
  }

  async writeFile(args: unknown): Promise<string> {
    const parsed = WriteFileArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const validPath = await this.validatePath(parsed.data.path)
    await fs.writeFile(validPath, parsed.data.content, 'utf-8')
    return `Successfully wrote to ${parsed.data.path}`
  }

  async listDirectory(args: unknown): Promise<string> {
    const parsed = ListDirectoryArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const validPath = await this.validatePath(parsed.data.path)
    const entries = await fs.readdir(validPath, { withFileTypes: true })
    const formatted = entries
      .map((entry) => {
        const prefix = entry.isDirectory() ? '[DIR]' : '[FILE]'
        return `${prefix} ${entry.name}`
      })
      .join('\n')
    return `Directory listing for ${parsed.data.path}:\n\n${formatted}`
  }

  async createDirectory(args: unknown): Promise<string> {
    const parsed = CreateDirectoryArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const validPath = await this.validatePath(parsed.data.path)
    await fs.mkdir(validPath, { recursive: true })
    return `Successfully created directory ${parsed.data.path}`
  }

  async moveFiles(args: unknown): Promise<string> {
    const parsed = MoveFilesArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const results = await Promise.all(
      parsed.data.sources.map(async (source) => {
        const validSourcePath = await this.validatePath(source)
        const validDestPath = await this.validatePath(
          path.join(parsed.data.destination, path.basename(source))
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

  async editText(args: unknown): Promise<string> {
    const parsed = EditTextArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const validPath = await this.validatePath(parsed.data.path)
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
      const flags = parsed.data.caseSensitive ? 'g' : 'gi'
      const regex = new RegExp(parsed.data.pattern, flags)
      modifiedContent = modifiedContent.replace(regex, parsed.data.replacement || '')
    }

    const diff = createTwoFilesPatch(validPath, validPath, content, modifiedContent)
    if (!parsed.data.dryRun) {
      await fs.writeFile(validPath, modifiedContent, 'utf-8')
    }
    return diff
  }

  async grepSearch(args: unknown): Promise<string> {
    const parsed = GrepSearchArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const validPath = await this.validatePath(parsed.data.path)
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

  async textReplace(args: unknown): Promise<string> {
    const parsed = TextReplaceArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const validPath = await this.validatePath(parsed.data.path)
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

    return result.success ? result.diff || '' : result.error || 'Text replacement failed'
  }

  async directoryTree(args: unknown): Promise<string> {
    const parsed = DirectoryTreeArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const buildTree = async (currentPath: string): Promise<TreeEntry[]> => {
      const validPath = await this.validatePath(currentPath)
      const entries = await fs.readdir(validPath, { withFileTypes: true })
      const result: TreeEntry[] = []

      for (const entry of entries) {
        const entryData: TreeEntry = {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file'
        }

        if (entry.isDirectory()) {
          const subPath = path.join(currentPath, entry.name)
          entryData.children = await buildTree(subPath)
        }

        result.push(entryData)
      }

      return result
    }

    const treeData = await buildTree(parsed.data.path)
    return JSON.stringify(treeData, null, 2)
  }

  async getFileInfo(args: unknown): Promise<string> {
    const parsed = GetFileInfoArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const validPath = await this.validatePath(parsed.data.path)
    const info = await this.getFileStats(validPath)
    return Object.entries(info)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')
  }

  async searchFiles(args: unknown): Promise<string> {
    const parsed = FileSearchArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }
    const rootPath = parsed.data.path
      ? await this.validatePath(parsed.data.path)
      : this.allowedDirectories[0]
    const results: string[] = []

    const search = async (currentPath: string) => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)
        try {
          await this.validatePath(fullPath)
          const isMatch =
            parsed.data.searchType === 'glob'
              ? minimatch(entry.name, parsed.data.pattern, {
                  dot: true,
                  nocase: !parsed.data.caseSensitive
                })
              : parsed.data.caseSensitive
                ? entry.name.includes(parsed.data.pattern)
                : entry.name.toLowerCase().includes(parsed.data.pattern.toLowerCase())
          if (isMatch) {
            results.push(fullPath)
          }
          if (entry.isDirectory()) {
            await search(fullPath)
          }
        } catch {
          continue
        }
      }
    }

    await search(rootPath)
    return results.slice(0, parsed.data.maxResults).join('\n')
  }
}
