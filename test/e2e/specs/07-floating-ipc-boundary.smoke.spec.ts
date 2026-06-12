import { test, expect, type Page } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import type { ElectronApplication } from '@playwright/test'

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
  await waitForAppReady(app.page)

  const original = await app.page.evaluate(async () => {
    return await window.deepchat.invoke('config.getFloatingButton', {})
  })

  try {
    await app.page.evaluate(async () => {
      await window.deepchat.invoke('config.setFloatingButton', { enabled: true })
    })

    const floatingPage = await waitForFloatingWindow(app.electronApp, () =>
      app.electronApp.windows()
    )
    await floatingPage.waitForLoadState('domcontentloaded')
    await expect(floatingPage.locator('.widget-stage')).toBeVisible({ timeout: 30_000 })

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
  } finally {
    await app.page
      .evaluate(async (enabled) => {
        await window.deepchat.invoke('config.setFloatingButton', { enabled })
      }, original.enabled)
      .catch(() => undefined)
  }
})
