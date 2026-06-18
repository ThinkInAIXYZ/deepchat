import { describe, expect, it } from 'vitest'
import type { AssistantMessageBlock, ChatMessageRecord } from '@shared/types/agent-interface'
import {
  appendMessageRecordToTape,
  appendToolFactsToTape
} from '@/presenter/agentRuntimePresenter/tapeFacts'
import { buildEffectiveTapeView } from '@/presenter/agentRuntimePresenter/tapeEffectiveView'

function createTable() {
  const rows: any[] = []
  let seq = 0
  const table = {
    rows,
    ensureBootstrapAnchor: () => {},
    appendAnchor: () => {},
    appendEvent: (input: any) => table.append({ ...input, kind: 'event', payload: input.data }),
    append: (input: any) => {
      const key = input.provenanceKey ?? null
      if (input.idempotent && key) {
        const existing = rows.find(
          (row) => row.session_id === input.sessionId && row.provenance_key === key
        )
        if (existing) {
          return existing
        }
      }
      const row = {
        session_id: input.sessionId,
        entry_id: (seq += 1),
        kind: input.kind,
        name: input.name ?? null,
        source_type: input.source?.type ?? null,
        source_id: input.source?.id ?? null,
        source_seq: input.source?.seq ?? null,
        provenance_key: key,
        payload_json: JSON.stringify(input.payload ?? {}),
        meta_json: JSON.stringify(input.meta ?? {}),
        created_at: input.createdAt ?? 0
      }
      rows.push(row)
      return row
    }
  }
  return table
}

function assistantRecord(
  blocks: AssistantMessageBlock[],
  overrides: Partial<ChatMessageRecord> = {}
) {
  return {
    id: 'a1',
    sessionId: 's1',
    orderSeq: 2,
    role: 'assistant',
    content: JSON.stringify(blocks),
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: 100,
    updatedAt: 100,
    ...overrides
  } as ChatMessageRecord
}

function toolCallBlock(
  status: AssistantMessageBlock['status'],
  id: string,
  response?: string
): AssistantMessageBlock {
  return {
    type: 'tool_call',
    status,
    timestamp: 120,
    tool_call: { id, name: 'search', params: '{"q":"x"}', ...(response ? { response } : {}) }
  } as AssistantMessageBlock
}

describe('appendToolFactsToTape', () => {
  it('writes only success/error tool blocks and reads status from the block', () => {
    const table = createTable()
    const record = assistantRecord([
      toolCallBlock('success', 'ok', 'done'),
      toolCallBlock('error', 'bad', 'boom'),
      toolCallBlock('pending', 'wait', 'partial'),
      toolCallBlock('loading', 'spin'),
      {
        type: 'content',
        status: 'success',
        timestamp: 120,
        content: 'text'
      } as AssistantMessageBlock
    ])

    const appended = appendToolFactsToTape(table as any, record, 'live', 'tool_loop')

    const toolCalls = table.rows.filter((row) => row.kind === 'tool_call')
    const toolResults = table.rows.filter((row) => row.kind === 'tool_result')
    expect(toolCalls.map((row) => JSON.parse(row.payload_json).toolCall.id).sort()).toEqual([
      'bad',
      'ok'
    ])
    expect(toolResults).toHaveLength(2)
    expect(appended).toBe(4)
    for (const row of [...toolCalls, ...toolResults]) {
      const meta = JSON.parse(row.meta_json)
      expect(meta.status === 'success' || meta.status === 'error').toBe(true)
      expect(meta.reason).toBe('tool_loop')
      expect(row.provenance_key).toMatch(/^tool_(call|result):a1:(ok|bad):/)
    }
  })

  it('skips a tool_call whose block is awaiting a pending permission/question interaction', () => {
    const table = createTable()
    const record = assistantRecord([
      {
        type: 'tool_call',
        status: 'success',
        timestamp: 120,
        tool_call: { id: 'perm1', name: 'fs_write', params: '{}' }
      } as AssistantMessageBlock,
      {
        type: 'action',
        status: 'pending',
        timestamp: 120,
        action_type: 'tool_call_permission',
        tool_call: { id: 'perm1', name: 'fs_write', params: '{}' }
      } as AssistantMessageBlock,
      toolCallBlock('success', 'done1', 'result')
    ])

    const appended = appendToolFactsToTape(table as any, record, 'live', 'tool_loop')

    expect(appended).toBe(2)
    const toolCallIds = table.rows
      .filter((row) => row.kind === 'tool_call')
      .map((row) => JSON.parse(row.payload_json).toolCall.id)
    expect(toolCallIds).toEqual(['done1'])
  })

  it('dedupes a mid-loop snapshot and the finalize write to one effective tool fact', () => {
    const table = createTable()
    const pending = assistantRecord([toolCallBlock('success', 'tc1', 'result')], {
      status: 'pending'
    })

    appendToolFactsToTape(table as any, pending, 'live', 'tool_loop')

    const finalized = assistantRecord([toolCallBlock('success', 'tc1', 'result')], {
      status: 'sent'
    })
    appendMessageRecordToTape(table as any, finalized, 'live')

    expect(table.rows.filter((row) => row.kind === 'tool_call')).toHaveLength(1)
    expect(table.rows.filter((row) => row.kind === 'tool_result')).toHaveLength(1)

    const effective = buildEffectiveTapeView(table.rows)
    expect(effective.rows.filter((row) => row.kind === 'tool_call')).toHaveLength(1)
    expect(effective.rows.filter((row) => row.kind === 'tool_result')).toHaveLength(1)
  })

  it('keeps one effective tool fact per call on a normal finalize without a snapshot', () => {
    const table = createTable()
    const finalized = assistantRecord([
      toolCallBlock('success', 'tc1', 'a'),
      toolCallBlock('success', 'tc2', 'b')
    ])

    appendMessageRecordToTape(table as any, finalized, 'live')

    const effective = buildEffectiveTapeView(table.rows)
    expect(effective.rows.filter((row) => row.kind === 'tool_call')).toHaveLength(2)
    expect(effective.rows.filter((row) => row.kind === 'tool_result')).toHaveLength(2)
  })

  it('selects the latest revision when the tool response changes after a snapshot', () => {
    const table = createTable()
    const snapshot = assistantRecord([toolCallBlock('success', 'tc1', 'first')], {
      status: 'pending'
    })
    appendToolFactsToTape(table as any, snapshot, 'live', 'tool_loop')

    const finalized = assistantRecord([toolCallBlock('success', 'tc1', 'second')], {
      status: 'sent'
    })
    appendMessageRecordToTape(table as any, finalized, 'live')

    expect(table.rows.filter((row) => row.kind === 'tool_result')).toHaveLength(2)
    const effective = buildEffectiveTapeView(table.rows)
    const effectiveResults = effective.rows.filter((row) => row.kind === 'tool_result')
    expect(effectiveResults).toHaveLength(1)
    expect(JSON.parse(effectiveResults[0].payload_json).response).toBe('second')
  })
})

function userRecord(
  id: string,
  orderSeq: number,
  text: string,
  overrides: Partial<ChatMessageRecord> = {}
) {
  return {
    id,
    sessionId: 's1',
    orderSeq,
    role: 'user',
    content: JSON.stringify({ text }),
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: 100,
    updatedAt: 100,
    ...overrides
  } as ChatMessageRecord
}

describe('buildEffectiveTapeView messageEntries (lineage pairing)', () => {
  it('pairs each effective message with its tape entry_id, consistent with messageRecords', () => {
    const table = createTable()
    appendMessageRecordToTape(table as any, userRecord('u1', 1, 'first'), 'live')
    appendMessageRecordToTape(
      table as any,
      assistantRecord(
        [
          {
            type: 'content',
            status: 'success',
            timestamp: 1,
            content: 'reply'
          } as AssistantMessageBlock
        ],
        { id: 'a1', orderSeq: 2 }
      ),
      'live'
    )

    const view = buildEffectiveTapeView(table.rows)
    expect(view.messageEntries.map((entry) => entry.record.id)).toEqual(
      view.messageRecords.map((record) => record.id)
    )
    expect(view.messageEntries.map((entry) => entry.record.orderSeq)).toEqual([1, 2])
    for (const entry of view.messageEntries) {
      const row = table.rows.find((r) => r.kind === 'message' && r.entry_id === entry.entryId)
      expect(row).toBeTruthy()
      expect(JSON.parse(row!.payload_json).record.id).toBe(entry.record.id)
    }
  })

  it('excludes a retracted message from messageEntries', () => {
    const table = createTable()
    appendMessageRecordToTape(table as any, userRecord('u1', 1, 'keep me'), 'live')
    appendMessageRecordToTape(table as any, userRecord('u2', 2, 'retract me'), 'live')
    table.append({
      sessionId: 's1',
      kind: 'event',
      name: 'message/retracted',
      payload: { data: { messageId: 'u2' } }
    })

    const ids = buildEffectiveTapeView(table.rows).messageEntries.map((entry) => entry.record.id)
    expect(ids).toEqual(['u1'])
  })
})
