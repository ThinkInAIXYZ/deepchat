import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { DuckDBInstance } from '@duckdb/node-api'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import type { ModelType } from '../../../src/shared/model'

test.use({ privacyModeEnabled: true })

test('native Memory indexing, vector-only recall, deletion and clear survive relaunch @smoke', async ({
  launchApp
}, testInfo) => {
  const rows = Number(process.env.DEEPCHAT_E2E_MEMORY_ROWS ?? 1000)
  expect([1000, 10000, 50000]).toContain(rows)
  const embeddingRequests: number[] = []
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'fixture-embedding' }] }))
      return
    }
    if (request.url !== '/v1/embeddings') {
      response.writeHead(404).end()
      return
    }
    let source = ''
    for await (const chunk of request) source += chunk
    const body = JSON.parse(source)
    const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input]
    embeddingRequests.push(inputs.length)
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        object: 'list',
        model: body.model,
        data: inputs.map((input, index) => ({
          object: 'embedding',
          index,
          embedding: Array.from({ length: 1536 }, (_, component) =>
            component === (input.includes('cobalt-lark') || input === 'quartzneedle' ? 0 : 1)
              ? 1
              : Math.fround(Math.sin(component + 1) * 0.001)
          )
        })),
        usage: { prompt_tokens: inputs.length * 4, total_tokens: inputs.length * 4 }
      })
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  try {
    const initial = await launchApp()
    expect(initial.ownsUserDataDir).toBe(true)
    await waitForAppReady(initial.page)
    await initial.page.evaluate(async (baseUrl) => {
      const providerId = `custom-${crypto.randomUUID()}`
      await window.deepchat.invoke('providers.add', {
        provider: {
          id: providerId,
          name: 'Memory vector fixture',
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
          id: 'fixture-embedding',
          name: 'Fixture Embedding',
          type: 'embedding' as ModelType,
          enabled: true,
          vision: false,
          functionCall: false,
          reasoning: false,
          contextLength: 8192,
          maxTokens: 8192
        }
      })
      await window.deepchat.invoke('config.updateDeepChatAgent', {
        agentId: 'deepchat',
        updates: {
          config: {
            memoryEnabled: true,
            memoryEmbedding: { providerId, modelId: 'fixture-embedding' }
          }
        }
      })
    }, `http://127.0.0.1:${address.port}/v1`)
    expect(await initial.close()).toBe('graceful')

    const securityPath = join(initial.userDataDir, 'database-security.json')
    if (existsSync(securityPath)) {
      expect(JSON.parse(readFileSync(securityPath, 'utf8')).metadata?.enabled).not.toBe(true)
    }
    // Seed canonical rows only while the disposable application's writer is closed.
    const db = new Database(join(initial.userDataDir, 'app_db', 'agent.db'))
    try {
      const insert = db.prepare(`INSERT INTO agent_memory
        (id, agent_id, kind, content, created_at, status, embedding_state, lifecycle_state)
        VALUES (?, 'deepchat', 'semantic', ?, ?, 'fts_only', 'fts_only', 'active')`)
      db.transaction(() => {
        const now = Date.now()
        insert.run('native-anchor', 'The project codename is cobalt-lark.', now)
        for (let index = 1; index < rows; index++) {
          insert.run(`native-filler-${index}`, `Baseline fact ${index} about slow rivers.`, now)
        }
      })()
    } finally {
      db.close()
    }

    const app = await launchApp()
    await waitForAppReady(app.page)
    await app.page.evaluate(() => window.deepchat.invoke('memory.reindex', { agentId: 'deepchat' }))
    await expect
      .poll(
        async () => {
          const { status } = await app.page.evaluate(() =>
            window.deepchat.invoke('memory.getStatus', { agentId: 'deepchat' })
          )
          return { pending: status.pendingEmbedding, outcome: status.lastReindex?.outcome }
        },
        // Reserve a minute for recall, the fixed idle window and relaunch within the test limit.
        { timeout: rows === 50000 ? testInfo.timeout - 60_000 : 120_000 }
      )
      .toEqual({ pending: 0, outcome: 'completed' })

    const timings: number[] = []
    for (let sample = 0; sample < 12; sample++) {
      const startedAt = performance.now()
      const result = await app.page.evaluate(() =>
        window.deepchat.invoke('memory.search', {
          agentId: 'deepchat',
          query: 'quartzneedle',
          limit: 20
        })
      )
      timings.push(performance.now() - startedAt)
      expect(result.results).toEqual([
        expect.objectContaining({
          id: 'native-anchor',
          sources: expect.objectContaining({ vec: true })
        })
      ])
    }
    const { health } = await app.page.evaluate(() =>
      window.deepchat.invoke('memory.getHealth', { agentId: 'deepchat' })
    )
    expect(health.runtime.agent.retrieval.search.vectorCandidates).toBeGreaterThan(0)
    expect(health.runtime.process.vector.openStores).toBeGreaterThan(0)
    expect(embeddingRequests.some((count) => count > 1)).toBe(true)

    const deletion = await app.page.evaluate(() =>
      window.deepchat.invoke('memory.delete', { agentId: 'deepchat', memoryId: 'native-anchor' })
    )
    expect(deletion.action).toBe('applied')
    expect(
      await app.page.evaluate(() =>
        window.deepchat.invoke('memory.search', {
          agentId: 'deepchat',
          query: 'quartzneedle',
          limit: 20
        })
      )
    ).toEqual({ results: [] })
    // Measure settled footprint without forcing GC or slowing normal E2E runs.
    if (process.env.DEEPCHAT_E2E_MEASURE_RESOURCES === '1')
      await new Promise((resolve) => setTimeout(resolve, 30_000))
    expect(await app.close()).toBe('graceful')

    const instance = await DuckDBInstance.create(
      join(app.userDataDir, 'app_db', 'AgentMemory', 'deepchat.v2.duckdb')
    )
    const connection = await instance.connect()
    try {
      const result = await connection.runAndReadAll(
        'SELECT count(*)::INTEGER AS total FROM memory_vector'
      )
      expect(result.getRowObjectsJson()).toEqual([{ total: rows - 1 }])
    } finally {
      connection.closeSync()
      instance.closeSync()
    }

    const reopened = await launchApp()
    await waitForAppReady(reopened.page)
    expect(
      await reopened.page.evaluate(() =>
        window.deepchat.invoke('memory.search', {
          agentId: 'deepchat',
          query: 'quartzneedle',
          limit: 20
        })
      )
    ).toEqual({ results: [] })
    const { status: beforeClear } = await reopened.page.evaluate(() =>
      window.deepchat.invoke('memory.getStatus', { agentId: 'deepchat' })
    )
    expect(beforeClear.total).toBeGreaterThanOrEqual(rows - 1)
    const cleared = await reopened.page.evaluate(() =>
      window.deepchat.invoke('memory.clear', { agentId: 'deepchat' })
    )
    expect(cleared.cleanupPendingRestart).toBe(false)
    expect(cleared.removed).toBeGreaterThanOrEqual(beforeClear.total)
    expect(
      await reopened.page.evaluate(() =>
        window.deepchat.invoke('memory.getStatus', { agentId: 'deepchat' })
      )
    ).toMatchObject({ status: { total: 0, pendingEmbedding: 0 } })
    expect(await reopened.close()).toBe('graceful')
    const clearedDb = new Database(join(reopened.userDataDir, 'app_db', 'agent.db'), {
      readonly: true
    })
    try {
      expect(
        clearedDb
          .prepare("SELECT count(*) AS total FROM agent_memory WHERE agent_id = 'deepchat'")
          .get()
      ).toEqual({ total: 0 })
    } finally {
      clearedDb.close()
    }
    const evidence = testInfo.outputPath('native-memory-baseline.json')
    writeFileSync(
      evidence,
      JSON.stringify({
        rows,
        dimensions: 1536,
        embeddingShape: 'dense-f32-sine-noise',
        timingsMs: timings,
        embeddingRequests,
        beforeClear
      })
    )
    await testInfo.attach('native-memory-baseline.json', {
      path: evidence,
      contentType: 'application/json'
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
