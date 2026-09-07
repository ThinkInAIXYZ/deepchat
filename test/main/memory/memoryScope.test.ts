import { describe, expect, it } from 'vitest'

import {
  AGENT_MEMORY_AGENT_SCOPE,
  buildMemoryScopePredicateSql,
  memoryScopeFilterFromContext,
  memoryScopeFromRow,
  normalizeMemoryScope,
  normalizeMemoryScopeFilter,
  rowMatchesMemoryScopeFilter
} from '@/memory/core/scope'
import { buildMemoryProvenanceKey, buildScopedMemoryProvenanceKey } from '@/memory/core/scoring'
import { AGENT_MEMORY_SCOPE_ID_MAX_CHARS } from '@shared/types/agent-memory'

describe('memory applicability scopes', () => {
  it('normalizes bounded narrow scopes and keeps agent scope canonical', () => {
    expect(normalizeMemoryScope()).toBe(AGENT_MEMORY_AGENT_SCOPE)
    expect(normalizeMemoryScope({ type: 'agent' })).toBe(AGENT_MEMORY_AGENT_SCOPE)
    expect(normalizeMemoryScope({ type: 'session', id: '  session-1  ' })).toEqual({
      type: 'session',
      id: 'session-1'
    })
    expect(
      normalizeMemoryScope({
        type: 'project',
        id: '😀'.repeat(AGENT_MEMORY_SCOPE_ID_MAX_CHARS)
      })
    ).toEqual({
      type: 'project',
      id: '😀'.repeat(AGENT_MEMORY_SCOPE_ID_MAX_CHARS)
    })
    expect(() => normalizeMemoryScope({ type: 'user', id: '   ' })).toThrow(/invalid user scope id/)
    expect(() => normalizeMemoryScope({ type: 'agent', id: 'unexpected' } as never)).toThrow(
      /agent scope must not include an id/
    )
    expect(() =>
      normalizeMemoryScope({
        type: 'project',
        id: '😀'.repeat(AGENT_MEMORY_SCOPE_ID_MAX_CHARS + 1)
      })
    ).toThrow(/invalid project scope id/)
  })

  it('builds a deterministic union from runtime context and deduplicates filters', () => {
    expect(
      memoryScopeFilterFromContext({
        userId: ' user-1 ',
        projectId: 'project-1',
        sessionId: 'session-1'
      })
    ).toEqual([
      { type: 'agent' },
      { type: 'user', id: 'user-1' },
      { type: 'project', id: 'project-1' },
      { type: 'session', id: 'session-1' }
    ])
    expect(
      normalizeMemoryScopeFilter([
        { type: 'session', id: 'session-1' },
        { type: 'agent' },
        { type: 'session', id: ' session-1 ' }
      ])
    ).toEqual([{ type: 'session', id: 'session-1' }, { type: 'agent' }])
  })

  it('uses the same exact applicability semantics in JavaScript and SQL', () => {
    const filter = [{ type: 'agent' as const }, { type: 'session' as const, id: 'session-1' }]
    expect(rowMatchesMemoryScopeFilter({ scope_type: 'agent', scope_id: null }, filter)).toBe(true)
    expect(
      rowMatchesMemoryScopeFilter({ scope_type: 'session', scope_id: 'session-1' }, filter)
    ).toBe(true)
    expect(
      rowMatchesMemoryScopeFilter({ scope_type: 'session', scope_id: 'session-2' }, filter)
    ).toBe(false)

    expect(buildMemoryScopePredicateSql('memory', filter)).toEqual({
      sql: "((memory.scope_type = 'agent' AND memory.scope_id IS NULL) OR (memory.scope_type = ? AND memory.scope_id = ?))",
      params: ['session', 'session-1']
    })
    expect(buildMemoryScopePredicateSql('memory', [])).toEqual({ sql: '0', params: [] })
    expect(() => buildMemoryScopePredicateSql('memory; DROP TABLE x', filter)).toThrow(
      /invalid SQL scope alias/
    )
  })

  it('fails closed for malformed persisted scope pairs', () => {
    expect(() => memoryScopeFromRow({ scope_type: 'project', scope_id: ' project-1 ' })).toThrow(
      /non-canonical persisted scope id/
    )
    expect(() => memoryScopeFromRow({ scope_type: 'agent', scope_id: 'unexpected' })).toThrow(
      /invalid persisted agent scope/
    )
    expect(() => memoryScopeFromRow({ scope_type: 'session', scope_id: null })).toThrow(
      /session scope requires an id/
    )
  })

  it('preserves legacy agent provenance while separating narrow scopes', () => {
    const legacyAgentKey = buildMemoryProvenanceKey('agent-a', 'semantic', '  Likes   Redis  ')
    expect(
      buildScopedMemoryProvenanceKey('agent-a', 'semantic', 'Likes Redis', { type: 'agent' })
    ).toBe(legacyAgentKey)

    const sessionOne = buildScopedMemoryProvenanceKey('agent-a', 'semantic', 'Likes Redis', {
      type: 'session',
      id: 'session-1'
    })
    const sessionTwo = buildScopedMemoryProvenanceKey('agent-a', 'semantic', 'Likes Redis', {
      type: 'session',
      id: 'session-2'
    })
    expect(sessionOne).toMatch(/^v3:semantic:[0-9a-f]{64}$/u)
    expect(sessionOne).not.toBe(legacyAgentKey)
    expect(sessionTwo).not.toBe(sessionOne)

    const framedScope = buildScopedMemoryProvenanceKey('agent-a', 'semantic', 'b\0c', {
      type: 'session',
      id: 'a'
    })
    const framedContent = buildScopedMemoryProvenanceKey('agent-a', 'semantic', 'c', {
      type: 'session',
      id: 'a\0b'
    })
    expect(framedScope).not.toBe(framedContent)
  })
})
