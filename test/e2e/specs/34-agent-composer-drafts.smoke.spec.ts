import { test, expect } from '../fixtures/electronApp'
import { selectAgent } from '../helpers/chat'
import { waitForAppReady } from '../helpers/wait'

test('agent drafts survive switches, deselection and reload @smoke', async ({ app }) => {
  await waitForAppReady(app.page)
  const { agent } = await app.page.evaluate(async () => {
    return window.deepchat.invoke('config.createDeepChatAgent', {
      name: 'Draft regression agent'
    }) as Promise<{ agent: { id: string } }>
  })

  try {
    await selectAgent(app.page, 'deepchat')
    const editor = app.page.getByTestId('chat-input-contenteditable')
    await editor.fill('Draft for DeepChat')
    await selectAgent(app.page, agent.id)
    await expect(editor).toHaveText('')
    await editor.fill('Draft for another agent')

    await selectAgent(app.page, 'deepchat')
    await expect(editor).toHaveText('Draft for DeepChat')
    await app.page.getByTestId('sidebar-agent-all-button').click()
    await expect(editor).toHaveCount(0)
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
