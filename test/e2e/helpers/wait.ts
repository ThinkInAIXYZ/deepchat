import { expect, type Page } from '@playwright/test'

export async function waitForAppReady(page: Page): Promise<void> {
  await expect(page.getByTestId('app-root')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('window-sidebar')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('app-settings-button')).toBeVisible({ timeout: 30_000 })
}

export async function waitForChatSurface(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        if (
          await page
            .getByTestId('chat-page')
            .isVisible()
            .catch(() => false)
        ) {
          return 'chat'
        }

        if (
          await page
            .getByTestId('new-thread-page')
            .isVisible()
            .catch(() => false)
        ) {
          return 'new-thread'
        }

        return 'loading'
      },
      {
        timeout: 30_000,
        intervals: [500, 1_000, 2_000]
      }
    )
    .not.toBe('loading')
}

export async function waitForGenerationDone(page: Page): Promise<void> {
  const chatPage = page.getByTestId('chat-page')
  await expect(chatPage).toBeVisible({ timeout: 60_000 })

  await expect
    .poll(async () => (await chatPage.getAttribute('data-generating')) ?? 'false', {
      timeout: 15_000,
      intervals: [250, 500, 1_000]
    })
    .toBe('true')

  await expect
    .poll(async () => (await chatPage.getAttribute('data-generating')) ?? 'false', {
      timeout: 240_000,
      intervals: [500, 1_000, 2_000]
    })
    .toBe('false')

  await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: 30_000 })
}
