import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { zipSync } from 'fflate'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

const require = createRequire(import.meta.url)

test('ZIP review installs a disabled user plugin and imports a working MCP server @smoke', async ({
  app
}, testInfo) => {
  const source = path.join(app.userDataDir, 'fixture')
  mkdirSync(source, { recursive: true })
  const zipPath = path.join(source, 'plugin.zip')
  const manifest = {
    name: 'portable-smoke',
    version: '1.0.0',
    description: 'User plugin installation smoke test',
    skills: './skills',
    hooks: './hooks.json',
    mcpServers: {
      smoke: {
        command: process.execPath,
        args: ['${PLUGIN_ROOT}/server.cjs'],
        cwd: '${PLUGIN_ROOT}'
      }
    }
  }
  const server = `const {McpServer}=require(${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/mcp.js'))}); const {StdioServerTransport}=require(${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'))}); const server=new McpServer({name:'portable-smoke',version:'1.0.0'}); server.registerTool('portable_check',{description:'Check the imported plugin server',inputSchema:{}},async()=>({content:[{type:'text',text:'Imported MCP server is running'}]})); server.connect(new StdioServerTransport());`
  writeFileSync(
    zipPath,
    zipSync({
      'portable/.codex-plugin/plugin.json': Buffer.from(JSON.stringify(manifest)),
      'portable/skills/portable-check/SKILL.md': Buffer.from(
        '---\nname: portable-check\ndescription: Check the portable plugin fixture\n---\nUse portable_check to inspect the imported MCP server.'
      ),
      'portable/hooks.json': Buffer.from(
        JSON.stringify({
          hooks: {
            UserPromptSubmit: [
              { hooks: [{ type: 'command', command: 'node "${PLUGIN_ROOT}/hook.cjs"' }] }
            ]
          }
        })
      ),
      'portable/hook.cjs': Buffer.from('process.stdout.write("{}")'),
      'portable/server.cjs': Buffer.from(server)
    })
  )
  await app.electronApp.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] })
  }, zipPath)
  await waitForAppReady(app.page)
  await app.page.evaluate(() => {
    window.location.hash = '#/plugins'
  })
  await app.page.getByRole('button', { name: /Install from ZIP|从 ZIP 安装/ }).click()
  const dialog = app.page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Choose ZIP|选择 ZIP/ }).click()
  await dialog.getByRole('button', { name: /Inspect package|检查插件包/ }).click()
  await expect(dialog.getByText('portable-smoke · 1.0.0')).toBeVisible()
  const checkboxes = dialog.getByRole('checkbox')
  await expect(checkboxes).toHaveCount(3)
  await expect(checkboxes.nth(0)).toBeChecked()
  await expect(checkboxes.nth(1)).not.toBeChecked()
  await expect(checkboxes.nth(2)).not.toBeChecked()
  await checkboxes.nth(2).check()
  await app.page.screenshot({ path: testInfo.outputPath('plugin-review.png') })
  await dialog.getByRole('button', { name: /Install \(disabled\)|安装（暂不启用）/ }).click()
  await expect(app.page.getByRole('heading', { name: 'portable-smoke', exact: true })).toBeVisible()
  const installed = await app.page.evaluate(async () => {
    const { plugins } = await window.deepchat.invoke('plugins.list', {})
    return plugins.find((plugin) => plugin.name === 'portable-smoke')!
  })
  expect(installed).toMatchObject({
    enabled: false,
    official: false,
    userPlugin: { selection: { hooks: false, mcp: true } }
  })
  await app.page.evaluate(async () => {
    await window.deepchat.invoke('mcp.setEnabled', { enabled: true })
  })
  await app.page.getByRole('button', { name: /^(Enable|启用)$/ }).click()
  await expect
    .poll(
      async () =>
        app.page.evaluate(async (id) => {
          const { plugin } = await window.deepchat.invoke('plugins.get', { pluginId: id })
          return plugin?.mcpServers?.[0]?.running
        }, installed.id),
      { timeout: 30000 }
    )
    .toBe(true)
  const tools = await app.page.evaluate(
    async () => (await window.deepchat.invoke('mcp.listToolDefinitions', {})).tools
  )
  expect(tools.some((tool) => tool.function.name.includes('portable_check'))).toBe(true)
  await app.page.screenshot({ path: testInfo.outputPath('plugin-details.png') })
  await app.page.getByRole('button', { name: /^(Disable|停用|禁用)$/ }).click()
  await expect
    .poll(async () =>
      app.page.evaluate(async (id) => {
        const { plugin } = await window.deepchat.invoke('plugins.get', { pluginId: id })
        return plugin?.enabled === false && plugin?.mcpServers?.every((server) => !server.running)
      }, installed.id)
    )
    .toBe(true)
  await app.page.getByRole('button', { name: /^(Uninstall|卸载)$/ }).click()
  await app.page
    .getByRole('dialog')
    .getByRole('button', { name: /^(Uninstall|卸载)$/ })
    .click()
  await expect
    .poll(async () =>
      app.page.evaluate(
        async (id) => (await window.deepchat.invoke('plugins.get', { pluginId: id })).plugin,
        installed.id
      )
    )
    .toBeUndefined()
  expect(app.pageErrors).toEqual([])
})

test('reviewed hooks reach provider requests and HTTP MCP uses host-owned credentials @smoke', async ({
  app
}) => {
  const { createServer } = await import('node:http')
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { StreamableHTTPServerTransport } =
    await import('@modelcontextprotocol/sdk/server/streamableHttp.js')
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
  let authenticatedRequests = 0
  const remote = createServer(async (req, res) => {
    if (req.url === '/mcp') {
      if (req.headers.authorization !== 'Bearer fixture-token') {
        res.writeHead(401).end()
        return
      }
      authenticatedRequests++
      const server = new McpServer({ name: 'authenticated-fixture', version: '1.0.0' })
      server.registerTool('authenticated_check', { inputSchema: {} }, async () => ({
        content: [{ type: 'text', text: 'Authenticated' }]
      }))
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      })
      res.on('close', () => {
        void server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res)
      return
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end()
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const chunk = {
      id: 'fixture-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'fixture-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'Done' }, finish_reason: null }]
    }
    res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    res.write(
      `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
    )
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve))
  const address = remote.address() as { port: number }
  const baseUrl = `http://127.0.0.1:${address.port}`
  const source = path.join(app.userDataDir, 'context-fixture')
  mkdirSync(path.join(source, '.codex-plugin'), { recursive: true })
  writeFileSync(
    path.join(source, '.codex-plugin/plugin.json'),
    JSON.stringify({
      name: 'context-fixture',
      hooks: {
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: 'command',
                  command: `"${process.execPath}" "\${PLUGIN_ROOT}/hook.cjs"`,
                  commandWindows: `"${process.execPath}" "%PLUGIN_ROOT%/hook.cjs"`
                }
              ]
            }
          ]
        }
      },
      mcpServers: { remote: { url: `${baseUrl}/mcp`, bearer_token_env_var: 'FIXTURE_TOKEN' } }
    })
  )
  writeFileSync(
    path.join(source, 'hook.cjs'),
    `let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const data=JSON.parse(input);console.log(JSON.stringify({hookSpecificOutput:{hookEventName:data.hook_event_name,additionalContext:'PLUGIN_INPUT_CONTEXT:'+data.prompt}}))})`
  )
  try {
    await waitForAppReady(app.page)
    const id = await app.page.evaluate(async (source) => {
      const { prepared: inspected } = await window.deepchat.invoke('plugins.inspectSource', {
        source: { kind: 'directory', path: source },
        requestId: crypto.randomUUID()
      })
      const { result: installed } = await window.deepchat.invoke('plugins.installUser', {
        operationId: inspected.operationId,
        selection: { skills: false, hooks: true, mcp: true }
      })
      if (!installed.ok) throw new Error(installed.error)
      await window.deepchat.invoke('mcp.setEnabled', { enabled: true })
      await window.deepchat.invoke('plugins.enable', { pluginId: installed.status!.id })
      return installed.status!.id
    }, source)
    expect(authenticatedRequests).toBe(0)
    const result = await app.page.evaluate(
      async (pluginId) =>
        window.deepchat.invoke('plugins.configureMcp', {
          pluginId,
          serverName: `${pluginId}.remote`,
          values: { FIXTURE_TOKEN: 'fixture-token' }
        }),
      id
    )
    expect(result.result.ok).toBe(true)
    await expect
      .poll(async () =>
        app.page.evaluate(async () =>
          (await window.deepchat.invoke('mcp.listToolDefinitions', {})).tools.some((tool) =>
            tool.function.name.includes('authenticated_check')
          )
        )
      )
      .toBe(true)
    expect(authenticatedRequests).toBeGreaterThan(0)
    const sessionId = await app.page.evaluate(async (baseUrl) => {
      const providerId = `custom-${crypto.randomUUID()}`
      const { provider } = await window.deepchat.invoke('providers.add', {
        provider: {
          id: providerId,
          name: 'Plugin fixture',
          apiType: 'openai-completions',
          baseUrl: `${baseUrl}/v1`,
          apiKey: 'fixture-key',
          enable: true,
          custom: true,
          customModels: [
            {
              id: 'fixture-model',
              name: 'Fixture',
              providerId,
              group: 'fixture',
              enabled: true,
              isCustom: true,
              vision: false,
              functionCall: false,
              reasoning: false,
              contextLength: 32000,
              maxTokens: 1000
            }
          ]
        }
      })
      const { agents } = await window.deepchat.invoke('sessions.getAgents', {})
      const { session } = await window.deepchat.invoke('sessions.create', {
        agentId: agents[0].id,
        message: 'first-input',
        providerId: provider.id,
        modelId: 'fixture-model'
      })
      return session.id
    }, baseUrl)
    await expect
      .poll(
        () =>
          requests.some((request) =>
            JSON.stringify(request.messages).includes('PLUGIN_INPUT_CONTEXT:first-input')
          ),
        { timeout: 30000 }
      )
      .toBe(true)
    await expect
      .poll(async () =>
        app.page.evaluate(
          async (sessionId) =>
            (await window.deepchat.invoke('sessions.restore', { sessionId })).session?.status,
          sessionId
        )
      )
      .toBe('idle')
    await app.page.evaluate(
      async (sessionId) =>
        window.deepchat.invoke('chat.sendMessage', { sessionId, content: 'second-input' }),
      sessionId
    )
    await expect
      .poll(
        () =>
          requests.some((request) =>
            JSON.stringify(request.messages).includes('PLUGIN_INPUT_CONTEXT:second-input')
          ),
        { timeout: 30000 }
      )
      .toBe(true)
    const second = requests.find((request) =>
      JSON.stringify(request.messages).includes('PLUGIN_INPUT_CONTEXT:second-input')
    )!
    expect(
      JSON.stringify(second.messages.filter((message) => message.role === 'system'))
    ).not.toContain('PLUGIN_INPUT_CONTEXT:first-input')
    await expect
      .poll(async () =>
        app.page.evaluate(
          async (sessionId) =>
            (await window.deepchat.invoke('sessions.restore', { sessionId })).session?.status,
          sessionId
        )
      )
      .toBe('idle')
    await app.page.evaluate(
      async (pluginId) => window.deepchat.invoke('plugins.disable', { pluginId }),
      id
    )
    await app.page.evaluate(
      async (sessionId) =>
        window.deepchat.invoke('chat.sendMessage', { sessionId, content: 'third-input' }),
      sessionId
    )
    await expect
      .poll(
        () => requests.some((request) => JSON.stringify(request.messages).includes('third-input')),
        { timeout: 30000 }
      )
      .toBe(true)
    expect(
      JSON.stringify(requests.at(-1)!.messages.filter((message) => message.role === 'system'))
    ).not.toContain('PLUGIN_INPUT_CONTEXT:')
  } finally {
    remote.closeAllConnections()
    await new Promise<void>((resolve) => remote.close(() => resolve()))
  }
})
