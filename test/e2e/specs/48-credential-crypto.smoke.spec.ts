import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('native async crypto reads legacy ciphertext @smoke', async ({ app }, testInfo) => {
  expect(app.ownsUserDataDir).toBe(true)
  await waitForAppReady(app.page)
  const compatibility = await app.electronApp.evaluate(async ({ safeStorage }) => {
    const plaintext = 'credential-compatibility-fixture'
    const legacy = safeStorage.encryptString(plaintext)
    const available = await safeStorage.isAsyncEncryptionAvailable()
    const legacyRead = await safeStorage.decryptStringAsync(legacy)
    const current = await safeStorage.encryptStringAsync(plaintext)
    const currentRead = await safeStorage.decryptStringAsync(current)
    return {
      available,
      legacyMatches: legacyRead.result === plaintext,
      currentMatches: currentRead.result === plaintext,
      shouldReEncrypt: legacyRead.shouldReEncrypt,
      electron: process.versions.electron
    }
  })
  expect(compatibility.available).toBe(true)
  expect(compatibility.legacyMatches).toBe(true)
  expect(compatibility.currentMatches).toBe(true)
  expect(typeof compatibility.shouldReEncrypt).toBe('boolean')
  await testInfo.attach('native-crypto-compatibility.json', {
    body: Buffer.from(JSON.stringify(compatibility)),
    contentType: 'application/json'
  })
})

test('cloud credentials stay wrapped across acknowledged updates and relaunch @smoke', async ({
  launchApp
}) => {
  const secret = 'disposable-cloud-credential-fixture'
  const initial = await launchApp()
  expect(initial.ownsUserDataDir).toBe(true)
  await waitForAppReady(initial.page)
  const { config: empty } = await initial.page.evaluate(() =>
    window.deepchat.invoke('sync.getCloudConfig', {})
  )
  expect(empty.safeStorageAvailable).toBe(true)
  expect(empty.hasSecret).toBe(false)
  expect(await initial.close()).toBe('graceful')

  const active = await launchApp()
  await waitForAppReady(active.page)
  const { config: configured } = await active.page.evaluate(
    (secret) =>
      window.deepchat.invoke('sync.setCloudConfig', {
        config: {
          enabled: false,
          endpoint: 'http://127.0.0.1:1',
          bucket: 'credential-fixture',
          accessKeyId: 'fixture-access-key',
          secretAccessKey: secret
        }
      }),
    secret
  )
  expect(configured).toMatchObject({ hasSecret: true, safeStorageAvailable: true })
  expect(JSON.stringify(configured)).not.toContain(secret)
  const settingsPath = join(active.userDataDir, 'app-settings.json')
  const raw = readFileSync(settingsPath, 'utf8')
  expect(raw).not.toContain(secret)
  const wrapped = JSON.parse(raw).cloudSyncSecret
  expect(typeof wrapped).toBe('string')
  expect(wrapped.length).toBeGreaterThan(0)
  const { config: updated } = await active.page.evaluate(() =>
    window.deepchat.invoke('sync.setCloudConfig', { config: { region: 'us-west-2' } })
  )
  expect(updated).toMatchObject({ hasSecret: true, region: 'us-west-2' })
  expect(JSON.parse(readFileSync(settingsPath, 'utf8')).cloudSyncSecret).toBe(wrapped)
  expect(await active.close()).toBe('graceful')

  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  const { config: persisted } = await reopened.page.evaluate(() =>
    window.deepchat.invoke('sync.getCloudConfig', {})
  )
  expect(persisted).toEqual(updated)
  expect(JSON.parse(readFileSync(settingsPath, 'utf8')).cloudSyncSecret).toBe(wrapped)
  expect(await reopened.close()).toBe('graceful')
})
