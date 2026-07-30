import { describe, expect, it, vi } from 'vitest'
import { SettingsLeaveGuard } from '../../../src/renderer/settings/services/settingsLeaveGuard'
import { installSettingsRouteLeaveGuard } from '../../../src/renderer/settings/services/settingsRouteLeaveGuard'

describe('settings route leave guard', () => {
  it('blocks real router navigation until the user decides and unregisters cleanly', async () => {
    const { createMemoryHistory, createRouter, isNavigationFailure, NavigationFailureType } =
      await vi.importActual<typeof import('vue-router')>('vue-router')
    const routeComponent = { template: '<div />' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/first', component: routeComponent },
        { path: '/second', component: routeComponent }
      ]
    })
    await router.push('/first')

    const guard = new SettingsLeaveGuard()
    const onDiscard = vi.fn()
    const lease = guard.register({ id: 'route-test', onDiscard })
    const removeGuard = installSettingsRouteLeaveGuard(router, guard)
    lease.setRisk('dirty')

    const canceledNavigation = router.push('/second')
    await vi.waitFor(() => {
      expect(guard.getSnapshot().promptOpen).toBe(true)
    })
    guard.cancelLeave()

    expect(isNavigationFailure(await canceledNavigation, NavigationFailureType.aborted)).toBe(true)
    expect(router.currentRoute.value.path).toBe('/first')
    expect(onDiscard).not.toHaveBeenCalled()

    const allowedNavigation = router.push('/second')
    await vi.waitFor(() => {
      expect(guard.getSnapshot().promptOpen).toBe(true)
    })
    expect(guard.discardAndLeave()).toBe(true)

    await expect(allowedNavigation).resolves.toBeUndefined()
    expect(router.currentRoute.value.path).toBe('/second')
    expect(onDiscard).toHaveBeenCalledOnce()

    lease.setRisk('dirty')
    removeGuard()
    await expect(router.push('/first')).resolves.toBeUndefined()
    expect(router.currentRoute.value.path).toBe('/first')
    expect(guard.getSnapshot().promptOpen).toBe(false)
    lease.release()
  })
})
