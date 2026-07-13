import { expect, type Page } from '@playwright/test'
import {
  getSettingsRouteItems,
  resolveSettingsNavigationPath,
  type SettingsNavigationItem
} from '../../../src/shared/settingsNavigation'
import type { ElectronAppInstance } from '../fixtures/electronApp'

const isSettingsWindow = async (page: Page): Promise<boolean> => {
  const url = page.url()
  if (url.startsWith('devtools://')) {
    return false
  }

  if (url.includes('/renderer/settings/index.html') || url.includes('/settings/index.html')) {
    return true
  }

  const title = await page.title().catch(() => '')
  if (title.includes('DevTools')) {
    return false
  }

  return title.includes('Settings')
}

export async function openSettings(app: ElectronAppInstance): Promise<Page> {
  await app.page.getByTestId('app-settings-button').click()

  await expect
    .poll(
      async () => {
        for (const candidate of app.electronApp.windows()) {
          if (await isSettingsWindow(candidate)) {
            return true
          }
        }
        return false
      },
      {
        timeout: 30_000,
        intervals: [500, 1_000, 2_000]
      }
    )
    .toBe(true)

  for (const candidate of app.electronApp.windows()) {
    if (await isSettingsWindow(candidate)) {
      await expect(candidate.getByTestId('settings-page')).toBeVisible({ timeout: 30_000 })
      return candidate
    }
  }

  throw new Error('Settings window did not open.')
}

const getRouteTabTestId = (
  item: SettingsNavigationItem,
  routeName?: SettingsNavigationItem['routeName']
): string => {
  const firstStaticPathSegment = item.path
    .split('/')
    .find((segment) => segment && !segment.startsWith(':'))
  const tabSegment = firstStaticPathSegment ?? routeName?.replace(/^settings-/, '')
  if (!tabSegment) {
    throw new Error(`Route ${item.routeName} has no static tab segment`)
  }
  return `settings-tab-${tabSegment}`
}

export async function openSettingsTab(
  settingsPage: Page,
  tabTestId: string,
  routeName?: SettingsNavigationItem['routeName']
): Promise<void> {
  const routeItems = getSettingsRouteItems(process.platform, process.arch)
  const routeItem = routeName
    ? routeItems.find((item) => item.routeName === routeName)
    : routeItems.find(
        (item) => !item.hiddenInSidebar && getRouteTabTestId(item, item.routeName) === tabTestId
      )

  if (routeItem?.hiddenInSidebar) {
    const path = resolveSettingsNavigationPath(
      routeItem.routeName,
      undefined,
      process.platform,
      process.arch
    )
    await settingsPage.evaluate((hash) => {
      window.location.hash = hash
    }, `#${path}`)
    return
  }

  const tab = settingsPage.getByTestId(tabTestId)
  await expect(tab).toBeVisible({ timeout: 30_000 })
  await tab.click()
}

export async function selectProvider(settingsPage: Page, providerId: string): Promise<void> {
  const providerItem = settingsPage.locator(`[data-provider-id="${providerId}"]`).first()
  await expect(
    providerItem,
    `Provider "${providerId}" was not found. Configure it before running "pnpm run e2e:smoke".`
  ).toBeVisible({ timeout: 30_000 })
  await providerItem.click()
}

export async function verifyProviderConnection(settingsPage: Page, modelId: string): Promise<void> {
  const verifyButton = settingsPage.getByTestId('provider-verify-button')
  await expect(verifyButton).toBeVisible({ timeout: 30_000 })
  await verifyButton.click()

  const dialog = settingsPage.getByTestId('model-check-dialog')
  await expect(dialog).toBeVisible({ timeout: 30_000 })

  await dialog.getByTestId('model-check-select').click()

  const option = settingsPage
    .locator(`[data-testid="model-check-option"][data-model-id="${modelId}"]`)
    .first()
  await expect(
    option,
    `Model "${modelId}" was not found in the provider check dialog.`
  ).toBeVisible({ timeout: 30_000 })
  await option.click()

  await dialog.getByTestId('model-check-submit').click()
  await expect(dialog.getByTestId('model-check-result')).toHaveAttribute('data-success', 'true', {
    timeout: 180_000
  })
}
