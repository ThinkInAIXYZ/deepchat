import { describe, expect, it } from 'vitest'

import { formatMemorySourceRecordContent, toMemoryItemDto } from '@/routes'
import { memoryListRoute, memoryRestoreRoute } from '@shared/contracts/routes'
import type { AgentMemoryRow } from '@/presenter/memoryPresenter/types'
import type { ChatMessageRecord } from '@shared/types/agent-interface'

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
    conflict_with: null,
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

  it('maps conflict_with to camelCase conflictWith and accepts conflicted status', () => {
    const dto = toMemoryItemDto(
      makeRow({ status: 'conflicted', conflict_with: 'm-target', conflict_state: null })
    )
    const parsed = memoryListRoute.output.parse({ memories: [dto] })
    expect(parsed.memories[0].status).toBe('conflicted')
    expect(parsed.memories[0].conflictWith).toBe('m-target')
    expect('conflict_with' in parsed.memories[0]).toBe(false)
  })
})

describe('memory.restore route contract round-trip', () => {
  it('round-trips a valid restore input and output', () => {
    const input = memoryRestoreRoute.input.parse({ agentId: 'deepchat-abc123', memoryId: 'mem-1' })
    expect(input).toEqual({ agentId: 'deepchat-abc123', memoryId: 'mem-1' })
    expect(memoryRestoreRoute.output.parse({ ok: true })).toEqual({ ok: true })
    expect(memoryRestoreRoute.output.parse({ ok: false })).toEqual({ ok: false })
  })

  it('rejects an illegal agentId at the contract layer', () => {
    for (const agentId of ['../etc', 'has space', '']) {
      expect(memoryRestoreRoute.input.safeParse({ agentId, memoryId: 'm1' }).success).toBe(false)
    }
  })
})

describe('formatMemorySourceRecordContent', () => {
  const record = (role: ChatMessageRecord['role'], content: string): ChatMessageRecord =>
    ({
      id: 'msg-1',
      sessionId: 's',
      role,
      content,
      createdAt: 1000,
      updatedAt: 1000,
      status: 'sent',
      orderSeq: 1,
      tokenCount: 0
    }) as ChatMessageRecord

  it('returns readable text for user and assistant JSON records', () => {
    expect(formatMemorySourceRecordContent(record('user', JSON.stringify({ text: 'hello' })))).toBe(
      'hello'
    )
    expect(
      formatMemorySourceRecordContent(
        record(
          'assistant',
          JSON.stringify([
            { type: 'content', content: 'answer body' },
            { type: 'reasoning', text: 'reasoning note' },
            { type: 'reasoning_content', content: 'reasoning block' },
            { type: 'tool_call', content: '{"raw":true}' }
          ])
        )
      )
    ).toBe('answer body reasoning note reasoning block')
  })

  it('returns empty text for malformed or unsupported records', () => {
    expect(formatMemorySourceRecordContent(record('user', '{bad json'))).toBe('')
    expect(
      formatMemorySourceRecordContent(record('assistant', JSON.stringify({ tool: true })))
    ).toBe('')
  })
})
