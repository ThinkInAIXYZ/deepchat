import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { test, expect } from '../fixtures/electronApp'
import type { ModelType } from '../../../src/shared/model'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

function processes(): Array<{ pid: number; parent: number; command: string }> {
  if (process.platform === 'win32') {
    const rows = JSON.parse(
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'
        ],
        { encoding: 'utf8' }
      )
    )
    return rows.map((row: { ProcessId: number; ParentProcessId: number; Name: string }) => ({
      pid: row.ProcessId,
      parent: row.ParentProcessId,
      command: row.Name
    }))
  }
  return execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
      return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }] : []
    })
}

test('Memory evicts idle stores, changes models and survives native worker loss @smoke', async ({
  launchApp
}) => {
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          data: ['fixture-embedding-16', 'fixture-embedding-32', 'fixture-chat'].map((id) => ({
            id
          }))
        })
      )
      return
    }
    let source = ''
    for await (const chunk of request) source += chunk
    const body = source ? JSON.parse(source) : {}
    if (request.url === '/v1/embeddings') {
      const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input]
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          object: 'list',
          model: body.model,
          data: inputs.map((input, index) => ({
            object: 'embedding',
            index,
            embedding: Array.from(
              { length: body.model.endsWith('-32') ? 32 : 16 },
              (_, component) =>
                component === (input.includes('cobalt-lark') || input === 'quartzneedle' ? 0 : 1)
                  ? 1
                  : 0
            )
          })),
          usage: { prompt_tokens: inputs.length * 4, total_tokens: inputs.length * 4 }
        })
      )
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion',
          created: 1,
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Memory fixture' },
              finish_reason: 'stop'
            }
          ]
        })
      )
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(
      `data: ${JSON.stringify({
        id: 'fixture',
        object: 'chat.completion.chunk',
        created: 1,
        model: body.model,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'MEMORY_RUNTIME_STILL_READY' },
            finish_reason: 'stop'
          }
        ]
      })}\n\n`
    )
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    const initial = await launchApp()
    expect(initial.ownsUserDataDir).toBe(true)
    await waitForAppReady(initial.page)
    const setup = await initial.page.evaluate(async (baseUrl) => {
      const providerId = `custom-${crypto.randomUUID()}`
      await window.deepchat.invoke('providers.add', {
        provider: {
          id: providerId,
          name: 'Memory lifecycle fixture',
          apiType: 'openai-completions',
          baseUrl,
          apiKey: 'fixture-key',
          enable: true,
          custom: true
        }
      })
      for (const modelId of ['fixture-embedding-16', 'fixture-embedding-32', 'fixture-chat']) {
        await window.deepchat.invoke('models.addCustom', {
          providerId,
          model: {
            id: modelId,
            name: modelId,
            type: (modelId === 'fixture-chat' ? 'chat' : 'embedding') as ModelType,
            enabled: true,
            vision: false,
            functionCall: false,
            reasoning: false,
            contextLength: 8192,
            maxTokens: 8192
          }
        })
        await window.deepchat.invoke('models.setStatus', { providerId, modelId, enabled: true })
      }
      const agents: string[] = []
      const memories: Record<string, string> = {}
      for (let index = 0; index < 9; index++) {
        const { agent } = await window.deepchat.invoke('config.createDeepChatAgent', {
          name: `Memory lifecycle ${index}`
        })
        agents.push(agent.id)
        await window.deepchat.invoke('config.updateDeepChatAgent', {
          agentId: agent.id,
          updates: {
            config: {
              memoryEnabled: true
            }
          }
        })
        const { result } = await window.deepchat.invoke('memory.add', {
          agentId: agent.id,
          kind: 'semantic',
          content: 'The project codename is cobalt-lark.'
        })
        if (result.action !== 'created' || !result.memoryId)
          throw new Error(`Memory fixture was not created: ${JSON.stringify(result)}`)
        memories[agent.id] = result.memoryId
        await window.deepchat.invoke('config.updateDeepChatAgent', {
          agentId: agent.id,
          updates: {
            config: {
              memoryEnabled: false,
              memoryEmbedding: { providerId, modelId: 'fixture-embedding-16' }
            }
          }
        })
      }
      return { providerId, agents, memories }
    }, `http://127.0.0.1:${port}/v1`)
    expect(await initial.close()).toBe('graceful')

    const app = await launchApp()
    await waitForAppReady(app.page)
    const host = processes().find(
      (row) =>
        row.parent === app.electronApp.process().pid && row.command.includes('deepchat-harness-')
    )!
    expect(host).toBeDefined()
    const before = processes()
      .filter((row) => row.parent === host.pid)
      .map((row) => row.pid)
    expect(before).toHaveLength(1)
    const recall = (agentId: string, query = 'quartzneedle') =>
      app.page.evaluate(
        ({ agentId, query }) =>
          window.deepchat.invoke('memory.search', { agentId, query, limit: 5 }),
        { agentId, query }
      )
    for (const agentId of setup.agents) {
      await app.page.evaluate(async (agentId) => {
        await window.deepchat.invoke('config.updateDeepChatAgent', {
          agentId,
          updates: { config: { memoryEnabled: true } }
        })
        await window.deepchat.invoke('memory.reindex', { agentId })
      }, agentId)
      await expect
        .poll(async () =>
          (await recall(agentId)).results.some(
            (row) => row.id === setup.memories[agentId] && row.sources?.vec
          )
        )
        .toBe(true)
    }
    const lastAgent = setup.agents.at(-1)!
    await expect
      .poll(
        async () =>
          (
            await app.page.evaluate(
              (agentId) => window.deepchat.invoke('memory.getHealth', { agentId }),
              lastAgent
            )
          ).health.runtime.process.vector.openStores
      )
      .toBeLessThanOrEqual(8)
    await app.page.evaluate(
      async ({ agentId, providerId }) => {
        await window.deepchat.invoke('config.updateDeepChatAgent', {
          agentId,
          updates: {
            config: {
              memoryEmbedding: { providerId, modelId: 'fixture-embedding-32' }
            }
          }
        })
        await window.deepchat.invoke('memory.reindex', { agentId })
      },
      { agentId: lastAgent, providerId: setup.providerId }
    )
    await expect
      .poll(async () => (await recall(lastAgent)).results.some((row) => row.sources?.vec))
      .toBe(true)
    const worker = processes().filter((row) => row.parent === host.pid && !before.includes(row.pid))
    expect(worker).toHaveLength(1)
    expect((await recall(lastAgent, 'cobalt')).results.some((row) => row.sources?.fts)).toBe(true)
    process.kill(worker[0].pid, 'SIGKILL')
    await expect
      .poll(async () => (await recall(lastAgent, 'cobalt')).results.some((row) => row.sources?.fts))
      .toBe(true)
    expect(() => process.kill(host.pid, 0)).not.toThrow()
    expect(() => process.kill(before[0], 0)).not.toThrow()
    expect(
      processes()
        .filter((row) => row.parent === host.pid)
        .map((row) => row.pid)
    ).toEqual(before)
    const clearedAgent = setup.agents[0]
    const cleared = await app.page.evaluate(
      (agentId) => window.deepchat.invoke('memory.clear', { agentId }),
      clearedAgent
    )
    expect(cleared.removed).toBeGreaterThanOrEqual(1)
    expect(cleared.cleanupPendingRestart).toBe(true)
    expect((await recall(clearedAgent, 'cobalt')).results).toEqual([])
    const { session } = await app.page.evaluate(
      ({ providerId, projectDir }) =>
        window.deepchat.invoke('sessions.create', {
          agentId: 'deepchat',
          providerId,
          modelId: 'fixture-chat',
          projectDir,
          message: 'Reply after the vector worker stops.'
        }),
      { providerId: setup.providerId, projectDir: app.userDataDir }
    )
    await expect
      .poll(async () =>
        JSON.stringify(
          await app.page.evaluate(
            (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 30 }),
            session.id
          )
        )
      )
      .toContain('MEMORY_RUNTIME_STILL_READY')
    expect(await app.close()).toBe('graceful')
    const reopened = await launchApp()
    await waitForAppReady(reopened.page)
    expect(
      (
        await reopened.page.evaluate(
          (agentId) =>
            window.deepchat.invoke('memory.search', { agentId, query: 'cobalt', limit: 5 }),
          clearedAgent
        )
      ).results
    ).toEqual([])
    await reopened.page.evaluate(
      (agentId) => window.deepchat.invoke('memory.reindex', { agentId }),
      lastAgent
    )
    await expect
      .poll(async () =>
        (
          await reopened.page.evaluate(
            (agentId) =>
              window.deepchat.invoke('memory.search', {
                agentId,
                query: 'quartzneedle',
                limit: 5
              }),
            lastAgent
          )
        ).results.some((row) => row.id === setup.memories[lastAgent] && row.sources?.vec)
      )
      .toBe(true)
    expect(await reopened.close()).toBe('graceful')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
