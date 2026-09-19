import { TOOL_SEARCH_AGENT_TOOL_NAME } from '@deepchat/shared/agentTools'
import type {
  CanonicalToolCatalogEntry,
  ToolSurfaceActivationCandidate,
  ToolSurfaceExecutionContext,
  ToolSurfaceSnapshot
} from '@deepchat/agent-kernel/runtime/toolSurface'
import {
  TOOL_SEARCH_MAX_QUERY_LENGTH,
  TOOL_SEARCH_MAX_RESULT_LIMIT,
  toolSearchInputSchema,
  type ToolSearchInput
} from '@deepchat/agent-kernel/contracts/toolSearchDefinition'

export {
  TOOL_SEARCH_DEFAULT_RESULT_LIMIT,
  TOOL_SEARCH_MAX_QUERY_LENGTH,
  TOOL_SEARCH_MAX_RESULT_LIMIT,
  TOOL_SEARCH_TOOL_SERVER_NAME,
  buildToolSearchDefinition,
  toolSearchInputSchema,
  type ToolSearchInput
} from '@deepchat/agent-kernel/contracts/toolSearchDefinition'

export const TOOL_SEARCH_MAX_NAME_LENGTH = 256
export const TOOL_SEARCH_MAX_DESCRIPTION_LENGTH = 240
const TOOL_SEARCH_MAX_QUERY_TOKENS = 32

export interface ToolSearchResultItem {
  readonly name: string
  readonly source: 'DeepChat' | 'MCP'
  readonly description: string
  readonly effect: 'read' | 'write'
  readonly state: 'pending'
}

export interface ToolSearchResult {
  readonly results: readonly ToolSearchResultItem[]
}

export interface ToolSearchExecution {
  readonly result: ToolSearchResult
  readonly candidates: readonly ToolSurfaceActivationCandidate[]
}

interface SearchableToolSurfaceEntry {
  readonly catalogEntry: CanonicalToolCatalogEntry
  readonly name: string
  readonly normalizedName: string
  readonly source: ToolSearchResultItem['source']
  readonly description: string
  readonly normalizedDescription: string
}

const searchableEntriesBySnapshot = new WeakMap<
  ToolSurfaceSnapshot,
  readonly SearchableToolSurfaceEntry[]
>()

export type ToolSearchInputParseResult =
  | { readonly success: true; readonly data: ToolSearchInput }
  | { readonly success: false; readonly error: string }

export function parseToolSearchInput(input: unknown): ToolSearchInputParseResult {
  const parsed = toolSearchInputSchema.safeParse(input)
  if (!parsed.success || !normalizeSearchText(parsed.data.query, TOOL_SEARCH_MAX_QUERY_LENGTH)) {
    return {
      success: false,
      error: `Invalid arguments for ${TOOL_SEARCH_AGENT_TOOL_NAME}. Provide a non-empty query of at most ${TOOL_SEARCH_MAX_QUERY_LENGTH} characters and an optional integer limit from 1 to ${TOOL_SEARCH_MAX_RESULT_LIMIT}.`
    }
  }
  return { success: true, data: parsed.data }
}

function normalizeSearchText(value: string, limit: number): string {
  return Array.from(
    value
      .normalize('NFKC')
      .replace(/[\p{Cc}\p{Cf}\p{Cs}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
    .slice(0, limit)
    .join('')
}

function tokenize(value: string): readonly string[] {
  return Object.freeze(
    Array.from(
      new Set(value.match(/[\p{L}\p{N}_-]+/gu)?.filter((token) => token.length >= 2) ?? [])
    ).slice(0, TOOL_SEARCH_MAX_QUERY_TOKENS)
  )
}

function scoreCatalogEntry(
  normalizedQuery: string,
  queryTokens: readonly string[],
  entry: SearchableToolSurfaceEntry
): number {
  let score = 0
  if (entry.normalizedName === normalizedQuery) score += 10_000
  else if (entry.normalizedName.includes(normalizedQuery)) score += 4_000
  if (entry.normalizedDescription.includes(normalizedQuery)) score += 2_000
  for (const token of queryTokens) {
    if (entry.normalizedName === token) score += 1_000
    else if (entry.normalizedName.includes(token)) score += 500
    if (entry.normalizedDescription.includes(token)) score += 200
    if (entry.catalogEntry.execution.effect === token) score += 50
  }
  return score
}

function buildSearchableEntries(
  snapshot: ToolSurfaceSnapshot
): readonly SearchableToolSurfaceEntry[] {
  const activeTargets = new Set(snapshot.activeEntries.map((entry) => entry.stableTargetKey))
  const ceilingByTarget = new Map(
    snapshot.ceiling.entries.map((entry) => [entry.catalogEntry.stableTargetKey, entry])
  )
  return Object.freeze(
    snapshot.eligibleCatalog.entries.flatMap((entry) => {
      if (
        activeTargets.has(entry.stableTargetKey) ||
        entry.target.providerVisibleName === TOOL_SEARCH_AGENT_TOOL_NAME
      ) {
        return []
      }
      const ceilingEntry = ceilingByTarget.get(entry.stableTargetKey)
      if (
        !ceilingEntry ||
        ceilingEntry.catalogEntry.canonicalToolDefinitionHash !== entry.canonicalToolDefinitionHash
      ) {
        return []
      }
      const name = normalizeSearchText(
        entry.target.providerVisibleName,
        TOOL_SEARCH_MAX_NAME_LENGTH
      )
      if (!name || name !== entry.target.providerVisibleName) return []
      const description = normalizeSearchText(
        entry.target.source === 'mcp'
          ? (ceilingEntry.definition.raw?.description ?? '')
          : ceilingEntry.definition.function.description,
        TOOL_SEARCH_MAX_DESCRIPTION_LENGTH
      )
      return [
        Object.freeze({
          catalogEntry: entry,
          name,
          normalizedName: name.toLocaleLowerCase('en-US'),
          source: entry.target.source === 'agent' ? ('DeepChat' as const) : ('MCP' as const),
          description,
          normalizedDescription: description.toLocaleLowerCase('en-US')
        })
      ]
    })
  )
}

function getSearchableEntries(
  snapshot: ToolSurfaceSnapshot
): readonly SearchableToolSurfaceEntry[] {
  const cached = searchableEntriesBySnapshot.get(snapshot)
  if (cached) return cached
  const entries = buildSearchableEntries(snapshot)
  searchableEntriesBySnapshot.set(snapshot, entries)
  return entries
}

export function searchToolSurfaceSnapshot(
  input: ToolSearchInput,
  context: ToolSurfaceExecutionContext
): ToolSearchExecution {
  const snapshot = context.snapshot
  const normalizedQuery = normalizeSearchText(
    input.query,
    TOOL_SEARCH_MAX_QUERY_LENGTH
  ).toLocaleLowerCase('en-US')
  if (!normalizedQuery) {
    return Object.freeze({
      result: Object.freeze({ results: Object.freeze([]) }),
      candidates: Object.freeze([])
    })
  }
  const queryTokens = tokenize(normalizedQuery)
  const ranked = getSearchableEntries(snapshot)
    .flatMap((entry) => {
      const score = scoreCatalogEntry(normalizedQuery, queryTokens, entry)
      return score > 0 ? [{ entry, score }] : []
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.entry.name < right.entry.name ? -1 : left.entry.name > right.entry.name ? 1 : 0)
    )
    .slice(0, input.limit)

  const results = ranked.map(({ entry }) =>
    Object.freeze({
      name: entry.name,
      source: entry.source,
      description: entry.description,
      effect: entry.catalogEntry.execution.effect,
      state: 'pending' as const
    })
  )
  const candidates = ranked.map(({ entry }, resultRank) =>
    Object.freeze({
      ...snapshot.request,
      stableTargetKey: entry.catalogEntry.stableTargetKey,
      canonicalToolDefinitionHash: entry.catalogEntry.canonicalToolDefinitionHash,
      toolCallOrdinalWithinBatch: context.toolCallOrdinalWithinBatch,
      resultRank
    })
  )
  return Object.freeze({
    result: Object.freeze({ results: Object.freeze(results) }),
    candidates: Object.freeze(candidates)
  })
}
