import { test, expect } from '../fixtures/electronApp'
import { createNewChat, selectAgent, selectModel, sendMessage } from '../helpers/chat'
import {
  createExactReplyPrompt,
  createSmokeToken,
  E2E_TARGET_MODEL_ID,
  E2E_TARGET_PROVIDER_ID
} from '../helpers/testData'
import { waitForAppReady, waitForGenerationDone } from '../helpers/wait'

test('输入框输入长英文/长路径时不顶开宽度 @smoke', async ({ app }) => {
  test.skip(
    process.env.RUN_PROVIDER_INTEGRATION !== 'true',
    'Set RUN_PROVIDER_INTEGRATION=true to run the real ChatPage composer width check.'
  )

  await waitForAppReady(app.page)

  // 窄窗口下才能复现：宽窗口里输入框已达 max-w-4xl，不存在被长文本顶开的空间
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows().find(
      (win) => !win.isDestroyed() && win.getTitle() === 'DeepChat'
    )
    mainWindow?.setSize(800, 640)
  })
  await app.page.waitForTimeout(500)

  await selectAgent(app.page)
  await createNewChat(app.page)
  await selectModel(app.page, E2E_TARGET_MODEL_ID, E2E_TARGET_PROVIDER_ID)
  await sendMessage(app.page, createExactReplyPrompt(createSmokeToken('E2E_WIDTH')))
  await waitForGenerationDone(app.page)

  const box = app.page.getByTestId('chat-input-box')
  await expect(box).toBeVisible({ timeout: 30_000 })
  const before = await box.boundingBox()
  expect(before).not.toBeNull()

  const editor = app.page
    .getByTestId('chat-input-editor')
    .locator('[contenteditable="true"]')
    .first()
  await editor.click()
  const longPath =
    '/Users/ssa-user/Desktop/study/github/deepchat/src/renderer/src/components/chat/ChatInputBox.vue'
  await editor.fill(longPath.repeat(2))
  await app.page.waitForTimeout(250)

  const after = await box.boundingBox()
  expect(after).not.toBeNull()
  expect(Math.round(after!.width)).toBe(Math.round(before!.width))

  const regionBox = await app.page.getByTestId('chat-composer-region').boundingBox()
  const shellBox = await app.page.getByTestId('chat-page-shell').boundingBox()
  expect(regionBox).not.toBeNull()
  expect(shellBox).not.toBeNull()
  expect(Math.round(regionBox!.width)).toBeLessThanOrEqual(Math.round(shellBox!.width) + 1)
})
