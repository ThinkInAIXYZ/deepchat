import { test, expect } from '../fixtures/electronApp'
import {
  createNewChat,
  getActiveSessionId,
  getAssistantMessages,
  openSessionById,
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

test('会话重启后持久化 @smoke', async ({ app, launchApp }) => {
  const sessionAToken = createSmokeToken('E2E_SESSION_A')
  const sessionBToken = createSmokeToken('E2E_SESSION_B')

  await waitForAppReady(app.page)
  await selectAgent(app.page)

  await createNewChat(app.page)
  await selectModel(app.page, E2E_TARGET_MODEL_ID, E2E_TARGET_PROVIDER_ID)
  await sendMessage(app.page, createExactReplyPrompt(sessionAToken))
  await waitForGenerationDone(app.page)
  const sessionAId = await getActiveSessionId(app.page)

  await createNewChat(app.page)
  await selectModel(app.page, E2E_TARGET_MODEL_ID, E2E_TARGET_PROVIDER_ID)
  await sendMessage(app.page, createExactReplyPrompt(sessionBToken))
  await waitForGenerationDone(app.page)
  const sessionBId = await getActiveSessionId(app.page)

  await openSessionById(app.page, sessionAId)
  await expect(getAssistantMessages(app.page).last()).toContainText(sessionAToken)

  await app.close()

  const relaunched = await launchApp()
  await waitForAppReady(relaunched.page)
  await selectAgent(relaunched.page)

  await expect(
    relaunched.page.locator(`[data-testid="sidebar-session-item"][data-session-id="${sessionAId}"]`)
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    relaunched.page.locator(`[data-testid="sidebar-session-item"][data-session-id="${sessionBId}"]`)
  ).toBeVisible({ timeout: 30_000 })

  await openSessionById(relaunched.page, sessionAId)
  await expect(getAssistantMessages(relaunched.page).last()).toContainText(sessionAToken)

  await openSessionById(relaunched.page, sessionBId)
  await expect(getAssistantMessages(relaunched.page).last()).toContainText(sessionBToken)
})
