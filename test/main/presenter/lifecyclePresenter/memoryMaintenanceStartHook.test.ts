import { describe, expect, it, vi, beforeEach } from 'vitest'
import { LifecyclePhase } from '@shared/lifecycle'

const { startBackgroundMaintenance } = vi.hoisted(() => ({
  startBackgroundMaintenance: vi.fn()
}))

vi.mock('@/presenter', () => ({
  presenter: {
    memoryPresenter: {
      startBackgroundMaintenance
    }
  }
}))

const { memoryMaintenanceStartHook } =
  await import('@/presenter/lifecyclePresenter/hooks/after-start/memoryMaintenanceStartHook')

describe('memoryMaintenanceStartHook', () => {
  beforeEach(() => {
    startBackgroundMaintenance.mockClear()
  })

  it('starts memory maintenance after app start with low priority', async () => {
    expect(memoryMaintenanceStartHook.name).toBe('memory-maintenance-start')
    expect(memoryMaintenanceStartHook.phase).toBe(LifecyclePhase.AFTER_START)
    expect(memoryMaintenanceStartHook.priority).toBe(30)
    expect(memoryMaintenanceStartHook.critical).toBe(false)

    await memoryMaintenanceStartHook.execute({} as never)

    expect(startBackgroundMaintenance).toHaveBeenCalledTimes(1)
  })
})
