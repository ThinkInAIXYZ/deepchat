import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('database encryption preserves settings through legacy unlock rekey and disable @smoke', async ({
  launchApp
}) => {
  const firstPassword = 'disposable-database-password-one'
  const nextPassword = 'disposable-database-password-two'
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  await active.page.evaluate(() =>
    window.deepchat.invoke('settings.update', {
      changes: [{ key: 'copyWithCotEnabled', value: false }]
    })
  )
  const { status: enabled } = await active.page.evaluate(
    (password) => window.deepchat.invoke('databaseSecurity.enable', { password }),
    firstPassword
  )
  expect(enabled).toMatchObject({
    enabled: true,
    passwordStorage: 'safeStorage',
    manualUnlockRequired: false
  })
  const file = join(active.userDataDir, 'database-security.json')
  const databaseFile = join(active.userDataDir, 'app_db', 'agent.db')
  const raw = readFileSync(file, 'utf8')
  expect(raw).not.toContain(firstPassword)
  expect(readFileSync(databaseFile).subarray(0, 16).toString()).not.toBe('SQLite format 3\u0000')
  const legacy = await active.electronApp.evaluate(
    ({ safeStorage }, value) => safeStorage.encryptString(value).toString('base64'),
    firstPassword
  )
  const state = JSON.parse(raw)
  writeFileSync(
    file,
    JSON.stringify({ ...state, metadata: { ...state.metadata, wrappedPassword: legacy } })
  )
  expect(await active.close()).toBe('graceful')

  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  expect(
    (
      await reopened.page.evaluate(() =>
        window.deepchat.invoke('settings.getSnapshot', { keys: ['copyWithCotEnabled'] })
      )
    ).values.copyWithCotEnabled
  ).toBe(false)
  expect(JSON.parse(readFileSync(file, 'utf8')).metadata.wrappedPassword).toBe(legacy)
  await expect(
    reopened.page.evaluate(
      (newPassword) =>
        window.deepchat.invoke('databaseSecurity.changePassword', {
          currentPassword: 'wrong-fixture-password',
          newPassword
        }),
      nextPassword
    )
  ).rejects.toThrow()
  const { status: changed } = await reopened.page.evaluate(
    ({ currentPassword, newPassword }) =>
      window.deepchat.invoke('databaseSecurity.changePassword', { currentPassword, newPassword }),
    { currentPassword: firstPassword, newPassword: nextPassword }
  )
  expect(changed.enabled).toBe(true)
  expect(readFileSync(file, 'utf8')).not.toContain(nextPassword)
  expect(await reopened.close()).toBe('graceful')

  const changedApp = await launchApp()
  await waitForAppReady(changedApp.page)
  expect(
    (
      await changedApp.page.evaluate(() =>
        window.deepchat.invoke('settings.getSnapshot', { keys: ['copyWithCotEnabled'] })
      )
    ).values.copyWithCotEnabled
  ).toBe(false)
  const { status: disabled } = await changedApp.page.evaluate(
    (currentPassword) => window.deepchat.invoke('databaseSecurity.disable', { currentPassword }),
    nextPassword
  )
  expect(disabled).toMatchObject({ enabled: false, passwordStorage: 'none' })
  expect(readFileSync(databaseFile).subarray(0, 16).toString()).toBe('SQLite format 3\u0000')
  expect(await changedApp.close()).toBe('graceful')

  const plain = await launchApp()
  await waitForAppReady(plain.page)
  expect(
    (
      await plain.page.evaluate(() =>
        window.deepchat.invoke('settings.getSnapshot', { keys: ['copyWithCotEnabled'] })
      )
    ).values.copyWithCotEnabled
  ).toBe(false)
  expect(await plain.close()).toBe('graceful')
})
