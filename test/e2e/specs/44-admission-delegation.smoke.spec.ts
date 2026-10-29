import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import type { LiveDelegationSummary } from '../../../src/shared/orchestration/liveDelegation'
import type { ModelType } from '../../../src/shared/model'

test.use({ privacyModeEnabled: true })

test('delegation admission queues, cancels and releases execution slots @smoke', async ({
  launchApp
}, testInfo) => {
  const memoryRows = Number(process.env.DEEPCHAT_E2E_MEMORY_LOAD_ROWS ?? 0)
  expect([0, 1000, 10000, 50000]).toContain(memoryRows)
  let embeddingBatches = 0
  const started = new Set<number>()
  const releases = new Map<number, () => void>()
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'admission-fixture' }] }))
      return
    }
    if (!['/v1/chat/completions', '/v1/embeddings'].includes(request.url ?? '')) {
      response.writeHead(404).end()
      return
    }
    let source = ''
    for await (const chunk of request) source += chunk
    const body = JSON.parse(source)
    if (request.url === '/v1/embeddings') {
      const inputs = Array.isArray(body.input) ? body.input : [body.input]
      embeddingBatches++
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          object: 'list',
          model: body.model,
          data: inputs.map((_: string, index: number) => ({
            object: 'embedding',
            index,
            embedding: Array.from({ length: 1536 }, (_, component) => (component === 0 ? 1 : 0))
          })),
          usage: { prompt_tokens: inputs.length, total_tokens: inputs.length }
        })
      )
      return
    }
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'title',
          object: 'chat.completion',
          created: 1,
          model: 'admission-fixture',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Admission verification' },
              finish_reason: 'stop'
            }
          ]
        })
      )
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const emit = (delta: unknown, finishReason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({
          id: 'admission-fixture',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'admission-fixture',
          choices: [{ index: 0, delta, finish_reason: finishReason }]
        })}\n\n`
      )
    const userText = body.messages
      .filter((message: { role: string }) => message.role === 'user')
      .map((message: { content: unknown }) => JSON.stringify(message.content))
      .join('\n')
    const child = /CHILD_ADMISSION_(\d)/.exec(userText)
    if (child) {
      const index = Number(child[1])
      started.add(index)
      await new Promise<void>((resolve) => {
        releases.set(index, resolve)
        response.once('close', resolve)
      })
      if (response.destroyed) return
      emit({ content: `CHILD_${index}_DONE` }, 'stop')
    } else if (!body.messages.some((message: { role: string }) => message.role === 'tool')) {
      emit(
        {
          role: 'assistant',
          tool_calls: Array.from({ length: 4 }, (_, slot) => {
            const index = slot + (userText.includes('PARENT_ADMISSION_B') ? 4 : 0)
            return {
              index,
              id: `spawn-${index}`,
              type: 'function',
              function: {
                name: 'deepchat_subagents',
                arguments: JSON.stringify({
                  operation: 'spawn',
                  slotId: 'explorer',
                  title: `Admission verification ${index}`,
                  prompt: `CHILD_ADMISSION_${index}: Reply with CHILD_${index}_DONE without using tools.`
                })
              }
            }
          })
        },
        'tool_calls'
      )
    } else emit({ content: 'Delegation requests accepted.' }, 'stop')
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    let app = await launchApp()
    await waitForAppReady(app.page)
    const providerId = await app.page.evaluate(
      async ({ baseUrl, memoryRows }) => {
        const providerId = `custom-${crypto.randomUUID()}`
        await window.deepchat.invoke('providers.add', {
          provider: {
            id: providerId,
            name: 'Admission fixture',
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
            id: 'admission-fixture',
            name: 'Admission fixture',
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
          modelId: 'admission-fixture',
          enabled: true
        })
        if (memoryRows)
          await window.deepchat.invoke('models.addCustom', {
            providerId,
            model: {
              id: 'load-embedding',
              name: 'Load embedding',
              type: 'embedding' as ModelType,
              enabled: true,
              vision: false,
              functionCall: false,
              reasoning: false,
              contextLength: 8192,
              maxTokens: 8192
            }
          })
        const { config } = await window.deepchat.invoke('config.resolveDeepChatAgentConfig', {
          agentId: 'deepchat'
        })
        await window.deepchat.invoke('config.updateDeepChatAgent', {
          agentId: 'deepchat',
          updates: {
            config: {
              ...config,
              ...(memoryRows
                ? {
                    memoryEnabled: true,
                    memoryEmbedding: { providerId, modelId: 'load-embedding' }
                  }
                : {}),
              subagentEnabled: true,
              permissionMode: 'full_access',
              enabledSkillNames: [],
              disabledAgentTools: []
            }
          }
        })
        return providerId
      },
      { baseUrl: `http://127.0.0.1:${port}/v1`, memoryRows }
    )
    if (memoryRows) {
      expect(app.ownsUserDataDir).toBe(true)
      expect(await app.close()).toBe('graceful')
      const database = new Database(join(app.userDataDir, 'app_db', 'agent.db'))
      try {
        const insert = database.prepare(`INSERT INTO agent_memory
          (id, agent_id, kind, content, created_at, status, embedding_state, lifecycle_state)
          VALUES (?, 'deepchat', 'semantic', ?, ?, 'fts_only', 'fts_only', 'active')`)
        database.transaction(() => {
          const now = Date.now()
          for (let index = 0; index < memoryRows; index++)
            insert.run(`load-${index}`, `Concurrent native indexing fact ${index}.`, now)
        })()
      } finally {
        database.close()
      }
      app = await launchApp()
      await waitForAppReady(app.page)
      await app.page.evaluate(() =>
        window.deepchat.invoke('memory.reindex', { agentId: 'deepchat' })
      )
    }
    const firstParent = await app.page.evaluate(
      async ({ providerId, projectDir }) => {
        const { session } = await window.deepchat.invoke('sessions.create', {
          agentId: 'deepchat',
          message: 'PARENT_ADMISSION_A: Delegate four isolated admission verification tasks.',
          providerId,
          modelId: 'admission-fixture',
          projectDir,
          permissionMode: 'full_access',
          orchestrationPolicy: 'proactive'
        })
        return { parentSessionId: session.id, providerId }
      },
      { providerId, projectDir: app.userDataDir }
    )
    await expect.poll(() => started.size).toBe(4)
    if (memoryRows) {
      expect(embeddingBatches).toBeGreaterThan(0)
      const { status } = await app.page.evaluate(() =>
        window.deepchat.invoke('memory.getStatus', { agentId: 'deepchat' })
      )
      expect(status.pendingEmbedding).toBeGreaterThan(0)
    }
    const secondParentId = await app.page.evaluate(
      async ({ providerId, projectDir }) => {
        const { session } = await window.deepchat.invoke('sessions.create', {
          agentId: 'deepchat',
          message: 'PARENT_ADMISSION_B: Delegate four isolated admission verification tasks.',
          providerId,
          modelId: 'admission-fixture',
          projectDir,
          permissionMode: 'full_access',
          orchestrationPolicy: 'proactive'
        })
        return session.id
      },
      { providerId: firstParent.providerId, projectDir: app.userDataDir }
    )
    const list = (parentSessionId: string) =>
      app.page.evaluate(async (parentSessionId) => {
        const { delegations } = await window.deepchat.invoke('orchestration.liveDelegation.list', {
          parentSessionId,
          limit: 100
        })
        return delegations
      }, parentSessionId) as Promise<LiveDelegationSummary[]>
    const listAll = async () => [
      ...(await list(firstParent.parentSessionId)),
      ...(await list(secondParentId))
    ]
    await expect.poll(async () => (await listAll()).length).toBe(8)
    await expect.poll(() => started.size).toBe(6)
    const queued = (await listAll()).find(
      (delegation) => delegation.title === 'Admission verification 7'
    )!
    expect(queued.status).toBe('queued')
    await app.page.evaluate(
      async ({ parentSessionId, delegationId }) => {
        await window.deepchat.invoke('orchestration.liveDelegation.interrupt', {
          parentSessionId,
          delegationId
        })
      },
      { parentSessionId: secondParentId, delegationId: queued.id }
    )
    expect(started.has(7)).toBe(false)
    releases.get(0)!()
    await expect.poll(() => started.has(6)).toBe(true)
    for (const release of releases.values()) release()
    await expect
      .poll(async () => (await listAll()).map((delegation) => delegation.status).sort())
      .toEqual(['idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'interrupted'])
    const final = await listAll()
    expect(final.find((delegation) => delegation.id === queued.id)?.status).toBe('interrupted')
    expect([...started].sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
    if (memoryRows)
      await expect
        .poll(
          async () =>
            (
              await app.page.evaluate(() =>
                window.deepchat.invoke('memory.getStatus', { agentId: 'deepchat' })
              )
            ).status.lastReindex?.outcome,
          { timeout: 180_000 }
        )
        .toBe('completed')
    expect(app.pageErrors).toEqual([])
    expect(await app.close()).toBe('graceful')
    const records = readFileSync(join(app.userDataDir, 'logs', 'main.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const admission = records.filter((record) => record.event.startsWith('agent.admission.'))
    expect(admission.some((record) => record.event === 'agent.admission.queued')).toBe(true)
    expect(admission.some((record) => record.event === 'agent.admission.rejected')).toBe(true)
    expect(admission.at(-1)).toMatchObject({ event: 'agent.admission.closed' })
    await testInfo.attach('admission-comparison.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            completed: 7,
            interrupted: 1,
            peakStartedBeforeRelease: 6,
            started: [...started].sort(),
            memoryRows,
            embeddingBatches,
            events: admission.map((record) => record.event)
          },
          null,
          2
        )
      ),
      contentType: 'application/json'
    })
  } finally {
    for (const release of releases.values()) release()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
