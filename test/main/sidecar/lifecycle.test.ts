import { describe, expect, it, vi } from 'vitest'
import { SidecarLifecycle } from '@/sidecar/lifecycle'

describe('SidecarLifecycle', () => {
  it('waits for the business quit approval instead of exiting at prevention', async () => {
    const lifecycle = new SidecarLifecycle(() => false)
    const stopped = lifecycle.shutdown()

    expect(lifecycle.isStopping()).toBe(true)
    lifecycle.notifyQuitRequested()

    await expect(stopped).resolves.toBeUndefined()
  })

  it('shares one shutdown attempt and immediately honors an early quit', async () => {
    const beforeQuit = vi.fn(() => false)
    const lifecycle = new SidecarLifecycle(beforeQuit)
    const first = lifecycle.shutdown()
    const second = lifecycle.shutdown()

    expect(first).toBe(second)
    expect(beforeQuit).toHaveBeenCalledTimes(1)

    lifecycle.notifyQuitRequested()
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    await expect(lifecycle.shutdown()).resolves.toBeUndefined()
    expect(beforeQuit).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate before-quit when approval arrived during startup failure', async () => {
    const beforeQuit = vi.fn(() => true)
    const lifecycle = new SidecarLifecycle(beforeQuit)
    lifecycle.notifyQuitRequested()

    await expect(lifecycle.shutdown()).resolves.toBeUndefined()
    expect(beforeQuit).not.toHaveBeenCalled()
  })

  it('surfaces before-quit failure without marking the attempt completed', async () => {
    const failure = new Error('stop failed')
    const beforeQuit = vi
      .fn<() => boolean>()
      .mockImplementationOnce(() => {
        throw failure
      })
      .mockReturnValueOnce(true)
    const lifecycle = new SidecarLifecycle(beforeQuit)

    await expect(lifecycle.shutdown()).rejects.toBe(failure)
    expect(lifecycle.isStopping()).toBe(false)
    await expect(lifecycle.shutdown()).resolves.toBeUndefined()
    expect(beforeQuit).toHaveBeenCalledTimes(2)
  })
})
