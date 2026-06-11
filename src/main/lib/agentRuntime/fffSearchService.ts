import path from 'path'
import { existsSync } from 'node:fs'
import { readFile } from 'fs/promises'
import { pathToFileURL } from 'url'
import type { FileFinderApi, FileItem, GrepMatch, GrepMode, Result, Score } from '@ff-labs/fff-node'

export type FffFileSearchHit = {
  path: string
  score: number
}

export type FffGrepHit = {
  path: string
  lineNumber: number
  snippet: string
  score: number
}

export type FffFindFilesOptions = {
  workspaceRoot: string
  pathScope?: string[]
  maxResults?: number
  currentFile?: string
  signal?: AbortSignal
}

export type FffGlobFilesOptions = {
  workspaceRoot: string
  maxResults?: number
  pageIndex?: number
  currentFile?: string
  signal?: AbortSignal
}

export type FffGrepOptions = {
  workspaceRoot: string
  pathScope?: string[]
  contextLines?: number
  maxResults?: number
  mode?: GrepMode
  signal?: AbortSignal
}

export type FffSearchSource = 'fff'

export type FffSearchMetadata = {
  source: FffSearchSource
  elapsedMs: number
  resultCount: number
}

type FffModule = typeof import('@ff-labs/fff-node')

type FinderHandle = {
  root: string
  finder: FileFinderApi
  lastUsedAt: number
}

type FffSearchServiceOptions = {
  moduleLoader?: () => Promise<FffModule>
  scanTimeoutMs?: number
  maxCachedFinders?: number
  now?: () => number
}

export class FffSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FffSearchUnavailableError'
  }
}

const DEFAULT_SCAN_TIMEOUT_MS = 10_000
const DEFAULT_MAX_CACHED_FINDERS = 4
const DEFAULT_FIND_LIMIT = 50
const DEFAULT_GREP_LIMIT = 100
const MAX_FIND_LIMIT = 200
const MAX_GREP_LIMIT = 200
const MAX_GLOB_LIMIT = 1000
const MAX_CONTEXT_LINES = 5
const PACKAGED_FFF_NODE_ENTRY = path.join(
  'app.asar.unpacked',
  'node_modules',
  '@ff-labs',
  'fff-node',
  'dist',
  'src',
  'index.js'
)
const GLOB_PATTERN = /[*?[{]/
const WHITESPACE_PATTERN = /\s/
const REGEX_INTENT_PATTERN = /(^|[^\\])(?:\||\(\?|\[[^\]]+\]|\.\*|\.\+|\\[bBdDsSwW]|\^|\$)/

const getProcessResourcesPath = (): string | undefined => {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return typeof resourcesPath === 'string' ? resourcesPath : undefined
}

const resolvePackagedFffNodeEntry = (
  resourcesPath: string | undefined = getProcessResourcesPath()
): string | null => {
  if (!resourcesPath) {
    return null
  }

  const candidate = path.join(resourcesPath, PACKAGED_FFF_NODE_ENTRY)
  return existsSync(candidate) ? candidate : null
}

const loadFffModule = async (): Promise<FffModule> => {
  const packagedEntry = resolvePackagedFffNodeEntry()
  if (packagedEntry) {
    return (await import(pathToFileURL(packagedEntry).href)) as FffModule
  }

  return import('@ff-labs/fff-node')
}

const clampInt = (value: number | undefined, fallback: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(Math.max(Math.floor(value), 1), max)
}

const clampContextLines = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  return Math.min(Math.max(Math.floor(value), 0), MAX_CONTEXT_LINES)
}

const toPosixPath = (value: string): string => value.replace(/\\/g, '/')

const normalizeRoot = (workspaceRoot: string): string => path.resolve(workspaceRoot)

const normalizeQuery = (query: string): string => query.trim()

const hasWhitespace = (value: string): boolean => WHITESPACE_PATTERN.test(value)

const resolveGrepMode = (query: string, mode?: GrepMode): GrepMode => {
  if (mode) {
    return mode
  }
  return REGEX_INTENT_PATTERN.test(query) ? 'regex' : 'plain'
}

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) {
    return
  }
  throw createAbortError()
}

export function normalizeFffPathConstraint(
  pathConstraint: string,
  workspaceRoot: string
): string | null {
  let trimmed = pathConstraint.trim()
  if (!trimmed) return null

  if (path.isAbsolute(trimmed)) {
    const relative = toPosixPath(path.relative(workspaceRoot, trimmed))
    if (relative === '') return null
    if (relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) {
      throw new FffSearchUnavailableError(
        `Path constraint must be inside the workspace: ${pathConstraint}`
      )
    }
    trimmed = relative
  }

  if (trimmed === '.' || trimmed === './') return null
  if (trimmed.startsWith('./')) trimmed = trimmed.slice(2)
  trimmed = toPosixPath(trimmed)

  if (hasWhitespace(trimmed)) {
    throw new FffSearchUnavailableError(
      `Path constraint contains whitespace and cannot be safely passed to FFF: ${pathConstraint}`
    )
  }

  const recursiveDir = trimmed.match(/^(.*)\/\*\*(?:\/\*)?$/)
  if (recursiveDir) {
    const dir = recursiveDir[1]
    if (dir && !GLOB_PATTERN.test(dir)) return `${dir}/`
  }
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) return trimmed
  if (GLOB_PATTERN.test(trimmed)) return trimmed

  return trimmed
}

function buildFffQueries(
  query: string,
  pathScope: string[] | undefined,
  workspaceRoot: string
): string[] {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) {
    throw new Error('Search query is required')
  }

  const constraints = (pathScope ?? [])
    .map((scope) => normalizeFffPathConstraint(scope, workspaceRoot))
    .filter((scope): scope is string => Boolean(scope))

  if (constraints.length === 0) {
    return [normalizedQuery]
  }

  return constraints.map((constraint) => `${constraint} ${normalizedQuery}`)
}

function buildSnippet(match: GrepMatch): string {
  return [...(match.contextBefore ?? []), match.lineContent, ...(match.contextAfter ?? [])]
    .join('\n')
    .trimEnd()
}

function scoreGrepMatch(match: GrepMatch, index: number): number {
  const definitionBoost = match.isDefinition ? 50 : 0
  const orderBoost = Math.max(0, 100 - index)
  return (match.fuzzyScore ?? 0) + match.totalFrecencyScore + definitionBoost + orderBoost
}

function mapFileHit(root: string, item: FileItem, score: Score | undefined): FffFileSearchHit {
  return {
    path: toPosixPath(item.relativePath || path.relative(root, item.fileName)),
    score: score?.total ?? item.totalFrecencyScore ?? 0
  }
}

async function readRelativeFileLines(
  root: string,
  relativePath: string,
  cache: Map<string, Promise<string[] | null>>
): Promise<string[] | null> {
  const normalizedRelativePath = toPosixPath(relativePath)
  const existing = cache.get(normalizedRelativePath)
  if (existing) {
    return await existing
  }

  const promise = (async () => {
    const resolvedPath = path.resolve(root, normalizedRelativePath)
    const relativeToRoot = path.relative(root, resolvedPath)
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      return null
    }

    try {
      const content = await readFile(resolvedPath, 'utf8')
      return content.split(/\r\n|\n|\r/)
    } catch {
      return null
    }
  })()

  cache.set(normalizedRelativePath, promise)
  return await promise
}

async function buildFullSnippet(
  root: string,
  match: GrepMatch,
  contextLines: number,
  cache: Map<string, Promise<string[] | null>>
): Promise<string> {
  const lines = await readRelativeFileLines(root, match.relativePath, cache)
  if (!lines || match.lineNumber < 1 || match.lineNumber > lines.length) {
    return buildSnippet(match)
  }

  const startIndex = Math.max(0, match.lineNumber - 1 - contextLines)
  const endIndex = Math.min(lines.length, match.lineNumber + contextLines)
  const snippet = lines.slice(startIndex, endIndex).join('\n').trimEnd()
  return snippet || buildSnippet(match)
}

export class FffSearchService {
  private readonly moduleLoader: () => Promise<FffModule>
  private readonly scanTimeoutMs: number
  private readonly maxCachedFinders: number
  private readonly now: () => number
  private readonly finders = new Map<string, Promise<FinderHandle>>()

  constructor(options: FffSearchServiceOptions = {}) {
    this.moduleLoader = options.moduleLoader ?? loadFffModule
    this.scanTimeoutMs = options.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS
    this.maxCachedFinders = options.maxCachedFinders ?? DEFAULT_MAX_CACHED_FINDERS
    this.now = options.now ?? (() => Date.now())
  }

  async findFiles(query: string, options: FffFindFilesOptions): Promise<FffFileSearchHit[]> {
    const root = normalizeRoot(options.workspaceRoot)
    const pageSize = clampInt(options.maxResults, DEFAULT_FIND_LIMIT, MAX_FIND_LIMIT)
    const handle = await this.getFinder(root, options.signal)
    const queries = buildFffQueries(query, options.pathScope, root)
    const hits = new Map<string, FffFileSearchHit>()

    for (const scopedQuery of queries) {
      throwIfAborted(options.signal)
      const result = handle.finder.fileSearch(scopedQuery, {
        pageSize,
        currentFile: options.currentFile
      })
      if (!result.ok) {
        throw new FffSearchUnavailableError(result.error)
      }

      result.value.items.forEach((item, index) => {
        const hit = mapFileHit(root, item, result.value.scores[index])
        const existing = hits.get(hit.path)
        if (!existing || hit.score > existing.score) {
          hits.set(hit.path, hit)
        }
      })
    }

    return Array.from(hits.values())
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, pageSize)
  }

  async globFiles(pattern: string, options: FffGlobFilesOptions): Promise<FffFileSearchHit[]> {
    const root = normalizeRoot(options.workspaceRoot)
    const pageSize = clampInt(options.maxResults, DEFAULT_FIND_LIMIT, MAX_GLOB_LIMIT)
    const handle = await this.getFinder(root, options.signal)
    const normalizedPattern = pattern.trim() || '**/*'

    throwIfAborted(options.signal)
    const result = handle.finder.glob(normalizedPattern, {
      pageSize,
      pageIndex: options.pageIndex,
      currentFile: options.currentFile
    })
    if (!result.ok) {
      throw new FffSearchUnavailableError(result.error)
    }

    return result.value.items
      .map((item, index) => mapFileHit(root, item, result.value.scores[index]))
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, pageSize)
  }

  async grep(query: string, options: FffGrepOptions): Promise<FffGrepHit[]> {
    const root = normalizeRoot(options.workspaceRoot)
    const pageSize = clampInt(options.maxResults, DEFAULT_GREP_LIMIT, MAX_GREP_LIMIT)
    const contextLines = clampContextLines(options.contextLines)
    const mode = resolveGrepMode(query, options.mode)
    const handle = await this.getFinder(root, options.signal)
    const queries = buildFffQueries(query, options.pathScope, root)
    const hits = new Map<string, FffGrepHit>()
    const fileLineCache = new Map<string, Promise<string[] | null>>()

    for (const scopedQuery of queries) {
      throwIfAborted(options.signal)
      const result = handle.finder.grep(scopedQuery, {
        mode,
        smartCase: true,
        beforeContext: contextLines,
        afterContext: contextLines,
        classifyDefinitions: true,
        pageSize
      })
      if (!result.ok) {
        throw new FffSearchUnavailableError(result.error)
      }

      const mappedHits = await Promise.all(
        result.value.items.map(async (match, index) => {
          const pathLabel = toPosixPath(match.relativePath)
          return {
            path: pathLabel,
            lineNumber: match.lineNumber,
            snippet: await buildFullSnippet(root, match, contextLines, fileLineCache),
            score: scoreGrepMatch(match, index)
          } satisfies FffGrepHit
        })
      )

      mappedHits.forEach((hit) => {
        const key = `${hit.path}:${hit.lineNumber}:${hit.snippet}`
        const existing = hits.get(key)
        if (!existing || hit.score > existing.score) {
          hits.set(key, hit)
        }
      })
    }

    return Array.from(hits.values())
      .sort(
        (a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.lineNumber - b.lineNumber
      )
      .slice(0, pageSize)
  }

  destroyAll(): void {
    for (const finderPromise of this.finders.values()) {
      void finderPromise.then((handle) => {
        if (!handle.finder.isDestroyed) {
          handle.finder.destroy()
        }
      })
    }
    this.finders.clear()
  }

  private async getFinder(root: string, signal?: AbortSignal): Promise<FinderHandle> {
    throwIfAborted(signal)
    const existing = this.finders.get(root)
    if (existing) {
      const handle = await existing
      handle.lastUsedAt = this.now()
      if (!handle.finder.isDestroyed) {
        return handle
      }
      this.finders.delete(root)
    }

    const created = this.createFinder(root, signal)
    this.finders.set(root, created)
    this.evictStaleFinders()

    try {
      return await created
    } catch (error) {
      this.finders.delete(root)
      throw error
    }
  }

  private async createFinder(root: string, signal?: AbortSignal): Promise<FinderHandle> {
    throwIfAborted(signal)
    let mod: FffModule
    try {
      mod = await this.moduleLoader()
    } catch (error) {
      throw new FffSearchUnavailableError(
        `Failed to import FFF Node API: ${getErrorMessage(error)}`
      )
    }

    throwIfAborted(signal)
    try {
      if (!mod.FileFinder.isAvailable()) {
        throw new FffSearchUnavailableError('FFF native library is not available')
      }
    } catch (error) {
      if (error instanceof FffSearchUnavailableError) {
        throw error
      }
      throw new FffSearchUnavailableError(
        `Failed to check FFF availability: ${getErrorMessage(error)}`
      )
    }

    const created = mod.FileFinder.create({
      basePath: root,
      aiMode: true
    })
    if (!created.ok) {
      throw new FffSearchUnavailableError(created.error)
    }

    let scanResult: Result<boolean>
    try {
      scanResult = await this.waitForScan(created.value, signal)
    } catch (error) {
      created.value.destroy()
      throw error
    }
    if (!scanResult.ok) {
      created.value.destroy()
      throw new FffSearchUnavailableError(scanResult.error)
    }
    if (!scanResult.value) {
      created.value.destroy()
      throw new FffSearchUnavailableError(
        `FFF initial scan timed out after ${this.scanTimeoutMs}ms`
      )
    }

    return {
      root,
      finder: created.value,
      lastUsedAt: this.now()
    }
  }

  private async waitForScan(finder: FileFinderApi, signal?: AbortSignal): Promise<Result<boolean>> {
    throwIfAborted(signal)
    if (!signal) {
      return await finder.waitForScan(this.scanTimeoutMs)
    }

    let removeAbortListener = (): void => {}
    const abortPromise = new Promise<Result<boolean>>((_, reject) => {
      const onAbort = () => reject(createAbortError())
      signal.addEventListener('abort', onAbort, { once: true })
      removeAbortListener = () => signal.removeEventListener('abort', onAbort)
    })

    try {
      return await Promise.race([finder.waitForScan(this.scanTimeoutMs), abortPromise])
    } finally {
      removeAbortListener()
    }
  }

  private evictStaleFinders(): void {
    if (this.finders.size <= this.maxCachedFinders) {
      return
    }

    void Promise.all(
      Array.from(this.finders.entries()).map(async ([root, finderPromise]) => ({
        root,
        handle: await finderPromise.catch(() => null)
      }))
    ).then((entries) => {
      const ordered = entries
        .filter((entry): entry is { root: string; handle: FinderHandle } => Boolean(entry.handle))
        .sort((a, b) => a.handle.lastUsedAt - b.handle.lastUsedAt)

      while (this.finders.size > this.maxCachedFinders && ordered.length > 0) {
        const entry = ordered.shift()!
        this.finders.delete(entry.root)
        if (!entry.handle.finder.isDestroyed) {
          entry.handle.finder.destroy()
        }
      }
    })
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
