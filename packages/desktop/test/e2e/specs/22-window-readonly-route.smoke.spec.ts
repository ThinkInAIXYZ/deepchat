import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('main and settings windows expose current window state through typed route @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  const mainState = await app.page.evaluate(async () => {
    return (await window.deepchat.invoke('window.getCurrentState', {})) as {
      state?: {
        exists?: unknown
        isFocused?: unknown
        isFullScreen?: unknown
        isMaximized?: unknown
        windowId?: unknown
      }
    }
  })

  const settingsPage = await openSettings(app)
  await expect(settingsPage.getByTestId('settings-page')).toBeVisible({ timeout: 30_000 })

  const settingsState = await settingsPage.evaluate(async () => {
    return (await window.deepchat.invoke('window.getCurrentState', {})) as {
      state?: {
        exists?: unknown
        isFocused?: unknown
        isFullScreen?: unknown
        isMaximized?: unknown
        windowId?: unknown
      }
    }
  })

  for (const state of [mainState.state, settingsState.state]) {
    expect(state).toBeTruthy()
    expect(typeof state?.exists).toBe('boolean')
    expect(typeof state?.isFocused).toBe('boolean')
    expect(typeof state?.isFullScreen).toBe('boolean')
    expect(typeof state?.isMaximized).toBe('boolean')
    expect(typeof state?.windowId === 'number' || state?.windowId === null).toBe(true)
  }

  expect(mainState.state?.exists).toBe(true)
  expect(settingsState.state?.exists).toBe(true)
  expect(mainState.state?.windowId).not.toBe(settingsState.state?.windowId)
})
