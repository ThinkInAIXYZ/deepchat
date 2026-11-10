import { afterEach, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { dimDatabase } from './fixtures/database'
import { DimTimelineInspector } from '@/agent/dim/timelineInspector'
import { DimProjectionStore } from '@/agent/dim/projectionStore'
import { indexDimInspectorEvent } from '@/agent/dim/timelineInspectorProjection'
import type { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import type { DimEvent } from '@/agent/dim/sessionConnection'

vi.unmock('fs')
vi.unmock('node:fs')
const handles: DatabaseSync[] = []
afterEach(() => {
  for (const db of handles.splice(0)) db.close()
})
const event = (
  sequence: number | string,
  type: string,
  name: string,
  data: DimEvent['data'] = {}
): DimEvent => ({
  id: `event-${sequence}`,
  sequence,
  create_at: 1000,
  type,
  name,
  data
})
function fixture(events: DimEvent[]) {
  const { data, sqlite } = dimDatabase()
  handles.push(sqlite)
  const binding = data.dimSessionBindingsTable.bind('app', 'native')
  const call = vi.fn(
    async (_method: string, input: { after: string; through?: string; limit: number }) => ({
      through: input.through ?? String(events.at(-1)?.sequence ?? 0),
      events: events
        .filter(
          (item) =>
            BigInt(item.sequence) > BigInt(input.after) &&
            BigInt(item.sequence) <= BigInt(input.through ?? events.at(-1)?.sequence ?? 0)
        )
        .slice(0, input.limit)
    })
  )
  const latest = vi.fn(async (_ref, _kinds, filter) => ({
    event: events.find((item) => item.id === filter.right.value)!,
    through: String(events.at(-1)?.sequence ?? 0)
  }))
  const host = { start: vi.fn(async () => ({ call })) } as unknown as DimRuntimeSupervisor
  return {
    data,
    sqlite,
    binding,
    call,
    latest,
    host,
    inspector: new DimTimelineInspector({ database: data, host, content: { latest } })
  }
}

it('pages and filters native facts, preserving u64 pointers and reading payloads only from the owner', async () => {
  const source = Array.from({ length: 205 }, (_, index) =>
    event(index + 1, 'step', 'text', {
      turn_id: 'turn',
      request_id: 'request',
      delta: `chunk-${index}`
    })
  )
  source.push(
    event('18446744073709551615', 'model', 'call', {
      turn_id: 'turn',
      request_id: 'second',
      request: { api_key: 'private-secret', messages: ['canonical-payload-only'] }
    })
  )
  const { inspector, data, binding, call, latest, sqlite } = fixture(source)
  expect(inspector.owns('legacy')).toBe(false)
  const tail = await inspector.listPage({ sessionId: 'app', mode: 'tail', limit: 2 })
  expect(tail.status).toBe('ok')
  if (tail.status !== 'ok') throw new Error('missing page')
  expect(tail.records.map((row) => row.dim?.sequence)).toEqual(['205', '18446744073709551615'])
  expect(tail.records[1]).toMatchObject({
    name: 'model/call',
    family: 'attempt',
    requestSeq: 2,
    dim: { semanticName: 'provider/attempt_started' }
  })
  expect(call).toHaveBeenCalledTimes(3)
  expect(latest).not.toHaveBeenCalled()
  const cached = JSON.stringify(
    sqlite.prepare('SELECT fact_json FROM dim_timeline_inspector_facts').all()
  )
  expect(cached).not.toContain('canonical-payload-only')
  expect(cached).not.toContain('private-secret')
  const before = data.dimTimelineInspectorTable.max(data.dimTimelineInspectorTable.head(binding))
  indexDimInspectorEvent(data, binding, source[0])
  expect(data.dimTimelineInspectorTable.max(data.dimTimelineInspectorTable.head(binding))).toBe(
    before
  )
  const older = await inspector.listPage({
    sessionId: 'app',
    mode: 'older',
    cursor: tail.nextCursor!,
    expectedTapeIncarnationId: tail.tapeIncarnationId,
    limit: 2
  })
  expect(older.status === 'ok' && older.records.map((row) => row.dim?.sequence)).toEqual([
    '203',
    '204'
  ])
  const filtered = await inspector.listPage({
    sessionId: 'app',
    mode: 'tail',
    filters: { families: ['attempt'] },
    sort: { column: 'name', direction: 'asc' },
    limit: 1
  })
  expect(filtered.status === 'ok' && filtered.records.map((row) => row.name)).toEqual([
    'model/call'
  ])
  const detail = await inspector.getDetail({
    sessionId: 'app',
    entryId: tail.records[1].entryId,
    expectedTapeIncarnationId: tail.tapeIncarnationId
  })
  expect(detail.status).toBe('ok')
  expect(JSON.stringify(detail)).toContain('canonical-payload-only')
  expect(JSON.stringify(detail)).not.toContain('private-secret')
  expect(latest).toHaveBeenCalledWith(
    { sessionId: 'native', branchId: 'main' },
    ['model/call'],
    expect.objectContaining({ right: { kind: 'value', value: source.at(-1)!.id } }),
    '18446744073709551615'
  )
})

it('rebuilds a lost cache with a new epoch and fences a generation change during detail reads', async () => {
  const { inspector, sqlite, data, binding, latest } = fixture([
    event(1, 'turn', 'start', { turn_id: 'turn' })
  ])
  const page = await inspector.listPage({ sessionId: 'app', mode: 'tail' })
  if (page.status !== 'ok') throw new Error('missing page')
  sqlite.exec('DELETE FROM dim_timeline_inspector_facts')
  const reset = await inspector.listPage({
    sessionId: 'app',
    mode: 'tail',
    expectedTapeIncarnationId: page.tapeIncarnationId
  })
  expect(reset.status).toBe('reset')
  expect(reset.tapeIncarnationId).not.toBe(page.tapeIncarnationId)
  const rebuilt = await inspector.listPage({ sessionId: 'app', mode: 'tail' })
  if (rebuilt.status !== 'ok') throw new Error('missing rebuilt page')
  expect(rebuilt.records).toHaveLength(1)
  latest.mockImplementationOnce(async () => {
    data.dimSessionBindingsTable.replace(binding, {
      ...binding,
      dimSessionId: 'replacement',
      generation: 2
    })
    return { event: event(1, 'turn', 'start', { turn_id: 'turn' }), through: '1' }
  })
  const detail = await inspector.getDetail({
    sessionId: 'app',
    entryId: rebuilt.records[0].entryId,
    expectedTapeIncarnationId: rebuilt.tapeIncarnationId
  })
  expect(detail.status).toBe('reset')
  expect(detail).not.toHaveProperty('detail')
})

it('backfills history before accepting live index updates and counts tool completion once', async () => {
  const events = [
    event(1, 'turn', 'start', { turn_id: 'turn' }),
    event(2, 'step', 'tool-use', {
      turn_id: 'turn',
      request_id: 'request',
      call: { id: 'call', name: 'read' }
    }),
    event(3, 'step', 'tool-completed', {
      turn_id: 'turn',
      request_id: 'request',
      call_id: 'call',
      result: { isError: false }
    }),
    event(4, 'step', 'tool-result', {
      turn_id: 'turn',
      request_id: 'request',
      results: [{ call_id: 'call', result: { isError: false } }]
    })
  ]
  const { inspector, binding, data, sqlite } = fixture(events)
  const projection = new DimProjectionStore(data)
  // An upgraded desktop already has a transcript cursor, but no inspector cache yet.
  data.dimSessionBindingsTable.advance(binding, { ...binding, cursor: '3' })
  projection.apply(data.dimSessionBindingsTable.get('app')!, events[3])
  expect(data.dimTimelineInspectorTable.head(binding).cursor).toBe('0')
  const page = await inspector.listPage({ sessionId: 'app', mode: 'tail' })
  if (page.status !== 'ok') throw new Error('missing page')
  expect(page.records).toHaveLength(4)
  const outcomes = page.records.filter((row) => row.dim?.semanticName === 'execution/tool_outcome')
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0].facts).toMatchObject({ toolName: 'read', isError: false })
  expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%tape%'").all()).toEqual(
    []
  )
})
