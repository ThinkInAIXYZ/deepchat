import { describe, expect, it } from 'vitest'

import { toMemoryItemDto } from '@/routes'
import { memoryListRoute } from '@shared/contracts/routes'
import type { AgentMemoryRow } from '@/presenter/memoryPresenter/types'

function makeRow(overrides: Partial<AgentMemoryRow> = {}): AgentMemoryRow {
  return {
    id: 'm1',
    agent_id: 'agent',
    user_scope: null,
    kind: 'semantic',
    content: 'redis listens on 6379',
    importance: 0.5,
    status: 'embedded',
    embedding_id: null,
    embedding_dim: null,
    embedding_model: null,
    source_session: null,
    provenance_key: null,
    is_anchor: 0,
    superseded_by: null,
    created_at: 1000,
    last_accessed: null,
    access_count: 0,
    decay_score: null,
    source_entry_ids: null,
    confidence: null,
    last_consolidated_at: null,
    conflict_state: null,
    persona_state: null,
    ...overrides
  }
}

describe('toMemoryItemDto sourceEntryIds passthrough', () => {
  it('deserializes a valid source_entry_ids array alongside its session', () => {
    const dto = toMemoryItemDto(
      makeRow({ source_session: 'sess-1', source_entry_ids: '[12,34,56]' })
    )
    expect(dto.sourceSession).toBe('sess-1')
    expect(dto.sourceEntryIds).toEqual([12, 34, 56])
  })

  it('returns null for null / empty / malformed / non-array source_entry_ids', () => {
    expect(toMemoryItemDto(makeRow({ source_entry_ids: null })).sourceEntryIds).toBeNull()
    expect(toMemoryItemDto(makeRow({ source_entry_ids: '' })).sourceEntryIds).toBeNull()
    expect(toMemoryItemDto(makeRow({ source_entry_ids: '{bad json' })).sourceEntryIds).toBeNull()
    expect(toMemoryItemDto(makeRow({ source_entry_ids: '{"a":1}' })).sourceEntryIds).toBeNull()
  })

  it('keeps only non-negative integers and collapses an empty result to null', () => {
    expect(
      toMemoryItemDto(makeRow({ source_entry_ids: '[1,"x",null,2.5,-3,4]' })).sourceEntryIds
    ).toEqual([1, 4])
    expect(toMemoryItemDto(makeRow({ source_entry_ids: '["x",-1,1.5]' })).sourceEntryIds).toBeNull()
  })

  it('produces output that passes the memory.list contract schema', () => {
    const memories = [
      toMemoryItemDto(makeRow({ source_session: 'sess-1', source_entry_ids: '[1,2]' })),
      toMemoryItemDto(makeRow({ id: 'm2', source_session: null, source_entry_ids: null }))
    ]
    const parsed = memoryListRoute.output.parse({ memories })
    expect(parsed.memories[0].sourceEntryIds).toEqual([1, 2])
    expect(parsed.memories[1].sourceEntryIds).toBeNull()
  })
})
