import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('mcp settings read-only routes expose server and registry snapshots @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-mcp')
  await expect(settingsPage.getByTestId('settings-mcp-page')).toBeVisible({ timeout: 30_000 })

  const snapshot = await settingsPage.evaluate(async () => {
    const enabled = (await window.deepchat.invoke('mcp.getEnabled', {})) as {
      enabled?: unknown
    }
    const servers = (await window.deepchat.invoke('mcp.getServers', {})) as {
      servers?: Record<string, unknown>
    }
    const clients = (await window.deepchat.invoke('mcp.getClients', {})) as {
      clients?: unknown[]
    }
    const tools = (await window.deepchat.invoke('mcp.listToolDefinitions', {})) as {
      tools?: unknown[]
    }
    const prompts = (await window.deepchat.invoke('mcp.listPrompts', {})) as {
      prompts?: unknown[]
    }
    const resources = (await window.deepchat.invoke('mcp.listResources', {})) as {
      resources?: unknown[]
    }
    const npmRegistry = (await window.deepchat.invoke('mcp.getNpmRegistryStatus', {})) as {
      status?: {
        autoDetectEnabled?: unknown
        currentRegistry?: unknown
        isFromCache?: unknown
      }
    }

    return {
      clientCount: clients.clients?.length ?? -1,
      enabled: enabled.enabled,
      npmRegistry: npmRegistry.status,
      promptCount: prompts.prompts?.length ?? -1,
      resourceCount: resources.resources?.length ?? -1,
      serverNames: Object.keys(servers.servers ?? {}).sort(),
      toolCount: tools.tools?.length ?? -1
    }
  })

  expect(typeof snapshot.enabled).toBe('boolean')
  expect(snapshot.clientCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.promptCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.resourceCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.serverNames.every((serverName) => typeof serverName === 'string')).toBe(true)
  expect(snapshot.toolCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.npmRegistry).toBeTruthy()
  expect(typeof snapshot.npmRegistry?.autoDetectEnabled).toBe('boolean')
  expect(typeof snapshot.npmRegistry?.isFromCache).toBe('boolean')
  expect(
    snapshot.npmRegistry?.currentRegistry === null ||
      typeof snapshot.npmRegistry?.currentRegistry === 'string'
  ).toBe(true)
})
