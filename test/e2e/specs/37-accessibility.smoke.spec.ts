import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test('agent menu stays below its trigger and scrolls in short windows @smoke', async ({
  app
}, testInfo) => {
  const { page } = app
  await waitForAppReady(page)
  const agentIds: string[] = []
  try {
    await page.evaluate(async () => {
      await window.deepchat.invoke('config.setTheme', { theme: 'dark' })
    })
    for (let index = 0; index < 12; index += 1) {
      const { agent } = await page.evaluate(async (index) => {
        return window.deepchat.invoke('config.createDeepChatAgent', {
          name: `Menu regression ${index}`
        }) as Promise<{ agent: { id: string } }>
      }, index)
      agentIds.push(agent.id)
    }
    const viewport = { width: 800, height: 320 }
    await page.setViewportSize(viewport)
    await expect(page.getByTestId('window-sidebar-toggle')).toBeInViewport()
    await expect(page.getByTestId('window-sidebar-theme-toggle')).toBeInViewport()
    const trigger = page.getByTestId('sidebar-agent-selector')
    await trigger.click()
    const menu = page.getByTestId('sidebar-agent-menu')
    const expectAnchoredMenu = async () => {
      await expect(async () => {
        await expect(menu).toHaveAttribute('data-side', 'bottom')
        const triggerBox = await trigger.boundingBox()
        const menuBox = await menu.boundingBox()
        expect(triggerBox).not.toBeNull()
        expect(menuBox).not.toBeNull()
        expect(menuBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height)
        expect(menuBox!.x).toBeCloseTo(triggerBox!.x, 1)
        expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
      }).toPass({ timeout: 5000 })
    }
    await expectAnchoredMenu()
    expect(await menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('agent-menu-short.png') })

    const lastAgent = page.getByTestId('sidebar-agent-button').last()
    const lastAgentId = await lastAgent.getAttribute('data-agent-id')
    await page.getByTestId('sidebar-agent-all-button').focus()
    await page.keyboard.press('End')
    await expect(lastAgent).toHaveRole('menuitemradio')
    await expect(lastAgent).toHaveAttribute('aria-checked', 'false')
    await expect(lastAgent).toBeFocused()
    await expect(lastAgent).toBeInViewport()
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    await expect(trigger).toHaveAttribute('data-selected-agent-id', lastAgentId)
    await trigger.click()
    await expect(lastAgent).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('sidebar-agent-all-button')).toHaveAttribute(
      'aria-checked',
      'false'
    )
    await page.keyboard.press('Escape')
    const toggle = page.getByTestId('window-sidebar-toggle')
    for (const expanded of [true, false]) {
      if ((await toggle.getAttribute('aria-expanded')) !== String(expanded)) {
        await toggle.click()
      }
      await expect(toggle).toHaveAttribute('aria-expanded', String(expanded))
      await expect(toggle).toBeInViewport()
      await expect(page.getByTestId('window-sidebar-theme-toggle')).toBeInViewport()
      await trigger.click()
      await expectAnchoredMenu()
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`agent-menu-short-${expanded ? 'expanded' : 'collapsed'}.png`)
      })
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.evaluate(async () => {
      await window.deepchat.invoke('config.setTheme', { theme: 'light' })
    })
    for (const expanded of [true, false]) {
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', String(expanded))
      await trigger.click()
      await expectAnchoredMenu()
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`agent-menu-${expanded ? 'expanded' : 'collapsed'}.png`)
      })
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
    }
  } finally {
    await page.evaluate(async (ids) => {
      for (const id of ids) {
        await window.deepchat.invoke('config.deleteDeepChatAgent', { agentId: id })
      }
    }, agentIds)
  }
})

test('keyboard users can enter content, compose, and navigate settings @smoke', async ({
  app
}, testInfo) => {
  const { page, electronApp } = app
  await waitForAppReady(page)
  await expect(page.getByRole('navigation')).toHaveAccessibleName(/.+/)
  await expect(page.getByRole('main')).toHaveCount(1)

  // Reset keyboard traversal to the beginning of this isolated window.
  await page.bringToFront()
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
  await page.keyboard.press('Tab')
  const skip = page.getByRole('button', { name: /Skip to content|跳.*主要内容/ })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()

  const toggle = page.getByTestId('window-sidebar-toggle')
  await expect(toggle).toHaveCount(1)
  const initiallyExpanded = (await toggle.getAttribute('aria-expanded')) === 'true'
  const toggleBox = await toggle.boundingBox()
  expect(toggleBox).not.toBeNull()
  const sidebarBox = await page.getByTestId('window-sidebar').boundingBox()
  expect(sidebarBox).not.toBeNull()
  expect(toggleBox!.y + toggleBox!.height).toBeCloseTo(sidebarBox!.y + sidebarBox!.height - 8, 1)
  await page.bringToFront()
  await toggle.focus()
  await expect(toggle).toBeFocused()
  for (const expanded of [!initiallyExpanded, initiallyExpanded]) {
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', String(expanded))
    await expect(toggle).toBeFocused()
    await expect(async () => {
      const currentBox = await toggle.boundingBox()
      expect(currentBox).not.toBeNull()
      expect(currentBox!.x).toBeCloseTo(toggleBox!.x, 1)
      expect(currentBox!.y).toBeCloseTo(toggleBox!.y, 1)
    }).toPass()
    const theme = page.getByTestId('window-sidebar-theme-toggle')
    const settings = page.getByTestId('app-settings-button')
    const themeBox = await theme.boundingBox()
    const settingsBox = await settings.boundingBox()
    expect(themeBox).not.toBeNull()
    expect(settingsBox).not.toBeNull()
    expect(themeBox!.y).toBeGreaterThanOrEqual(settingsBox!.y + settingsBox!.height)
    expect(themeBox!.y + themeBox!.height).toBeLessThan(toggleBox!.y)
    if (expanded) {
      await expect(theme).toContainText(/Theme|主题/)
    } else {
      await expect(async () => {
        const currentToggleBox = await toggle.boundingBox()
        expect(currentToggleBox).not.toBeNull()
        for (const control of [theme, settings, page.getByTestId('app-plugins-button')]) {
          const box = await control.boundingBox()
          expect(box!.x + box!.width / 2).toBeCloseTo(
            currentToggleBox!.x + currentToggleBox!.width / 2,
            1
          )
          expect(box!.width).toBeCloseTo(currentToggleBox!.width, 1)
          expect(box!.height).toBeCloseTo(currentToggleBox!.height, 1)
        }
      }).toPass({ timeout: 5000 })
    }
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`sidebar-${expanded ? 'expanded' : 'collapsed'}.png`)
    })
  }

  const theme = page.getByTestId('window-sidebar-theme-toggle')
  const previousTheme = await theme.getAttribute('aria-label')
  await theme.click()
  await expect(theme).not.toHaveAttribute('aria-label', previousTheme!)

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
