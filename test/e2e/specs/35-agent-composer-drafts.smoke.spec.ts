import { test, expect } from '../fixtures/electronApp'
import { getActiveSessionId, selectAgent } from '../helpers/chat'
import { waitForAppReady } from '../helpers/wait'

test('agent drafts survive switches, history filtering and reload @smoke', async ({ app }) => {
  await waitForAppReady(app.page)
  const { agent } = await app.page.evaluate(async () => {
    return window.deepchat.invoke('config.createDeepChatAgent', {
      name: 'Draft regression agent'
    }) as Promise<{ agent: { id: string } }>
  })

  try {
    await selectAgent(app.page, 'deepchat')
    const selector = app.page.getByTestId('new-thread-agent-selector')
    await selector.focus()
    await app.page.keyboard.press('Enter')
    const checkedAgent = app.page.locator(
      '[data-testid="new-thread-agent-option"][data-agent-id="deepchat"]'
    )
    await expect(checkedAgent).toHaveRole('menuitemradio')
    await expect(checkedAgent).toHaveAttribute('aria-checked', 'true')
    await checkedAgent.focus()
    await app.page.keyboard.press('Enter')
    await expect(checkedAgent).toBeHidden()
    const editor = app.page.getByTestId('chat-input-contenteditable')
    await editor.fill('Draft for DeepChat')
    await app.page.getByTestId('sidebar-agent-selector').click()
    await app.page.getByTestId('sidebar-agent-all-button').click()
    await expect(editor).toHaveText('Draft for DeepChat')
    await selectAgent(app.page, agent.id)
    await expect(editor).toHaveText('')
    await editor.fill('Draft for another agent')

    await selectAgent(app.page, 'deepchat')
    await expect(editor).toHaveText('Draft for DeepChat')
    await app.page.getByTestId('sidebar-agent-selector').click()
    await app.page.getByTestId('sidebar-agent-all-button').click()
    await expect(editor).toHaveText('Draft for DeepChat')
    await selectAgent(app.page, 'deepchat')
    await expect(editor).toHaveText('Draft for DeepChat')

    await editor.fill('Latest edit before reload')
    await app.page.reload()
    await waitForAppReady(app.page)
    await selectAgent(app.page, 'deepchat')
    await expect(editor).toHaveText('Latest edit before reload')
    await selectAgent(app.page, agent.id)
    await expect(editor).toHaveText('Draft for another agent')
  } finally {
    await app.page.evaluate(async (agentId) => {
      await window.deepchat.invoke('config.deleteDeepChatAgent', { agentId })
    }, agent.id)
  }
})

test('history filtering preserves the active conversation and next execution Agent @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)
  await selectAgent(app.page, 'deepchat')
  const { agent } = await app.page.evaluate(async () => {
    return window.deepchat.invoke('config.createDeepChatAgent', {
      name: 'Independent history filter'
    }) as Promise<{ agent: { id: string } }>
  })
  try {
    const { session: historySession } = await app.page.evaluate(async () =>
      window.deepchat.invoke('sessions.create', {
        agentId: 'deepchat',
        providerId: 'openai',
        modelId: 'fixture-model',
        message: ''
      })
    )
    await selectAgent(app.page, agent.id)
    const { session } = await app.page.evaluate(
      async (agentId) =>
        window.deepchat.invoke('sessions.create', {
          agentId,
          providerId: 'openai',
          modelId: 'fixture-model',
          message: ''
        }),
      agent.id
    )
    const sessionId = session.id
    if ((await app.page.getByTestId('window-sidebar').getAttribute('class'))?.includes('w-12')) {
      await app.page.getByTestId('window-sidebar-toggle').click()
    }
    await app.page
      .locator(`[data-testid="sidebar-session-item"][data-session-id="${sessionId}"]`)
      .click()
    await expect(app.page.getByTestId('chat-page')).toBeVisible()
    expect(await getActiveSessionId(app.page)).toBe(sessionId)
    await app.page.getByTestId('sidebar-agent-selector').click()
    await app.page.locator('[data-testid="sidebar-agent-button"][data-agent-id="deepchat"]').click()
    await expect(app.page.getByTestId('chat-page')).toBeVisible()
    expect(await getActiveSessionId(app.page)).toBe(sessionId)
    await expect(
      app.page.locator(`[data-testid="sidebar-session-item"][data-session-id="${sessionId}"]`)
    ).toHaveCount(0)
    await app.page.getByTestId('app-new-chat-button').click()
    await expect(app.page.getByTestId('new-thread-agent-selector')).toHaveAttribute(
      'data-selected-agent-id',
      agent.id
    )
    await expect(app.page.getByTestId('sidebar-agent-selector')).toHaveAttribute(
      'data-selected-agent-id',
      'deepchat'
    )
    await app.page
      .locator(`[data-testid="sidebar-session-item"][data-session-id="${historySession.id}"]`)
      .click()
    await expect(app.page.getByTestId('chat-page')).toBeVisible()
    await app.page.getByTestId('app-new-chat-button').click()
    await expect(app.page.getByTestId('new-thread-agent-selector')).toHaveAttribute(
      'data-selected-agent-id',
      agent.id
    )
  } finally {
    await app.page.evaluate(async (agentId) => {
      await window.deepchat.invoke('config.deleteDeepChatAgent', { agentId })
    }, agent.id)
  }
})
