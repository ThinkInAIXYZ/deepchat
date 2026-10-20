import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test('agent menu stays below its trigger and scrolls in short windows @smoke', async ({
  app
}, testInfo) => {
  const { page } = app
  await waitForAppReady(page)
  await page.evaluate(async () => {
    await window.deepchat.invoke('config.setTheme', { theme: 'dark' })
    for (let index = 0; index < 12; index += 1) {
      await window.deepchat.invoke('config.createDeepChatAgent', {
        name: `Menu regression ${index}`
      })
    }
  })
  const viewport = { width: 800, height: 320 }
  await page.setViewportSize(viewport)
  const trigger = page.getByTestId('sidebar-agent-selector')
  await trigger.click()
  const menu = page.getByTestId('sidebar-agent-menu')
  await expect(async () => {
    await expect(menu).toHaveAttribute('data-side', 'bottom')
    const triggerBox = await trigger.boundingBox()
    const menuBox = await menu.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect(menuBox).not.toBeNull()
    expect(menuBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height)
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height)
    expect(await menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  }).toPass()
  await page.screenshot({ path: testInfo.outputPath('agent-menu-short.png') })

  const lastAgent = page.getByTestId('sidebar-agent-button').last()
  const lastAgentId = await lastAgent.getAttribute('data-agent-id')
  await page.getByTestId('sidebar-agent-all-button').focus()
  await page.keyboard.press('End')
  await expect(lastAgent).toBeFocused()
  await expect(lastAgent).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(trigger).toHaveAttribute('data-selected-agent-id', lastAgentId)
})

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

  await page.getByTestId('sidebar-agent-selector').focus()
  await page.keyboard.press('Enter')
  const agent = page.getByTestId('sidebar-agent-button').first()
  await agent.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('sidebar-agent-selector')).toHaveAttribute(
    'data-selected-agent-id',
    'deepchat'
  )
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
  await settings.bringToFront()
  await expect(settings.getByRole('navigation')).toHaveAccessibleName(/.+/)
  const appearance = settings.getByTestId('settings-tab-appearance')
  await appearance.focus()
  await settings.keyboard.press('Enter')
  await expect(appearance).toHaveAttribute('aria-current', 'page')
  // Detached development DevTools can take native focus while the settings route loads.
  await settings.bringToFront()
  await expect(settings.getByRole('main')).toBeFocused()
  const general = settings.getByTestId('settings-tab-general')
  await general.focus()
  await settings.keyboard.press('Enter')
  await expect(general).toHaveAttribute('aria-current', 'page')
  await expect(settings.getByRole('main')).toHaveCount(1)
  await settings.bringToFront()
  await expect(settings.getByRole('main')).toBeFocused()
})
