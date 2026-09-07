import {
  AGENT_MEMORY_SCOPE_ID_MAX_CHARS,
  AGENT_MEMORY_SCOPE_TYPES,
  type AgentMemoryScopeType
} from '@shared/types/agent-memory'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'

import type { AgentMemoryRow, MemoryScope, MemoryScopeContext } from '../domain/types'

export const AGENT_MEMORY_AGENT_SCOPE: MemoryScope = Object.freeze({ type: 'agent' })
export const AGENT_MEMORY_AGENT_SCOPE_FILTER: readonly MemoryScope[] = Object.freeze([
  AGENT_MEMORY_AGENT_SCOPE
])

const SCOPE_TYPE_SET: ReadonlySet<string> = new Set(AGENT_MEMORY_SCOPE_TYPES)

function normalizeScopeId(
  scopeType: Exclude<AgentMemoryScopeType, 'agent'>,
  value: unknown
): string {
  if (typeof value !== 'string') {
    throw new Error(`[Memory] ${scopeType} scope requires an id`)
  }
  const id = value.trim()
  if (!id || unicodeCodePointLength(id) > AGENT_MEMORY_SCOPE_ID_MAX_CHARS) {
    throw new Error(`[Memory] invalid ${scopeType} scope id`)
  }
  return id
}

export function normalizeMemoryScope(scope?: MemoryScope | null): MemoryScope {
  if (scope === undefined || scope === null) {
    return AGENT_MEMORY_AGENT_SCOPE
  }
  if (scope.type === 'agent') {
    if (Object.prototype.hasOwnProperty.call(scope, 'id')) {
      throw new Error('[Memory] agent scope must not include an id')
    }
    return AGENT_MEMORY_AGENT_SCOPE
  }
  if (!SCOPE_TYPE_SET.has(scope.type)) {
    throw new Error('[Memory] invalid scope type')
  }
  return {
    type: scope.type,
    id: normalizeScopeId(scope.type, scope.id)
  }
}

export function memoryScopeFromRow(
  row: Pick<AgentMemoryRow, 'scope_type' | 'scope_id'>
): MemoryScope {
  if (row.scope_type === 'agent') {
    if (row.scope_id !== null) throw new Error('[Memory] invalid persisted agent scope')
    return AGENT_MEMORY_AGENT_SCOPE
  }
  if (!SCOPE_TYPE_SET.has(row.scope_type)) throw new Error('[Memory] invalid persisted scope type')
  const id = normalizeScopeId(row.scope_type, row.scope_id)
  if (row.scope_id !== id) throw new Error('[Memory] non-canonical persisted scope id')
  return {
    type: row.scope_type,
    id
  }
}

export function memoryScopeKey(scope: MemoryScope): string {
  const normalized = normalizeMemoryScope(scope)
  return normalized.type === 'agent' ? 'agent' : `${normalized.type}\0${normalized.id}`
}

export function memoryScopesEqual(left: MemoryScope, right: MemoryScope): boolean {
  return memoryScopeKey(left) === memoryScopeKey(right)
}

export function rowsShareMemoryScope(
  left: Pick<AgentMemoryRow, 'scope_type' | 'scope_id'>,
  right: Pick<AgentMemoryRow, 'scope_type' | 'scope_id'>
): boolean {
  return left.scope_type === right.scope_type && left.scope_id === right.scope_id
}

export function normalizeMemoryScopeFilter(
  scopes: readonly MemoryScope[] | undefined,
  fallback: readonly MemoryScope[] = AGENT_MEMORY_AGENT_SCOPE_FILTER
): readonly MemoryScope[] {
  const source = scopes ?? fallback
  const normalized = new Map<string, MemoryScope>()
  for (const scope of source) {
    const value = normalizeMemoryScope(scope)
    normalized.set(memoryScopeKey(value), value)
  }
  return [...normalized.values()]
}

export function memoryScopeFilterFromContext(context?: MemoryScopeContext): readonly MemoryScope[] {
  const scopes: MemoryScope[] = [AGENT_MEMORY_AGENT_SCOPE]
  if (context?.userId !== undefined) {
    scopes.push({ type: 'user', id: normalizeScopeId('user', context.userId) })
  }
  if (context?.projectId !== undefined) {
    scopes.push({ type: 'project', id: normalizeScopeId('project', context.projectId) })
  }
  if (context?.sessionId !== undefined) {
    scopes.push({ type: 'session', id: normalizeScopeId('session', context.sessionId) })
  }
  return normalizeMemoryScopeFilter(scopes)
}

export function rowMatchesMemoryScopeFilter(
  row: Pick<AgentMemoryRow, 'scope_type' | 'scope_id'>,
  scopes: readonly MemoryScope[]
): boolean {
  return normalizeMemoryScopeFilter(scopes, []).some((scope) =>
    scope.type === 'agent'
      ? row.scope_type === 'agent' && row.scope_id === null
      : row.scope_type === scope.type && row.scope_id === scope.id
  )
}

export function legacyUserScopeForMemoryScope(scope: MemoryScope): string | null {
  const normalized = normalizeMemoryScope(scope)
  return normalized.type === 'user' ? normalized.id : null
}

export function buildMemoryScopePredicateSql(
  tableAlias: string,
  scopes: readonly MemoryScope[]
): { sql: string; params: string[] } {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tableAlias)) {
    throw new Error('[Memory] invalid SQL scope alias')
  }
  const normalized = normalizeMemoryScopeFilter(scopes, [])
  if (!normalized.length) return { sql: '0', params: [] }
  const clauses: string[] = []
  const params: string[] = []
  for (const scope of normalized) {
    if (scope.type === 'agent') {
      clauses.push(`(${tableAlias}.scope_type = 'agent' AND ${tableAlias}.scope_id IS NULL)`)
      continue
    }
    clauses.push(`(${tableAlias}.scope_type = ? AND ${tableAlias}.scope_id = ?)`)
    params.push(scope.type, scope.id)
  }
  return { sql: `(${clauses.join(' OR ')})`, params }
}
