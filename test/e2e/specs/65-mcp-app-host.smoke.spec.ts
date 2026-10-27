import { createServer } from 'node:http'
import type { McpAppDescriptor } from '../../../src/shared/types/mcp'
import type { AssistantMessageBlock } from '../../../src/shared/types/agent-interface'
import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('MCP Apps preserve saved sources, native sandbox policy, consent and reopen @smoke', async ({
  launchApp
}) => {
  const serverName = 'app-host-fixture'
  const resourceUri = 'ui://fixture/index.html'
  let renderName = ''
  const calls: string[] = []
  const server = createServer(async (request, response) => {
    let source = ''
    for await (const chunk of request) source += chunk
    const body = source ? JSON.parse(source) : {}
    if (request.url === '/mcp') {
      if (body.id === undefined) {
        response.writeHead(202).end()
        return
      }
      let result: unknown = {}
      if (body.method === 'initialize')
        result = {
          protocolVersion: body.params.protocolVersion,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: serverName, version: '1.0.0' }
        }
      else if (body.method === 'tools/list')
        result = {
          tools: ['render_app', 'app_action'].map((name) => ({
            name,
            description: `App fixture ${name}`,
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
            _meta: {
              ui: {
                ...(name === 'render_app' ? { resourceUri } : {}),
                visibility: name === 'render_app' ? ['model', 'app'] : ['app']
              }
            }
          }))
        }
      else if (body.method === 'tools/call') {
        calls.push(body.params.name)
        result = {
          content: [{ type: 'text', text: `APP_RESULT_${body.params.name}` }],
          structuredContent: { value: 42 }
        }
      } else if (body.method === 'resources/read')
        result = {
          contents: [
            {
              uri: resourceUri,
              mimeType: 'text/html;profile=mcp-app',
              text: '<main>APP_HOST_CONTENT</main>',
              _meta: {
                ui: {
                  permissions: { clipboardWrite: {} },
                  csp: { connectDomains: ['https://api.example.com'] }
                }
              }
            }
          ]
        }
      else if (body.method === 'resources/list') result = { resources: [] }
      else if (body.method === 'resources/templates/list') result = { resourceTemplates: [] }
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
      return
    }
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'app-fixture' }] }))
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'title',
          object: 'chat.completion',
          created: 1,
          model: 'app-fixture',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'App fixture' },
              finish_reason: 'stop'
            }
          ]
        })
      )
      return
    }
    const complete = body.messages.some((entry: { role: string }) => entry.role === 'tool')
    const delta = complete
      ? { content: 'APP_HOST_COMPLETE' }
      : {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'render-app',
              type: 'function',
              function: { name: renderName, arguments: '{}' }
            }
          ]
        }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(
      `data: ${JSON.stringify({ id: 'app-fixture', object: 'chat.completion.chunk', created: 1, model: 'app-fixture', choices: [{ index: 0, delta, finish_reason: complete ? 'stop' : 'tool_calls' }] })}\n\n`
    )
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    const first = await launchApp()
    expect(first.ownsUserDataDir).toBe(true)
    await waitForAppReady(first.page)
    const settings = await openSettings(first)
    const configured = await settings.evaluate(
      async ({ baseUrl, serverName }) => {
        await window.deepchat.invoke('mcp.setEnabled', { enabled: true })
        await window.deepchat.invoke('mcp.addServer', {
          serverName,
          config: {
            type: 'http',
            baseUrl: `${baseUrl}/mcp`,
            enabled: true,
            command: '',
            args: [],
            env: {},
            descriptions: 'Owned App fixture',
            icons: ''
          }
        })
        await window.deepchat.invoke('mcp.startServer', { serverName })
        const { servers } = await window.deepchat.invoke('mcp.getServers', {})
        const { tools } = await window.deepchat.invoke('mcp.listToolDefinitions', {})
        return {
          serverId: servers[serverName].serverId!,
          name: tools.find(
            (tool) => tool.server.name === serverName && tool.raw?.name === 'render_app'
          )!.function.name
        }
      },
      { baseUrl: `http://127.0.0.1:${port}`, serverName }
    )
    renderName = configured.name
    const sessionId = await first.page.evaluate(
      async ({ baseUrl, serverName }) => {
        const providerId = `custom-${crypto.randomUUID()}`
        await window.deepchat.invoke('providers.add', {
          provider: {
            id: providerId,
            name: 'App fixture',
            apiType: 'openai-completions',
            baseUrl,
            apiKey: 'fixture-key',
            enable: true,
            custom: true
          }
        })
        await window.deepchat.invoke('models.addCustom', {
          providerId,
          model: {
            id: 'app-fixture',
            name: 'App fixture',
            enabled: true,
            vision: false,
            functionCall: true,
            reasoning: false,
            contextLength: 32000,
            maxTokens: 8000
          }
        })
        await window.deepchat.invoke('models.setStatus', {
          providerId,
          modelId: 'app-fixture',
          enabled: true
        })
        const { config } = await window.deepchat.invoke('config.resolveDeepChatAgentConfig', {
          agentId: 'deepchat'
        })
        await window.deepchat.invoke('config.updateDeepChatAgent', {
          agentId: 'deepchat',
          updates: {
            config: {
              ...config,
              permissionMode: 'full_access',
              disabledAgentTools: [],
              enabledSkillNames: [],
              enabledMcpServerIds: [serverName],
              memoryEnabled: false
            }
          }
        })
        const { session } = await window.deepchat.invoke('sessions.create', {
          agentId: 'deepchat',
          message: 'Render the App fixture.',
          providerId,
          modelId: 'app-fixture',
          permissionMode: 'full_access',
          toolModeOverride: 'agent'
        })
        return session.id
      },
      { baseUrl: `http://127.0.0.1:${port}/v1`, serverName }
    )
    await expect
      .poll(async () =>
        JSON.stringify(
          await first.page.evaluate(
            (sessionId) =>
              window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
            sessionId
          )
        )
      )
      .toContain('APP_HOST_COMPLETE')
    const saved = await first.page.evaluate(async (sessionId) => {
      const { messages } = await window.deepchat.invoke('sessions.listMessagesPage', {
        sessionId,
        limit: 100
      })
      for (const message of messages) {
        if (message.role !== 'assistant') continue
        const blocks = JSON.parse(message.content) as AssistantMessageBlock[]
        const block = blocks.find((block) => block.tool_call?.mcpResult?.app)
        if (block)
          return {
            messageId: message.id,
            blockId: block.id || block.tool_call?.id || '',
            descriptor: block.tool_call!.mcpResult!.app!,
            toolInput: JSON.parse(block.tool_call!.params ?? '{}') as Record<string, unknown>
          }
      }
      throw new Error(`Persisted App result missing: ${JSON.stringify(messages).slice(0, 16384)}`)
    }, sessionId)
    const sourceInput = {
      ...saved,
      conversationId: sessionId,
      descriptor: saved.descriptor as McpAppDescriptor
    }
    for (const phase of ['first', 'reopen'] as const) {
      const active = phase === 'first' ? first : await launchApp()
      await waitForAppReady(active.page)
      await active.electronApp.evaluate(({ shell }) => {
        const links: string[] = []
        shell.openExternal = async (url) => {
          links.push(url)
        }
        Object.assign(globalThis, { __appHostLinks: links })
      })
      const { view } = await active.page.evaluate(
        (input) => window.deepchat.invoke('mcp.apps.prepareView', input),
        sourceInput
      )
      expect(view.html).toContain('APP_HOST_CONTENT')
      const policy = await active.electronApp.evaluate(async ({ net }, url) => {
        const response = await net.fetch(url)
        return {
          status: response.status,
          csp: response.headers.get('content-security-policy'),
          permissions: response.headers.get('permissions-policy')
        }
      }, view.sandboxUrl)
      expect(policy.status).toBe(200)
      expect(policy.csp).toContain("default-src 'none'")
      expect(policy.csp).toContain('connect-src https://api.example.com')
      expect(policy.permissions).toContain('camera=()')
      expect(policy.permissions).toContain('clipboard-write=(self)')
      const { call } = await active.page.evaluate(
        (instanceId) =>
          window.deepchat.invoke('mcp.apps.callTool', {
            instanceId,
            name: 'app_action',
            arguments: {}
          }),
        view.instanceId
      )
      expect(call.result.content).toEqual([{ type: 'text', text: 'APP_RESULT_app_action' }])
      if (phase === 'first') {
        await expect(
          settings.evaluate(
            (input) => window.deepchat.invoke('mcp.apps.prepareView', input),
            sourceInput
          )
        ).rejects.toThrow('conversation windows')
        for (const approved of [false, true]) {
          await active.page.evaluate((instanceId) => {
            Object.assign(window, {
              __appHostPending: window.deepchat.invoke('mcp.apps.openLink', {
                instanceId,
                url: 'https://example.com/fixture'
              })
            })
          }, view.instanceId)
          const dialog = active.page.getByRole('dialog')
          await expect(dialog).toBeVisible()
          await dialog
            .getByRole('button', {
              name: approved ? /Allow once|允许一次|允許一次|仅此一次|僅此一次/ : /Deny|拒绝|拒絕/
            })
            .click()
          expect(
            await active.page.evaluate(
              async () =>
                await (window as unknown as { __appHostPending: Promise<unknown> }).__appHostPending
            )
          ).toEqual({ opened: approved })
        }
        expect(
          await active.electronApp.evaluate(
            () => (globalThis as unknown as { __appHostLinks: string[] }).__appHostLinks
          )
        ).toEqual(['https://example.com/fixture'])
        await active.page.evaluate((instanceId) => {
          Object.assign(window, {
            __appHostPending: window.deepchat
              .invoke('mcp.apps.authorizeMessage', { instanceId, text: 'Owned pending consent' })
              .catch(() => undefined)
          })
        }, view.instanceId)
        await expect(active.page.getByRole('dialog')).toBeVisible()
      } else {
        await active.page.evaluate(
          ({ sessionId, messageId }) =>
            window.deepchat.invoke('sessions.deleteMessage', { sessionId, messageId }),
          { sessionId, messageId: saved.messageId }
        )
        await expect(
          active.page.evaluate(
            (instanceId) => window.deepchat.invoke('mcp.apps.listTools', { instanceId }),
            view.instanceId
          )
        ).rejects.toThrow('unavailable')
        expect(
          await active.electronApp.evaluate(
            async ({ net }, url) => (await net.fetch(url)).status,
            view.sandboxUrl
          )
        ).toBe(410)
        await expect(
          active.page.evaluate(
            (input) => window.deepchat.invoke('mcp.apps.prepareView', input),
            sourceInput
          )
        ).rejects.toThrow('source no longer matches')
      }
      expect(await active.close()).toBe('graceful')
      expect(active.pageErrors).toEqual([])
    }
    expect(calls).toEqual(['render_app', 'app_action', 'app_action'])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
