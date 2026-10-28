import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

type NativeReadFixture = {
  shortcuts: string[]
  channels: (string | null)[]
  restore(): void
}

test.use({ privacyModeEnabled: true })

test('native settings readers observe acknowledged changes and persisted floating bounds @smoke', async ({
  launchApp
}) => {
  let active = await launchApp()
  await waitForAppReady(active.page)
  expect(active.ownsUserDataDir).toBe(true)
  const profile = active.userDataDir
  await active.electronApp.evaluate(({ globalShortcut }, packageJson) => {
    const require = process.getBuiltinModule('node:module').createRequire(packageJson)
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    const register = globalShortcut.register
    const check = autoUpdater.checkForUpdates
    const fixture: NativeReadFixture = {
      shortcuts: [],
      channels: [],
      restore() {
        globalShortcut.register = register
        autoUpdater.checkForUpdates = check
      }
    }
    globalShortcut.register = (accelerator) => {
      fixture.shortcuts.push(accelerator)
      return true
    }
    autoUpdater.checkForUpdates = async () => {
      fixture.channels.push(autoUpdater.channel)
      return null
    }
    ;(
      globalThis as typeof globalThis & { nativeReadFixture: NativeReadFixture }
    ).nativeReadFixture = fixture
  }, resolve('package.json'))
  try {
    const shortcuts = (
      await active.page.evaluate(() => window.deepchat.invoke('config.getShortcutKeys', {}))
    ).shortcuts
    const accelerator = 'CommandOrControl+Shift+F12'
    await active.page.evaluate(
      (shortcuts) => window.deepchat.invoke('config.setShortcutKeys', { shortcuts }),
      { ...shortcuts, ShowHideWindow: accelerator }
    )
    await active.page.evaluate(() => window.deepchat.invoke('shortcut.register', {}))
    for (const channel of ['stable', 'beta'] as const) {
      expect(
        await active.page.evaluate(
          (channel) => window.deepchat.invoke('config.setUpdateChannel', { channel }),
          channel
        )
      ).toEqual({ channel })
      await active.page.evaluate(() =>
        window.deepchat.invoke('upgrade.check', { type: 'manualCheck' })
      )
    }
    const reads = await active.electronApp.evaluate(() => {
      const fixture = (globalThis as typeof globalThis & { nativeReadFixture: NativeReadFixture })
        .nativeReadFixture
      return { shortcuts: fixture.shortcuts, channels: fixture.channels }
    })
    expect(reads.shortcuts).toContain(accelerator)
    expect(reads.channels).toEqual(['latest', 'beta'])

    await active.page.evaluate(() =>
      window.deepchat.invoke('config.setFloatingButton', { enabled: true })
    )
    await expect
      .poll(() => active!.electronApp.windows().some((page) => page.url().includes('/floating/')))
      .toBe(true)
    const widget = active.electronApp.windows().find((page) => page.url().includes('/floating/'))!
    await widget.waitForFunction(() =>
      Boolean((window as unknown as { floatingButtonAPI?: unknown }).floatingButtonAPI)
    )
    await widget.evaluate(() => {
      const api = (
        window as unknown as {
          floatingButtonAPI: {
            onDragStart(x: number, y: number): void
            onDragMove(x: number, y: number): void
            onDragEnd(x: number, y: number): void
          }
        }
      ).floatingButtonAPI
      api.onDragStart(100, 100)
      api.onDragMove(140, 170)
      api.onDragEnd(140, 170)
    })
    const readSettings = () => JSON.parse(readFileSync(join(profile, 'app-settings.json'), 'utf8'))
    await expect.poll(() => readSettings().floatingButtonBounds?.y).toEqual(expect.any(Number))
    const bounds = readSettings().floatingButtonBounds
    expect(Number.isFinite(bounds.x)).toBe(true)
    expect(['left', 'right']).toContain(bounds.dockSide)
    await active.page.evaluate(() =>
      window.deepchat.invoke('config.setFloatingButton', { enabled: false })
    )
    await active.page.evaluate(() =>
      window.deepchat.invoke('config.setFloatingButton', { enabled: true })
    )
    await expect
      .poll(() => active!.electronApp.windows().some((page) => page.url().includes('/floating/')))
      .toBe(true)
    // The reopened native window reads the committed resting position from the private projection.
    await expect
      .poll(() =>
        active!.electronApp.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((window) => window.webContents.getURL().includes('/floating/'))
              ?.getBounds().y
        )
      )
      .toBe(bounds.y)
    await active.page.evaluate(() =>
      window.deepchat.invoke('config.setFloatingButton', { enabled: false })
    )
  } finally {
    await active.electronApp.evaluate(() =>
      (
        globalThis as typeof globalThis & { nativeReadFixture: NativeReadFixture }
      ).nativeReadFixture.restore()
    )
  }
  expect(await active.close()).toBe('graceful')
  active = await launchApp()
  await waitForAppReady(active.page)
  expect(
    await active.page.evaluate(() => window.deepchat.invoke('config.getUpdateChannel', {}))
  ).toEqual({ channel: 'beta' })
  expect(
    (await active.page.evaluate(() => window.deepchat.invoke('config.getShortcutKeys', {})))
      .shortcuts.ShowHideWindow
  ).toBe('CommandOrControl+Shift+F12')
  expect(await active.close()).toBe('graceful')
})
