import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { zipSync } from 'fflate'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test('cloud-browser example preserves private HTTP credentials across the host lifecycle @smoke', async ({
  launchApp
}, testInfo) => {
  const firstToken = randomUUID()
  const secondToken = randomUUID()
  let expectedToken = firstToken
  const requests: Array<{ headerCount: number; accepted: boolean }> = []
  const remote = createServer(async (req, res) => {
    const headerCount = req.rawHeaders.filter(
      (value, index) => index % 2 === 0 && value.toLowerCase() === 'authorization'
    ).length
    const accepted = req.headers.authorization === `Bearer ${expectedToken}`
    requests.push({ headerCount, accepted })
    if (!accepted) {
      res.writeHead(401).end()
      return
    }
    const server = new McpServer({ name: 'local-cloud-browser-fixture', version: '1.0.0' })
    server.registerTool('capy_probe', { inputSchema: {} }, async () => ({
      content: [{ type: 'text', text: 'Local synthetic MCP only; no browser resource created.' }]
    }))
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    })
    res.on('close', () => void server.close())
    await server.connect(transport)
    await transport.handleRequest(req, res)
  })
  let app: Awaited<ReturnType<typeof launchApp>> | undefined
  let failed = false
  try {
    await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve))
    const { port } = remote.address() as { port: number }
    let currentApp = await launchApp()
    app = currentApp
    const userDataDir = currentApp.userDataDir
    const source = path.resolve('examples/user-plugins/baizhi-cloud-browser')
    const entries = Object.fromEntries(
      readdirSync(source, { recursive: true, encoding: 'utf8' })
        .filter((relative) => statSync(path.join(source, relative)).isFile())
        .map((relative) => [
          relative.split(path.sep).join('/'),
          readFileSync(path.join(source, relative))
        ])
    )
    // Only the destination changes for the real-host test. Production is never contacted.
    const config = JSON.parse(entries['.mcp.json'].toString())
    config['baizhi-cloud-browser'].url = `http://127.0.0.1:${port}/mcp`
    entries['.mcp.json'] = Buffer.from(JSON.stringify(config))
    const archive = path.join(userDataDir, 'cloud-browser-fixture.zip')
    writeFileSync(archive, zipSync(entries))
    const secretAbsent = (value: unknown) => {
      const serialized = JSON.stringify(value)
      expect(serialized.includes(firstToken) || serialized.includes(secondToken)).toBe(false)
    }
    await waitForAppReady(currentApp.page)
    const installed = await currentApp.page.evaluate(async (archive) => {
      await window.deepchat.invoke('mcp.setEnabled', { enabled: true })
      await window.deepchat.invoke('mcp.addServer', {
        serverName: 'unrelated-lifecycle-fixture',
        config: {
          type: 'http',
          baseUrl: 'http://127.0.0.1:1/mcp',
          env: {},
          args: [],
          command: '',
          descriptions: 'Unrelated disabled fixture',
          icons: '',
          enabled: false
        }
      })
      const { prepared } = await window.deepchat.invoke('plugins.inspectSource', {
        source: { kind: 'zip', path: archive },
        requestId: crypto.randomUUID()
      })
      const { result } = await window.deepchat.invoke('plugins.installUser', {
        operationId: prepared.operationId,
        selection: { skills: false, hooks: false, mcp: true }
      })
      if (!result.ok) throw new Error(result.error)
      return result.status!
    }, archive)
    expect(installed.enabled).toBe(false)
    expect(requests).toEqual([])
    const id = installed.id
    const serverName = `${id}.baizhi-cloud-browser`
    await currentApp.page.evaluate(
      async (pluginId) => window.deepchat.invoke('plugins.enable', { pluginId }),
      id
    )
    const empty = await currentApp.page.evaluate(
      async ({ pluginId, serverName }) =>
        window.deepchat.invoke('plugins.configureMcp', {
          pluginId,
          serverName,
          values: { CAPYBROWSER_API_KEY: '' }
        }),
      { pluginId: id, serverName }
    )
    expect(empty.result.ok).toBe(false)
    expect(requests).toEqual([])
    const connect = async (token: string) => {
      const result = await currentApp.page.evaluate(
        async ({ pluginId, serverName, token }) =>
          window.deepchat.invoke('plugins.configureMcp', {
            pluginId,
            serverName,
            values: { CAPYBROWSER_API_KEY: token }
          }),
        { pluginId: id, serverName, token }
      )
      expect(result.result.ok).toBe(true)
      await expect
        .poll(async () =>
          currentApp.page.evaluate(
            async (pluginId) =>
              (await window.deepchat.invoke('plugins.get', { pluginId })).plugin?.mcpServers?.[0]
                ?.running,
            id
          )
        )
        .toBe(true)
    }
    await connect(firstToken)
    expect(requests.some((request) => request.accepted)).toBe(true)
    const discovered = await currentApp.page.evaluate(async () =>
      window.deepchat.invoke('mcp.listToolDefinitions', {})
    )
    expect(discovered.tools.some((tool) => tool.function.name.includes('capy_probe'))).toBe(true)
    const exported = await currentApp.page.evaluate(async () =>
      window.deepchat.invoke('mcp.getServers', {})
    )
    secretAbsent(exported)
    expect(exported.servers[serverName].customHeaders).toEqual({
      Authorization: 'Bearer ${CAPYBROWSER_API_KEY}'
    })
    const originalServerId = exported.servers[serverName].serverId
    expectedToken = secondToken
    const previousRequests = requests.length
    await connect(secondToken)
    await expect.poll(() => requests.length).toBeGreaterThan(previousRequests)
    await currentApp.close()
    currentApp = await launchApp()
    app = currentApp
    await waitForAppReady(currentApp.page)
    await expect
      .poll(async () =>
        currentApp.page.evaluate(
          async (pluginId) =>
            (await window.deepchat.invoke('plugins.get', { pluginId })).plugin?.mcpServers?.[0]
              ?.running,
          id
        )
      )
      .toBe(true)
    const restarted = await currentApp.page.evaluate(async () =>
      window.deepchat.invoke('mcp.getServers', {})
    )
    expect(restarted.servers[serverName].serverId).toBe(originalServerId)
    expect(restarted.servers['unrelated-lifecycle-fixture']).toBeDefined()
    secretAbsent(restarted)
    const disabled = await currentApp.page.evaluate(
      async (pluginId) => window.deepchat.invoke('plugins.disable', { pluginId }),
      id
    )
    expect(disabled.result.ok).toBe(true)
    await expect
      .poll(async () =>
        currentApp.page.evaluate(async (pluginId) => {
          const { plugin } = await window.deepchat.invoke('plugins.get', { pluginId })
          return plugin?.enabled === false && plugin.mcpServers?.every((server) => !server.running)
        }, id)
      )
      .toBe(true)
    const removed = await currentApp.page.evaluate(
      async (pluginId) => window.deepchat.invoke('plugins.uninstallUser', { pluginId }),
      id
    )
    expect(removed.result.ok).toBe(true)
    const final = await currentApp.page.evaluate(async () =>
      window.deepchat.invoke('mcp.getServers', {})
    )
    expect(final.servers[serverName]).toBeUndefined()
    expect(final.servers['unrelated-lifecycle-fixture']).toBeDefined()
    secretAbsent(final)
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((request) => request.headerCount === 1 && request.accepted)).toBe(true)
    await currentApp.close()
    secretAbsent(currentApp.consoleLogs)
    const logDirectory = path.join(userDataDir, 'logs')
    for (const file of readdirSync(logDirectory).filter((name) => /\.(jsonl|log)$/.test(name))) {
      secretAbsent(readFileSync(path.join(logDirectory, file), 'utf8'))
    }
    await testInfo.attach('host-lifecycle-result.json', {
      body: JSON.stringify({
        host: 'real Electron source build',
        server: 'loopback synthetic MCP',
        productionCalls: 0,
        installedDisabled: true,
        enabledExplicitly: true,
        emptyRejectedWithoutRequest: true,
        rotated: true,
        reconnectedAfterRestart: true,
        disabled: true,
        uninstalled: true,
        unrelatedPreserved: true,
        singleAuthorizationHeader: true,
        configAndLogsContainNoCredential: true
      }),
      contentType: 'application/json'
    })
  } catch (error) {
    failed = true
    throw error
  } finally {
    let cleanupError: unknown
    try {
      await app?.close()
    } catch (error) {
      cleanupError = error
    }
    try {
      remote.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        remote.close((error) => (error ? reject(error) : resolve()))
      )
    } catch (error) {
      cleanupError ??= error
    }
    if (!failed && cleanupError) throw cleanupError
  }
})
