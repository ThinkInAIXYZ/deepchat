import { describe, expect, it, vi } from 'vitest'
import { MainShutdownCoordinator } from '@/app/mainShutdownCoordinator'

describe('MainShutdownCoordinator', () => {
  it('gives one explicit request ownership of teardown and the terminal action', async () => {
    let completeTeardown!: () => void
    const teardown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeTeardown = resolve
        })
    )
    const observer = { started: vi.fn(), terminal: vi.fn() }
    const coordinator = new MainShutdownCoordinator(teardown, observer, () => 10)

    const update = coordinator.request('update_install')
    const restart = coordinator.request('restart')
    completeTeardown()

    await expect(update).resolves.toBe(true)
    await expect(restart).resolves.toBe(false)
    expect(teardown).toHaveBeenCalledOnce()
    expect(observer.started).toHaveBeenCalledOnce()
    expect(observer.started).toHaveBeenCalledWith('update_install')
    expect(observer.terminal).toHaveBeenCalledOnce()
    expect(observer.terminal).toHaveBeenCalledWith({ outcome: 'completed', durationMs: 0 })
  })

  it('keeps cleanup silent and lets a later explicit request own the terminal action', async () => {
    const observer = { started: vi.fn(), terminal: vi.fn() }
    const coordinator = new MainShutdownCoordinator(
      async () => undefined,
      observer,
      () => 10
    )

    await coordinator.cleanup()
    expect(observer.started).not.toHaveBeenCalled()
    expect(observer.terminal).not.toHaveBeenCalled()

    await expect(coordinator.request('app_quit')).resolves.toBe(true)
    expect(observer.started).toHaveBeenCalledWith('app_quit')
    expect(observer.terminal).toHaveBeenCalledWith({ outcome: 'completed', durationMs: 0 })
  })

  it('contains observer failures without changing teardown failure behavior', async () => {
    const failure = new Error('teardown failed')
    const observer = {
      started: vi.fn(() => {
        throw new Error('observer failed')
      }),
      terminal: vi.fn(() => {
        throw new Error('observer failed')
      })
    }
    const coordinator = new MainShutdownCoordinator(async () => {
      throw failure
    }, observer)

    await expect(coordinator.request('restart')).rejects.toBe(failure)
    expect(observer.started).toHaveBeenCalledOnce()
    expect(observer.terminal).toHaveBeenCalledWith({
      outcome: 'failed',
      durationMs: expect.any(Number)
    })
  })
})
