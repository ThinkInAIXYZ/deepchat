import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('database maintenance restores sessions through incremental and overwrite imports @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  await active.page.evaluate(
    (folderPath) =>
      window.deepchat.invoke('config.updateSyncSettings', { enabled: true, folderPath }),
    join(active.userDataDir, 'maintenance-backups')
  )
  const created = await active.page.evaluate(() =>
    window.deepchat.invoke('sessions.create', {
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      message: '',
      projectDir: null
    })
  )
  const sessionId = created.session.id
  const before = await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    sessionId
  )
  expect(before.session?.id).toBe(sessionId)
  const { backup } = await active.page.evaluate(() =>
    window.deepchat.invoke('sync.startBackup', {})
  )
  expect(backup).not.toBeNull()
  await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.delete', { sessionId }),
    sessionId
  )
  const missing = await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    sessionId
  )
  expect(missing.session).toBeNull()
  const invalid = await active.page.evaluate(() =>
    window.deepchat.invoke('sync.import', { backupFile: '../not-a-backup.zip', mode: 'increment' })
  )
  expect(invalid.result.success).toBe(false)
  const restored = await active.page.evaluate(
    (backupFile) => window.deepchat.invoke('sync.import', { backupFile, mode: 'increment' }),
    backup!.fileName
  )
  expect(restored.result.success).toBe(true)
  const increment = await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    sessionId
  )
  expect(increment.session?.id).toBe(sessionId)
  expect(increment.session?.providerId).toBe(before.session?.providerId)
  const extra = await active.page.evaluate(() =>
    window.deepchat.invoke('sessions.create', {
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      message: '',
      projectDir: null
    })
  )
  const overwritten = await active.page.evaluate(
    (backupFile) => window.deepchat.invoke('sync.import', { backupFile, mode: 'overwrite' }),
    backup!.fileName
  )
  expect(overwritten.result.success).toBe(true)
  const removed = await active.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    extra.session.id
  )
  expect(removed.session).toBeNull()
  const { report } = await active.page.evaluate(() =>
    window.deepchat.invoke('databaseSecurity.repairSchema', {})
  )
  expect(report.remainingIssues).toEqual([])
  expect(await active.close()).toBe('graceful')

  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  const persisted = await reopened.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
    sessionId
  )
  expect(persisted.session?.id).toBe(sessionId)
  expect(persisted.session?.providerId).toBe(before.session?.providerId)
  expect(await reopened.close()).toBe('graceful')
})

test('database repair and import cannot enter while encryption is preparing @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const password = 'disposable-maintenance-password'
  await active.electronApp.evaluate(({ safeStorage }, password) => {
    const encrypt = safeStorage.encryptStringAsync
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fixture = {
      entered: false,
      release,
      restore: () => {
        safeStorage.encryptStringAsync = encrypt
      }
    }
    Object.assign(globalThis, { __maintenanceFixture: fixture })
    safeStorage.encryptStringAsync = async (value) => {
      if (value === password) {
        fixture.entered = true
        await gate
      }
      return encrypt.call(safeStorage, value)
    }
  }, password)
  const enabled = active.page.evaluate(
    (password) => window.deepchat.invoke('databaseSecurity.enable', { password }),
    password
  )
  void enabled.catch(() => undefined)
  try {
    await expect
      .poll(() =>
        active.electronApp.evaluate(
          () =>
            (globalThis as unknown as { __maintenanceFixture: { entered: boolean } })
              .__maintenanceFixture.entered
        )
      )
      .toBe(true)
    await expect(
      active.page.evaluate(() => window.deepchat.invoke('databaseSecurity.repairSchema', {}))
    ).rejects.toThrow('App database maintenance is maintenance')
    await expect(
      active.page.evaluate(() =>
        window.deepchat.invoke('sync.import', { backupFile: 'unavailable.zip', mode: 'increment' })
      )
    ).rejects.toThrow('App database maintenance is maintenance')
  } finally {
    await active.electronApp.evaluate(() => {
      const fixture = (
        globalThis as unknown as {
          __maintenanceFixture: { release(): void; restore(): void }
        }
      ).__maintenanceFixture
      fixture.restore()
      fixture.release()
    })
  }
  expect((await enabled).status.enabled).toBe(true)
  expect(
    (await active.page.evaluate(() => window.deepchat.invoke('databaseSecurity.repairSchema', {})))
      .report.remainingIssues
  ).toEqual([])
  expect(await active.close()).toBe('graceful')
})
