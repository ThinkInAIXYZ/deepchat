import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('legacy settings file and database values survive owner bootstrap and relaunch @smoke', async ({
  launchApp
}) => {
  const extension = { source: 'legacy-fixture', nested: { retained: [1, 2, 3] } }
  let active = await launchApp({
    prepareUserData: (profile) => {
      const file = join(profile, 'app-settings.json')
      const settings = JSON.parse(readFileSync(file, 'utf8'))
      const workspace = join(profile, 'workspace')
      mkdirSync(workspace)
      Object.assign(settings, {
        defaultProjectPath: workspace,
        appVersion: '0.9.0',
        language: 'en-US',
        copyWithCotEnabled: true,
        extensionFixture: extension
      })
      writeFileSync(file, JSON.stringify(settings))
    }
  })
  await waitForAppReady(active.page)
  const profile = active.userDataDir
  const file = join(profile, 'app-settings.json')
  const readSettings = () => JSON.parse(readFileSync(file, 'utf8'))
  expect(readSettings().extensionFixture).toEqual(extension)
  expect(
    await active.page.evaluate(() => window.deepchat.invoke('config.getLanguage', {}))
  ).toMatchObject({ requestedLanguage: 'en-US', locale: 'en-US' })
  const version = await active.electronApp.evaluate(({ app }) => app.getVersion())
  expect(readSettings().appVersion).toBe(version)

  const changed = await active.page.evaluate(async () => {
    const settings = await window.deepchat.invoke('settings.update', {
      changes: [
        { key: 'autoScrollEnabled', value: false },
        { key: 'fontSizeLevel', value: 2 },
        { key: 'copyWithCotEnabled', value: false }
      ]
    })
    const entries = await window.deepchat.invoke('config.updateEntries', {
      changes: [{ key: 'maxFileSize', value: 20 * 1024 * 1024 }]
    })
    const language = await window.deepchat.invoke('config.setLanguage', { language: 'zh-CN' })
    const cloud = await window.deepchat.invoke('sync.setCloudConfig', {
      config: {
        enabled: false,
        endpoint: 'http://127.0.0.1:1',
        bucket: 'settings-owner-fixture',
        accessKeyId: 'fixture-key',
        secretAccessKey: 'owned-profile-cloud-fixture'
      }
    })
    return { settings, entries, language, cloud }
  })
  expect(changed.settings.values).toEqual({
    autoScrollEnabled: false,
    fontSizeLevel: 2,
    copyWithCotEnabled: false
  })
  expect(changed.entries.values).toEqual({ maxFileSize: 20 * 1024 * 1024 })
  expect(changed.language).toMatchObject({ requestedLanguage: 'zh-CN', locale: 'zh-CN' })
  expect(changed.cloud.config).toMatchObject({ hasSecret: true, safeStorageAvailable: true })
  expect(readFileSync(file, 'utf8')).not.toContain('owned-profile-cloud-fixture')
  const wrappedSecret = readSettings().cloudSyncSecret
  expect(typeof wrappedSecret).toBe('string')
  expect(readSettings()).toMatchObject({
    extensionFixture: extension,
    autoScrollEnabled: false,
    fontSizeLevel: 2,
    language: 'zh-CN',
    maxFileSize: 20 * 1024 * 1024,
    copyWithCotEnabled: true
  })

  expect(await active.close()).toBe('graceful')
  active = await launchApp()
  await waitForAppReady(active.page)
  expect(active.userDataDir).toBe(profile)
  const restored = await active.page.evaluate(async () => ({
    settings: await window.deepchat.invoke('settings.getSnapshot', {
      keys: ['autoScrollEnabled', 'fontSizeLevel', 'copyWithCotEnabled']
    }),
    entries: await window.deepchat.invoke('config.getEntries', { keys: ['maxFileSize'] }),
    language: await window.deepchat.invoke('config.getLanguage', {}),
    cloud: await window.deepchat.invoke('sync.getCloudConfig', {})
  }))
  expect(restored.settings.values).toEqual(changed.settings.values)
  expect(restored.entries.values).toEqual(changed.entries.values)
  expect(restored.language).toEqual(changed.language)
  expect(restored.cloud.config).toMatchObject({ hasSecret: true, safeStorageAvailable: true })
  expect(readSettings().cloudSyncSecret).toBe(wrappedSecret)
  expect(readSettings().extensionFixture).toEqual(extension)
  expect(readSettings().copyWithCotEnabled).toBe(true)
  expect(await active.close()).toBe('graceful')
})
