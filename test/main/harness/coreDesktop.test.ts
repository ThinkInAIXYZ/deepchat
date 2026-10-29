import { expect, it, vi } from 'vitest'
import { CoreNativeDesktop } from '../../../src/harness/core/desktop'
import type { CoreKernelNative } from '../../../src/harness/core/kernel'
import { CoreDesktopNative } from '@/harness/desktop'

vi.unmock('path')
vi.unmock('node:path')

it('cancels reordered Native calls and releases completed cancellation identities', async () => {
  const failed = vi.fn()
  const read = vi.fn(async () => ({ width: 10, height: 20 }))
  const native = new CoreDesktopNative(
    { agentDesktop: { readImageSize: read } } as unknown as CoreKernelNative,
    async () => {},
    async () => {},
    failed
  )
  let held:
    | {
        position: 'admission' | 'reply'
        entered: ReturnType<typeof Promise.withResolvers<void>>
        release: ReturnType<typeof Promise.withResolvers<void>>
      }
    | undefined
  const core = new CoreNativeDesktop(
    async (command) => {
      if (command.operation !== 'call' || !held) return await native.invoke([command])
      const gate = held
      if (gate.position === 'admission') {
        gate.entered.resolve()
        await gate.release.promise
      }
      const result = await native.invoke([command])
      if (gate.position === 'reply') {
        gate.entered.resolve()
        await gate.release.promise
      }
      return result
    },
    () => {},
    failed
  )
  const ports = await core.createPorts({ temporaryDirectory: '/tmp', profileDirectory: '/profile' })
  try {
    for (let i = 0; i < 84; i++) {
      held = {
        position: i === 0 ? 'admission' : 'reply',
        entered: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>()
      }
      const signal = new AbortController()
      const canceled = new Error(`canceled ${i}`)
      const call = ports.agentDesktop.readImageSize('/image', signal.signal)
      const rejected = expect(call).rejects.toBe(canceled)
      await held.entered.promise
      signal.abort(canceled)
      await Promise.resolve()
      held.release.resolve()
      await rejected
    }
    held = undefined
    expect(read).toHaveBeenCalledTimes(83)
    expect(await ports.agentDesktop.readImageSize('/image')).toEqual({ width: 10, height: 20 })
    expect(failed).not.toHaveBeenCalled()
  } finally {
    held?.release.resolve()
    await core.close()
  }
})

it('owns renderer subscriptions until registration and waits for physical Native closure', async () => {
  const callbacks = new Map<number, () => void>()
  const disposed = vi.fn()
  const failed = vi.fn()
  const release = Promise.withResolvers<void>()
  const registration = Promise.withResolvers<void>()
  const native = new CoreDesktopNative(
    {
      onRendererDestroyed: (id, listener) => {
        callbacks.set(id, listener)
        return () => {
          callbacks.delete(id)
          disposed()
        }
      }
    } as CoreKernelNative,
    async (event) => core.accept(event),
    async () => await release.promise,
    failed
  )
  const core = new CoreNativeDesktop(
    async (command) => {
      if (command.operation === 'watch') await registration.promise
      return await native.invoke([command])
    },
    () => {},
    failed
  )
  const ports = await core.createPorts({ temporaryDirectory: '/tmp', profileDirectory: '/profile' })
  const first = vi.fn()
  const second = vi.fn()
  const stopFirst = ports.onRendererDestroyed(7, first)
  const stopSecond = ports.onRendererDestroyed(7, second)
  stopFirst()
  registration.resolve()
  await vi.waitFor(() => expect(callbacks.has(7)).toBe(true))
  callbacks.get(7)!()
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledOnce()
  stopSecond()
  await vi.waitFor(() => expect(disposed).toHaveBeenCalledOnce())
  let closed = false
  const closing = core.close().then(() => {
    closed = true
  })
  await Promise.resolve()
  expect(closed).toBe(false)
  await expect(ports.getProxyUrl()).rejects.toThrow('stopping')
  release.resolve()
  await closing
  expect(callbacks.size).toBe(0)
  expect(failed).not.toHaveBeenCalled()
})
