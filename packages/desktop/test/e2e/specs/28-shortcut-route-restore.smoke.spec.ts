import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test.setTimeout(60_000)

test('shortcut settings can update notify register and restore typed routes @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-shortcut')
  await expect(settingsPage.getByTestId('settings-shortcut-page')).toBeVisible({ timeout: 30_000 })
  await expect(settingsPage.getByTestId('shortcut-row-QuickSearch')).toBeVisible({
    timeout: 30_000
  })

  const original = (await settingsPage.evaluate(async () => {
    const result = (await window.deepchat.invoke('config.getShortcutKeys', {})) as {
      shortcuts: Record<string, string>
    }
    return result.shortcuts
  })) as Record<string, string>

  const temporaryShortcuts = {
    ...original,
    QuickSearch: 'Control+Alt+Shift+9'
  }

  try {
    await settingsPage.evaluate(() => {
      ;(
        window as unknown as {
          __deepchatShortcutUpdate?: Promise<{
            eventQuickSearch?: string
            eventVersionType: string
          }>
        }
      ).__deepchatShortcutUpdate = new Promise((resolve) => {
        const unsubscribe = window.deepchat.on('config.shortcutKeys.changed', (payload) => {
          unsubscribe()
          const event = payload as { shortcuts?: Record<string, string>; version?: unknown }
          resolve({
            eventQuickSearch: event.shortcuts?.QuickSearch,
            eventVersionType: typeof event.version
          })
        })
      })
    })

    const saved = await settingsPage.evaluate(
      async ({ temporaryShortcuts }) => {
        const result = (await window.deepchat.invoke('config.setShortcutKeys', {
          shortcuts: temporaryShortcuts
        })) as {
          shortcuts: Record<string, string>
        }
        return result.shortcuts
      },
      { temporaryShortcuts }
    )
    expect(saved.QuickSearch).toBe(temporaryShortcuts.QuickSearch)

    await expect
      .poll(
        async () => {
          return await settingsPage.evaluate(async () => {
            const result = (await window.deepchat.invoke('config.getShortcutKeys', {})) as {
              shortcuts: Record<string, string>
            }
            return result.shortcuts.QuickSearch
          })
        },
        {
          timeout: 10_000,
          intervals: [250, 500, 1_000]
        }
      )
      .toBe(temporaryShortcuts.QuickSearch)

    const updateSnapshot = await settingsPage.evaluate(async () => {
      const updatePromise = (
        window as unknown as {
          __deepchatShortcutUpdate?: Promise<{
            eventQuickSearch?: string
            eventVersionType: string
          }>
        }
      ).__deepchatShortcutUpdate
      if (!updatePromise) {
        throw new Error('Shortcut update listener was not registered')
      }

      return await Promise.race([
        updatePromise,
        new Promise<null>((resolve) => {
          window.setTimeout(() => resolve(null), 10_000)
        })
      ])
    })
    expect(updateSnapshot).not.toBeNull()
    expect(updateSnapshot?.eventQuickSearch).toBe(temporaryShortcuts.QuickSearch)
    expect(updateSnapshot?.eventVersionType).toBe('number')

    const runtimeSnapshot = await settingsPage.evaluate(async () => {
      const destroyed = (await window.deepchat.invoke('shortcut.destroy', {})) as {
        destroyed?: unknown
      }
      const registered = (await window.deepchat.invoke('shortcut.register', {})) as {
        registered?: unknown
      }
      const unregistered = (await window.deepchat.invoke('shortcut.unregister', {})) as {
        unregistered?: unknown
      }

      return {
        destroyed: destroyed.destroyed,
        registered: registered.registered,
        unregistered: unregistered.unregistered
      }
    })

    expect(runtimeSnapshot.destroyed).toBe(true)
    expect(runtimeSnapshot.registered).toBe(true)
    expect(runtimeSnapshot.unregistered).toBe(true)
  } finally {
    await settingsPage
      .evaluate(
        async ({ original }) => {
          await window.deepchat.invoke('config.setShortcutKeys', { shortcuts: original })
          await window.deepchat.invoke('shortcut.register', {})
        },
        { original }
      )
      .catch(() => undefined)
  }

  const restored = await settingsPage.evaluate(async () => {
    const result = (await window.deepchat.invoke('config.getShortcutKeys', {})) as {
      shortcuts: Record<string, string>
    }
    return result.shortcuts
  })
  expect(restored.QuickSearch).toBe(original.QuickSearch)
})
