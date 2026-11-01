import { describe, expect, it, vi } from 'vitest'
import { DatabaseRequestGate } from '@/app/databaseRequestGate'
import { StartupWorkloadCoordinator } from '@/app/startupWorkloadCoordinator'
import { createRouteDispatcher, dispatchDeepchatRoute } from '@/routes'
import {
  createRendererRouteContext,
  createRouteMap,
  type DeepchatRouteHandler
} from '@/routes/routeRegistry'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createRuntime(handler: DeepchatRouteHandler) {
  const gate = new DatabaseRequestGate(() => undefined)
  const coordinator = new StartupWorkloadCoordinator()
  const dispatcher = createRouteDispatcher({
    appDatabaseMaintenance: gate,
    routeMaps: [createRouteMap([['models.getProviderCatalog', handler]])],
    isSettingsWindow: async (windowId) => windowId === 99,
    startupWorkloadCoordinator: coordinator
  })
  const dispatch = (providerId = 'fixture', webContentsId = 42) =>
    dispatchDeepchatRoute(
      dispatcher,
      'models.getProviderCatalog',
      { providerId },
      createRendererRouteContext(webContentsId, 99)
    )
  return { gate, coordinator, dispatch }
}

describe('database requests scheduled as startup work', () => {
  it('keeps concurrent route arguments and callers independent', async () => {
    const release = deferred<void>()
    const handler = vi.fn<DeepchatRouteHandler>(async (input, context) => {
      await release.promise
      return { input, caller: context.caller }
    })
    const { dispatch } = createRuntime(handler)
    const requests = [dispatch('alpha'), dispatch('beta'), dispatch('alpha', 43)]
    try {
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2))
    } finally {
      release.resolve()
    }
    await expect(Promise.all(requests)).resolves.toEqual(
      (
        [
          ['alpha', 42],
          ['beta', 42],
          ['alpha', 43]
        ] as const
      ).map(([providerId, webContentsId]) => ({
        input: { providerId },
        caller: createRendererRouteContext(webContentsId, 99).caller
      }))
    )
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('rechecks admission after an awaited native window query', async () => {
    const gate = new DatabaseRequestGate(() => undefined)
    const authority = Promise.withResolvers<boolean>()
    const handler = vi.fn(async () => ({ models: [] }))
    const dispatcher = createRouteDispatcher({
      appDatabaseMaintenance: gate,
      routeMaps: [createRouteMap([['models.getProviderCatalog', handler]])],
      isSettingsWindow: () => authority.promise,
      startupWorkloadCoordinator: new StartupWorkloadCoordinator()
    })
    const pending = dispatchDeepchatRoute(
      dispatcher,
      'models.getProviderCatalog',
      { providerId: 'fixture' },
      createRendererRouteContext(42, 99)
    )
    const rejected = expect(pending).rejects.toThrow('maintenance is maintenance')
    gate.beginMaintenance()
    const drain = gate.drain()
    expect(handler).not.toHaveBeenCalled()
    authority.resolve(false)
    await rejected
    await drain
    expect(handler).not.toHaveBeenCalled()
    gate.resume()
  })

  it('rechecks admission before queued work actually executes', async () => {
    const handler = vi.fn(async () => ({ models: [] }))
    const { gate, coordinator, dispatch } = createRuntime(handler)
    const release = deferred<void>()
    const blockers = [0, 1].map((index) =>
      coordinator.scheduleTask({
        id: `blocker-${index}`,
        target: 'settings',
        phase: 'deferred',
        resource: 'io',
        labelKey: 'startup.test',
        run: () => release.promise
      })
    )
    const rejected = expect(dispatch()).rejects.toThrow('maintenance is maintenance')
    gate.beginMaintenance()
    const drain = gate.drain()
    release.resolve()
    await Promise.all(blockers)
    await rejected
    await drain
    expect(handler).not.toHaveBeenCalled()
    gate.resume()
  })

  it('drains the running handler after cancellation settles its scheduled reply', async () => {
    const entered = deferred<void>()
    const release = deferred<{ models: never[] }>()
    const { gate, coordinator, dispatch } = createRuntime(async () => {
      entered.resolve()
      return await release.promise
    })
    const pending = dispatch()
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    gate.beginMaintenance()
    coordinator.cancelTarget('settings')
    await rejected
    let drained = false
    const drain = gate.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    release.resolve({ models: [] })
    await drain
    gate.resume()
  })
})
