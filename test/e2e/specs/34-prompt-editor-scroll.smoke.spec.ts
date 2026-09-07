import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('custom prompts scroll with visible actions and persist after save @smoke', async ({
  app
}, testInfo) => {
  await waitForAppReady(app.page)
  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-prompt')
  const settingsWindow = await app.electronApp.browserWindow(settingsPage)
  await settingsWindow.evaluate((window) => window.setSize(1000, 640))

  const addPrompt = settingsPage.getByRole('button', { name: /Add Custom Prompt|新增自定义提示词/ })
  await addPrompt.click()
  const dialog = settingsPage.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: /^(Confirm|确认)$/ })
  const cancel = dialog.getByRole('button', { name: /^(Cancel|取消)$/ })
  const viewport = dialog.locator('[data-slot="scroll-area-viewport"]')

  await expect(confirm).toBeInViewport()
  await expect(cancel).toBeInViewport()
  await expect(confirm).toBeDisabled()
  await expect(viewport).toBeVisible()
  await viewport.hover()
  await settingsPage.mouse.wheel(0, 1400)
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await expect(dialog.getByText(/^(File Management|文件管理)$/)).toBeInViewport()
  await expect(confirm).toBeInViewport()

  const name = `Scroll regression ${Date.now()}`
  await dialog.getByPlaceholder(/Enter a name for your prompt|请输入提示词名称/).fill(name)
  await dialog
    .getByPlaceholder(/Please enter prompt content|请输入提示词内容/)
    .fill('Summarize the attached notes.')
  await expect(confirm).toBeEnabled()
  await settingsPage.screenshot({ path: testInfo.outputPath('prompt-small-window.png') })
  await confirm.click()
  await expect(dialog).not.toBeVisible()
  await expect(settingsPage.getByText(name, { exact: true })).toBeVisible()

  await settingsPage.reload()
  await expect(settingsPage.getByText(name, { exact: true })).toBeVisible()
  await settingsWindow.evaluate((window) => window.setSize(1100, 900))
  await addPrompt.click()
  await expect(confirm).toBeInViewport()
  await expect(viewport).toBeVisible()
  await settingsPage.screenshot({ path: testInfo.outputPath('prompt-large-window.png') })
  await settingsPage.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(addPrompt).toBeFocused()
})
