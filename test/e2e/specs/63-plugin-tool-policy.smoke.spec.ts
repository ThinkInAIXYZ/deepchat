import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('plugin policy preserves persisted decisions, ambiguity and disabled policies @smoke', async ({
  launchApp
}) => {
  const calls: string[] = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    let body = ''
    for await (const chunk of request) body += chunk
    const message = JSON.parse(body)
    if (message.id === undefined) {
      response.writeHead(202).end()
      return
    }
    let result: unknown = {}
    if (message.method === 'initialize') {
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'policy-fixture', version: '1.0.0' }
      }
    } else if (message.method === 'tools/list') {
      result = {
        tools: ['allowed', 'ask', 'blocked'].map((name) => ({
          name,
          description: `Policy fixture ${name}`,
          inputSchema: { type: 'object', properties: {} }
        }))
      }
    } else if (message.method === 'tools/call') {
      calls.push(message.params.name)
      result = { content: [{ type: 'text', text: `POLICY_EXECUTED_${message.params.name}` }] }
    }
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const serverName = 'policy-owner-fixture'
  const policy = {
    pluginId: 'com.deepchat.policy-e2e',
    serverId: serverName,
    tools: { allowed: 'allow', ask: 'ask', blocked: 'deny' },
    enabled: true
  }
  try {
    const bootstrap = await launchApp()
    expect(bootstrap.ownsUserDataDir).toBe(true)
    await waitForAppReady(bootstrap.page)
    const settings = await openSettings(bootstrap)
    await settings.evaluate(
      async ({ serverName, baseUrl }) => {
        await window.deepchat.invoke('mcp.setEnabled', { enabled: true })
        await window.deepchat.invoke('mcp.addServer', {
          serverName,
          config: {
            type: 'http',
            baseUrl,
            enabled: true,
            command: '',
            args: [],
            env: {},
            descriptions: 'Disposable policy fixture',
            icons: ''
          }
        })
      },
      { serverName, baseUrl: `http://127.0.0.1:${port}/mcp` }
    )
    const file = join(bootstrap.userDataDir, 'plugin-tool-policies.json')
    expect(await bootstrap.close()).toBe('graceful')
    for (const phase of ['single', 'ambiguous', 'disabled'] as const) {
      const policies =
        phase === 'ambiguous'
          ? [policy, { ...policy, pluginId: 'com.deepchat.policy-e2e-other' }]
          : [{ ...policy, enabled: phase !== 'disabled' }]
      const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
      writeFileSync(file, JSON.stringify({ ...previous, policies }, null, 2))
      const active = await launchApp()
      await waitForAppReady(active.page)
      const controls = await openSettings(active)
      await controls.evaluate(
        (serverName) => window.deepchat.invoke('mcp.startServer', { serverName }),
        serverName
      )
      await expect
        .poll(async () =>
          controls.evaluate(async (serverName) => {
            const { tools } = await window.deepchat.invoke('mcp.listToolDefinitions', {})
            return tools.filter((tool) => tool.server.name === serverName).length
          }, serverName)
        )
        .toBe(phase === 'single' ? 2 : 3)
      const { tools } = await controls.evaluate(() =>
        window.deepchat.invoke('mcp.listToolDefinitions', {})
      )
      const definitions = tools.filter((tool) => tool.server.name === serverName)
      const allowed = definitions.find((tool) => tool.raw?.name === 'allowed')!
      expect(allowed).toBeTruthy()
      const name =
        phase === 'disabled'
          ? definitions.find((tool) => tool.raw?.name === 'blocked')!.function.name
          : allowed.function.name
      const result = await controls.evaluate(
        ({ name, id }) =>
          window.deepchat.invoke('mcp.callTool', {
            request: { id, type: 'function', function: { name, arguments: '{}' } }
          }),
        { name, id: `policy-${phase}` }
      )
      if (phase === 'ambiguous') {
        expect(result.rawData.isError).toBe(true)
        expect(result.content).toContain('not declared')
        expect(calls).toEqual(['allowed'])
      } else {
        expect(result.rawData.isError).not.toBe(true)
        expect(result.content).toContain(
          phase === 'single' ? 'POLICY_EXECUTED_allowed' : 'POLICY_EXECUTED_blocked'
        )
      }
      expect(JSON.parse(readFileSync(file, 'utf8')).policies).toEqual(policies)
      expect(await active.close()).toBe('graceful')
    }
    expect(calls).toEqual(['allowed', 'blocked'])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
