import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('MCP and ACP settings persist through their database owners across reopen @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const legacyFiles = ['mcp-settings.json', 'acp_agents.json'].map((file) =>
    join(active.userDataDir, file)
  )
  const readLegacy = () => legacyFiles.map((file) => readFileSync(file, 'utf8'))
  const legacy = readLegacy()
  const serverName = 'settings-store-fixture'
  const agentId = 'settings-store-agent'
  await active.page.evaluate(
    async ({ serverName, agentId }) => {
      await window.deepchat.invoke('mcp.addServer', {
        serverName,
        config: {
          command: 'unused-settings-fixture',
          args: [],
          env: {},
          descriptions: 'Settings store fixture',
          icons: '',
          disable: false,
          enabled: false,
          type: 'stdio'
        }
      })
      await window.deepchat.invoke('config.addManualAcpAgent', {
        id: agentId,
        name: 'Settings fixture',
        command: 'unused-agent-fixture',
        enabled: false
      })
      await window.deepchat.invoke('config.updateManualAcpAgent', {
        agentId,
        updates: { name: 'Updated settings fixture', env: { FIXTURE_VALUE: 'persisted' } }
      })
      await window.deepchat.invoke('config.setAcpSharedMcpSelections', {
        selections: [serverName]
      })
      await window.deepchat.invoke('config.setAcpEnabled', { enabled: true })
    },
    { serverName, agentId }
  )
  expect(await active.close()).toBe('graceful')
  expect(readLegacy()).toEqual(legacy)

  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  const persisted = await reopened.page.evaluate(async () => ({
    ...(await window.deepchat.invoke('mcp.getServers', {})),
    ...(await window.deepchat.invoke('config.listManualAcpAgents', {})),
    ...(await window.deepchat.invoke('config.getAcpSharedMcpSelections', {})),
    enabled: (await window.deepchat.invoke('config.getAcpState', {})).enabled
  }))
  expect(persisted.enabled).toBe(true)
  expect(persisted.servers[serverName]).toMatchObject({ enabled: false, type: 'stdio' })
  expect(persisted.selections).toEqual([serverName])
  expect(persisted.agents).toContainEqual(
    expect.objectContaining({
      id: agentId,
      name: 'Updated settings fixture',
      env: { FIXTURE_VALUE: 'persisted' },
      enabled: false
    })
  )
  await reopened.page.evaluate(
    async ({ serverName, agentId }) => {
      await window.deepchat.invoke('config.setAcpSharedMcpSelections', { selections: [] })
      await window.deepchat.invoke('config.removeManualAcpAgent', { agentId })
      await window.deepchat.invoke('mcp.removeServer', { serverName })
      await window.deepchat.invoke('config.setAcpEnabled', { enabled: false })
    },
    { serverName, agentId }
  )
  expect(await reopened.close()).toBe('graceful')

  const removed = await launchApp()
  await waitForAppReady(removed.page)
  const final = await removed.page.evaluate(async () => ({
    ...(await window.deepchat.invoke('mcp.getServers', {})),
    ...(await window.deepchat.invoke('config.listManualAcpAgents', {})),
    ...(await window.deepchat.invoke('config.getAcpSharedMcpSelections', {})),
    enabled: (await window.deepchat.invoke('config.getAcpState', {})).enabled
  }))
  expect(final.enabled).toBe(false)
  expect(final.servers).not.toHaveProperty(serverName)
  expect(final.agents).not.toContainEqual(expect.objectContaining({ id: agentId }))
  expect(final.selections).toEqual([])
  expect(readLegacy()).toEqual(legacy)
})
