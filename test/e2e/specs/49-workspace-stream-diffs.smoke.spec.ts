import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDeepchatEventEnvelope } from '../../../src/shared/contracts/events'
import { DEEPCHAT_EVENT_CHANNEL } from '../../../src/shared/contracts/channels'
import { test, expect } from '../fixtures/electronApp'
import { createNewChat } from '../helpers/chat'
import { waitForAppReady } from '../helpers/wait'

test('workspace text files render through the stream-diffs surface @smoke', async ({ app }) => {
  const workspace = join(app.userDataDir, 'workspace-stream-diffs')
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'sample.ts'), 'export const answer = 42\n')

  await waitForAppReady(app.page)
  await app.page.evaluate(async (path) => {
    await window.deepchat.invoke('config.setLanguage', { language: 'en-US' })
    await window.deepchat.invoke('config.setDefaultProjectPath', { path })
  }, workspace)
  await createNewChat(app.page)

  await app.electronApp.evaluate(
    ({ webContents }, { url, channel, event }) => {
      const contents = webContents.getAllWebContents().find((target) => target.getURL() === url)
      if (!contents) throw new Error('Chat renderer not found')
      contents.send(channel, event)
    },
    {
      url: app.page.url(),
      channel: DEEPCHAT_EVENT_CHANNEL,
      event: createDeepchatEventEnvelope('appRuntime.shortcutRequested', {
        action: 'toggleWorkspace'
      })
    }
  )

  const panel = app.page.getByTestId('chat-side-panel-shell')
  const file = panel.locator('[data-workspace-path]').filter({ hasText: 'sample.ts' })
  await expect(file).toBeVisible()
  await file.click()

  const codePane = panel.getByTestId('workspace-code-pane')
  await expect(codePane).toBeVisible()
  await expect(codePane.locator('[data-file]')).toBeVisible()
  await expect(codePane).toContainText('export const answer = 42')
  await expect(codePane).toHaveAttribute('role', 'region')
  await expect(codePane).toHaveAttribute('tabindex', '0')
  await expect(codePane).toHaveAttribute('aria-label', /sample\.ts$/)
  await expect(codePane.locator('.monaco-editor')).toHaveCount(0)
})
