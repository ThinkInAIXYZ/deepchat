import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab, selectProvider } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('provider headers use a JSON editor above the model list @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-model-providers')
  await expect(settingsPage.getByTestId('settings-provider-page')).toBeVisible({
    timeout: 30_000
  })

  const providerRow = settingsPage.locator('[data-provider-id="openai"]').first()
  if (!(await providerRow.isVisible())) {
    await settingsPage.getByTestId('disabled-providers-toggle').click()
  }
  await selectProvider(settingsPage, 'openai')

  const orderedSections = settingsPage.locator(
    '[data-testid="provider-advanced-toggle"], [data-testid="provider-models-section"]'
  )
  await expect(orderedSections).toHaveCount(2)
  expect(
    await orderedSections.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-testid'))
    )
  ).toEqual(['provider-advanced-toggle', 'provider-models-section'])

  await settingsPage.getByTestId('provider-advanced-toggle').click()
  const trigger = settingsPage.getByTestId('provider-custom-headers-trigger')
  await expect(trigger).toBeVisible()
  await trigger.click()

  const editor = settingsPage.getByTestId('provider-custom-headers-editor')
  const editorInput = editor.locator('.native-edit-context, textarea.inputarea').first()
  const save = settingsPage.getByTestId('provider-custom-headers-save')
  const replaceEditorText = async (value: string) => {
    await editor.locator('.view-lines').click()
    await settingsPage.keyboard.press('ControlOrMeta+A')
    await editorInput.evaluate((element, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', text)
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData
        })
      )
    }, value)
  }
  await expect(editor).toBeVisible()
  await expect(editor.locator('.monaco-editor')).toBeVisible()
  await expect(editorInput).toBeFocused()

  await replaceEditorText('[]')
  await expect(save).toBeDisabled()

  await replaceEditorText('{"X-Tenant-ID":"team-a"}')
  await expect(save).toBeEnabled()
  await settingsPage.getByTestId('provider-custom-headers-format').click()
  await save.click()
  await expect(editor).not.toBeVisible()
  await expect(trigger).toBeFocused()

  await trigger.click()
  await expect(editor.locator('.view-lines')).toContainText('X-Tenant-ID')
  await replaceEditorText('{}')
  await save.click()
  await expect(editor).not.toBeVisible()
})
