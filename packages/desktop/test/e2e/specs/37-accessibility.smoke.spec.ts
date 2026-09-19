import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test('keyboard users can enter content, compose, and navigate settings @smoke', async ({ app }) => {
  const { page, electronApp } = app
  await waitForAppReady(page)
  await expect(page.getByRole('navigation')).toHaveAccessibleName(/.+/)
  await expect(page.getByRole('main')).toHaveCount(1)

  // Reset keyboard traversal to the beginning of this isolated window.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
  await page.keyboard.press('Tab')
  const skip = page.getByRole('button', { name: /Skip to content|跳.*主要内容/ })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()

  const agent = page.getByTestId('sidebar-agent-button').first()
  await agent.focus()
  await page.keyboard.press('Enter')
  await expect(agent).toHaveAttribute('aria-pressed', 'true')
  const composer = page.getByTestId('chat-input-contenteditable')
  await expect(composer).toHaveRole('textbox')
  await expect(composer).toHaveAccessibleName(/.+/)
  await expect(composer).toHaveAttribute('aria-multiline', 'true')
  await composer.focus()
  await page.keyboard.type('Accessible draft')
  await expect(composer).toContainText('Accessible draft')
  await page.keyboard.press('Tab')
  await expect(composer).not.toBeFocused()

  await page.getByTestId('app-settings-button').focus()
  await page.keyboard.press('Enter')
  await expect
    .poll(() =>
      electronApp.windows().some((window) => window.url().includes('/settings/index.html'))
    )
    .toBe(true)
  const settings = electronApp
    .windows()
    .find((window) => window.url().includes('/settings/index.html'))!
  await expect(settings.getByRole('navigation')).toHaveAccessibleName(/.+/)
  const general = settings.getByTestId('settings-tab-general')
  await general.focus()
  await settings.keyboard.press('Enter')
  await expect(general).toHaveAttribute('aria-current', 'page')
  await expect(settings.getByRole('main')).toHaveCount(1)
  await expect(settings.getByRole('main')).toBeFocused()
})
