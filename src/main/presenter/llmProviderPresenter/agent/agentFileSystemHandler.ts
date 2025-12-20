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
