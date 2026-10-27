import { expect, type Page } from '@playwright/test'

const escapeAttributeValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

const createModelOptionSelector = (modelId: string, providerId?: string): string => {
  const selector = `[data-testid="model-option"][data-model-id="${escapeAttributeValue(modelId)}"]`
  return providerId
    ? `${selector}[data-provider-id="${escapeAttributeValue(providerId)}"]`
    : selector
}

export async function selectAgent(page: Page, agentId = 'deepchat'): Promise<void> {
  if (!(await page.getByTestId('new-thread-page').isVisible())) await createNewChat(page)
  const selector = page.getByTestId('new-thread-agent-selector')
  if ((await selector.getAttribute('data-selected-agent-id')) !== agentId) {
    const button = page
      .locator(
        `[data-testid="new-thread-agent-option"][data-agent-id="${escapeAttributeValue(agentId)}"]`
      )
      .first()
    if ((await selector.getAttribute('aria-expanded')) !== 'true') await selector.click()
    await expect(button).toBeVisible({ timeout: 30_000 })
    await button.click()
    await expect(button).toBeHidden()
    await expect(selector).toHaveAttribute('data-selected-agent-id', agentId, {
      timeout: 30_000
    })
  }

  await expect(page.getByTestId('chat-input-editor')).toBeVisible({ timeout: 30_000 })
}

export async function createNewChat(page: Page): Promise<void> {
  const sidebarButton = page.getByTestId('app-new-chat-button')
  const collapsedButton = page.getByTestId('collapsed-new-chat-button')

  if (await sidebarButton.isVisible().catch(() => false)) {
    await sidebarButton.click()
  } else {
    await collapsedButton.click()
  }

  await expect(page.getByTestId('chat-input-editor')).toBeVisible({ timeout: 30_000 })
}

export async function selectModel(page: Page, modelId: string, providerId?: string): Promise<void> {
  const switcher = page.getByTestId('app-model-switcher')

  await expect(switcher).toBeVisible({ timeout: 30_000 })

  const selectedModelId = await switcher.getAttribute('data-selected-model-id')
  const selectedProviderId = await switcher.getAttribute('data-selected-provider-id')
  if (selectedModelId === modelId && (!providerId || selectedProviderId === providerId)) {
    return
  }

  await switcher.click()

  const modelLabel = providerId ? `${providerId}/${modelId}` : modelId
  const option = page.locator(createModelOptionSelector(modelId, providerId)).first()
  await expect(
    option,
    `Model "${modelLabel}" was not found. Configure it before running "pnpm run e2e:smoke".`
  ).toBeAttached({ timeout: 30_000 })
  await option.scrollIntoViewIfNeeded()
  await expect(option).toBeVisible({ timeout: 30_000 })
  await option.click()

  await expect
    .poll(
      async () => {
        const nextSelectedModelId = await switcher.getAttribute('data-selected-model-id')
        const nextSelectedProviderId = await switcher.getAttribute('data-selected-provider-id')
        return (
          nextSelectedModelId === modelId && (!providerId || nextSelectedProviderId === providerId)
        )
      },
      {
        message: `Model switcher should select "${modelLabel}".`,
        timeout: 60_000
      }
    )
    .toBe(true)
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('chat-input-editor').locator('[contenteditable="true"]').first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
  await editor.fill(text)

  const sendButton = page.getByTestId('chat-send-button')
  await expect(sendButton).toBeEnabled({ timeout: 30_000 })
  await sendButton.click()
}

export function getUserMessages(page: Page) {
  return page.getByTestId('chat-message-user')
}

export function getAssistantMessages(page: Page) {
  return page.getByTestId('chat-message-assistant')
}

export async function getActiveSessionId(page: Page): Promise<string> {
  let sessionId = ''
  await expect
    .poll(
      async () => {
        sessionId = await page.evaluate(async () => {
          const { session } = await window.deepchat.invoke('sessions.getActive', {})
          return session?.id ?? ''
        })
        return sessionId
      },
      { timeout: 30_000 }
    )
    .not.toBe('')
  return sessionId
}

export async function openSessionById(page: Page, sessionId: string): Promise<void> {
  const sessionItem = page
    .locator(`[data-testid="sidebar-session-item"][data-session-id="${sessionId}"]`)
    .first()
  await expect(sessionItem).toBeVisible({ timeout: 30_000 })
  await sessionItem.click()
  await expect(sessionItem).toHaveAttribute('data-active', 'true', { timeout: 30_000 })
}
