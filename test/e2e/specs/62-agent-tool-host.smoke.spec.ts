import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('Agent tools preserve image metadata, workspace access and reopen @smoke', async ({
  launchApp
}) => {
  const image = readFileSync(new URL('../../../resources/icon.png', import.meta.url))
  const resolution = `${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`
  let imagePath = ''
  let toolResults: string[] = []
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'host-fixture' }] }))
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let source = ''
    for await (const chunk of request) source += chunk
    const body = JSON.parse(source)
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'title',
          object: 'chat.completion',
          created: 1,
          model: 'host-fixture',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Agent host verification' },
              finish_reason: 'stop'
            }
          ]
        })
      )
      return
    }
    const results = body.messages.filter((message: { role: string }) => message.role === 'tool')
    toolResults = results.map((message: { content: unknown }) => JSON.stringify(message.content))
    const complete = results.length >= 2
    const delta = complete
      ? { content: 'AGENT_HOST_VERIFIED' }
      : {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `host-read-${results.length}`,
              type: 'function',
              function: {
                name: 'read',
                arguments: JSON.stringify({ path: results.length ? 'workspace.txt' : imagePath })
              }
            }
          ]
        }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(
      `data: ${JSON.stringify({
        id: 'host-fixture',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'host-fixture',
        choices: [{ index: 0, delta, finish_reason: complete ? 'stop' : 'tool_calls' }]
      })}\n\n`
    )
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    const active = await launchApp()
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    const projectDir = join(active.userDataDir, 'workspace')
    const temporary = join(active.userDataDir, 'temp')
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(temporary, { recursive: true })
    imagePath = join(temporary, 'host-image.png')
    writeFileSync(imagePath, image)
    writeFileSync(join(projectDir, 'workspace.txt'), 'WORKSPACE_HOST_READ_VERIFIED')
    const sessionId = await active.page.evaluate(
      async ({ baseUrl, projectDir }) => {
        const providerId = `custom-${crypto.randomUUID()}`
        await window.deepchat.invoke('providers.add', {
          provider: {
            id: providerId,
            name: 'Agent host fixture',
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
            id: 'host-fixture',
            name: 'Agent host fixture',
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
          modelId: 'host-fixture',
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
              memoryEnabled: false
            }
          }
        })
        const { session } = await window.deepchat.invoke('sessions.create', {
          agentId: 'deepchat',
          message: 'Verify image metadata and workspace file access.',
          providerId,
          modelId: 'host-fixture',
          projectDir,
          permissionMode: 'full_access',
          toolModeOverride: 'agent'
        })
        return session.id
      },
      { baseUrl: `http://127.0.0.1:${port}/v1`, projectDir }
    )
    await expect.poll(() => toolResults.length).toBe(2)
    expect(toolResults[0]).toContain('[Image Metadata]')
    expect(toolResults[0]).toContain(`resolution: ${resolution}`)
    expect(toolResults[0]).toContain('neither the current session model nor the agent vision model')
    expect(toolResults[1]).toContain('WORKSPACE_HOST_READ_VERIFIED')
    await expect
      .poll(async () =>
        JSON.stringify(
          await active.page.evaluate(
            (sessionId) =>
              window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
            sessionId
          )
        )
      )
      .toContain('AGENT_HOST_VERIFIED')
    expect(await active.close()).toBe('graceful')
    const reopened = await launchApp()
    await waitForAppReady(reopened.page)
    const { messages } = await reopened.page.evaluate(
      (sessionId) => window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
      sessionId
    )
    expect(JSON.stringify(messages)).toContain('AGENT_HOST_VERIFIED')
    expect(JSON.stringify(messages)).toContain('WORKSPACE_HOST_READ_VERIFIED')
    expect(await reopened.close()).toBe('graceful')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
