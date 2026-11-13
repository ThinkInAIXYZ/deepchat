import { expect, it, vi } from 'vitest'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { dimDatabase } from './fixtures/database'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimSessionRuntime } from '@/agent/dim/sessionRuntime'
import { DimLegacyMigration } from '@/agent/dim/legacyMigration'
import { DimQueue } from '@/agent/dim/queue'
import { DimContent } from '@/agent/dim/content'
import type {
  ChatMessageRecord,
  PendingSessionInputRecord,
  UserMessageContent
} from '@shared/types/agent-interface'

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'migrates paused legacy drafts, mutates and restarts them, then admits each once to the native queue',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dim-legacy-queue-'))
    const database = dimDatabase()
    const requests: string[] = []
    let held: ServerResponse | undefined
    const reply = (response: ServerResponse, text: string) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'legacy-queue', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
    }
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      if (body.includes('Write a short title for this conversation:')) {
        reply(response, 'Legacy queue')
        return
      }
      requests.push(body)
      if (requests.length === 1) held = response
      else reply(response, 'Retried draft finished')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin/node'])
      ),
      nativePlugins: true
    })
    const user = (text: string): UserMessageContent => ({
      text,
      files: [],
      links: [],
      search: false,
      think: false
    })
    const draft = (id: string, text: string): PendingSessionInputRecord => ({
      id,
      sessionId: 'legacy',
      mode: 'queue',
      state: 'pending',
      payload: { text },
      messageIds: [],
      assistantMessageId: null,
      blocking: null,
      queueOrder: 0,
      claimedAt: null,
      consumedAt: null,
      createdAt: 1,
      updatedAt: 1
    })
    const alpha = draft('alpha', 'Original alpha')
    const beta = draft('beta', 'Queued beta')
    const retry = {
      ...draft('retry', 'Retry only once'),
      state: 'retry_required' as const,
      messageIds: ['retry-user'],
      assistantMessageId: 'partial'
    }
    const message = (
      id: string,
      orderSeq: number,
      role: 'user' | 'assistant',
      content: string
    ): ChatMessageRecord => ({
      id,
      sessionId: 'legacy',
      orderSeq,
      role,
      content,
      status: 'sent',
      metadata: '{}',
      isContextEdge: 0,
      createdAt: 1,
      updatedAt: 1
    })
    let runtime: DimSessionRuntime | undefined
    try {
      const model = await new DimModelBridge(host).configure({
        key: 'legacy-queue',
        displayName: 'Legacy queue',
        connection: {
          driverKind: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
          auth: { type: 'anonymous' }
        },
        model: {
          modelId: 'fixture',
          displayName: 'Fixture',
          status: 'active',
          capabilities: {
            modalities: ['text'],
            toolCalling: true,
            streaming: true,
            structuredOutput: true,
            vision: false,
            audio: false,
            reasoning: false,
            contextWindow: 64000,
            maxOutputTokens: 1000
          }
        }
      })
      const migration = new DimLegacyMigration({
        database: database.data,
        host,
        snapshot: async () => ({
          formatVersion: 1,
          productSessionId: 'legacy',
          summary: null,
          messages: [
            message('old-user', 1, 'user', JSON.stringify(user('Old history'))),
            message('old-assistant', 2, 'assistant', '[]'),
            message('retry-user', 3, 'user', JSON.stringify(user('Retry only once'))),
            { ...message('partial', 4, 'assistant', '[]'), status: 'error' }
          ],
          pendingInputs: [alpha, beta, retry],
          excludedContextMessageIds: ['retry-user']
        })
      })
      runtime = new DimSessionRuntime({
        database: database.data,
        host,
        launch: async () => ({
          cwd: profile,
          model: { ...model },
          policy: { preset: 'full-access', allowedTools: [], disallowedTools: [] }
        }),
        prepare: (binding) => migration.prepare(binding),
        projected: () => {},
        failed: (_id, error) => {
          throw error
        }
      })
      const queue = new DimQueue({
        database: database.data,
        host,
        runtime,
        legacyPendingInputs: () => [alpha, beta, retry],
        prepareNative: async (id) => {
          await runtime!.open(id)
        },
        setProjectDir: async () => {},
        prepareInput: async (_id, input) => ({
          content: [{ type: 'text', text: input.text }],
          representation: user(input.text),
          summary: { status: 'ready', issues: [], suggestedActions: [] }
        })
      })
      expect((await queue.listPendingInputs('legacy')).map((item) => item.id)).toEqual([
        'legacy-queue:alpha',
        'legacy-queue:beta',
        'legacy-queue:retry'
      ])
      expect(database.data.dimSessionBindingsTable.get('legacy')).toBeNull()
      await runtime.open('legacy')
      expect(requests).toEqual([])
      await queue.updateQueuedInput('legacy', 'legacy-queue:alpha', { text: 'Edited alpha' })
      await queue.moveQueuedInput('legacy', 'legacy-queue:beta', 0)
      await queue.deletePendingInput('legacy', 'legacy-queue:alpha')
      expect(requests).toEqual([])
      const binding = database.data.dimSessionBindingsTable.get('legacy')!
      const before = await new DimContent(host).transcript(
        { sessionId: binding.dimSessionId, branchId: 'main' },
        'legacy'
      )
      expect(before.pendingInputs.map((item) => item.id)).toEqual(['beta', 'retry'])
      await runtime.stop()
      await runtime.open('legacy')
      expect((await queue.listPendingInputs('legacy')).map((item) => item.id)).toEqual([
        'legacy-queue:beta',
        'legacy-queue:retry'
      ])
      expect(await queue.resumePendingQueue('legacy')).toBe(true)
      await expect.poll(() => requests.length).toBe(1)
      expect(requests[0]).toContain('Queued beta')
      expect(requests[0]).not.toContain('Retry only once')
      await Promise.all([
        queue.retryPendingQueueInput('legacy', 'legacy-queue:retry'),
        queue.retryPendingQueueInput('legacy', 'legacy-queue:retry')
      ])
      expect(requests).toHaveLength(1)
      const queuedRetry = (await queue.listPendingInputs('legacy')).find(
        (item) => item.payload.text === 'Retry only once'
      )!
      await queue.updateQueuedInput('legacy', queuedRetry.id, { text: 'Retry only once' })
      reply(held!, 'Beta finished')
      await runtime.waitIdle('legacy')
      expect(requests).toHaveLength(2)
      expect(requests[1].match(/Retry only once/g)).toHaveLength(1)
      expect(await queue.listPendingInputs('legacy')).toEqual([])
      const after = await new DimContent(host).transcript(
        { sessionId: binding.dimSessionId, branchId: 'main' },
        'legacy'
      )
      expect(after.pendingInputs).toEqual([])
      expect(after.messages.filter((item) => item.id === 'retry-user')).toHaveLength(1)
    } finally {
      if (held && !held.writableEnded) reply(held, 'cleanup')
      await runtime?.stop()
      await host.stop()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      database.sqlite.close()
      await rm(profile, { recursive: true, force: true })
    }
  },
  90_000
)
