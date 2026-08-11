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

    expect(await update).toEqual({ run: expect.any(Function), abandon: expect.any(Function) })
    await expect(restart).resolves.toBeUndefined()
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

    expect(await coordinator.request('app_quit')).toEqual({
      run: expect.any(Function),
      abandon: expect.any(Function)
    })
    expect(observer.started).toHaveBeenCalledWith('app_quit')
    expect(observer.terminal).toHaveBeenCalledWith({ outcome: 'completed', durationMs: 0 })
  })

  it('lets a later quit own the terminal action when the winning action fails', async () => {
    const failure = new Error('restart failed')
    const observer = { started: vi.fn(), terminal: vi.fn(), actionFailed: vi.fn() }
    const coordinator = new MainShutdownCoordinator(
      async () => undefined,
      observer,
      () => 10
    )

    const restartClaim = await coordinator.request('restart')
    expect(restartClaim).toBeDefined()

    await expect(
      restartClaim?.run(async () => {
        throw failure
      })
    ).rejects.toThrow('restart failed')
    const quitClaim = await coordinator.request('app_quit')

    expect(quitClaim).toBeDefined()
    expect(observer.started.mock.calls.map(([reason]) => reason)).toEqual(['restart', 'app_quit'])
    expect(observer.actionFailed).toHaveBeenCalledWith({
      reason: 'restart',
      durationMs: 0,
      error: failure
    })
  })

  it('contains action-failure observer errors without replacing the action error', async () => {
    const actionError = new Error('install failed')
    const coordinator = new MainShutdownCoordinator(async () => undefined, {
      started: vi.fn(),
      terminal: vi.fn(),
      actionFailed: vi.fn(() => {
        throw new Error('observer failed')
      })
    })
    const claim = await coordinator.request('update_install')

    await expect(
      claim?.run(() => {
        throw actionError
      })
    ).rejects.toBe(actionError)
  })

  it('rejects a stale claim after a later request owns the terminal action', async () => {
    const observer = { started: vi.fn(), terminal: vi.fn() }
    const coordinator = new MainShutdownCoordinator(async () => undefined, observer)
    const staleClaim = await coordinator.request('restart')
    staleClaim?.abandon()
    expect(await coordinator.request('app_quit')).toBeDefined()
    const staleAction = vi.fn()

    await expect(staleClaim?.run(staleAction)).rejects.toThrow(
      'Main shutdown action claim is not active'
    )
    expect(staleAction).not.toHaveBeenCalled()
  })

  it('runs a terminal action once and keeps ownership after success', async () => {
    let completeAction!: () => void
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeAction = resolve
        })
    )
    const coordinator = new MainShutdownCoordinator(async () => undefined, {
      started: vi.fn(),
      terminal: vi.fn()
    })
    const claim = await coordinator.request('restart')
    const firstRun = claim?.run(action)

    await expect(claim?.run(action)).rejects.toThrow('Main shutdown action claim is not active')
    completeAction()
    await firstRun
    claim?.abandon()

    expect(action).toHaveBeenCalledOnce()
    await expect(coordinator.request('app_quit')).resolves.toBeUndefined()
  })

  it('contains observer failures and keeps teardown failures one-shot', async () => {
    const failure = new Error('teardown failed')
    const observer = {
      started: vi.fn(() => {
        throw new Error('observer failed')
      }),
      terminal: vi.fn(() => {
        throw new Error('observer failed')
      })
    }
    const teardown = vi.fn(async () => {
      throw failure
    })
    const coordinator = new MainShutdownCoordinator(teardown, observer)

    await expect(coordinator.request('restart')).rejects.toBe(failure)
    await expect(coordinator.request('app_quit')).rejects.toBe(failure)
    expect(teardown).toHaveBeenCalledOnce()
    expect(observer.started).toHaveBeenCalledTimes(2)
    expect(observer.terminal).toHaveBeenCalledWith({
      outcome: 'failed',
      durationMs: expect.any(Number)
    })
  })

  it('reports best-effort teardown degradation without blocking the terminal action', async () => {
    const observer = { started: vi.fn(), terminal: vi.fn() }
    const action = vi.fn()
    const coordinator = new MainShutdownCoordinator(
      async () => 'failed',
      observer,
      () => 10
    )

    const claim = await coordinator.request('app_quit')
    await claim?.run(action)

    expect(observer.terminal).toHaveBeenCalledWith({ outcome: 'failed', durationMs: 0 })
    expect(action).toHaveBeenCalledOnce()
  })

  it('keeps shutdown ownership usable when the diagnostic clock throws', async () => {
    const actionError = new Error('restart failed')
    const observer = { started: vi.fn(), terminal: vi.fn(), actionFailed: vi.fn() }
    const now = vi.fn(() => {
      throw new Error('clock unavailable')
    })
    const coordinator = new MainShutdownCoordinator(async () => undefined, observer, now)

    const restartClaim = await coordinator.request('restart')
    expect(observer.started).toHaveBeenCalledWith('restart')
    expect(observer.terminal).toHaveBeenCalledWith({ outcome: 'completed' })

    await expect(
      restartClaim?.run(() => {
        throw actionError
      })
    ).rejects.toBe(actionError)
    expect(observer.actionFailed).toHaveBeenCalledWith({ reason: 'restart', error: actionError })
    await expect(coordinator.request('app_quit')).resolves.toBeDefined()
  })

  it('omits duration when only the terminal clock reading fails', async () => {
    const observer = { started: vi.fn(), terminal: vi.fn() }
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(10)
      .mockImplementation(() => {
        throw new Error('clock unavailable')
      })
    const coordinator = new MainShutdownCoordinator(async () => undefined, observer, now)

    await expect(coordinator.request('app_quit')).resolves.toBeDefined()
    expect(observer.terminal).toHaveBeenCalledWith({ outcome: 'completed' })
  })
})
