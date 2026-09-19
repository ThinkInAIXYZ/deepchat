import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

const TEST_AGENT_PREFIX = 'DeepChat E2E Temp Agent'

type AgentSnapshot = {
  id?: unknown
  name?: unknown
  description?: unknown
  type?: unknown
  protected?: unknown
}

async function cleanupTempAgents(page: Page): Promise<void> {
  await page.evaluate(
    async ({ prefix }) => {
      const listed = (await window.deepchat.invoke('config.listAgents', {
        agentType: 'deepchat'
      })) as {
        agents?: AgentSnapshot[]
      }
      const agents = Array.isArray(listed.agents) ? listed.agents : []
      const targets = agents.filter(
        (agent) =>
          typeof agent.id === 'string' &&
          typeof agent.name === 'string' &&
          agent.name.startsWith(prefix) &&
          agent.protected !== true
      )

      for (const agent of targets) {
        await window.deepchat.invoke('config.deleteDeepChatAgent', { agentId: agent.id })
      }
    },
    { prefix: TEST_AGENT_PREFIX }
  )
}

async function findAgentByName(page: Page, name: string): Promise<AgentSnapshot | null> {
  return await page.evaluate(
    async ({ name }) => {
      const listed = (await window.deepchat.invoke('config.listAgents', {
        agentType: 'deepchat'
      })) as {
        agents?: AgentSnapshot[]
      }
      const agents = Array.isArray(listed.agents) ? listed.agents : []
      return agents.find((agent) => typeof agent.name === 'string' && agent.name === name) ?? null
    },
    { name }
  )
}

test('deepchat agent settings can create update and remove a temporary agent @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)
  await cleanupTempAgents(app.page)

  const runId = Date.now()
  const initialName = `${TEST_AGENT_PREFIX} ${runId}`
  const updatedName = `${initialName} Updated`
  const initialDescription = `created by e2e ${runId}`
  const updatedDescription = `updated by e2e ${runId}`
  let createdAgentId: string | null = null

  const settingsPage = await openSettings(app)

  try {
    await openSettingsTab(settingsPage, 'settings-tab-deepchat-agents')
    await expect(settingsPage.getByTestId('settings-deepchat-agents-page')).toBeVisible({
      timeout: 30_000
    })

    await settingsPage.getByTestId('deepchat-agent-add-button').click()
    await settingsPage.getByTestId('deepchat-agent-name-input').fill(initialName)
    await settingsPage.getByTestId('deepchat-agent-description-input').fill(initialDescription)
    await settingsPage.getByTestId('deepchat-agent-save-button').click()

    await expect
      .poll(async () => Boolean(await findAgentByName(settingsPage, initialName)), {
        timeout: 30_000,
        intervals: [500, 1_000]
      })
      .toBe(true)
    const createdAgent = await findAgentByName(settingsPage, initialName)

    expect(createdAgent?.type).toBe('deepchat')
    expect(createdAgent?.description).toBe(initialDescription)
    expect(typeof createdAgent?.id).toBe('string')
    createdAgentId = createdAgent?.id as string

    await expect(settingsPage.getByTestId(`deepchat-agent-row-${createdAgentId}`)).toBeVisible({
      timeout: 30_000
    })

    await settingsPage.getByTestId('deepchat-agent-name-input').fill(updatedName)
    await settingsPage.getByTestId('deepchat-agent-description-input').fill(updatedDescription)
    await settingsPage.getByTestId('deepchat-agent-save-button').click()

    await expect
      .poll(async () => Boolean(await findAgentByName(settingsPage, updatedName)), {
        timeout: 30_000,
        intervals: [500, 1_000]
      })
      .toBe(true)
    const updatedAgent = await findAgentByName(settingsPage, updatedName)

    expect(updatedAgent?.id).toBe(createdAgentId)
    expect(updatedAgent?.description).toBe(updatedDescription)
    await expect(settingsPage.getByTestId(`deepchat-agent-row-${createdAgentId}`)).toContainText(
      updatedName
    )

    const deleteResult = (await settingsPage.evaluate(
      async ({ agentId }) => {
        return await window.deepchat.invoke('config.deleteDeepChatAgent', { agentId })
      },
      { agentId: createdAgentId }
    )) as {
      removed?: unknown
    }
    expect(deleteResult.removed).toBe(true)
    createdAgentId = null

    await expect
      .poll(async () => await findAgentByName(settingsPage, updatedName), {
        timeout: 30_000,
        intervals: [500, 1_000]
      })
      .toBeNull()
  } finally {
    if (createdAgentId) {
      await settingsPage
        .evaluate(
          async ({ agentId }) => {
            await window.deepchat.invoke('config.deleteDeepChatAgent', { agentId })
          },
          { agentId: createdAgentId }
        )
        .catch(() => undefined)
    }
    await cleanupTempAgents(settingsPage).catch(() => undefined)
  }
})
