import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'
import settingsMessages from '../../../src/renderer/src/i18n/en-US/settings.json' with { type: 'json' }
import commonMessages from '../../../src/renderer/src/i18n/en-US/common.json' with { type: 'json' }
import mcpMessages from '../../../src/renderer/src/i18n/en-US/mcp.json' with { type: 'json' }

test('MCP hosts preserve management, market, onboarding and snapshot routes @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  await app.page.evaluate(() => window.deepchat.invoke('config.setLanguage', { language: 'en-US' }))
  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-mcp', 'settings-mcp')
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

  for (const [entry, page, path] of [
    ['settings', settingsPage, '/mcp'],
    ['plugins', app.page, '/plugins/mcp']
  ] as const) {
    await page.evaluate((path) => {
      window.location.hash = `#${path}?view=market&r2=1`
    }, path)
    await expect(page.getByText(mcpMessages.market.builtinTitle, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: commonMessages.back, exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${path}?r2=1`)
    await page.getByRole('button', { name: 'MCP Market', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('view=market')
    await page.getByRole('button', { name: commonMessages.back, exact: true }).click()

    const masterSwitch = page.getByRole('switch', { name: settingsMessages.mcp.center.title })
    if ((await masterSwitch.getAttribute('aria-checked')) !== 'true') await masterSwitch.click()
    await expect(masterSwitch).toHaveAttribute('aria-checked', 'true')

    const serverName = `r2-${entry}-server`
    const config = {
      type: 'http',
      baseUrl: 'http://127.0.0.1:1/mcp',
      command: '',
      args: [],
      env: {},
      enabled: false,
      icons: '',
      descriptions: 'R2 disabled fixture'
    }
    await page.getByRole('button', { name: commonMessages.add, exact: true }).click()
    let dialog = page.getByRole('dialog', { name: settingsMessages.mcp.addServerDialog.title })
    await dialog.locator('textarea').fill(JSON.stringify({ mcpServers: { [serverName]: config } }))
    await dialog
      .getByRole('button', { name: settingsMessages.mcp.serverForm.parseAndContinue })
      .click()
    await dialog
      .getByRole('button', { name: settingsMessages.mcp.serverForm.submit, exact: true })
      .click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('heading', { name: serverName, exact: true })).toBeVisible()
    await page
      .getByRole('button', { name: `${commonMessages.more}: ${serverName}`, exact: true })
      .click()
    await page.getByRole('menuitem', { name: settingsMessages.mcp.editServer, exact: true }).click()
    dialog = page.getByRole('dialog', { name: settingsMessages.mcp.editServerDialog.title })
    await dialog.locator('#server-description').fill(`Edited from ${entry}`)
    await dialog
      .getByRole('button', { name: settingsMessages.mcp.serverForm.submit, exact: true })
      .click()
    await expect(dialog).not.toBeVisible()
    const saved = await page.evaluate(async (serverName) => {
      const result = await window.deepchat.invoke('mcp.getServers', {})
      return result.servers[serverName]
    }, serverName)
    expect(saved.descriptions).toBe(`Edited from ${entry}`)
    expect(saved.enabled).toBe(false)
    await page
      .getByRole('button', { name: `${commonMessages.more}: ${serverName}`, exact: true })
      .click()
    await page
      .getByRole('menuitem', { name: settingsMessages.mcp.removeServer, exact: true })
      .click()
    dialog = page.getByRole('dialog', { name: settingsMessages.mcp.removeServerDialog.title })
    await dialog.getByRole('button', { name: commonMessages.confirm, exact: true }).click()
    await expect(page.getByRole('heading', { name: serverName, exact: true })).not.toBeVisible()

    await page.evaluate(async () => {
      await window.deepchat.invoke('onboarding.start', { force: true, stepId: 'select-provider' })
      for (const stepId of ['select-provider', 'provider-api-key', 'provider-model'] as const) {
        await window.deepchat.invoke('onboarding.setStepStatus', { stepId, status: 'completed' })
      }
    })
    await page.evaluate(
      (hash) => {
        window.location.hash = hash
      },
      entry === 'settings' ? '#/overview' : '#/plugins'
    )
    await expect(page.getByTestId('settings-mcp-page')).not.toBeVisible()
    await page.evaluate((path) => {
      window.location.hash = `#${path}`
    }, path)
    await expect(page.getByTestId('settings-mcp-page')).toBeVisible()
    const guideState = await page.evaluate(
      async () => (await window.deepchat.invoke('onboarding.getState', {})).state
    )
    expect(guideState, entry).toMatchObject({ status: 'active', currentStepId: 'mcp' })
    const guide = page.getByTestId('guided-onboarding-overlay')
    await expect(guide).toBeVisible()
    await guide.getByRole('button', { name: commonMessages.next, exact: true }).click()
    await expect
      .poll(() => app.page.evaluate(() => window.location.hash))
      .toContain('/plugins/skills')
    const state = await page.evaluate(
      async () => (await window.deepchat.invoke('onboarding.getState', {})).state
    )
    expect(state.steps.find((step) => step.id === 'mcp')?.status).toBe('completed')
    expect(state.currentStepId).toBe('skills')
    await page.evaluate(() => window.deepchat.invoke('onboarding.complete', { force: true }))
    await page.evaluate((path) => {
      window.location.hash = `#${path}`
    }, path)
    await expect(page.getByTestId('settings-mcp-page')).toBeVisible()
    await page.screenshot({ path: `test-results/e2e/mcp-${entry}-r2.png` })
  }
  expect(app.pageErrors).toEqual([])
})
