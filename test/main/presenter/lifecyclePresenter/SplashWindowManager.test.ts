import { afterEach, describe, expect, it } from 'vitest'
import { eventBus } from '../../../../src/main/eventbus'
import { LIFECYCLE_EVENTS } from '../../../../src/main/events'
import { SplashWindowManager } from '../../../../src/main/presenter/lifecyclePresenter/SplashWindowManager'
import { LifecyclePhase } from '../../../../src/shared/lifecycle'

describe('SplashWindowManager', () => {
  let manager: SplashWindowManager | null = null

  afterEach(async () => {
    if (!manager) {
      return
    }

    await manager.close()
    manager = null
  })

  it('removes lifecycle listeners and clears activities on close', async () => {
    const initialHookExecutedCount = eventBus.listenerCount(LIFECYCLE_EVENTS.HOOK_EXECUTED)
    const initialHookCompletedCount = eventBus.listenerCount(LIFECYCLE_EVENTS.HOOK_COMPLETED)
    const initialHookFailedCount = eventBus.listenerCount(LIFECYCLE_EVENTS.HOOK_FAILED)
    const initialErrorOccurredCount = eventBus.listenerCount(LIFECYCLE_EVENTS.ERROR_OCCURRED)

    manager = new SplashWindowManager()

    expect(eventBus.listenerCount(LIFECYCLE_EVENTS.HOOK_EXECUTED)).toBe(
      initialHookExecutedCount + 1
    )
    expect(eventBus.listenerCount(LIFECYCLE_EVENTS.HOOK_COMPLETED)).toBe(
      initialHookCompletedCount + 1
    )
    expect(eventBus.listenerCount(LIFECYCLE_EVENTS.HOOK_FAILED)).toBe(initialHookFailedCount + 1)
    expect(eventBus.listenerCount(LIFECYCLE_EVENTS.ERROR_OCCURRED)).toBe(
      initialErrorOccurredCount + 1
    )

    eventBus.sendToMain(LIFECYCLE_EVENTS.HOOK_EXECUTED, {
      phase: LifecyclePhase.INIT,
      name: 'bootstrap'
    })

    expect((manager as any).activities.size).toBe(1)

    await manager.close()

    expect(eventBus.listenerCount(LIFECYCLE_EVENTS.HOOK_EXECUTED)).toBe(initialHookExecutedCount)
    expect(eventBus.listenerCount(LIFECYCLE_EVENTS.HOOK_COMPLETED)).toBe(initialHookCompletedCount)
    expect(eventBus.listenerCount(LIFECYCLE_EVENTS.HOOK_FAILED)).toBe(initialHookFailedCount)
    expect(eventBus.listenerCount(LIFECYCLE_EVENTS.ERROR_OCCURRED)).toBe(initialErrorOccurredCount)
    expect((manager as any).activities.size).toBe(0)

    eventBus.sendToMain(LIFECYCLE_EVENTS.HOOK_EXECUTED, {
      phase: LifecyclePhase.INIT,
      name: 'bootstrap-again'
    })

    expect((manager as any).activities.size).toBe(0)
    manager = null
  })
})
