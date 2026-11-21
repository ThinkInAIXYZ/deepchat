import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { DimModelBridge } from '@/agent/dim/modelBridge'

function fixture() {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const result = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  const client = Object.assign(new EventEmitter(), {
    call: vi.fn(() => result),
    close: vi.fn(() => reject(new Error('connection closed')))
  })
  const bridge = new DimModelBridge({ openConnection: async () => client } as never)
  const stream = bridge.stream(
    { providerId: 'native', modelId: 'fixture' },
    {
      messages: [{ role: 'user', content: 'request' }]
    }
  )
  const notice = (sequence: string) =>
    client.emit('notification', {
      method: 'management.progress',
      params: {
        method: 'deepchat.native.stream',
        data: { sequence, event: { type: 'text', content: 'partial' } }
      }
    })
  return { client, stream, resolve, notice }
}

it.each(['sequence gap', 'missing final progress'])(
  'rejects %s instead of returning truncated model output',
  async (fault) => {
    const { client, stream, resolve, notice } = fixture()
    const first = stream.next()
    const failed = expect(first).rejects.toThrow('lost')
    await vi.waitFor(() => expect(client.call).toHaveBeenCalledOnce())
    if (fault === 'sequence gap') notice('2')
    else resolve({ eventCount: '1' })
    await failed
    expect(client.close).toHaveBeenCalled()
  }
)

it('closes and joins its native call when the consumer stops before HTTP completes', async () => {
  const { client, stream, notice } = fixture()
  const first = stream.next()
  await vi.waitFor(() => expect(client.call).toHaveBeenCalledOnce())
  notice('1')
  expect(await first).toEqual({ value: { type: 'text', content: 'partial' }, done: false })
  await expect(stream.return(undefined)).resolves.toEqual({ value: undefined, done: true })
  expect(client.close).toHaveBeenCalledOnce()
  expect(client.listenerCount('notification')).toBe(0)
})
