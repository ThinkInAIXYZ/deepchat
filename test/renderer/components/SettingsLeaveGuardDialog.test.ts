import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import SettingsLeaveGuardDialog from '../../../src/renderer/settings/components/SettingsLeaveGuardDialog.vue'
import {
  settingsLeaveGuard,
  type SettingsLeaveGuardLease
} from '../../../src/renderer/settings/services/settingsLeaveGuard'

describe('SettingsLeaveGuardDialog', () => {
  let lease: SettingsLeaveGuardLease | undefined
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.restoreAllMocks()
    settingsLeaveGuard.cancelLeave()
    lease?.release()
    lease = undefined
    document.body.innerHTML = ''
  })

  it('discards registered edits before allowing the pending navigation', async () => {
    const onDiscard = vi.fn()
    lease = settingsLeaveGuard.register({
      id: 'settings.test.dialog',
      onDiscard
    })
    lease.setRisk('dirty')

    wrapper = mount(SettingsLeaveGuardDialog, {
      attachTo: document.body
    })
    const leave = settingsLeaveGuard.requestLeave()
    await nextTick()

    const cancel = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="settings-leave-guard-cancel"]'
    )
    const discard = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="settings-leave-guard-discard"]'
    )
    expect(document.activeElement).toBe(cancel)
    expect(discard).not.toBeNull()
    discard?.click()
    await flushPromises()

    expect(onDiscard).toHaveBeenCalledOnce()
    await expect(leave).resolves.toBe(true)
    expect(settingsLeaveGuard.getSnapshot()).toMatchObject({
      promptOpen: false,
      risk: 'clean'
    })
  })

  it('cancels one pending navigation from the explicit stay action', async () => {
    const onDiscard = vi.fn()
    const cancelLeave = vi.spyOn(settingsLeaveGuard, 'cancelLeave')
    lease = settingsLeaveGuard.register({
      id: 'settings.test.cancel',
      onDiscard
    })
    lease.setRisk('dirty')

    wrapper = mount(SettingsLeaveGuardDialog, {
      attachTo: document.body
    })
    const leave = settingsLeaveGuard.requestLeave()
    await nextTick()

    document.body
      .querySelector<HTMLButtonElement>('[data-testid="settings-leave-guard-cancel"]')
      ?.click()
    await flushPromises()

    expect(cancelLeave).toHaveBeenCalledOnce()
    expect(onDiscard).not.toHaveBeenCalled()
    await expect(leave).resolves.toBe(false)
    expect(settingsLeaveGuard.getSnapshot().promptOpen).toBe(false)
  })
})
