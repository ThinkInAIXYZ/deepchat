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
    await settingsPage.getByTestId('provider-browse-all').click()
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
  const editorInput = editor.locator('[contenteditable="true"]').first()
  const save = settingsPage.getByTestId('provider-custom-headers-save')
  const replaceEditorText = async (value: string) => {
    await editorInput.click()
    await settingsPage.keyboard.press('ControlOrMeta+A')
    await settingsPage.keyboard.insertText(value)
  }
  await expect(editor).toBeVisible()
  await expect(editor.locator('[data-file]')).toBeVisible()
  await expect(editor).toHaveAttribute('role', 'group')
  await expect(editor).toHaveAttribute('tabindex', '-1')
  await expect(editorInput).toHaveAttribute('role', 'textbox')
  await expect(editorInput).toHaveAttribute('aria-label', /.+/)
  await expect(editorInput).toBeFocused()

  await replaceEditorText('[]')
  await expect(save).toBeDisabled()

  await replaceEditorText('{\n  "a": 1\n}')
  await settingsPage.keyboard.press('ControlOrMeta+End')
  await settingsPage.keyboard.press('ArrowUp')
  await settingsPage.keyboard.press('End')
  await settingsPage.keyboard.press('Tab')
  await expect(editorInput).toBeFocused()
  expect(
    await editorInput.locator('[data-line="2"]').evaluate((element) => element.textContent)
  ).toBe('  "a": 1  ')

  await replaceEditorText('{"X-Tenant-ID":"team-a"}')
  await expect(save).toBeEnabled()
  await settingsPage.getByTestId('provider-custom-headers-format').click()
  await save.click()
  await expect(editor).not.toBeVisible()
  await expect(trigger).toBeFocused()

  await trigger.click()
  await expect(editorInput).toContainText('X-Tenant-ID')
  await replaceEditorText('{}')
  await save.click()
  await expect(editor).not.toBeVisible()
})
