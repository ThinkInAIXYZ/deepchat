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
const fffSearchService = new FffSearchService()

type CacheEntry = {
  files: string[]
  createdAt: number
  complete: boolean
  globPattern: string
  nextFffPageIndex: number
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
    try {
      await extendCacheEntry(cached, workspacePath, targetLimit, options.excludePatterns)
    } catch (error) {
      console.warn('[WorkspaceSearch] FFF search failed:', error)
      cached.complete = true
    }

    setCacheEntry(cacheKey, cached)
  } else if (!cached.complete && cached.files.length < requiredCount) {
    try {
      await extendCacheEntry(cached, workspacePath, requiredCount, options.excludePatterns)
    } catch (error) {
      console.warn('[WorkspaceSearch] FFF search failed:', error)
      cached.complete = true
    }
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
