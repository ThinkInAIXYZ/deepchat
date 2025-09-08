import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { createTwoFilesPatch } from 'diff'
import { minimatch } from 'minimatch'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { glob } from 'glob'

// Schema definitions
const ReadFilesArgsSchema = z.object({
  paths: z
    .array(z.string())
    .min(1)
    .describe('Array of file paths to read (can be single or multiple files)')
})

const WriteFileArgsSchema = z.object({
  path: z.string(),
  content: z.string()
})

// Enhanced text search schema for grep functionality
const GrepSearchArgsSchema = z.object({
  path: z.string().describe('Directory path to search in'),
  pattern: z.string().describe('Regular expression pattern to search for'),
  filePattern: z.string().optional().describe('File name pattern to filter files (glob pattern)'),
  recursive: z.boolean().default(true).describe('Whether to search recursively in subdirectories'),
  caseSensitive: z.boolean().default(false).describe('Whether the search should be case sensitive'),
  includeLineNumbers: z
    .boolean()
    .default(true)
    .describe('Whether to include line numbers in results'),
  contextLines: z
    .number()
    .default(0)
    .describe('Number of context lines to show before and after matches'),
  maxResults: z.number().default(100).describe('Maximum number of results to return')
})

// Enhanced text replacement schema
const TextReplaceArgsSchema = z.object({
  path: z.string().describe('Path to the file to edit'),
  pattern: z.string().describe('Regular expression pattern to find'),
  replacement: z.string().describe('Text to replace matches with'),
  global: z
    .boolean()
    .default(true)
    .describe('Whether to replace all occurrences or just the first'),
  caseSensitive: z.boolean().default(false).describe('Whether the search should be case sensitive'),
  dryRun: z.boolean().default(false).describe('Preview changes using git-style diff format')
})

// Consolidated file search schema (combines search_files and glob_search)
const FileSearchArgsSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Directory to search in (optional, defaults to current directory)'),
  pattern: z
    .string()
    .describe('Search pattern - can be a glob pattern (e.g., "**/*.ts") or simple text match'),
  searchType: z
    .enum(['glob', 'name'])
    .default('glob')
    .describe('Type of search: "glob" for glob patterns, "name" for filename matching'),
  excludePatterns: z
    .array(z.string())
    .optional()
    .default([])
    .describe('Array of patterns to exclude'),
  caseSensitive: z.boolean().default(false).describe('Whether the search should be case-sensitive'),
  respectGitIgnore: z.boolean().default(true).describe('Whether to respect .gitignore patterns'),
  sortByModified: z
    .boolean()
    .default(true)
    .describe('Sort results by modification time (newest first)'),
  maxResults: z.number().default(1000).describe('Maximum number of results to return')
})

// Consolidated move files schema (combines move_file and move_multiple_files)
const MoveFilesArgsSchema = z.object({
  sources: z.array(z.string()).min(1).describe('Array of source file/directory paths to move'),
  destination: z.string().describe('Destination directory or file path')
})

// Consolidated text editing schema (combines edit_file and text_replace)
const EditTextArgsSchema = z.object({
  path: z.string().describe('Path to the file to edit'),
  operation: z.enum(['replace_pattern', 'edit_lines']).describe('Type of edit operation'),
  // For pattern replacement
  pattern: z
    .string()
    .optional()
    .describe('Regular expression pattern to find (for replace_pattern operation)'),
  replacement: z
    .string()
    .optional()
    .describe('Text to replace matches with (for replace_pattern operation)'),
  global: z
    .boolean()
    .default(true)
    .describe('Whether to replace all occurrences (for replace_pattern operation)'),
  caseSensitive: z
    .boolean()
    .default(false)
    .describe('Whether the search should be case sensitive (for replace_pattern operation)'),
  // For line-based editing
  edits: z
    .array(
      z.object({
        oldText: z.string().describe('Text to search for - must match exactly'),
        newText: z.string().describe('Text to replace with')
      })
    )
    .optional()
    .describe('Array of line-based edits (for edit_lines operation)'),
  dryRun: z.boolean().default(false).describe('Preview changes using git-style diff format')
})

const CreateDirectoryArgsSchema = z.object({
  path: z.string()
})

const ListDirectoryArgsSchema = z.object({
  path: z.string().describe('Directory path to list'),
  showDetails: z
    .boolean()
    .default(false)
    .describe('Show detailed file information (size, modified time, permissions)'),
  sortBy: z
    .enum(['name', 'size', 'modified'])
    .default('name')
    .describe('Sort criteria for results'),
  ignorePatterns: z
    .array(z.string())
    .optional()
    .describe('Array of glob patterns to ignore (e.g., ["*.tmp", "node_modules"])'),
  respectGitIgnore: z.boolean().default(false).describe('Whether to respect .gitignore patterns')
})

const DirectoryTreeArgsSchema = z.object({
  path: z.string()
})

const GetFileInfoArgsSchema = z.object({
  path: z.string()
})

interface FileInfo {
  size: number
  created: Date
  modified: Date
  accessed: Date
  isDirectory: boolean
  isFile: boolean
  permissions: string
}

interface TreeEntry {
  name: string
  type: 'file' | 'directory'
  children?: TreeEntry[]
}

// New interfaces for enhanced text functionality
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

// Enhanced file entry interface for detailed directory listing
interface EnhancedFileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedTime: Date
  permissions: string
}

// Glob search result interface
interface GlobSearchResult {
  files: string[]
  totalCount: number
  gitIgnoredCount?: number
}

export class FileSystemServer {
  private server: Server
  private allowedDirectories: string[]

  constructor(allowedDirectories: string[]) {
    if (allowedDirectories.length === 0) {
      throw new Error('At least one allowed directory must be provided')
    }

    // 将目录路径标准化
    this.allowedDirectories = allowedDirectories.map((dir) =>
      this.normalizePath(path.resolve(this.expandHome(dir)))
    )

    // 创建服务器实例
    this.server = new Server(
      {
        name: 'secure-filesystem-server',
        version: '0.3.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    // 设置请求处理器
    this.setupRequestHandlers()
  }

  // 初始化方法，验证所有目录是否存在且可访问
  public async initialize(): Promise<void> {
    await Promise.all(
      this.allowedDirectories.map(async (dir) => {
        try {
          const stats = await fs.stat(dir)
          if (!stats.isDirectory()) {
            throw new Error(`Error: ${dir} is not a directory`)
          }
        } catch (error) {
          throw new Error(`Error accessing directory ${dir}: ${error}`)
        }
      })
    )
  }

  // 启动服务器
  public startServer(transport: Transport): void {
    this.server.connect(transport)
  }

  // 辅助方法：标准化路径
  private normalizePath(p: string): string {
    return path.normalize(p)
  }

  // 辅助方法：扩展主目录路径
  private expandHome(filepath: string): string {
    if (filepath.startsWith('~/') || filepath === '~') {
      return path.join(os.homedir(), filepath.slice(1))
    }
    return filepath
  }

  // 安全验证：验证路径是否在允许的目录范围内
  private async validatePath(requestedPath: string): Promise<string> {
    const expandedPath = this.expandHome(requestedPath)
    const absolute = path.isAbsolute(expandedPath)
      ? path.resolve(expandedPath)
      : path.resolve(process.cwd(), expandedPath)

    const normalizedRequested = this.normalizePath(absolute)

    // Check if path is within allowed directories
    const isAllowed = this.allowedDirectories.some((dir) => normalizedRequested.startsWith(dir))
    if (!isAllowed) {
      throw new Error(
        `Access denied - path outside allowed directories: ${absolute} not in ${this.allowedDirectories.join(', ')}`
      )
    }

    // Handle symlinks by checking their real path
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
      // For new files that don't exist yet, verify parent directory
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

  // 获取文件统计信息
  private async getFileStats(filePath: string): Promise<FileInfo> {
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

  // 文件搜索功能
  private async searchFiles(
    rootPath: string,
    pattern: string,
    excludePatterns: string[] = []
  ): Promise<string[]> {
    const results: string[] = []

    const search = async (currentPath: string) => {
      let entries
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true })
      } catch (error) {
        console.error(`[searchFiles] Error reading directory ${currentPath}:`, error)
        return // Skip this directory if unreadable
      }

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)

        try {
          // 验证每个路径是否合法
          await this.validatePath(fullPath)

          // 检查路径是否匹配排除模式
          const relativePath = path.relative(rootPath, fullPath)
          const shouldExclude = excludePatterns.some((excludePattern) => {
            // 修正: 使用更适合文件和目录的 glob 模式
            const globPattern = excludePattern.includes('/')
              ? excludePattern
              : `**/${excludePattern}`
            const isMatch = minimatch(relativePath, globPattern, { dot: true, matchBase: true })
            return isMatch
          })

          if (shouldExclude) {
            continue
          }

          // 修改匹配逻辑: 检查文件名是否 *包含* 模式（不区分大小写）
          // 或者，如果模式包含通配符，则使用 minimatch 进行匹配
          let isPatternMatch = false
          const lowerCaseEntryName = entry.name.toLowerCase()
          const lowerCasePattern = pattern.toLowerCase()

          if (pattern.includes('*') || pattern.includes('?')) {
            // 使用 minimatch 进行通配符匹配
            isPatternMatch = minimatch(entry.name, pattern, { dot: true, nocase: true })
          } else {
            // 否则，执行包含检查（不区分大小写）
            isPatternMatch = lowerCaseEntryName.includes(lowerCasePattern)
          }

          if (isPatternMatch) {
            results.push(fullPath)
          }

          if (entry.isDirectory()) {
            await search(fullPath)
          }
        } catch (error) {
          // 搜索过程中跳过无效路径
          console.error(`[searchFiles] Error processing path ${fullPath}:`, error)
          continue
        }
      }
    }

    try {
      await search(rootPath)
    } catch (error) {
      console.error(`[searchFiles] Error during search execution starting from ${rootPath}:`, error)
    }
    return results
  }

  // Enhanced text content search functionality (grep-like)
  private async grepSearch(
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

    // Create regex pattern with appropriate flags
    const regexFlags = caseSensitive ? 'g' : 'gi'
    let regex: RegExp
    try {
      regex = new RegExp(pattern, regexFlags)
    } catch (error) {
      throw new Error(`Invalid regular expression pattern: ${pattern}. Error: ${error}`)
    }

    // Helper function to search within a single file
    const searchInFile = async (filePath: string): Promise<void> => {
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        const lines = content.split('\n')
        const fileMatches: GrepMatch[] = []

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const matches = Array.from(line.matchAll(regex))

          if (matches.length > 0) {
            const match: GrepMatch = {
              file: filePath,
              line: includeLineNumbers ? i + 1 : 0,
              content: line
            }

            // Add context lines if requested
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

            // Stop if we've reached the maximum results
            if (result.totalMatches >= maxResults) {
              break
            }
          }
        }

        if (fileMatches.length > 0) {
          result.files.push(filePath)
          result.matches.push(...fileMatches)
        }
      } catch (error) {
        // Skip files that can't be read (binary files, permission issues, etc.)
        console.error(`[grepSearch] Error reading file ${filePath}:`, error)
      }
    }

    // Recursive directory traversal
    const searchDirectory = async (currentPath: string): Promise<void> => {
      if (result.totalMatches >= maxResults) {
        return
      }

      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true })

        for (const entry of entries) {
          if (result.totalMatches >= maxResults) {
            break
          }

          const fullPath = path.join(currentPath, entry.name)

          try {
            // Validate path is within allowed directories
            await this.validatePath(fullPath)

            if (entry.isFile()) {
              // Check if file matches the file pattern
              if (minimatch(entry.name, filePattern, { nocase: true })) {
                await searchInFile(fullPath)
              }
            } else if (entry.isDirectory() && recursive) {
              await searchDirectory(fullPath)
            }
          } catch (error) {
            // Skip invalid paths
            console.error(`[grepSearch] Error processing path ${fullPath}:`, error)
            continue
          }
        }
      } catch (error) {
        console.error(`[grepSearch] Error reading directory ${currentPath}:`, error)
      }
    }

    // Start the search
    const validatedPath = await this.validatePath(rootPath)
    const stats = await fs.stat(validatedPath)

    if (stats.isFile()) {
      // Search in a single file
      if (minimatch(path.basename(validatedPath), filePattern, { nocase: true })) {
        await searchInFile(validatedPath)
      }
    } else if (stats.isDirectory()) {
      // Search in directory
      await searchDirectory(validatedPath)
    }

    return result
  }

  // Enhanced text replacement functionality
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

      // Create regex pattern with appropriate flags
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

      // Perform the replacement
      const modifiedContent = normalizedOriginal.replace(regex, replacement)
      const matches = Array.from(normalizedOriginal.matchAll(new RegExp(pattern, regexFlags + 'g')))
      const replacements = matches.length

      if (replacements === 0) {
        return {
          success: true,
          replacements: 0,
          diff: 'No matches found for the given pattern.'
        }
      }

      // Create diff
      const diff = this.createUnifiedDiff(normalizedOriginal, modifiedContent, filePath)

      // Write file if not dry run
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

  // 文件编辑和差异显示功能
  private normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n')
  }

  private createUnifiedDiff(
    originalContent: string,
    newContent: string,
    filepath: string = 'file'
  ): string {
    // 确保行尾一致性
    const normalizedOriginal = this.normalizeLineEndings(originalContent)
    const normalizedNew = this.normalizeLineEndings(newContent)

    return createTwoFilesPatch(
      filepath,
      filepath,
      normalizedOriginal,
      normalizedNew,
      'original',
      'modified'
    )
  }

  private async applyFileEdits(
    filePath: string,
    edits: Array<{ oldText: string; newText: string }>,
    dryRun = false
  ): Promise<string> {
    // 读取文件内容并标准化行尾
    const content = this.normalizeLineEndings(await fs.readFile(filePath, 'utf-8'))

    // 按顺序应用编辑
    let modifiedContent = content
    for (const edit of edits) {
      const normalizedOld = this.normalizeLineEndings(edit.oldText)
      const normalizedNew = this.normalizeLineEndings(edit.newText)

      // 如果存在精确匹配，使用它
      if (modifiedContent.includes(normalizedOld)) {
        modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew)
        continue
      }

      // 否则，逐行匹配，对空白字符具有灵活性
      const oldLines = normalizedOld.split('\n')
      const contentLines = modifiedContent.split('\n')
      let matchFound = false

      for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
        const potentialMatch = contentLines.slice(i, i + oldLines.length)

        // 比较标准化后空白字符的行
        const isMatch = oldLines.every((oldLine, j) => {
          const contentLine = potentialMatch[j]
          return oldLine.trim() === contentLine.trim()
        })

        if (isMatch) {
          // 保留第一行的原始缩进
          const originalIndent = contentLines[i].match(/^\s*/)?.[0] || ''
          const newLines = normalizedNew.split('\n').map((line, j) => {
            if (j === 0) return originalIndent + line.trimStart()
            // 对后续行，尝试保留相对缩进
            const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || ''
            const newIndent = line.match(/^\s*/)?.[0] || ''
            if (oldIndent && newIndent) {
              const relativeIndent = newIndent.length - oldIndent.length
              return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart()
            }
            return line
          })

          contentLines.splice(i, oldLines.length, ...newLines)
          modifiedContent = contentLines.join('\n')
          matchFound = true
          break
        }
      }

      if (!matchFound) {
        throw new Error(`Cannot find exact matching content to edit:\n${edit.oldText}`)
      }
    }

    // 创建统一差异
    const diff = this.createUnifiedDiff(content, modifiedContent, filePath)

    // 格式化差异，使用适当数量的反引号
    let numBackticks = 3
    while (diff.includes('`'.repeat(numBackticks))) {
      numBackticks++
    }
    const formattedDiff = `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`

    if (!dryRun) {
      await fs.writeFile(filePath, modifiedContent, 'utf-8')
    }

    return formattedDiff
  }

  // 设置请求处理器
  private setupRequestHandlers(): void {
    // 设置工具列表处理器
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'read_files',
            description:
              'Read the complete contents of multiple files simultaneously. This is more ' +
              'efficient than reading files one by one when you need to analyze ' +
              "or compare multiple files. Each file's content is returned with its " +
              "path as a reference. Failed reads for individual files won't stop " +
              'the entire operation. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(ReadFilesArgsSchema)
          },
          {
            name: 'write_file',
            description:
              'Create a new file or completely overwrite an existing file with new content. ' +
              'Use with caution as it will overwrite existing files without warning. ' +
              'Handles text content with proper encoding. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(WriteFileArgsSchema)
          },
          {
            name: 'edit_text',
            description:
              'Edit text files using two methods: 1) Pattern replacement with regex support for bulk find-and-replace operations, or 2) Line-based editing for precise text modifications. ' +
              'Supports dry-run mode to preview changes. Returns git-style diff showing modifications. ' +
              'Perfect for code refactoring, configuration updates, or bulk text replacements. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(EditTextArgsSchema)
          },
          {
            name: 'create_directory',
            description:
              'Create a new directory or ensure a directory exists. Can create multiple ' +
              'nested directories in one operation. If the directory already exists, ' +
              'this operation will succeed silently. Perfect for setting up directory ' +
              'structures for projects or ensuring required paths exist. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema)
          },
          {
            name: 'list_directory',
            description:
              'Get a detailed listing of all files and directories in a specified path. ' +
              'Results clearly distinguish between files and directories with [FILE] and [DIR] ' +
              'prefixes. Supports detailed information display (size, modification time, permissions), ' +
              'custom sorting (by name, size, or modification time), ignore patterns, and git-aware filtering. ' +
              'This tool is essential for understanding directory structure and finding specific files. ' +
              'Only works within allowed directories.',
            inputSchema: zodToJsonSchema(ListDirectoryArgsSchema)
          },
          {
            name: 'directory_tree',
            description:
              'Get a recursive tree view of files and directories as a JSON structure. ' +
              "Each entry includes 'name', 'type' (file/directory), and 'children' for directories. " +
              'Files have no children array, while directories always have a children array (which may be empty). ' +
              'The output is formatted with 2-space indentation for readability. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema)
          },
          {
            name: 'move_files',
            description:
              'Move or rename one or more files and directories in a single operation. ' +
              'Can move files between directories and rename them simultaneously. ' +
              'If any destination exists, that specific operation will fail but others will continue. ' +
              'Supports both single file moves and batch operations. Both sources and destination must be within allowed directories.',
            inputSchema: zodToJsonSchema(MoveFilesArgsSchema)
          },
          {
            name: 'get_file_info',
            description:
              'Retrieve detailed metadata about a file or directory. Returns comprehensive ' +
              'information including size, creation time, last modified time, permissions, ' +
              'and type. This tool is perfect for understanding file characteristics ' +
              'without reading the actual content. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(GetFileInfoArgsSchema)
          },
          {
            name: 'list_allowed_directories',
            description:
              'Returns the list of directories that this server is allowed to access. ' +
              'Use this to understand which directories are available before trying to access files.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'grep_search',
            description:
              'Search for text patterns within file contents using regular expressions. ' +
              'Similar to the Unix grep command, this tool searches through files recursively ' +
              'and returns matching lines with optional context. Supports file filtering, ' +
              'case sensitivity options, and result limiting. Perfect for finding specific ' +
              'code patterns, function definitions, or text content across multiple files. ' +
              'Only searches within allowed directories.',
            inputSchema: zodToJsonSchema(GrepSearchArgsSchema)
          },
          {
            name: 'text_replace',
            description:
              'Replace text patterns in files using regular expressions. This tool provides ' +
              'powerful find-and-replace functionality with regex support, case sensitivity ' +
              'options, and dry-run mode for previewing changes. Shows a git-style diff ' +
              'of the changes made. Use this for bulk text replacements, code refactoring, ' +
              'or updating configuration files. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(TextReplaceArgsSchema)
          },
          {
            name: 'file_search',
            description:
              'Search for files and directories matching a pattern. This tool searches through files and directories ' +
              "recursively and returns full paths to all matching items. Great for finding files when you don't know their exact location.",
            inputSchema: zodToJsonSchema(FileSearchArgsSchema)
          }
        ]
      }
    })

    // 设置工具调用处理器
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params

        switch (name) {
          case 'read_files': {
            const parsed = ReadFilesArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for read_files: ${parsed.error}`)
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
            return {
              content: [{ type: 'text', text: results.join('\n---\n') }]
            }
          }

          case 'write_file': {
            const parsed = WriteFileArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for write_file: ${parsed.error}`)
            }
            const validPath = await this.validatePath(parsed.data.path)
            await fs.writeFile(validPath, parsed.data.content, 'utf-8')
            return {
              content: [{ type: 'text', text: `Successfully wrote to ${parsed.data.path}` }]
            }
          }

          case 'edit_text': {
            const parsed = EditTextArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for edit_text: ${parsed.error}`)
            }
            const validPath = await this.validatePath(parsed.data.path)

            if (parsed.data.operation === 'edit_lines') {
              // Line-based editing
              if (!parsed.data.edits || parsed.data.edits.length === 0) {
                throw new Error('edits array is required for edit_lines operation')
              }
              const result = await this.applyFileEdits(
                validPath,
                parsed.data.edits,
                parsed.data.dryRun
              )
              return {
                content: [{ type: 'text', text: result }]
              }
            } else if (parsed.data.operation === 'replace_pattern') {
              // Pattern replacement
              if (!parsed.data.pattern || parsed.data.replacement === undefined) {
                throw new Error(
                  'pattern and replacement are required for replace_pattern operation'
                )
              }
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
              return {
                content: [{ type: 'text', text: result.success ? result.diff : result.error }],
                isError: !result.success
              }
            } else {
              throw new Error(`Unknown operation: ${parsed.data.operation}`)
            }
          }

          case 'create_directory': {
            const parsed = CreateDirectoryArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for create_directory: ${parsed.error}`)
            }
            const validPath = await this.validatePath(parsed.data.path)
            await fs.mkdir(validPath, { recursive: true })
            return {
              content: [
                { type: 'text', text: `Successfully created directory ${parsed.data.path}` }
              ]
            }
          }

          case 'list_directory': {
            const parsed = ListDirectoryArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for list_directory: ${parsed.error}`)
            }

            const entries = await this.enhancedListDirectory(parsed.data.path, {
              ignorePatterns: parsed.data.ignorePatterns,
              respectGitIgnore: parsed.data.respectGitIgnore,
              showDetails: parsed.data.showDetails,
              sortBy: parsed.data.sortBy
            })

            if (entries.length === 0) {
              return {
                content: [{ type: 'text', text: 'Directory is empty or all files are ignored' }]
              }
            }

            const formatted = entries
              .map((entry) => {
                const prefix = entry.isDirectory ? '[DIR]' : '[FILE]'
                let result = `${prefix} ${entry.name}`

                if (parsed.data.showDetails && !entry.isDirectory) {
                  const sizeKB = (entry.size / 1024).toFixed(1)
                  const modifiedDate = entry.modifiedTime.toLocaleDateString()
                  const modifiedTime = entry.modifiedTime.toLocaleTimeString()
                  result += ` (${sizeKB}KB, ${entry.permissions}, ${modifiedDate} ${modifiedTime})`
                } else if (parsed.data.showDetails && entry.isDirectory) {
                  result += ` (${entry.permissions})`
                }

                return result
              })
              .join('\n')

            const summary = `Directory listing for ${parsed.data.path} (${entries.length} items):\n\n${formatted}`
            return {
              content: [{ type: 'text', text: summary }]
            }
          }

          case 'directory_tree': {
            const parsed = DirectoryTreeArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for directory_tree: ${parsed.error}`)
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
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(treeData, null, 2)
                }
              ]
            }
          }

          case 'move_files': {
            const parsed = MoveFilesArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for move_files: ${parsed.error}`)
            }
            const destInfo = await this.getFileStats(parsed.data.destination)
            const results = await Promise.all(
              parsed.data.sources.map(async (source) => {
                const validSourcePath = await this.validatePath(source)
                let validDestPath = ''
                if (destInfo.isFile) {
                  validDestPath = await this.validatePath(parsed.data.destination)
                } else {
                  validDestPath = await this.validatePath(
                    path.join(parsed.data.destination, path.basename(source))
                  )
                }
                try {
                  await fs.rename(validSourcePath, validDestPath)
                  return `Successfully moved ${source} to ${parsed.data.destination}`
                } catch (e) {
                  return `Move ${source} to ${parsed.data.destination} failed: ${JSON.stringify(e)}`
                }
              })
            )
            return {
              content: [
                {
                  type: 'text',
                  text: results.join('\n')
                }
              ]
            }
          }

          case 'get_file_info': {
            const parsed = GetFileInfoArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for get_file_info: ${parsed.error}`)
            }
            const validPath = await this.validatePath(parsed.data.path)
            const info = await this.getFileStats(validPath)
            return {
              content: [
                {
                  type: 'text',
                  text: Object.entries(info)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n')
                }
              ]
            }
          }

          case 'list_allowed_directories': {
            return {
              content: [
                {
                  type: 'text',
                  text: `Allowed directories:\n${this.allowedDirectories.join('\n')}`
                }
              ]
            }
          }

          case 'grep_search': {
            const parsed = GrepSearchArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for grep_search: ${parsed.error}`)
            }
            const validPath = await this.validatePath(parsed.data.path)
            const result = await this.grepSearch(validPath, parsed.data.pattern, {
              filePattern: parsed.data.filePattern,
              recursive: parsed.data.recursive,
              caseSensitive: parsed.data.caseSensitive,
              includeLineNumbers: parsed.data.includeLineNumbers,
              contextLines: parsed.data.contextLines,
              maxResults: parsed.data.maxResults
            })

            if (result.totalMatches === 0) {
              return {
                content: [{ type: 'text', text: 'No matches found' }]
              }
            }

            // Format the results
            const formattedResults = result.matches
              .map((match) => {
                let output = `${match.file}:${match.line}: ${match.content}`

                if (match.beforeContext && match.beforeContext.length > 0) {
                  const beforeLines = match.beforeContext
                    .map(
                      (line, i) =>
                        `${match.file}:${match.line - match.beforeContext!.length + i}: ${line}`
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

            const summary = `Found ${result.totalMatches} matches in ${result.files.length} files:\n\n${formattedResults}`

            return {
              content: [{ type: 'text', text: summary }]
            }
          }

          case 'file_search': {
            const parsed = FileSearchArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for file_search: ${parsed.error}`)
            }
            const validPath = await this.validatePath(parsed.data.path || '.')

            let results: string[]
            if (parsed.data.searchType === 'glob') {
              // Use glob search for glob patterns
              const globResult = await this.globSearch(parsed.data.pattern, validPath, {
                caseSensitive: parsed.data.caseSensitive,
                respectGitIgnore: parsed.data.respectGitIgnore,
                sortByModified: parsed.data.sortByModified,
                maxResults: parsed.data.maxResults
              })
              results = globResult.files
            } else {
              // Use name search for simple text matching
              results = await this.searchFiles(
                validPath,
                parsed.data.pattern,
                parsed.data.excludePatterns
              )
            }

            return {
              content: [
                { type: 'text', text: results.length > 0 ? results.join('\n') : 'No matches found' }
              ]
            }
          }

          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text', text: `Error: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }

  // Enhanced glob search functionality inspired by Google Gemini CLI
  private async globSearch(
    pattern: string,
    searchPath: string = '.',
    options: {
      caseSensitive?: boolean
      respectGitIgnore?: boolean
      sortByModified?: boolean
      maxResults?: number
    } = {}
  ): Promise<GlobSearchResult> {
    const {
      caseSensitive = false,
      respectGitIgnore = true,
      sortByModified = true,
      maxResults = 1000
    } = options

    const validatedPath = await this.validatePath(searchPath)

    try {
      // Use the glob library for proper glob pattern matching
      const globResults = await glob(pattern, {
        cwd: validatedPath,
        nodir: false, // Include directories
        dot: true, // Include hidden files
        nocase: !caseSensitive,
        ignore: respectGitIgnore ? ['**/node_modules/**', '**/.git/**'] : ['**/node_modules/**'],
        absolute: true,
        maxDepth: 20, // Reasonable depth limit
        follow: false // Don't follow symlinks for security
      })

      // Limit results
      const limitedResults = globResults.slice(0, maxResults)

      // Validate all paths are within allowed directories
      const validResults: string[] = []
      for (const result of limitedResults) {
        try {
          await this.validatePath(result)
          validResults.push(result)
        } catch (error) {
          // Skip paths outside allowed directories
          console.error(`[globSearch] Path validation failed for ${result}:`, error)
          continue
        }
      }

      // Sort results if requested
      if (sortByModified && validResults.length > 0) {
        const fileStats = await Promise.all(
          validResults.map(async (filePath) => {
            try {
              const stats = await fs.stat(filePath)
              return { path: filePath, mtime: stats.mtime.getTime() }
            } catch {
              return { path: filePath, mtime: 0 }
            }
          })
        )

        fileStats.sort((a, b) => b.mtime - a.mtime)
        return {
          files: fileStats.map((f) => f.path),
          totalCount: fileStats.length
        }
      }

      return {
        files: validResults,
        totalCount: validResults.length
      }
    } catch (error) {
      console.error(`[globSearch] Error during glob search:`, error)
      throw new Error(
        `Glob search failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // Enhanced directory listing functionality
  private async enhancedListDirectory(
    dirPath: string,
    options: {
      ignorePatterns?: string[]
      respectGitIgnore?: boolean
      showDetails?: boolean
      sortBy?: 'name' | 'size' | 'modified'
    } = {}
  ): Promise<EnhancedFileEntry[]> {
    const {
      ignorePatterns = [],
      respectGitIgnore: _respectGitIgnore = false,
      showDetails: _showDetails = false,
      sortBy = 'name'
    } = options

    const validatedPath = await this.validatePath(dirPath)
    const entries = await fs.readdir(validatedPath, { withFileTypes: true })
    const results: EnhancedFileEntry[] = []

    // Helper function to check if filename matches ignore patterns
    const shouldIgnore = (filename: string): boolean => {
      return ignorePatterns.some((pattern) => {
        const regexPattern = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
        const regex = new RegExp(`^${regexPattern}$`)
        return regex.test(filename)
      })
    }

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) {
        continue
      }

      const fullPath = path.join(validatedPath, entry.name)

      try {
        const stats = await fs.stat(fullPath)
        const enhancedEntry: EnhancedFileEntry = {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? 0 : stats.size,
          modifiedTime: stats.mtime,
          permissions: stats.mode.toString(8).slice(-3)
        }

        results.push(enhancedEntry)
      } catch (error) {
        console.error(`[enhancedListDirectory] Error getting stats for ${fullPath}:`, error)
        continue
      }
    }

    // Sort results
    results.sort((a, b) => {
      // Directories first
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1

      // Then by requested sort criteria
      switch (sortBy) {
        case 'size':
          return b.size - a.size
        case 'modified':
          return b.modifiedTime.getTime() - a.modifiedTime.getTime()
        default:
          return a.name.localeCompare(b.name)
      }
    })

    return results
  }
}

// 使用示例
// const server = new FileSystemServer(['/path/to/allowed/directory'])
// await server.initialize()
// server.startServer()
