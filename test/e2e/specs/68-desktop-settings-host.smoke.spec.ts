import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('desktop appearance and native login observations survive settings owner relaunch @smoke', async ({
  launchApp
}) => {
  let active = await launchApp({
    prepareUserData: (profile) => {
      const file = join(profile, 'app-settings.json')
      const stored = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ ...stored, launchAtLoginEnabled: true }))
    }
  })
  await waitForAppReady(active.page)
  expect(active.ownsUserDataDir).toBe(true)
  const settingsPage = await openSettings(active)

  // Keep OS login writes inside this disposable process fixture.
  await active.electronApp.evaluate(({ app }) => {
    const get = app.getLoginItemSettings
    const set = app.setLoginItemSettings
    const observed = get.call(app)
    const writes: boolean[] = []
    app.getLoginItemSettings = () => ({ ...observed, openAtLogin: false })
    app.setLoginItemSettings = (options) => {
      writes.push(Boolean(options.openAtLogin))
    }
    const state = globalThis as typeof globalThis & {
      restoreDesktopSettingsFixture?: () => boolean[]
    }
    state.restoreDesktopSettingsFixture = () => {
      app.getLoginItemSettings = get
      app.setLoginItemSettings = set
      delete state.restoreDesktopSettingsFixture
      return writes
    }
  })
  try {
    const login = await active.page.evaluate(async () => ({
      before: await window.deepchat.invoke('settings.getSnapshot', {
        keys: ['launchAtLoginEnabled']
      }),
      changed: await window.deepchat.invoke('settings.update', {
        changes: [{ key: 'launchAtLoginEnabled', value: true }]
      })
    }))
    expect(login.before.values).toEqual({ launchAtLoginEnabled: false })
    expect(login.changed.values).toEqual({ launchAtLoginEnabled: false })

    expect(
      await active.page.evaluate(() => window.deepchat.invoke('config.setTheme', { theme: 'dark' }))
    ).toEqual({ theme: 'dark', isDark: true })
    await expect(active.page.locator('html')).toHaveClass(/dark/)
    await expect(settingsPage.locator('html')).toHaveClass(/dark/)
    expect(
      await active.page.evaluate(() =>
        window.deepchat.invoke('config.setLanguage', { language: 'fa' })
      )
    ).toEqual({ requestedLanguage: 'fa-IR', locale: 'fa-IR', direction: 'rtl' })
    await expect(active.page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(settingsPage.locator('html')).toHaveAttribute('dir', 'rtl')

    const restored = await settingsPage.evaluate(async () => ({
      theme: await window.deepchat.invoke('config.setTheme', { theme: 'light' }),
      language: await window.deepchat.invoke('config.setLanguage', { language: 'en-US' })
    }))
    expect(restored.theme).toEqual({ theme: 'light', isDark: false })
    expect(restored.language).toEqual({
      requestedLanguage: 'en-US',
      locale: 'en-US',
      direction: 'auto'
    })
    await expect(active.page.locator('html')).not.toHaveClass(/dark/)
    await expect(settingsPage.locator('html')).not.toHaveClass(/dark/)
    await expect(active.page.locator('html')).toHaveAttribute('dir', 'auto')
    await expect(settingsPage.locator('html')).toHaveAttribute('dir', 'auto')
  } finally {
    const writes = await active.electronApp.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          restoreDesktopSettingsFixture?: () => boolean[]
        }
      ).restoreDesktopSettingsFixture?.()
    )
    expect(writes).toEqual([true])
  }
  const stored = JSON.parse(readFileSync(join(active.userDataDir, 'app-settings.json'), 'utf8'))
  expect(stored).toMatchObject({ language: 'en-US', appTheme: 'light', launchAtLoginEnabled: true })
  expect(await active.close()).toBe('graceful')

  active = await launchApp()
  await waitForAppReady(active.page)
  const reopened = await active.page.evaluate(async () => ({
    theme: await window.deepchat.invoke('config.getTheme', {}),
    language: await window.deepchat.invoke('config.getLanguage', {})
  }))
  expect(reopened.theme).toEqual({ theme: 'light', isDark: false })
  expect(reopened.language).toEqual({
    requestedLanguage: 'en-US',
    locale: 'en-US',
    direction: 'auto'
  })
  expect(await active.close()).toBe('graceful')
})
