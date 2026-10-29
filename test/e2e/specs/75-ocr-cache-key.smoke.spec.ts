import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('OCR cache keeps native key ownership and encryption across relaunch @smoke', async ({
  launchApp
}, testInfo) => {
  let active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  const clearCache = async () => {
    await waitForAppReady(active.page)
    const settings = await openSettings(active)
    return settings.evaluate(async (node) => {
      await window.deepchat.invoke('toolchains.setSource', {
        kind: 'node',
        selection: { source: 'custom', customPath: node }
      })
      const status = await window.deepchat.invoke('ocr.getRuntimeStatus', {})
      if (status.availability.status !== 'available')
        throw new Error(`OCR runtime is unavailable: ${status.availability.reason}`)
      const { cache } = await window.deepchat.invoke('ocr.clearCache', {})
      return cache
    }, process.execPath)
  }
  const first = await clearCache()
  const nativeEncryptionAvailable = await active.electronApp.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable()
  )
  if (process.platform !== 'linux' && nativeEncryptionAvailable)
    expect(first.mode).toBe('persistent')
  expect(first.entryCount).toBe(0)
  const keyPath = join(active.userDataDir, 'ocr', 'cache-key.json')
  const databasePath = join(active.userDataDir, 'ocr', 'ocr-cache.db')
  let wrappedKey: Buffer | null = null
  if (first.mode === 'persistent') {
    expect(existsSync(keyPath)).toBe(true)
    expect(
      readFileSync(databasePath).subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))
    ).toBe(false)
    wrappedKey = readFileSync(keyPath)
  } else {
    expect(first.persistenceUnavailableReason).toBe('safe_storage_unavailable')
    expect(existsSync(databasePath)).toBe(false)
  }
  expect(await active.close()).toBe('graceful')
  active = await launchApp()
  const second = await clearCache()
  expect(second.mode).toBe(first.mode)
  expect(second.entryCount).toBe(0)
  if (wrappedKey) expect(readFileSync(keyPath).equals(wrappedKey)).toBe(true)
  expect(await active.close()).toBe('graceful')
  await testInfo.attach('ocr-cache-ownership.json', {
    body: JSON.stringify({
      mode: first.mode,
      relaunchMode: second.mode,
      nativeEncryptionAvailable
    }),
    contentType: 'application/json'
  })
})
