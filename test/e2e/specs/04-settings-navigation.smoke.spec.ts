import type { Page, TestInfo } from '@playwright/test'
import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

const desktopViewport = { width: 1280, height: 900 }
const minimumViewport = { width: 760, height: 720 }

const settingsPages = [
  {
    name: 'overview',
    tabTestId: 'settings-tab-overview',
    pageTestId: 'settings-overview-page'
  },
  {
    name: 'general',
    tabTestId: 'settings-tab-general',
    pageTestId: 'settings-general-page'
  },
  {
    name: 'appearance',
    tabTestId: 'settings-tab-appearance',
    pageTestId: 'settings-appearance-page'
  },
  {
    name: 'environments',
    tabTestId: 'settings-tab-environments',
    pageTestId: 'settings-environments-page'
  },
  {
    name: 'shortcuts',
    tabTestId: 'settings-tab-shortcut',
    pageTestId: 'settings-shortcut-page'
  },
  {
    name: 'provider-center',
    tabTestId: 'settings-tab-model-providers',
    pageTestId: 'settings-provider-page'
  },
  {
    name: 'mcp-center',
    tabTestId: 'settings-tab-mcp',
    pageTestId: 'settings-mcp-page'
  },
  {
    name: 'deepchat-agents',
    tabTestId: 'settings-tab-deepchat-agents',
    pageTestId: 'settings-deepchat-agents-page'
  },
  {
    name: 'acp',
    tabTestId: 'settings-tab-acp-agents',
    pageTestId: 'settings-acp-page'
  },
  {
    name: 'remote',
    tabTestId: 'settings-tab-remote',
    pageTestId: 'settings-remote-page'
  },
  {
    name: 'notifications-hooks',
    tabTestId: 'settings-tab-notifications-hooks',
    pageTestId: 'settings-notifications-hooks-page'
  },
  {
    name: 'plugins',
    tabTestId: 'settings-tab-plugins',
    pageTestId: 'settings-plugins-page',
    optional: true
  },
  {
    name: 'skills',
    tabTestId: 'settings-tab-skills',
    pageTestId: 'settings-skills-page'
  },
  {
    name: 'prompts',
    tabTestId: 'settings-tab-prompt',
    pageTestId: 'settings-prompt-page'
  },
  {
    name: 'knowledge-base',
    tabTestId: 'settings-tab-knowledge-base',
    pageTestId: 'settings-knowledge-base-page'
  },
  {
    name: 'data-privacy',
    tabTestId: 'settings-tab-database',
    pageTestId: 'settings-data-page'
  },
  {
    name: 'about',
    tabTestId: 'settings-tab-about',
    pageTestId: 'settings-about-page'
  }
] as const

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
  const tab = page.getByTestId(item.tabTestId)
  if (item.optional && (await tab.count()) === 0) {
    return false
  }

  await openSettingsTab(page, item.tabTestId)
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
