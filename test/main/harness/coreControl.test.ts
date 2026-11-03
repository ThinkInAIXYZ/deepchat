import { afterEach, expect, it, vi } from 'vitest'
import { CoreHarnessControl } from '../../../src/harness/core/control'
import type { HarnessControlCommand } from '@shared/harness/control'

afterEach(() => vi.useRealTimers())

function receipt(revision: number, result: unknown = null) {
  return { protocol: 1, revision, outcome: 'accepted', scope: null, result, fences: [], grants: [] }
}

it('applies local fences and acknowledges a transition before submitting its successor', async () => {
  const prepared = Promise.withResolvers<unknown>()
  const committed = Promise.withResolvers<unknown>()
  const calls: Array<{ sequence: number; command: HarnessControlCommand }> = []
  const control = new CoreHarnessControl(
    {
      async control(_generation, sequence, command) {
        calls.push({ sequence, command })
        return sequence === 1
          ? await prepared.promise
          : sequence === 2
            ? await committed.promise
            : receipt(sequence)
      }
    },
    'generation',
    () => {
      throw new Error('Unexpected control failure')
    }
  )
  const fences = vi.fn(() => true)
  const first = control.transition(
    { method: 'prepareOperation', scopeId: 'scope', operationId: 'operation' },
    fences
  )
  const successor = control.send({ method: 'clearReady', scopeId: 'scope' })
  await vi.waitFor(() => expect(calls).toHaveLength(1))
  prepared.resolve(receipt(1, { transitionId: 'operation' }))
  await vi.waitFor(() => expect(calls).toHaveLength(2))
  expect(fences).toHaveBeenCalledOnce()
  expect(calls[1]).toEqual({
    sequence: 2,
    command: {
      method: 'commit',
      scopeId: 'scope',
      transitionId: 'operation',
      aborted: true
    }
  })
  committed.resolve(receipt(2))
  await first
  await successor
  expect(calls.map(({ sequence }) => sequence)).toEqual([1, 2, 3])
  expect(fences).toHaveBeenCalledTimes(2)
  control.stop()
})

it('fences unknown outcomes without replaying queued work or applying a late receipt', async () => {
  vi.useFakeTimers()
  const late = Promise.withResolvers<unknown>()
  const service = { control: vi.fn(() => late.promise) }
  const failOwner = vi.fn()
  const closed = vi.fn()
  const apply = vi.fn()
  const control = new CoreHarnessControl(service, 'generation', failOwner)
  control.onClose(closed)
  const first = control.send({ method: 'open', sessionId: 'session', scopeId: 'scope' }, apply)
  const successor = control.send({ method: 'clearReady', scopeId: 'scope' }, apply)
  const rejected = Promise.all([
    expect(first).rejects.toThrow('timed out'),
    expect(successor).rejects.toThrow('timed out')
  ])
  await vi.advanceTimersByTimeAsync(10_000)
  await rejected
  late.resolve(receipt(1))
  await Promise.resolve()
  expect(control.closed).toBe(true)
  expect(closed).toHaveBeenCalledOnce()
  expect(failOwner).toHaveBeenCalledOnce()
  expect(service.control).toHaveBeenCalledOnce()
  expect(apply).not.toHaveBeenCalled()
  await expect(control.send({ method: 'release', scopeId: 'scope' })).rejects.toThrow('timed out')
})
