import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import type { ElectronApplication, Page } from '@playwright/test'

test.use({ privacyModeEnabled: true })

const isFloatingWindow = async (page: Page): Promise<boolean> => {
  const url = page.url()
  if (url.includes('/renderer/floating/index.html') || url.includes('/floating/index.html')) {
    return true
  }

  return url.includes('/floating/')
}

const waitForFloatingWindow = async (
  electronApp: ElectronApplication,
  windows: () => Page[],
  timeout = 30_000
): Promise<Page> => {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    for (const candidate of windows()) {
      if (await isFloatingWindow(candidate)) {
        return candidate
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  const rendererUrls = await Promise.all(
    windows().map(async (page) => ({
      title: await page.title().catch(() => ''),
      url: page.url()
    }))
  )
  const mainWindows = await electronApp.evaluate(async ({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      id: window.id,
      destroyed: window.isDestroyed(),
      visible: window.isVisible(),
      url: window.webContents.getURL()
    }))
  )

  throw new Error(
    `Floating window did not become available. renderer=${JSON.stringify(
      rendererUrls
    )} main=${JSON.stringify(mainWindows)}`
  )
}

test('floating window IPC boundary uses scoped preload API @smoke', async ({ app }) => {
  expect(app.ownsUserDataDir).toBe(true)
  await waitForAppReady(app.page)
  const mainWindow = await app.electronApp.browserWindow(app.page)
  expect(await mainWindow.evaluate((window) => window.isVisible())).toBe(true)
  const dockVisible = await app.electronApp.evaluate(({ app }) => app.dock?.isVisible())

  const original = await app.page.evaluate(async () => {
    return await window.deepchat.invoke('config.getFloatingButton', {})
  })
  let sessionId: string | undefined

  try {
    sessionId = await app.page.evaluate(async () => {
      await window.deepchat.invoke('config.setFloatingButton', { enabled: false })
      const { session } = await window.deepchat.invoke('sessions.create', {
        agentId: 'deepchat',
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
        message: ''
      })
      return session.id
    })
    await app.page.evaluate(async () => {
      await window.deepchat.invoke('config.setFloatingButton', { enabled: true })
    })

    const floatingPage = await waitForFloatingWindow(app.electronApp, () =>
      app.electronApp.windows()
    )
    await floatingPage.waitForLoadState('domcontentloaded')
    await expect(floatingPage.locator('.widget-stage')).toBeVisible({ timeout: 30_000 })
    expect(await mainWindow.evaluate((window) => window.isVisible())).toBe(true)
    const floatingWindow = await app.electronApp.browserWindow(floatingPage)
    expect(await floatingWindow.evaluate((window) => window.isVisible())).toBe(true)
    if (process.platform === 'darwin') {
      expect(await floatingWindow.evaluate((window) => window.isVisibleOnAllWorkspaces())).toBe(
        true
      )
      expect(await app.electronApp.evaluate(({ app }) => app.dock?.isVisible())).toBe(dockVisible)
    }

    const boundary = await floatingPage.evaluate(async () => {
      const runtime = window as unknown as {
        api?: Record<string, unknown>
        deepchat?: unknown
        electron?: unknown
        floatingButtonAPI?: {
          getSnapshot: () => Promise<unknown>
          setExpanded: (expanded: boolean) => void
          onSnapshotUpdate: (callback: (snapshot: unknown) => void) => () => void
        } & Record<string, unknown>
      }

      const apiKeys = Object.keys(runtime.floatingButtonAPI ?? {}).sort()
      const snapshot = await runtime.floatingButtonAPI?.getSnapshot()
      let updateCount = 0
      const unsubscribe = runtime.floatingButtonAPI?.onSnapshotUpdate(() => {
        updateCount += 1
      })
      unsubscribe?.()

      runtime.floatingButtonAPI?.setExpanded(true)
      runtime.floatingButtonAPI?.setExpanded(false)

      return {
        apiKeys,
        hasApiIpcRenderer: Boolean(runtime.api && 'ipcRenderer' in runtime.api),
        hasBroadApi: Boolean(runtime.api),
        hasDeepchat: Boolean(runtime.deepchat),
        hasElectron: Boolean(runtime.electron),
        hasFloatingApi: Boolean(runtime.floatingButtonAPI),
        hasRemoveAllListeners: Boolean(
          runtime.floatingButtonAPI && 'removeAllListeners' in runtime.floatingButtonAPI
        ),
        snapshot,
        updateCount
      }
    })

    expect(boundary.hasFloatingApi).toBe(true)
    expect(boundary.hasBroadApi).toBe(false)
    expect(boundary.hasApiIpcRenderer).toBe(false)
    expect(boundary.hasDeepchat).toBe(false)
    expect(boundary.hasElectron).toBe(false)
    expect(boundary.hasRemoveAllListeners).toBe(false)
    expect(boundary.apiKeys).toEqual(
      expect.arrayContaining([
        'getSnapshot',
        'getLanguage',
        'getTheme',
        'setExpanded',
        'onSnapshotUpdate',
        'onLanguageChanged',
        'onThemeChanged'
      ])
    )
    expect(boundary.snapshot).toMatchObject({
      expanded: expect.any(Boolean),
      activeCount: expect.any(Number),
      sessions: expect.any(Array)
    })
    expect(boundary.updateCount).toBe(0)

    await expect
      .poll(() =>
        floatingPage.evaluate(async () => {
          const snapshot = await window.floatingButtonAPI.getSnapshot()
          return snapshot.sessions.map((session) => session.id)
        })
      )
      .toContain(sessionId)
    await floatingPage.evaluate((sessionId) => {
      window.floatingButtonAPI.setExpanded(true)
      window.floatingButtonAPI.openSession(sessionId)
    }, sessionId)
    await expect
      .poll(() =>
        app.page.evaluate(async () => {
          const { session } = await window.deepchat.invoke('sessions.getActive', {})
          return session?.id
        })
      )
      .toBe(sessionId)
    await expect
      .poll(() =>
        floatingPage.evaluate(async () => (await window.floatingButtonAPI.getSnapshot()).expanded)
      )
      .toBe(false)
  } finally {
    if (sessionId) {
      await app.page.evaluate(async (sessionId) => {
        await window.deepchat.invoke('sessions.delete', { sessionId })
      }, sessionId)
    }
    await app.page
      .evaluate(async (enabled) => {
        await window.deepchat.invoke('config.setFloatingButton', { enabled })
      }, original.enabled)
      .catch(() => undefined)
  }
})
