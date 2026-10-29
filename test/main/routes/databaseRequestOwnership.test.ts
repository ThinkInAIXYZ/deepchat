import { describe, expect, it, vi } from 'vitest'
import { DatabaseRequestGate } from '@/app/databaseRequestGate'
import { StartupWorkloadCoordinator } from '@/app/startupWorkloadCoordinator'
import { createRouteDispatcher, dispatchDeepchatRoute } from '@/routes'
import { createRendererRouteContext, createRouteMap } from '@/routes/routeRegistry'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createRuntime(handler: () => Promise<unknown>) {
  const gate = new DatabaseRequestGate(() => undefined)
  const coordinator = new StartupWorkloadCoordinator()
  const dispatcher = createRouteDispatcher({
    appDatabaseMaintenance: gate,
    routeMaps: [createRouteMap([['models.getProviderCatalog', handler]])],
    settingsWindow: { getSettingsWindowId: () => 99 },
    startupWorkloadCoordinator: coordinator
  })
  const dispatch = () =>
    dispatchDeepchatRoute(
      dispatcher,
      'models.getProviderCatalog',
      { providerId: 'fixture' },
      createRendererRouteContext(42, 99)
    )
  return { gate, coordinator, dispatch }
}

describe('database requests scheduled as startup work', () => {
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
