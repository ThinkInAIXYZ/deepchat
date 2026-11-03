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

  await app.page.evaluate(() => window.deepchat.invoke('config.setLanguage', { language: 'en-US' }))
  const previousPages = new Set(app.electronApp.windows())
  await app.electronApp.evaluate(({ Menu }) => {
    const fileMenu = Menu.getApplicationMenu()?.items.find((item) =>
      item.submenu?.items.some((entry) => /New Window/i.test(entry.label))
    )
    const command = fileMenu?.submenu?.items.find((entry) => /New Window/i.test(entry.label))
    if (!command) throw new Error('New Window command is unavailable')
    command.click()
  })
  await expect
    .poll(
      () =>
        app.electronApp
          .windows()
          .filter((page) => !previousPages.has(page) && page.url().includes('/renderer/index.html'))
          .length
    )
    .toBe(1)
  const second = app.electronApp
    .windows()
    .find((page) => !previousPages.has(page) && page.url().includes('/renderer/index.html'))!
  await waitForAppReady(second)
  const ids = await app.page.evaluate(async () => {
    const ids: string[] = []
    for (let index = 0; index < 2; index += 1) {
      const { session } = await window.deepchat.invoke('sessions.create', {
        agentId: 'deepchat',
        message: '',
        providerId: 'openai',
        modelId: 'gpt-4o'
      })
      ids.push(session.id)
    }
    return ids
  })
  const state = (page: typeof second) =>
    page.evaluate(async () => ({
      id: (await window.deepchat.invoke('sessions.getActive', {})).session?.id ?? null,
      route: (
        document.querySelector('#app') as unknown as {
          __vue_app__: {
            config: { globalProperties: { $pinia: { _s: Map<string, { route: unknown }> } } }
          }
        }
      ).__vue_app__.config.globalProperties.$pinia._s.get('pageRouter')?.route
    }))
  await app.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.activate', { sessionId }),
    ids[0]
  )
  await second.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.activate', { sessionId }),
    ids[1]
  )
  await expect
    .poll(() => state(app.page))
    .toEqual({ id: ids[0], route: { name: 'chat', sessionId: ids[0] } })
  await expect
    .poll(() => state(second))
    .toEqual({ id: ids[1], route: { name: 'chat', sessionId: ids[1] } })
  await app.page.evaluate(() => window.deepchat.invoke('sessions.deactivate', {}))
  await expect.poll(() => state(app.page)).toEqual({ id: null, route: { name: 'newThread' } })
  await expect
    .poll(() => state(second))
    .toEqual({ id: ids[1], route: { name: 'chat', sessionId: ids[1] } })
  await second.evaluate(() => window.deepchat.invoke('sessions.deactivate', {}))
  await expect.poll(() => state(second)).toEqual({ id: null, route: { name: 'newThread' } })
  await expect.poll(() => state(app.page)).toEqual({ id: null, route: { name: 'newThread' } })
})
