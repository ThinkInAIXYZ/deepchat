import { test, expect } from '../fixtures/electronApp'
import {
  createNewChat,
  getActiveSessionId,
  getAssistantMessages,
  getUserMessages,
  selectAgent,
  selectModel,
  sendMessage
} from '../helpers/chat'
import {
  createExactReplyPrompt,
  createSmokeToken,
  E2E_TARGET_MODEL_ID,
  E2E_TARGET_PROVIDER_ID
} from '../helpers/testData'
import { waitForAppReady, waitForGenerationDone } from '../helpers/wait'

test('基础聊天流程 @smoke', async ({ app }, testInfo) => {
  const firstReplyToken = createSmokeToken('E2E_CHAT_ONE')
  const secondReplyToken = createSmokeToken('E2E_CHAT_TWO')

  await waitForAppReady(app.page)
  await selectAgent(app.page)
  await createNewChat(app.page)
  await selectModel(app.page, E2E_TARGET_MODEL_ID, E2E_TARGET_PROVIDER_ID)

  await sendMessage(app.page, createExactReplyPrompt(firstReplyToken))
  await waitForGenerationDone(app.page)

  await expect(getUserMessages(app.page)).toHaveCount(1)
  await expect(getAssistantMessages(app.page)).toHaveCount(1)
  await expect(getUserMessages(app.page).last()).toContainText(firstReplyToken)
  await expect(getAssistantMessages(app.page).last()).toContainText(firstReplyToken)

  await expect
    .poll(
      async () => {
        const switcher = app.page.getByTestId('app-model-switcher')
        return {
          modelId: (await switcher.getAttribute('data-selected-model-id')) ?? '',
          providerId: (await switcher.getAttribute('data-selected-provider-id')) ?? ''
        }
      },
      {
        message: `Model switcher should keep ${E2E_TARGET_PROVIDER_ID}/${E2E_TARGET_MODEL_ID}.`,
        timeout: 60_000
      }
    )
    .toEqual({
      modelId: E2E_TARGET_MODEL_ID,
      providerId: E2E_TARGET_PROVIDER_ID
    })

  const firstSessionId = await getActiveSessionId(app.page)
  expect(firstSessionId).not.toBe('')

  await sendMessage(app.page, createExactReplyPrompt(secondReplyToken))
  await waitForGenerationDone(app.page)

  await expect(getUserMessages(app.page)).toHaveCount(2)
  await expect(getAssistantMessages(app.page)).toHaveCount(2)
  await expect(getAssistantMessages(app.page).last()).toContainText(secondReplyToken)

  await app.page.screenshot({
    path: testInfo.outputPath('chat-basic.png'),
    fullPage: true
  })
})
