import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('acp settings exposes config presenter read-only routes @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-acp-agents')
  await expect(settingsPage.getByTestId('settings-acp-page')).toBeVisible({ timeout: 30_000 })

  const snapshot = await settingsPage.evaluate(async () => {
    const acpState = (await window.deepchat.invoke('config.getAcpState', {})) as {
      agents?: unknown[]
      enabled?: unknown
    }
    const registry = (await window.deepchat.invoke('config.listAcpRegistryAgents', {})) as {
      agents?: Array<{
        enabled?: unknown
        id?: unknown
        installState?: { status?: unknown } | null
        name?: unknown
        source?: unknown
        version?: unknown
      }>
    }
    const manual = (await window.deepchat.invoke('config.listManualAcpAgents', {})) as {
      agents?: Array<{
        command?: unknown
        enabled?: unknown
        id?: unknown
        name?: unknown
        source?: unknown
      }>
    }
    const sharedMcp = (await window.deepchat.invoke('config.getAcpSharedMcpSelections', {})) as {
      selections?: unknown[]
    }
    const deepchatAgents = (await window.deepchat.invoke('config.listAgents', {
      agentType: 'deepchat'
    })) as {
      agents?: Array<{ id?: unknown; name?: unknown; type?: unknown }>
    }
    const acpAgents = (await window.deepchat.invoke('config.listAgents', {
      agentType: 'acp'
    })) as {
      agents?: Array<{ id?: unknown; name?: unknown; type?: unknown }>
    }

    return {
      acpAgentCount: acpAgents.agents?.length ?? -1,
      acpAgentsValid:
        acpAgents.agents?.every(
          (agent) =>
            typeof agent.id === 'string' && typeof agent.name === 'string' && agent.type === 'acp'
        ) ?? false,
      acpEnabled: acpState.enabled,
      acpStateAgentCount: acpState.agents?.length ?? -1,
      deepchatAgentCount: deepchatAgents.agents?.length ?? -1,
      deepchatAgentsValid:
        deepchatAgents.agents?.every(
          (agent) =>
            typeof agent.id === 'string' &&
            typeof agent.name === 'string' &&
            agent.type === 'deepchat'
        ) ?? false,
      manualAgentCount: manual.agents?.length ?? -1,
      manualAgentsValid:
        manual.agents?.every(
          (agent) =>
            typeof agent.id === 'string' &&
            typeof agent.name === 'string' &&
            typeof agent.command === 'string' &&
            typeof agent.enabled === 'boolean' &&
            agent.source === 'manual'
        ) ?? false,
      registryAgentCount: registry.agents?.length ?? -1,
      registryAgentsValid:
        registry.agents?.every(
          (agent) =>
            typeof agent.id === 'string' &&
            typeof agent.name === 'string' &&
            typeof agent.version === 'string' &&
            typeof agent.enabled === 'boolean' &&
            agent.source === 'registry' &&
            (agent.installState == null ||
              ['not_installed', 'installing', 'installed', 'error'].includes(
                String(agent.installState.status)
              ))
        ) ?? false,
      sharedMcpCount: sharedMcp.selections?.length ?? -1,
      sharedMcpSelectionsValid:
        sharedMcp.selections?.every((selection) => typeof selection === 'string') ?? false
    }
  })

  expect(typeof snapshot.acpEnabled).toBe('boolean')
  expect(snapshot.acpStateAgentCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.registryAgentCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.registryAgentsValid).toBe(true)
  expect(snapshot.manualAgentCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.manualAgentsValid).toBe(true)
  expect(snapshot.sharedMcpCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.sharedMcpSelectionsValid).toBe(true)
  expect(snapshot.deepchatAgentCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.deepchatAgentsValid).toBe(true)
  expect(snapshot.acpAgentCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.acpAgentsValid).toBe(true)
})
