import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

type NativeConfigurationFixture = {
  opened: string[]
  protectedValues: boolean[]
  relaunches: number
  exits: number
  finish(): void
}

test.use({ privacyModeEnabled: true })

test('native font, folder and configuration restart capabilities preserve the profile @smoke', async ({
  launchApp
}) => {
  let active = await launchApp()
  await waitForAppReady(active.page)
  expect(active.ownsUserDataDir).toBe(true)
  const profile = active.userDataDir
  const restartProcess = active.electronApp.process()
  const catalogs = await active.page.evaluate(() =>
    Promise.all([
      window.deepchat.invoke('settings.listSystemFonts', {}),
      window.deepchat.invoke('settings.listSystemFonts', {})
    ])
  )
  expect(catalogs[0].fonts.length).toBeGreaterThan(0)
  expect(catalogs[1]).toEqual(catalogs[0])
  const family = catalogs[0].fonts.find((name) => /^[A-Za-z][A-Za-z0-9-]*$/.test(name))
  expect(family).toBeTruthy()
  const selected = await active.page.evaluate(
    (family) =>
      window.deepchat.invoke('settings.update', {
        changes: [
          { key: 'fontFamily', value: `  ${family.toLowerCase()}; ` },
          { key: 'codeFontFamily', value: family }
        ]
      }),
    family!
  )
  expect(selected.values).toEqual({ fontFamily: family, codeFontFamily: family })

  // Observe the real shutdown at the native relaunch/exit boundary without spawning another app.
  await active.electronApp.evaluate(({ app, shell, BrowserWindow }) => {
    const relaunch = app.relaunch
    const exit = app.exit
    const quit = app.quit
    const openPath = shell.openPath
    const windows = BrowserWindow.getAllWindows().map((window) => ({
      window,
      protect: window.setContentProtection
    }))
    const fixture = {
      opened: [] as string[],
      protectedValues: [] as boolean[],
      relaunches: 0,
      exits: 0,
      finish: () => {
        app.relaunch = relaunch
        app.exit = exit
        app.quit = quit
        shell.openPath = openPath
        for (const { window, protect } of windows) window.setContentProtection = protect
        exit.call(app, 0)
      }
    }
    app.relaunch = () => {
      fixture.relaunches++
    }
    app.exit = () => {
      fixture.exits++
    }
    app.quit = () => {}
    shell.openPath = async (path) => {
      fixture.opened.push(path)
      return ''
    }
    for (const { window, protect } of windows) {
      window.setContentProtection = function (
        this: InstanceType<typeof BrowserWindow>,
        enabled: boolean
      ) {
        protect.call(this, enabled)
        fixture.protectedValues.push(this.isContentProtected())
      }
    }
    ;(
      globalThis as typeof globalThis & { nativeConfigurationFixture?: NativeConfigurationFixture }
    ).nativeConfigurationFixture = fixture
  })
  expect(
    await active.page.evaluate(() => window.deepchat.invoke('config.openLoggingFolder', {}))
  ).toEqual({ opened: true })
  expect(existsSync(join(profile, 'logs'))).toBe(true)
  expect(
    await active.page.evaluate(() =>
      window.deepchat.invoke('settings.update', {
        changes: [
          { key: 'contentProtectionEnabled', value: true },
          { key: 'loggingEnabled', value: true }
        ]
      })
    )
  ).toMatchObject({ values: { contentProtectionEnabled: true, loggingEnabled: true } })

  await expect
    .poll(() =>
      active.electronApp.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              nativeConfigurationFixture: NativeConfigurationFixture
            }
          ).nativeConfigurationFixture.exits
      )
    )
    .toBe(1)
  const native = await active.electronApp.evaluate(() => {
    const fixture = (
      globalThis as typeof globalThis & { nativeConfigurationFixture: NativeConfigurationFixture }
    ).nativeConfigurationFixture
    return {
      opened: fixture.opened,
      protectedValues: fixture.protectedValues,
      relaunches: fixture.relaunches
    }
  })
  expect(native.opened).toEqual([join(profile, 'logs')])
  expect(native.protectedValues.length).toBeGreaterThan(0)
  expect(native.protectedValues.every(Boolean)).toBe(true)
  expect(native.relaunches).toBe(1)
  expect(JSON.parse(readFileSync(join(profile, 'app-settings.json'), 'utf8'))).toMatchObject({
    fontFamily: family,
    codeFontFamily: family,
    contentProtectionEnabled: true,
    loggingEnabled: true
  })
  expect(readFileSync(join(profile, 'logs', 'main.jsonl'), 'utf8')).toContain(
    'app.shutdown.terminal'
  )
  await active.electronApp
    .evaluate(() =>
      (
        globalThis as typeof globalThis & { nativeConfigurationFixture: NativeConfigurationFixture }
      ).nativeConfigurationFixture.finish()
    )
    .catch((error) => {
      if (!(error instanceof Error) || !error.message.includes('closed')) throw error
    })
  await expect.poll(() => restartProcess.exitCode).toBe(0)
  expect(await active.close()).toBe('graceful')

  active = await launchApp()
  await waitForAppReady(active.page)
  expect(
    (
      await active.page.evaluate(() =>
        window.deepchat.invoke('settings.getSnapshot', {
          keys: ['fontFamily', 'codeFontFamily', 'contentProtectionEnabled', 'loggingEnabled']
        })
      )
    ).values
  ).toEqual({
    fontFamily: family,
    codeFontFamily: family,
    contentProtectionEnabled: true,
    loggingEnabled: true
  })
  const identity = await active.page.evaluate(() =>
    window.deepchat.invoke('window.getRuntimeIdentity', {})
  )
  expect(
    await active.electronApp.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id)!.isContentProtected(),
      identity.windowId!
    )
  ).toBe(true)
  expect(await active.close()).toBe('graceful')
})
