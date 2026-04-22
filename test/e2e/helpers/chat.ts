import { expect, type Page } from '@playwright/test'

export async function selectAgent(page: Page, preferredAgentId = 'deepchat'): Promise<void> {
  const preferredAgent = page
    .locator(`[data-testid="sidebar-agent-button"][data-agent-id="${preferredAgentId}"]`)
    .first()
  const fallbackAgent = page.getByTestId('sidebar-agent-button').first()
  const button = (await preferredAgent.count()) > 0 ? preferredAgent : fallbackAgent

  await expect(button).toBeVisible({ timeout: 30_000 })

  if ((await button.getAttribute('data-selected')) !== 'true') {
    await button.click()
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

export async function selectModel(page: Page, modelId: string): Promise<void> {
  const switcher = page.getByTestId('app-model-switcher')

  await expect(switcher).toBeVisible({ timeout: 30_000 })

  const existingText = (await switcher.textContent())?.trim() ?? ''
  if (existingText.includes(modelId)) {
    return
  }

  await switcher.click()

  const searchInput = page.locator('[data-model-search-input="true"]').last()
  if ((await searchInput.count()) > 0) {
    await searchInput.fill(modelId)
  }

  const option = page.locator(`[data-testid="model-option"][data-model-id="${modelId}"]`).first()
  await expect(
    option,
    `Model "${modelId}" was not found. Configure it before running "pnpm run e2e:smoke".`
  ).toBeVisible({ timeout: 30_000 })
  await option.click()

  await expect
    .poll(async () => {
      const text = (await switcher.textContent())?.trim() ?? ''
      return text.includes(modelId)
    })
    .toBe(true)
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('chat-input-contenteditable')
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
  const activeSession = page
    .locator('[data-testid="sidebar-session-item"][data-active="true"]')
    .first()
  await expect(activeSession).toBeVisible({ timeout: 30_000 })
  const sessionId = await activeSession.getAttribute('data-session-id')

  if (!sessionId) {
    throw new Error('Active session id was not found in the sidebar.')
  }

  return sessionId
}

export async function openSessionById(page: Page, sessionId: string): Promise<void> {
  const sessionItem = page
    .locator(`[data-testid="sidebar-session-item"][data-session-id="${sessionId}"]`)
    .first()
  await expect(sessionItem).toBeVisible({ timeout: 30_000 })
  await sessionItem.click()
}
