import type { Page, TestInfo } from '@playwright/test'
import { DEEPCHAT_EVENT_CHANNEL } from '../../../src/shared/contracts/channels'
import { upgradeStatusChangedEvent } from '../../../src/shared/contracts/events/upgrade.events'
import {
  getSettingsRouteItems,
  type SettingsNavigationItem
} from '../../../src/shared/settingsNavigation'
import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

const desktopViewport = { width: 1280, height: 900 }
const minimumViewport = { width: 760, height: 720 }

type SettingsPageSmokeItem = {
  name: string
  routeName: SettingsNavigationItem['routeName']
  tabTestId: string
  pageTestId: string
  optional?: boolean
}

const settingsPages = [
  {
    name: 'overview',
    routeName: 'settings-overview',
    tabTestId: 'settings-tab-overview',
    pageTestId: 'settings-overview-page'
  },
  {
    name: 'general',
    routeName: 'settings-common',
    tabTestId: 'settings-tab-general',
    pageTestId: 'settings-general-page'
  },
  {
    name: 'appearance',
    routeName: 'settings-display',
    tabTestId: 'settings-tab-appearance',
    pageTestId: 'settings-appearance-page'
  },
  {
    name: 'environments',
    routeName: 'settings-environments',
    tabTestId: 'settings-tab-environments',
    pageTestId: 'settings-environments-page'
  },
  {
    name: 'shortcuts',
    routeName: 'settings-shortcut',
    tabTestId: 'settings-tab-shortcut',
    pageTestId: 'settings-shortcut-page'
  },
  {
    name: 'provider-center',
    routeName: 'settings-provider',
    tabTestId: 'settings-tab-model-providers',
    pageTestId: 'settings-provider-page'
  },
  {
    name: 'mcp-center',
    routeName: 'settings-mcp',
    tabTestId: 'settings-tab-mcp',
    pageTestId: 'settings-mcp-page'
  },
  {
    name: 'deepchat-agents',
    routeName: 'settings-deepchat-agents',
    tabTestId: 'settings-tab-deepchat-agents',
    pageTestId: 'settings-deepchat-agents-page'
  },
  {
    name: 'acp',
    routeName: 'settings-acp',
    tabTestId: 'settings-tab-acp-agents',
    pageTestId: 'settings-acp-page'
  },
  {
    name: 'remote',
    routeName: 'settings-remote',
    tabTestId: 'settings-tab-remote',
    pageTestId: 'settings-remote-page'
  },
  {
    name: 'notifications-hooks',
    routeName: 'settings-notifications-hooks',
    tabTestId: 'settings-tab-notifications-hooks',
    pageTestId: 'settings-notifications-hooks-page'
  },
  {
    name: 'plugins',
    routeName: 'settings-plugins',
    tabTestId: 'settings-tab-plugins',
    pageTestId: 'settings-plugins-page',
    optional: true
  },
  {
    name: 'prompts',
    routeName: 'settings-prompt',
    tabTestId: 'settings-tab-prompt',
    pageTestId: 'settings-prompt-page'
  },
  {
    name: 'knowledge-base',
    routeName: 'settings-knowledge-base',
    tabTestId: 'settings-tab-knowledge-base',
    pageTestId: 'settings-knowledge-base-page'
  },
  {
    name: 'data-privacy',
    routeName: 'settings-database',
    tabTestId: 'settings-tab-database',
    pageTestId: 'settings-data-page'
  },
  {
    name: 'about',
    routeName: 'settings-about',
    tabTestId: 'settings-tab-about',
    pageTestId: 'settings-about-page'
  }
] as const satisfies ReadonlyArray<SettingsPageSmokeItem>

const variantPages = settingsPages.filter((page) =>
  ['overview', 'provider-center', 'mcp-center', 'data-privacy'].includes(page.name)
)

async function applyVisualState(
  page: Page,
  options: { dark?: boolean; rtl?: boolean }
): Promise<void> {
  await page.evaluate(({ dark, rtl }) => {
    const theme = dark ? 'dark' : 'light'
    for (const target of [document.documentElement, document.body]) {
      target.classList.remove('light', 'dark', 'system')
      target.classList.add(theme)
      target.setAttribute('data-theme', theme)
      target.dir = rtl ? 'rtl' : 'ltr'
    }
  }, options)
}

async function captureSettingsPage(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.waitForTimeout(250)
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true
  })
}

async function openAndCaptureSettingsPage(
  page: Page,
  testInfo: TestInfo,
  item: (typeof settingsPages)[number],
  suffix: string,
  visualState: { dark?: boolean; rtl?: boolean }
): Promise<boolean> {
  const routeItem = getSettingsRouteItems(process.platform, process.arch).find(
    (navigationItem) => navigationItem.routeName === item.routeName
  )
  const tab = page.getByTestId(item.tabTestId)
  const isOptional = 'optional' in item && item.optional
  if (
    !routeItem ||
    (routeItem.hiddenInSidebar !== true && isOptional && (await tab.count()) === 0)
  ) {
    return false
  }

  await openSettingsTab(page, item.tabTestId, item.routeName)
  await expect(page.getByTestId(item.pageTestId)).toBeVisible({ timeout: 30_000 })
  await applyVisualState(page, visualState)
  await captureSettingsPage(page, testInfo, `settings-${item.name}-${suffix}`)
  return true
}

test('settings control center navigation and screenshots @smoke', async ({ app }, testInfo) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await settingsPage.setViewportSize(desktopViewport)
  await applyVisualState(settingsPage, { dark: false, rtl: false })

  for (const item of settingsPages) {
    await openAndCaptureSettingsPage(settingsPage, testInfo, item, 'desktop-light', {
      dark: false,
      rtl: false
    })
  }

  await settingsPage.evaluate(() => {
    window.location.hash = '#/dashboard'
  })
  await expect(settingsPage.getByTestId('settings-overview-page')).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => settingsPage.evaluate(() => window.location.hash), { timeout: 30_000 })
    .toContain('/overview')
  await applyVisualState(settingsPage, { dark: false, rtl: false })
  await captureSettingsPage(settingsPage, testInfo, 'settings-dashboard-compat-desktop-light')

  await settingsPage.setViewportSize(desktopViewport)
  await applyVisualState(settingsPage, { dark: true, rtl: false })
  for (const item of variantPages) {
    await openAndCaptureSettingsPage(settingsPage, testInfo, item, 'desktop-dark', {
      dark: true,
      rtl: false
    })
  }

  await settingsPage.setViewportSize(minimumViewport)
  await applyVisualState(settingsPage, { dark: false, rtl: true })
  for (const item of variantPages) {
    await openAndCaptureSettingsPage(settingsPage, testInfo, item, 'minimum-rtl', {
      dark: false,
      rtl: true
    })
  }

  await settingsPage.setViewportSize(desktopViewport)
  await applyVisualState(settingsPage, { dark: false, rtl: false })
})

test('release notes retain document typography for Atom HTML and Markdown @smoke', async ({
  app
}, testInfo) => {
  await waitForAppReady(app.page)
  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-about', 'settings-about')
  await expect(settingsPage.getByTestId('settings-about-page')).toBeVisible()
  const installedVersion = await app.electronApp.evaluate(({ app }) => app.getVersion())
  await expect(settingsPage.getByText(`v${installedVersion}`, { exact: true })).toBeVisible()
  await captureSettingsPage(settingsPage, testInfo, 'about-installed-version')
  const settingsWindow = await app.electronApp.browserWindow(settingsPage)
  const items = Array.from({ length: 20 }, (_, index) => `Change ${index + 1}: 修复更新日志显示`)

  for (const [format, releaseNotes] of Object.entries({
    html: `<h2>HTML changes</h2><ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`,
    markdown: `## Markdown changes\n\n${items.map((item) => `- ${item}`).join('\n')}`
  })) {
    await settingsWindow.evaluate(
      (window, { channel, name, payload }) => {
        window.webContents.send(channel, { name, payload })
      },
      {
        channel: DEEPCHAT_EVENT_CHANNEL,
        name: upgradeStatusChangedEvent.name,
        payload: upgradeStatusChangedEvent.payload.parse({
          status: 'available',
          info: {
            version: format === 'html' ? '99.0.0' : '99.0.1',
            releaseDate: '2026-10-02',
            releaseNotes,
            githubUrl: 'https://github.com/ThinkInAIXYZ/deepchat/releases/tag/v99.0.0'
          },
          version: Date.now()
        })
      }
    )

    const notes = settingsPage.getByTestId('settings-about-page').locator('.markdown-renderer')
    await expect(
      notes.getByRole('heading', { name: format === 'html' ? 'HTML changes' : 'Markdown changes' })
    ).toBeVisible()
    await expect
      .poll(() => settingsPage.locator('.release-notes').evaluate((el) => el.scrollTop))
      .toBe(0)
    await expect(notes.locator('li')).toHaveCount(20)
    await expect(notes.locator('li').last()).toHaveText(items[19])
    for (const dark of [false, true]) {
      await applyVisualState(settingsPage, { dark })
      await expect(notes.locator('ul')).toHaveCSS('list-style-type', 'disc')
      await expect(notes.locator('h2')).toHaveCSS('font-weight', '600')
      await expect(notes.locator('li').first()).toHaveCSS('font-size', '14px')
    }

    await settingsPage.setViewportSize(minimumViewport)
    const region = settingsPage.locator('.release-notes')
    await expect(region).toHaveAttribute('tabindex', '0')
    expect(await region.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await region.focus()
    await settingsPage.keyboard.press('End')
    await expect.poll(() => region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    await captureSettingsPage(settingsPage, testInfo, `release-notes-${format}-minimum-dark`)
  }
})
