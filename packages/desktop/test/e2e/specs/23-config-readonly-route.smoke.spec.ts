import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('config settings read-only routes expose agents hooks and shortcuts @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)

  await openSettingsTab(settingsPage, 'settings-tab-deepchat-agents')
  await expect(settingsPage.getByTestId('settings-deepchat-agents-page')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('deepchat-agents-sticky-header')).toBeVisible({
    timeout: 30_000
  })

  const agentSnapshot = await settingsPage.evaluate(async () => {
    type Agent = {
      agentType?: unknown
      config?: unknown
      description?: unknown
      enabled?: unknown
      id?: unknown
      name?: unknown
      protected?: unknown
      type?: unknown
    }

    const all = (await window.deepchat.invoke('config.listAgents', {})) as {
      agents?: Agent[]
    }
    const deepchat = (await window.deepchat.invoke('config.listAgents', {
      agentType: 'deepchat'
    })) as {
      agents?: Agent[]
    }

    const agents = Array.isArray(all.agents) ? all.agents : []
    const deepchatAgents = Array.isArray(deepchat.agents) ? deepchat.agents : []
    const selectedAgent =
      deepchatAgents.find((agent) => typeof agent.id === 'string') ??
      agents.find((agent) => typeof agent.id === 'string' && agent.type === 'deepchat')
    const selectedAgentId = typeof selectedAgent?.id === 'string' ? selectedAgent.id : null

    let resolvedConfig: {
      hasObjectConfig: boolean
      hasValidMcpSelections: boolean
      mcpSelectionCount: number
    } | null = null

    if (selectedAgentId) {
      const configResult = (await window.deepchat.invoke('config.resolveDeepChatAgentConfig', {
        agentId: selectedAgentId
      })) as {
        config?: unknown
      }
      const selectionsResult = (await window.deepchat.invoke('config.getAgentMcpSelections', {
        agentId: selectedAgentId
      })) as {
        selections?: unknown[]
      }
      const selections = Array.isArray(selectionsResult.selections)
        ? selectionsResult.selections
        : []

      resolvedConfig = {
        hasObjectConfig:
          typeof configResult.config === 'object' &&
          configResult.config !== null &&
          !Array.isArray(configResult.config),
        hasValidMcpSelections: selections.every((selection) => typeof selection === 'string'),
        mcpSelectionCount: selections.length
      }
    }

    return {
      allAgentCount: agents.length,
      agentsValid: agents.every(
        (agent) =>
          typeof agent.id === 'string' &&
          typeof agent.name === 'string' &&
          (agent.type === 'deepchat' || agent.type === 'acp') &&
          typeof agent.enabled === 'boolean' &&
          (agent.agentType === undefined ||
            agent.agentType === 'deepchat' ||
            agent.agentType === 'acp') &&
          (agent.description === undefined || typeof agent.description === 'string') &&
          (agent.protected === undefined || typeof agent.protected === 'boolean')
      ),
      deepchatAgentCount: deepchatAgents.length,
      deepchatAgentsValid: deepchatAgents.every(
        (agent) =>
          typeof agent.id === 'string' &&
          typeof agent.name === 'string' &&
          agent.type === 'deepchat' &&
          typeof agent.enabled === 'boolean'
      ),
      selectedAgentId,
      resolvedConfig
    }
  })

  expect(agentSnapshot.allAgentCount).toBeGreaterThanOrEqual(0)
  expect(agentSnapshot.agentsValid).toBe(true)
  expect(agentSnapshot.deepchatAgentCount).toBeGreaterThan(0)
  expect(agentSnapshot.deepchatAgentsValid).toBe(true)
  expect(typeof agentSnapshot.selectedAgentId).toBe('string')
  expect(agentSnapshot.resolvedConfig).toBeTruthy()
  expect(agentSnapshot.resolvedConfig?.hasObjectConfig).toBe(true)
  expect(agentSnapshot.resolvedConfig?.mcpSelectionCount).toBeGreaterThanOrEqual(0)
  expect(agentSnapshot.resolvedConfig?.hasValidMcpSelections).toBe(true)

  await openSettingsTab(settingsPage, 'settings-tab-notifications-hooks')
  await expect(settingsPage.getByTestId('settings-notifications-hooks-page')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('notifications-hooks-add')).toBeVisible({
    timeout: 30_000
  })

  const hooksSnapshot = await settingsPage.evaluate(async () => {
    const allowedEvents = new Set([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PermissionRequest',
      'Stop',
      'SessionEnd'
    ])
    const result = (await window.deepchat.invoke('config.getHooksNotifications', {})) as {
      config?: {
        hooks?: Array<{
          command?: unknown
          enabled?: unknown
          events?: unknown[]
          id?: unknown
          name?: unknown
        }>
      }
    }
    const hooks = Array.isArray(result.config?.hooks) ? result.config.hooks : []

    return {
      emptyStateVisible: Boolean(
        document.querySelector('[data-testid="notifications-hooks-empty"]')
      ),
      hookCount: hooks.length,
      hookCardsCount: document.querySelectorAll('[data-testid^="notifications-hook-"]').length,
      hooksValid: hooks.every(
        (hook) =>
          typeof hook.id === 'string' &&
          typeof hook.name === 'string' &&
          typeof hook.enabled === 'boolean' &&
          typeof hook.command === 'string' &&
          Array.isArray(hook.events) &&
          hook.events.every((event) => typeof event === 'string' && allowedEvents.has(event))
      )
    }
  })

  expect(hooksSnapshot.hookCount).toBeGreaterThanOrEqual(0)
  expect(hooksSnapshot.hooksValid).toBe(true)
  if (hooksSnapshot.hookCount === 0) {
    expect(hooksSnapshot.emptyStateVisible).toBe(true)
  } else {
    expect(hooksSnapshot.hookCardsCount).toBeGreaterThanOrEqual(hooksSnapshot.hookCount)
  }

  await openSettingsTab(settingsPage, 'settings-tab-shortcut')
  await expect(settingsPage.getByTestId('settings-shortcut-page')).toBeVisible({
    timeout: 30_000
  })

  const shortcutsSnapshot = await settingsPage.evaluate(async () => {
    const result = (await window.deepchat.invoke('config.getShortcutKeys', {})) as {
      shortcuts?: Record<string, unknown>
    }
    const entries = Object.entries(result.shortcuts ?? {})

    return {
      shortcutCount: entries.length,
      shortcutsValid: entries.every(
        ([shortcutId, shortcutValue]) =>
          typeof shortcutId === 'string' && typeof shortcutValue === 'string'
      )
    }
  })

  expect(shortcutsSnapshot.shortcutCount).toBeGreaterThan(0)
  expect(shortcutsSnapshot.shortcutsValid).toBe(true)
})
