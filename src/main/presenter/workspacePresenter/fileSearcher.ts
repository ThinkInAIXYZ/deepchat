import fs from 'fs/promises'
import path from 'path'
import { ConcurrencyLimiter } from './concurrencyLimiter'
import { RipgrepSearcher } from './ripgrepSearcher'

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
const CACHE_TTL_MS = 30_000
const MAX_CACHE_ENTRIES = 50
const MTIME_CACHE_TTL_MS = 60_000

const statLimiter = new ConcurrencyLimiter(10)
const mtimeCache = new Map<string, { mtimeMs: number; cachedAt: number }>()

type CacheEntry = {
  files: string[]
  createdAt: number
  complete: boolean
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

export async function searchFiles(
  workspacePath: string,
  pattern: string,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const pageSize = options.maxResults ?? DEFAULT_PAGE_SIZE
  const offset = decodeCursor(options.cursor)
  const sortBy = options.sortBy ?? 'name'

  const cacheKey = getCacheKey(workspacePath, pattern, sortBy, options.excludePatterns)
  let cached = getCachedEntry(cacheKey)

  if (!cached) {
    const targetLimit = Math.min(
      Math.max(offset + pageSize + 1, DEFAULT_CACHE_LIMIT),
      MAX_CACHE_FILES
    )
    const maxResults = Math.min(targetLimit + 1, MAX_CACHE_FILES + 1)

    const seen = new Set<string>()
    const files: string[] = []

    try {
      for await (const filePath of RipgrepSearcher.files(pattern, workspacePath, {
        maxResults,
        excludePatterns: options.excludePatterns
      })) {
        const normalized = path.normalize(filePath)
        if (seen.has(normalized)) continue
        seen.add(normalized)
        files.push(normalized)
      }
    } catch (error) {
      console.warn('[WorkspaceSearch] Ripgrep search failed:', error)
    }

    const complete = files.length <= targetLimit
    const trimmedFiles = complete ? files : files.slice(0, targetLimit)

    const sortedFiles =
      sortBy === 'modified'
        ? await sortFilesByModified(trimmedFiles)
        : sortFilesByName(trimmedFiles)

    cached = {
      files: sortedFiles,
      createdAt: Date.now(),
      complete
    }

    setCacheEntry(cacheKey, cached)
  }

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
