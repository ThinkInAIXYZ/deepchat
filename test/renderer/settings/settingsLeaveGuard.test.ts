import { describe, expect, it, vi } from 'vitest'
import { SettingsLeaveGuard } from '../../../src/renderer/settings/services/settingsLeaveGuard'

describe('SettingsLeaveGuard', () => {
  it('allows leaving immediately when no registered surface has data at risk', async () => {
    const guard = new SettingsLeaveGuard()

    await expect(guard.requestLeave()).resolves.toBe(true)
    expect(guard.getSnapshot()).toMatchObject({ risk: 'clean', promptOpen: false })
  })

  it('keeps dirty data until the user explicitly discards it', async () => {
    const guard = new SettingsLeaveGuard()
    const onDiscard = vi.fn()
    const lease = guard.register({ id: 'agent-editor', onDiscard })
    lease.setRisk('dirty')

    const leave = guard.requestLeave()
    expect(guard.getSnapshot()).toMatchObject({ risk: 'dirty', promptOpen: true })
    expect(guard.discardAndLeave()).toBe(true)

    await expect(leave).resolves.toBe(true)
    expect(onDiscard).toHaveBeenCalledOnce()
    expect(guard.getSnapshot()).toMatchObject({ risk: 'clean', promptOpen: false })
  })

  it('allows only the latest concurrent leave intent to continue', async () => {
    const guard = new SettingsLeaveGuard()
    const lease = guard.register({ id: 'agent-editor', onDiscard: vi.fn() })
    lease.setRisk('dirty')

    const supersededLeave = guard.requestLeave()
    const latestLeave = guard.requestLeave()

    await expect(supersededLeave).resolves.toBe(false)
    expect(guard.getSnapshot()).toMatchObject({ risk: 'dirty', promptOpen: true })
    expect(guard.discardAndLeave()).toBe(true)
    await expect(latestLeave).resolves.toBe(true)
  })

  it('does not offer discard while work is in flight and resumes when it becomes clean', async () => {
    const guard = new SettingsLeaveGuard()
    const lease = guard.register({ id: 'agent-editor', onDiscard: vi.fn() })
    lease.setRisk('busy')

    const leave = guard.requestLeave()
    expect(guard.getSnapshot()).toMatchObject({ risk: 'busy', promptOpen: true })
    expect(guard.discardAndLeave()).toBe(false)

    lease.setRisk('dirty')
    expect(guard.getSnapshot()).toMatchObject({ risk: 'dirty', promptOpen: true })
    lease.setRisk('clean')

    await expect(leave).resolves.toBe(true)
  })

  it('cancels a pending leave without changing the registered risk', async () => {
    const guard = new SettingsLeaveGuard()
    const lease = guard.register({ id: 'agent-editor', onDiscard: vi.fn() })
    lease.setRisk('dirty')

    const leave = guard.requestLeave()
    guard.cancelLeave()

    await expect(leave).resolves.toBe(false)
    expect(guard.getSnapshot()).toMatchObject({ risk: 'dirty', promptOpen: false })
  })

  it('keeps the guard blocked if a discard callback fails', async () => {
    const guard = new SettingsLeaveGuard()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const lease = guard.register({
      id: 'agent-editor',
      onDiscard: () => {
        lease.setRisk('clean')
        throw new Error('reset failed')
      }
    })
    lease.setRisk('dirty')

    const leave = guard.requestLeave()
    expect(guard.discardAndLeave()).toBe(false)
    expect(guard.getSnapshot()).toMatchObject({ risk: 'dirty', promptOpen: true })
    guard.cancelLeave()

    await expect(leave).resolves.toBe(false)
    consoleError.mockRestore()
  })
})
