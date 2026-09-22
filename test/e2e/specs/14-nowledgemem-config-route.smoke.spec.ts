import { createServer } from 'node:http'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import type { NowledgePluginState } from '../../../src/shared/types/nowledgeMemPlugin'

const pluginId = 'com.deepchat.plugins.nowledge-mem'

test('Nowledge plugin verifies local REST and MCP, protects keys and restores its lifecycle @smoke', async ({
  app
}, testInfo) => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { StreamableHTTPServerTransport } =
    await import('@modelcontextprotocol/sdk/server/streamableHttp.js')
  let contextReads = 0
  const fixtureKey = 'nowledge-e2e-key'
  const remote = createServer(async (req, res) => {
    if (req.headers['x-nmem-api-key'] !== fixtureKey) {
      res.writeHead(401).end('{}')
      return
    }
    const url = new URL(req.url!, 'http://localhost')
    if (url.pathname.endsWith('/health') || url.pathname.endsWith('/memories')) {
      res.setHeader('Content-Type', 'application/json')
      res.end(url.pathname.endsWith('/health') ? '{"status":"ok"}' : '{"memories":[]}')
      return
    }
    const mem = new McpServer({ name: 'Nowledge fixture', version: '1.0.0' })
    mem.registerTool('read_context_bundle', { inputSchema: {} }, async () => {
      contextReads++
      return { content: [{ type: 'text', text: 'Fixture context' }] }
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await mem.connect(transport)
    res.on('close', () => {
      void transport.close()
      void mem.close()
    })
    await transport.handleRequest(req, res)
  })
  await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(remote.address() as { port: number }).port}`
  const readState = async () => {
    const result = await app.page.evaluate(
      async (id) =>
        (
          await window.deepchat.invoke('plugins.invokeAction', {
            pluginId: id,
            actionId: 'nowledge.get'
          })
        ).result,
      pluginId
    )
    expect(result.ok).toBe(true)
    return result.data as unknown as NowledgePluginState
  }
  try {
    await waitForAppReady(app.page)
    await app.page.evaluate((id) => {
      window.location.hash = `#/plugins/${id}`
    }, pluginId)
    const panel = app.page.getByTestId('nowledge-mem-settings')
    await expect(panel).toBeVisible()
    await expect(panel.locator('input')).toHaveCount(2)
    await expect(panel.getByText('API key (optional)', { exact: true })).toBeVisible()
    await panel.getByTestId('nowledge-mem-base-url-input').fill(baseUrl)
    await panel.getByTestId('nowledge-mem-api-key-input').fill(fixtureKey)
    await panel.getByTestId('nowledge-mem-save-button').click()
    await expect.poll(async () => (await readState()).connection?.hasApiKey).toBe(true)
    expect(contextReads).toBeGreaterThan(0)
    expect(JSON.stringify(await readState())).not.toContain(fixtureKey)
    await expect(panel.getByTestId('nowledge-mem-api-key-input')).toHaveValue('')
    await expect(panel.getByTestId('nowledge-mem-api-key-input')).toHaveAttribute(
      'type',
      'password'
    )
    await app.page.screenshot({ path: testInfo.outputPath('nowledge-local.png') })

    const enabled = await app.page.evaluate(
      async (id) => (await window.deepchat.invoke('plugins.enable', { pluginId: id })).result,
      pluginId
    )
    expect(enabled.ok).toBe(true)
    await expect
      .poll(async () =>
        app.page.evaluate(
          async (id) =>
            (
              await window.deepchat.invoke('plugins.get', { pluginId: id })
            ).plugin?.mcpServers?.find((server) => server.serverId === 'nowledge-mem-connection')
              ?.running,
          pluginId
        )
      )
      .toBe(true)
    const tools = await app.page.evaluate(
      async () => (await window.deepchat.invoke('mcp.listToolDefinitions', {})).tools
    )
    expect(tools.some((tool) => tool.function.name.includes('read_context_bundle'))).toBe(true)

    const before = await readState()
    await panel.getByTestId('nowledge-mem-api-key-input').fill('wrong-key')
    await panel.getByTestId('nowledge-mem-save-button').click()
    await expect(panel.getByRole('alert')).toContainText('HTTP 401')
    expect(await readState()).toEqual(before)
    await panel.getByTestId('nowledge-mem-api-key-input').fill('')
    for (const action of ['plugins.disable', 'plugins.enable'] as const) {
      const result = await app.page.evaluate(
        async ({ action, id }) => (await window.deepchat.invoke(action, { pluginId: id })).result,
        { action, id: pluginId }
      )
      expect(result.ok).toBe(true)
    }
    await expect
      .poll(async () =>
        app.page.evaluate(
          async (id) =>
            (
              await window.deepchat.invoke('plugins.get', { pluginId: id })
            ).plugin?.mcpServers?.find((server) => server.serverId === 'nowledge-mem-connection')
              ?.running,
          pluginId
        )
      )
      .toBe(true)
    expect(await readState()).toEqual(before)
    await app.page.screenshot({ path: testInfo.outputPath('nowledge-verified.png') })
    await panel.getByTestId('nowledge-mem-base-url-input').fill(`${baseUrl}/alternate`)
    await panel.getByTestId('nowledge-mem-api-key-input').fill(fixtureKey)
    await panel.getByTestId('nowledge-mem-save-button').click()
    const confirm = app.page.getByRole('alertdialog')
    await expect(confirm).toContainText(`${baseUrl}/alternate`)
    expect((await readState()).connection?.baseUrl).toBe(baseUrl)
    await confirm.getByRole('button', { name: 'Verify and save', exact: true }).click()
    await expect(confirm).not.toBeVisible()
    await expect
      .poll(async () => (await readState()).connection?.baseUrl)
      .toBe(`${baseUrl}/alternate`)
    await panel.getByRole('button', { name: 'Clear connection', exact: true }).click()
    await app.page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm', exact: true })
      .click()
    await expect.poll(async () => (await readState()).connection).toBeNull()
  } finally {
    await app.page
      .evaluate(async (id) => window.deepchat.invoke('plugins.disable', { pluginId: id }), pluginId)
      .catch(() => {})
    remote.closeAllConnections()
    await new Promise<void>((resolve) => remote.close(() => resolve()))
  }
})
