import { expect, it, vi } from 'vitest'
import type { DimContent } from '@/agent/dim/content'
import { DimMemoryViews } from '@/agent/dim/memoryViews'
import { dimDatabase } from './fixtures/database'

function fixture() {
  const database = dimDatabase()
  database.data.newSessionsTable.create('product', 'agent', 'Session', null)
  const binding = database.data.dimSessionBindingsTable.bind('product', 'native')
  const events = vi.fn<DimContent['events']>()
  const transcript = vi.fn<DimContent['transcript']>()
  const views = new DimMemoryViews({ database: database.data, content: { events, transcript } })
  return { ...database, binding, events, transcript, views }
}

function audit(sequence: string, branchId = 'main') {
  return {
    event: {
      id: `audit-${sequence}`,
      sequence,
      create_at: 100,
      type: 'deepchat',
      name: 'memory-audit',
      data: {
        name: 'memory/view_assembled',
        state: { selected: ['one', { id: 'two' }], dropped: [], tokenBudget: 500 },
        meta: { messageId: 'turn' }
      }
    },
    position: { branch_id: branchId, sequence }
  }
}

it('reads retired owned generations with lossless descending pagination and no Tape', async () => {
  const { data, sqlite, binding, events, views } = fixture()
  data.dimSessionBindingsTable.replace(binding, {
    ...binding,
    dimSessionId: 'new-native',
    generation: 2
  })
  const head = 9007199254741500n
  const rows = Array.from({ length: 202 }, (_, index) => audit(String(head - BigInt(index))))
  events
    .mockResolvedValueOnce({ events: rows.slice(0, 200), through: String(head) })
    .mockResolvedValueOnce({ events: rows.slice(200), through: String(head) })
    .mockResolvedValueOnce({ events: [], through: '0' })
  try {
    const manifests = await views.list('agent', { limit: 202 })
    expect(manifests).toHaveLength(202)
    expect(manifests[0]).toMatchObject({
      entryId: null,
      selectedIds: ['one', 'two'],
      timeline: { sessionId: 'native', branchId: 'main', sequence: String(head) }
    })
    expect(events.mock.calls[1]).toEqual([
      { sessionId: 'native', branchId: 'main' },
      ['deepchat/memory-audit'],
      2,
      expect.objectContaining({
        conditions: expect.arrayContaining([
          expect.objectContaining({
            comparison: 'lt',
            right: { kind: 'value', value: String(head - 199n) }
          })
        ])
      }),
      String(head)
    ])
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%tape%'").all()).toEqual(
      []
    )
  } finally {
    sqlite.close()
  }
})

it('rejects ownership removal during reads and excludes another agent before querying', async () => {
  const { data, sqlite, events, views } = fixture()
  try {
    expect(await views.list('other-agent', { sessionId: 'product' })).toEqual([])
    expect(events).not.toHaveBeenCalled()
    events.mockImplementationOnce(async () => {
      data.dimSessionScopesTable.delete('product')
      return { events: [audit('42')], through: '42' }
    })
    await expect(views.list('agent')).rejects.toThrow('owner changed')
  } finally {
    sqlite.close()
  }
})

it('rejects inherited branch coordinates rather than attributing another branch to the product', async () => {
  const { sqlite, events, views } = fixture()
  events.mockResolvedValueOnce({ events: [audit('42', 'foreign')], through: '42' })
  try {
    await expect(views.list('agent')).rejects.toThrow('Invalid native memory view query result')
  } finally {
    sqlite.close()
  }
})
