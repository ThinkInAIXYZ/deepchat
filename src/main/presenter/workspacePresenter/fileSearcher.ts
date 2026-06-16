import fs from 'fs/promises'
import path from 'path'
import { ConcurrencyLimiter } from './concurrencyLimiter'
import { minimatch } from 'minimatch'
import { FffSearchService } from '@/lib/agentRuntime/fffSearchService'

export interface SearchOptions {
  maxResults?: number
  cursor?: string
  sortBy?: 'name' | 'modified'
  excludePatterns?: string[]
}

export interface SearchResult {
  files: string[]
  hasMore: boolean
  nextCursor?: string
  total?: number
}

const DEFAULT_PAGE_SIZE = 50
const DEFAULT_CACHE_LIMIT = 200
const MAX_CACHE_FILES = 500
const FFF_GLOB_PAGE_SIZE = 500
const FFF_UI_SCAN_TIMEOUT_MS = 2_500
const FILESYSTEM_FALLBACK_SCAN_TIMEOUT_MS = 2_500
const FILESYSTEM_FALLBACK_MAX_ENTRIES = 20_000
const CACHE_TTL_MS = 30_000
const MAX_CACHE_ENTRIES = 50
const MTIME_CACHE_TTL_MS = 60_000
const DEFAULT_EXCLUDES = [
  '.git',
  'node_modules',
  '.DS_Store',
  'dist',
  'build',
  'out',
  '.turbo',
  '.next',
  '.nuxt',
  '.cache',
  'coverage'
]

const statLimiter = new ConcurrencyLimiter(10)
const mtimeCache = new Map<string, { mtimeMs: number; cachedAt: number }>()
const fffFailureWarnings = new Map<string, number>()
const fffSearchService = new FffSearchService({ scanTimeoutMs: FFF_UI_SCAN_TIMEOUT_MS })

type CacheEntry = {
  files: string[]
  createdAt: number
  complete: boolean
  globPattern: string
  nextFffPageIndex: number
}

type FilesystemEntry = {
  name: string
  isDirectory(): boolean
  isSymbolicLink(): boolean
  isFile(): boolean
}

const searchCache = new Map<string, CacheEntry>()

const encodeCursor = (offset: number) => Buffer.from(String(offset)).toString('base64')

const decodeCursor = (cursor?: string) => {
  if (!cursor) return 0
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8')
    const offset = Number(decoded)
    return Number.isFinite(offset) && offset >= 0 ? offset : 0
  } catch {
    return 0
  }
}

const getCacheKey = (
  workspacePath: string,
  pattern: string,
  sortBy: SearchOptions['sortBy'],
  excludePatterns?: string[]
) => {
  const excludes = excludePatterns?.slice().sort().join(',') ?? ''
  return `${workspacePath}::${pattern}::${sortBy ?? 'name'}::${excludes}`
}

const toPosixPath = (value: string) => value.split(path.sep).join('/')

const normalizeGlobPattern = (pattern: string): string => {
  const trimmed = pattern.trim()
  if (!trimmed || trimmed === '*' || trimmed === '**' || trimmed === '**/*') {
    return '**/*'
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return trimmed.replace(/\\/g, '/')
  }
  return `**/${trimmed}`
}

const isExcluded = (workspacePath: string, filePath: string, excludePatterns?: string[]) => {
  const relativePath = toPosixPath(path.relative(workspacePath, filePath))
  const segments = relativePath.split('/')
  const patterns = [...new Set([...DEFAULT_EXCLUDES, ...(excludePatterns ?? [])])]

  return patterns.some((pattern) => {
    const normalizedPattern = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (!normalizedPattern) {
      return false
    }
    const hasGlob = /[*?[{]/.test(normalizedPattern)
    if (!hasGlob) {
      return (
        segments.includes(normalizedPattern) ||
        relativePath === normalizedPattern ||
        relativePath.startsWith(`${normalizedPattern}/`)
      )
    }

    return (
      minimatch(relativePath, normalizedPattern, { dot: true }) ||
      minimatch(relativePath, `**/${normalizedPattern}`, { dot: true }) ||
      minimatch(relativePath, `**/${normalizedPattern}/**`, { dot: true })
    )
  })
}

const getCachedEntry = (key: string) => {
  const entry = searchCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    searchCache.delete(key)
    return null
  }

  // Refresh LRU order
  searchCache.delete(key)
  searchCache.set(key, entry)

  return entry
}

const setCacheEntry = (key: string, entry: CacheEntry) => {
  searchCache.set(key, entry)
  while (searchCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = searchCache.keys().next().value
    if (!oldestKey) return
    searchCache.delete(oldestKey)
  }
}

const getMtime = async (filePath: string): Promise<number> => {
  const cached = mtimeCache.get(filePath)
  if (cached && Date.now() - cached.cachedAt <= MTIME_CACHE_TTL_MS) {
    return cached.mtimeMs
  }

  const mtimeMs = await statLimiter.run(async () => {
    try {
      const stats = await fs.stat(filePath)
      return stats.mtimeMs
    } catch {
      return 0
    }
  })

  mtimeCache.set(filePath, { mtimeMs, cachedAt: Date.now() })
  return mtimeMs
}

const sortFilesByName = (files: string[]) => files.sort((a, b) => a.localeCompare(b))

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const warnFffFailureOnce = (workspacePath: string, error: unknown): void => {
  const now = Date.now()
  for (const [key, loggedAt] of fffFailureWarnings.entries()) {
    if (now - loggedAt > CACHE_TTL_MS) {
      fffFailureWarnings.delete(key)
    }
  }

  const key = `${path.resolve(workspacePath)}::${getErrorMessage(error)}`
  if (fffFailureWarnings.has(key)) {
    return
  }

  fffFailureWarnings.set(key, now)
  console.warn(
    '[WorkspaceSearch] FFF unavailable, using filesystem fallback:',
    getErrorMessage(error)
  )
}

const sortFilesByModified = async (files: string[]) => {
  const entries = await Promise.all(
    files.map(async (file) => ({ file, mtimeMs: await getMtime(file) }))
  )

  entries.sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) {
      return b.mtimeMs - a.mtimeMs
    }
    return a.file.localeCompare(b.file)
  })

  return entries.map((entry) => entry.file)
}

const matchesGlobPattern = (
  workspacePath: string,
  filePath: string,
  globPattern: string
): boolean => {
  const relativePath = toPosixPath(path.relative(workspacePath, filePath))
  if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
    return false
  }

  return minimatch(relativePath, globPattern, {
    dot: true,
    nocase: process.platform === 'win32'
  })
}

const scanFilesystemFiles = async (
  workspacePath: string,
  globPattern: string,
  maxFiles: number,
  excludePatterns: string[] | undefined
): Promise<{ files: string[]; complete: boolean }> => {
  const files: string[] = []
  const queue = [workspacePath]
  const startedAt = Date.now()
  let queueIndex = 0
  let scannedEntries = 0
  let stoppedEarly = false

  while (queueIndex < queue.length) {
    const currentDir = queue[queueIndex++]
    let entries: FilesystemEntry[]
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      scannedEntries += 1
      if (
        scannedEntries > FILESYSTEM_FALLBACK_MAX_ENTRIES ||
        Date.now() - startedAt > FILESYSTEM_FALLBACK_SCAN_TIMEOUT_MS
      ) {
        stoppedEarly = true
        break
      }

      const filePath = path.join(currentDir, entry.name)
      if (isExcluded(workspacePath, filePath, excludePatterns)) {
        continue
      }

      if (entry.isDirectory()) {
        if (!entry.isSymbolicLink()) {
          queue.push(filePath)
        }
        continue
      }

      if (!entry.isFile() || !matchesGlobPattern(workspacePath, filePath, globPattern)) {
        continue
      }

      files.push(filePath)
      if (files.length >= maxFiles) {
        stoppedEarly = true
        break
      }
    }

    if (stoppedEarly) {
      break
    }
  }

  return {
    files,
    complete: !stoppedEarly && queueIndex >= queue.length
  }
}

const extendCacheEntryWithFilesystemFallback = async (
  entry: CacheEntry,
  workspacePath: string,
  requiredCount: number,
  excludePatterns: string[] | undefined
) => {
  const result = await scanFilesystemFiles(
    workspacePath,
    entry.globPattern,
    Math.min(requiredCount, MAX_CACHE_FILES + 1),
    excludePatterns
  )
  const seen = new Set(entry.files)

  for (const file of result.files) {
    if (seen.has(file)) {
      continue
    }
    seen.add(file)
    entry.files.push(file)
  }

  entry.complete = result.complete
}

const extendCacheEntry = async (
  entry: CacheEntry,
  workspacePath: string,
  requiredCount: number,
  excludePatterns: string[] | undefined
) => {
  const seen = new Set(entry.files)

  while (!entry.complete && entry.files.length < requiredCount) {
    const hits = await fffSearchService.globFiles(entry.globPattern, {
      workspaceRoot: workspacePath,
      maxResults: FFF_GLOB_PAGE_SIZE,
      pageIndex: entry.nextFffPageIndex
    })
    entry.nextFffPageIndex += 1
    if (hits.length < FFF_GLOB_PAGE_SIZE) {
      entry.complete = true
    }

    for (const hit of hits) {
      const normalized = path.normalize(path.join(workspacePath, hit.path))
      if (isExcluded(workspacePath, normalized, excludePatterns)) continue
      if (seen.has(normalized)) continue
      seen.add(normalized)
      entry.files.push(normalized)
    }
  }
}

const extendCacheEntryWithFallback = async (
  entry: CacheEntry,
  workspacePath: string,
  requiredCount: number,
  excludePatterns: string[] | undefined
) => {
  try {
    await extendCacheEntry(entry, workspacePath, requiredCount, excludePatterns)
  } catch (error) {
    warnFffFailureOnce(workspacePath, error)
    await extendCacheEntryWithFilesystemFallback(
      entry,
      workspacePath,
      requiredCount,
      excludePatterns
    )
  }
}

export async function searchFiles(
  workspacePath: string,
  pattern: string,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const pageSize = options.maxResults ?? DEFAULT_PAGE_SIZE
  const offset = decodeCursor(options.cursor)
  const sortBy = options.sortBy ?? 'name'
  const requiredCount = Math.min(offset + pageSize + 1, MAX_CACHE_FILES + 1)

  const cacheKey = getCacheKey(workspacePath, pattern, sortBy, options.excludePatterns)
  let cached = getCachedEntry(cacheKey)

  if (!cached) {
    const targetLimit = Math.min(Math.max(requiredCount, DEFAULT_CACHE_LIMIT), MAX_CACHE_FILES + 1)

    cached = {
      files: [],
      createdAt: Date.now(),
      complete: false,
      globPattern: normalizeGlobPattern(pattern),
      nextFffPageIndex: 0
    }
    await extendCacheEntryWithFallback(cached, workspacePath, targetLimit, options.excludePatterns)

    setCacheEntry(cacheKey, cached)
  } else if (!cached.complete && cached.files.length < requiredCount) {
    await extendCacheEntryWithFallback(
      cached,
      workspacePath,
      requiredCount,
      options.excludePatterns
    )
  }

  if (cached.files.length > MAX_CACHE_FILES) {
    cached.files = cached.files.slice(0, MAX_CACHE_FILES)
    cached.complete = false
  }

  cached.files =
    sortBy === 'modified' ? await sortFilesByModified(cached.files) : sortFilesByName(cached.files)
  cached.createdAt = Date.now()

  const files = cached.files.slice(offset, offset + pageSize)
  const hasMore = offset + pageSize < cached.files.length || !cached.complete
  const nextCursor = hasMore ? encodeCursor(offset + pageSize) : undefined

  return {
    files,
    hasMore,
    nextCursor,
    total: cached.complete ? cached.files.length : undefined
  }
}
