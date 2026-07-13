import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('knowledge settings read-only routes expose supported formats @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-knowledge-base')
  await expect(settingsPage.getByTestId('settings-knowledge-base-page')).toBeVisible({
    timeout: 30_000
  })

  const snapshot = await settingsPage.evaluate(async () => {
    const supported = (await window.deepchat.invoke('knowledge.isSupported', {})) as {
      supported?: unknown
    }
    const languages = (await window.deepchat.invoke('knowledge.getSupportedLanguages', {})) as {
      languages?: unknown[]
    }
    const separators = (await window.deepchat.invoke('knowledge.getSeparatorsForLanguage', {
      language: 'markdown'
    })) as {
      separators?: unknown[]
    }
    const extensions = (await window.deepchat.invoke(
      'knowledge.getSupportedFileExtensions',
      {}
    )) as {
      extensions?: unknown[]
    }

    return {
      extensions: extensions.extensions ?? [],
      languages: languages.languages ?? [],
      separators: separators.separators ?? [],
      supported: supported.supported
    }
  })

  expect(typeof snapshot.supported).toBe('boolean')
  expect(snapshot.languages.length).toBeGreaterThan(0)
  expect(snapshot.languages.every((language) => typeof language === 'string')).toBe(true)
  expect(snapshot.separators.length).toBeGreaterThan(0)
  expect(snapshot.separators.every((separator) => typeof separator === 'string')).toBe(true)
  expect(snapshot.separators).toContain('')
  expect(snapshot.extensions.length).toBeGreaterThan(0)
  expect(snapshot.extensions.every((extension) => typeof extension === 'string')).toBe(true)
  expect(snapshot.extensions).toEqual(expect.arrayContaining(['txt', 'md']))
})
