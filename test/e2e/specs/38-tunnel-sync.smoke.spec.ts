import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'
import { createServer } from 'node:net'
import { join } from 'node:path'

/** All writes use the fixture's isolated profile, including the legacy backup destination. */
test('tunnel host requires consent, prepares data on demand with legacy sync off, and restarts on its fixed port @smoke', async ({
  app,
  launchApp
}, testInfo) => {
  await waitForAppReady(app.page)
  await app.page.evaluate(async () => {
    await window.deepchat.invoke('config.setLanguage', { language: 'zh-CN' })
  })
  const settings = await openSettings(app)
  await openSettingsTab(settings, 'settings-tab-database')
  await settings.getByTestId('cloud-provider-tunnel').click()
  const section = settings.getByTestId('tunnel-sync-section')
  await expect(section).toBeVisible()
  await section.getByRole('tab', { name: /Custom domain|自定义域名/ }).click()
  await expect(section.locator('#tunnel-token')).toHaveAttribute('type', 'password')
  await section.screenshot({
    path: testInfo.outputPath('tunnel-domain-guide.png'),
    animations: 'disabled'
  })
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
  await section.getByRole('tab', { name: /Existing tunnel|已有隧道/ }).click()
  await section.locator('#tunnel-url').fill('https://sync.example.test')
  await section
    .locator('summary')
    .filter({ hasText: /Advanced settings|高级设置/ })
    .click()
  await section.locator('#tunnel-port').fill(String(port))
  // The initial enable action opens the credential-transfer confirmation, never the listener.
  await section.getByRole('button', { name: /Enable sharing|开启共享/ }).click()
  const confirmation = settings.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText('API')
  expect(
    await settings.evaluate(
      async () => (await window.deepchat.invoke('syncHost.getStatus', {})).status.running
    )
  ).toBe(false)
  await confirmation.getByRole('button', { name: /Confirm|确认|确定/ }).click()
  await expect(confirmation).toBeHidden()
  await expect
    .poll(async () =>
      settings.evaluate(
        async () => (await window.deepchat.invoke('syncHost.getStatus', {})).status.port
      )
    )
    .toBe(port)
  const pairing = await settings.evaluate(
    async () => (await window.deepchat.invoke('syncHost.createPairingCode', {})).pairing!
  )
  const response = await fetch(`http://127.0.0.1:${port}/sync/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: pairing.code, deviceName: 'Test receiver' })
  })
  const { token } = (await response.json()) as { token: string }
  expect(
    (
      await fetch(`http://127.0.0.1:${port}/sync/v1/prepare`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` }
      })
    ).status
  ).toBe(202)
  await expect
    .poll(async () =>
      settings.evaluate(
        async () => (await window.deepchat.invoke('syncHost.getStatus', {})).status.hasSnapshot
      )
    )
    .toBe(true)
  await expect(section.locator('code').first()).toContainText('https://sync.example.test')
  await settings.screenshot({
    path: testInfo.outputPath('tunnel-sync-host.png'),
    fullPage: true,
    animations: 'disabled'
  })
  await settings.setViewportSize({ width: 640, height: 800 })
  expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await settings.screenshot({
    path: testInfo.outputPath('tunnel-sync-narrow.png'),
    fullPage: true,
    animations: 'disabled'
  })

  await settings.setViewportSize({ width: 1280, height: 900 })
  await section.getByRole('button', { name: /Manage toolchain|管理工具链/ }).click()
  await expect(settings.getByTestId('toolchain-source-cloudflared')).toBeVisible()
  await settings.getByTestId('toolchain-source-cloudflared').scrollIntoViewIfNeeded()
  await settings.screenshot({
    path: testInfo.outputPath('cloudflared-toolchain.png'),
    animations: 'disabled'
  })

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
