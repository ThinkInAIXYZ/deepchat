import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import type { JsonValue } from '@shared/contracts/json'
import { DimSessionConnection, type DimEvent } from '@/agent/dim/sessionConnection'

it('replays committed history when notifications arrive out of order or miss a fact', async () => {
  const history: DimEvent[] = []
  class Client extends EventEmitter {
    async call<T>(method: string, params: JsonValue = {}): Promise<T> {
      if (method === 'deepchat.host.subscribe') return { watchId: 'watch' } as T
      if (method === 'deepchat.storage.history') {
        const { after } = params as { after: string }
        return {
          through: history.at(-1)?.sequence ?? 0,
          events: history.filter((event) => BigInt(event.sequence) > BigInt(after))
        } as T
      }
      return {} as T
    }
  }
  const client = new Client()
  const consumed: string[] = []
  const errors: unknown[] = []
  const reader = new DimSessionConnection(
    client,
    { sessionId: 'session', branchId: 'main' },
    (event) => {
      consumed.push(event.id)
    },
    (error) => errors.push(error)
  )
  await reader.start()
  history.push(
    ...[1, 2, 3].map((sequence) => ({
      id: `event-${sequence}`,
      sequence,
      create_at: 1,
      type: 'step',
      name: 'text',
      data: {}
    }))
  )
  for (const index of [2, 0])
    client.emit('notification', {
      method: 'deepchat.host.event',
      params: { watchId: 'watch', event: history[index] }
    })
  await reader.waitIdle()
  expect(consumed).toEqual(['event-1', 'event-2', 'event-3'])
  expect(reader.cursor).toBe('3')
  expect(errors).toEqual([])
  await reader.close()
})
