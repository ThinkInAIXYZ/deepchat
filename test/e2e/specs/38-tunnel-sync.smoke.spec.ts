import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'
import { createServer } from 'node:net'
import { join } from 'node:path'

/** All writes use the fixture's isolated profile, including the legacy backup destination. */
test('tunnel host requires consent, publishes with legacy sync off, and restarts on its fixed port @smoke', async ({
  app,
  launchApp
}, testInfo) => {
  await waitForAppReady(app.page)
  const settings = await openSettings(app)
  await openSettingsTab(settings, 'settings-tab-database')
  const section = settings.getByTestId('tunnel-sync-section')
  await expect(section).toBeVisible()
  await settings.evaluate(
    async (folderPath) => {
      await window.deepchat.invoke('config.updateSyncSettings', { enabled: false, folderPath })
    },
    join(app.userDataDir, 'test-backups')
  )

  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  await section.locator('#tunnel-port').fill(String(port))
  // The initial enable action opens the credential-transfer confirmation, never the listener.
  await section.getByRole('button', { name: /Enable host|启用主机/ }).click()
  const confirmation = settings.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText('API')
  expect(
    await settings.evaluate(
      async () => (await window.deepchat.invoke('syncHost.getStatus', {})).status.running
    )
  ).toBe(false)
  await confirmation.getByRole('button', { name: /Confirm|确认|确定/ }).click()
  await expect
    .poll(async () =>
      settings.evaluate(
        async () => (await window.deepchat.invoke('syncHost.getStatus', {})).status.port
      )
    )
    .toBe(port)
  await section.getByRole('button', { name: /Publish snapshot|发布快照/ }).click()
  await expect
    .poll(async () =>
      settings.evaluate(
        async () => (await window.deepchat.invoke('syncHost.getStatus', {})).status.hasSnapshot
      )
    )
    .toBe(true)
  await expect(section.locator('code').first()).toContainText(`127.0.0.1:${port}`)
  await settings.screenshot({ path: testInfo.outputPath('tunnel-sync-host.png'), fullPage: true })
  await settings.setViewportSize({ width: 640, height: 800 })
  expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await settings.screenshot({ path: testInfo.outputPath('tunnel-sync-narrow.png'), fullPage: true })

  await app.close()
  const restarted = await launchApp()
  await waitForAppReady(restarted.page)
  await expect
    .poll(async () =>
      restarted.page.evaluate(
        async () => (await window.deepchat.invoke('syncHost.getStatus', {})).status.port
      )
    )
    .toBe(port)
  await restarted.page.evaluate(async () => {
    await window.deepchat.invoke('syncHost.setEnabled', { enabled: false })
  })
  await expect(fetch(`http://127.0.0.1:${port}/sync/v1/handshake`)).rejects.toThrow()
})
