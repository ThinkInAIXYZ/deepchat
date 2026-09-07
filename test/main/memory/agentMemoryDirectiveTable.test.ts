import { expect, it } from 'vitest'
import { AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT } from '@shared/types/agent-memory'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const tableModule = Database
  ? await import('@/memory/data/tables/agentMemoryDirective').catch(() => null)
  : null
const directiveModule = await import('@/memory/domain/directives')

const AgentMemoryDirectiveTable = tableModule?.AgentMemoryDirectiveTable
const DatabaseCtor = Database!
const AgentMemoryDirectiveTableCtor = AgentMemoryDirectiveTable!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(AgentMemoryDirectiveTable),
  'AgentMemoryDirectiveTable is unavailable'
)

function writeInput(
  input: Parameters<typeof directiveModule.normalizeMemoryDirective>[0],
  overrides: Partial<{
    agentId: string
    id: string
    source: 'explicit_user' | 'manual' | 'derived_suggestion'
    status: 'draft' | 'active' | 'rejected'
    createdAt: number
    updatedAt: number
  }> = {}
) {
  return {
    agentId: overrides.agentId ?? 'a',
    id: overrides.id ?? 'directive-1',
    ...directiveModule.normalizeMemoryDirective(input),
    source: overrides.source ?? ('manual' as const),
    status: overrides.status ?? ('active' as const),
    createdAt: overrides.createdAt ?? 1_000,
    updatedAt: overrides.updatedAt ?? 1_000
  }
}

describeIfSqlite('AgentMemoryDirectiveTable', () => {
  it('persists explicit directives and preserves stable identity across trust upgrades', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryDirectiveTableCtor(db)
      table.createTable()
      table.assertCurrentSchema()

      const first = table.upsertExplicitDirective(
        writeInput({ kind: 'instruction', content: 'Use concise answers.' })
      )
      expect(first).toMatchObject({
        action: 'created',
        row: {
          agent_id: 'a',
          id: 'directive-1',
          kind: 'instruction',
          status: 'active',
          source: 'manual',
          normalized_topic: null
        }
      })
      expect(
        table.upsertExplicitDirective(
          writeInput({ kind: 'instruction', content: 'Use concise answers.' }, { id: 'ignored' })
        )
      ).toMatchObject({ action: 'unchanged', row: { id: 'directive-1' } })

      const suggested = table.insertDerivedDirectiveDraft(
        writeInput(
          { kind: 'suppress_topic', content: 'Do not mention Saffron.', topic: 'Project Saffron' },
          {
            id: 'directive-draft',
            source: 'derived_suggestion',
            status: 'draft',
            createdAt: 2_000,
            updatedAt: 2_000
          }
        )
      )
      expect(suggested).toMatchObject({
        inserted: true,
        row: {
          id: 'directive-draft',
          status: 'draft',
          source: 'derived_suggestion',
          normalized_topic: 'project saffron'
        }
      })
      expect(
        table.transitionDirective('a', 'directive-draft', 'draft', 'rejected', 3_000)
      ).toMatchObject({
        action: 'transitioned',
        row: {
          id: 'directive-draft',
          status: 'rejected',
          updated_at: 3_000
        }
      })
      expect(table.transitionDirective('a', 'directive-draft', 'draft', 'active', 4_000)).toEqual({
        action: 'not-found',
        row: null
      })

      const explicit = table.upsertExplicitDirective(
        writeInput(
          {
            kind: 'suppress_topic',
            content: 'Never include Project Saffron in replies.',
            topic: ' project   SAFFRON '
          },
          {
            id: 'replacement-id',
            source: 'explicit_user',
            createdAt: 4_000,
            updatedAt: 4_000
          }
        )
      )
      expect(explicit).toMatchObject({
        action: 'updated',
        row: {
          id: 'directive-draft',
          status: 'active',
          source: 'explicit_user',
          content: 'Never include Project Saffron in replies.',
          created_at: 2_000,
          updated_at: 4_000
        }
      })
      expect(table.countDirectivesByStatus('a')).toEqual({
        draft: 0,
        active: 2,
        rejected: 0
      })
    } finally {
      db.close()
    }
  })

  it('keeps ownership, bounded reads, transitions, and cleanup fail-closed', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryDirectiveTableCtor(db)
      table.createTable()
      table.insertDerivedDirectiveDraft(
        writeInput(
          { kind: 'instruction', content: 'Draft instruction' },
          { id: 'draft', source: 'derived_suggestion', status: 'draft' }
        )
      )
      table.upsertExplicitDirective(
        writeInput(
          { kind: 'suppress_topic', content: 'Hide Alpha.', topic: 'Alpha' },
          { id: 'active', updatedAt: 2_000 }
        )
      )
      table.upsertExplicitDirective(
        writeInput(
          { kind: 'instruction', content: 'Other agent instruction' },
          { agentId: 'b', id: 'other', updatedAt: 3_000 }
        )
      )

      expect(table.getDirective('b', 'draft')).toBeUndefined()
      expect(table.listDirectives('a', { statuses: ['draft'], limit: 10 })).toHaveLength(1)
      expect(table.listDirectives('a', { limit: Number.NaN })).toEqual([])
      expect(table.listActiveDirectives('a', 10).map((row) => row.id)).toEqual(['active'])
      expect(table.transitionDirective('b', 'draft', 'draft', 'active', 4_000)).toEqual({
        action: 'not-found',
        row: null
      })
      expect(table.deleteDirective('b', 'draft')).toBeNull()
      expect(table.deleteDirective('a', 'draft')).toMatchObject({ id: 'draft' })
      expect(table.retireDirectiveNamespace('a')).toBe(1)
      expect(table.listDirectives('a')).toEqual([])
      expect(table.listDirectives('b').map((row) => row.id)).toEqual(['other'])

      const queryPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT *
           FROM agent_memory_directive INDEXED BY idx_agent_memory_directive_status_v1
           WHERE agent_id = ? AND status = 'active'
           ORDER BY updated_at DESC, id ASC
           LIMIT ?`
        )
        .all('b', 64) as Array<{ detail: string }>
      expect(queryPlan.map((row) => row.detail).join('\n')).toContain(
        'idx_agent_memory_directive_status_v1'
      )
      const managementPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT *
           FROM agent_memory_directive
           WHERE agent_id = ?
           ORDER BY updated_at DESC, id ASC
           LIMIT ?`
        )
        .all('b', 200) as Array<{ detail: string }>
      expect(managementPlan.map((row) => row.detail).join('\n')).toContain(
        'idx_agent_memory_directive_management_v1'
      )
      expect(table.getLatestVersion()).toBe(50)
      expect(table.getMigrationSQL(50)).toContain(
        'CREATE TABLE IF NOT EXISTS agent_memory_directive'
      )
    } finally {
      db.close()
    }
  })

  it('rejects repository calls that would bypass the directive trust state machine', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryDirectiveTableCtor(db)
      table.createTable()
      expect(() =>
        table.upsertExplicitDirective(
          writeInput(
            { kind: 'instruction', content: 'Untrusted active directive' },
            { source: 'derived_suggestion' }
          )
        )
      ).toThrow(/active trust state/)
      expect(() =>
        table.insertDerivedDirectiveDraft(
          writeInput({ kind: 'instruction', content: 'Improper manual draft' }, { status: 'draft' })
        )
      ).toThrow(/draft trust state/)
      expect(() => table.transitionDirective('a', 'missing', 'active', 'rejected', 1_000)).toThrow(
        /trust transition/
      )
    } finally {
      db.close()
    }
  })

  it('keeps active directives bounded without blocking updates or later approvals', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryDirectiveTableCtor(db)
      table.createTable()
      for (let index = 0; index < AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT; index += 1) {
        expect(
          table.upsertExplicitDirective(
            writeInput(
              { kind: 'instruction', content: `Directive ${index}` },
              { id: `active-${index}`, createdAt: 1_000 + index, updatedAt: 1_000 + index }
            )
          ).action
        ).toBe('created')
      }

      expect(
        table.upsertExplicitDirective(
          writeInput({ kind: 'instruction', content: 'One directive too many' }, { id: 'overflow' })
        )
      ).toEqual({ action: 'capacity', row: null })

      expect(
        table.upsertExplicitDirective(
          writeInput(
            { kind: 'instruction', content: 'DIRECTIVE 0' },
            { id: 'replacement', createdAt: 500, updatedAt: 500 }
          )
        )
      ).toMatchObject({
        action: 'updated',
        row: { id: 'active-0', content: 'DIRECTIVE 0', updated_at: 1_000 }
      })

      table.insertDerivedDirectiveDraft(
        writeInput(
          { kind: 'instruction', content: 'Pending capacity' },
          { id: 'pending', source: 'derived_suggestion', status: 'draft' }
        )
      )
      expect(table.transitionDirective('a', 'pending', 'draft', 'active', 2_000)).toEqual({
        action: 'capacity',
        row: null
      })
      expect(table.deleteDirective('a', 'active-1')).toMatchObject({ id: 'active-1' })
      expect(table.transitionDirective('a', 'pending', 'draft', 'active', 2_000)).toMatchObject({
        action: 'transitioned',
        row: {
          id: 'pending',
          status: 'active'
        }
      })
      expect(table.countDirectivesByStatus('a').active).toBe(
        AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT
      )
    } finally {
      db.close()
    }
  })
})
