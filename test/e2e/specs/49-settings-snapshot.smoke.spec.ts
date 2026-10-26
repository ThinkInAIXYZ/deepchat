import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

async function changeSettings(page: Page, enabled: boolean) {
  return await page.evaluate(async (enabled) => {
    const events: Array<{ version: number; values: { autoScrollEnabled?: boolean } }> = []
    let received!: () => void
    const changed = new Promise<void>((resolve) => {
      received = resolve
    })
    const unsubscribe = window.deepchat.on('settings.changed', (payload) => {
      if (!payload.changedKeys.includes('autoScrollEnabled')) return
      events.push(payload)
      if (events.length === 2) received()
    })
    try {
      const first = await window.deepchat.invoke('settings.getSnapshot', {
        keys: ['autoScrollEnabled']
      })
      const second = await window.deepchat.invoke('settings.getSnapshot', {
        keys: ['autoScrollEnabled']
      })
      const initial = await window.deepchat.invoke('settings.update', {
        changes: [{ key: 'autoScrollEnabled', value: !enabled }]
      })
      const final = await window.deepchat.invoke('settings.update', {
        changes: [{ key: 'autoScrollEnabled', value: enabled }]
      })
      await changed
      return { first, second, initial, final, events }
    } finally {
      unsubscribe()
    }
  }, enabled)
}

test.use({ privacyModeEnabled: true })

test('settings revisions survive clock rollback and persist across relaunch @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const settingsPage = await openSettings(active)
  await openSettingsTab(settingsPage, 'settings-tab-general')
  const autoScroll = settingsPage.locator('#auto-scroll-switch')
  await expect(autoScroll).toHaveAttribute('aria-checked', 'true')

  // Control only the disposable Main process clock; restore it before shutdown.
  const fixedNow = await active.electronApp.evaluate(() => {
    const original = Date.now
    const state = globalThis as typeof globalThis & { restoreSettingsSmokeClock?: () => void }
    state.restoreSettingsSmokeClock = () => {
      Date.now = original
      delete state.restoreSettingsSmokeClock
    }
    const now = original()
    Date.now = () => now
    return now
  })
  try {
    const frozen = await changeSettings(active.page, true)
    const revisions = [
      frozen.first.version,
      frozen.second.version,
      frozen.events[0].version,
      frozen.initial.version,
      frozen.events[1].version,
      frozen.final.version
    ]
    for (let i = 1; i < revisions.length; i++)
      expect(revisions[i]).toBeGreaterThan(revisions[i - 1])
    expect(frozen.initial.values.autoScrollEnabled).toBe(false)
    expect(frozen.final.values.autoScrollEnabled).toBe(true)

    await active.electronApp.evaluate((_electron, now) => {
      Date.now = () => now - 30_000
    }, fixedNow)
    const rolledBack = await changeSettings(active.page, false)
    expect(rolledBack.first.version).toBeGreaterThan(frozen.final.version)
    expect(rolledBack.final.version).toBeGreaterThan(rolledBack.events[1].version)
    expect(rolledBack.final.values.autoScrollEnabled).toBe(false)
    await expect(autoScroll).toHaveAttribute('aria-checked', 'false')
  } finally {
    await active.electronApp.evaluate(() => {
      ;(
        globalThis as typeof globalThis & { restoreSettingsSmokeClock?: () => void }
      ).restoreSettingsSmokeClock?.()
    })
  }
  expect(await active.close()).toBe('graceful')

  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  const { values } = await reopened.page.evaluate(() =>
    window.deepchat.invoke('settings.getSnapshot', { keys: ['autoScrollEnabled'] })
  )
  expect(values.autoScrollEnabled).toBe(false)
  const reopenedSettings = await openSettings(reopened)
  await openSettingsTab(reopenedSettings, 'settings-tab-general')
  await expect(reopenedSettings.locator('#auto-scroll-switch')).toHaveAttribute(
    'aria-checked',
    'false'
  )
  expect(await reopened.close()).toBe('graceful')
})
