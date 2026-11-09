import { DimSessionConnection } from '@/agent/dim/sessionConnection'
import { projectDimEvent } from '@/agent/dim/messageProjection'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimSessionRuntime } from '@/agent/dim/sessionRuntime'
import { dimDatabase } from './fixtures/database'
import { DimProductGateway, type DimProductToolCall } from '@/agent/dim/productGateway'

// Explicit smoke target: no network requests or runtime downloads during tests.
it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'runs through the injected plugins and restores committed content',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-native-'))
    const runtime = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      profile: 'mock'
    })
    try {
      const [client, sameClient] = await Promise.all([runtime.start(), runtime.start()])
      expect(sameClient).toBe(client)
      expect(await client.call('deepchat.host.capabilities')).toMatchObject({
        apiVersion: 1,
        plugin: 'deepchat-host'
      })
      expect(await client.call('deepchat.storage.capabilities')).toMatchObject({
        apiVersion: 1,
        plugin: 'deepchat-storage'
      })
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile
      })
      const ref = { sessionId, branchId: 'main' }
      const events: Array<{ type: string; name: string }> = []
      client.on('notification', (notice) => {
        if (notice.method === 'deepchat.host.event') events.push(notice.params.event)
      })
      const { watchId } = await client.call<{ watchId: string }>('deepchat.host.subscribe', ref)
      const submissionId = randomUUID()

      expect(await client.call('deepchat.host.lookup', { ...ref, submissionId })).toEqual({
        status: 'unknown'
      })
      const receipt = await client.call('deepchat.host.input', {
        ...ref,
        mode: 'queue',
        submissionId,
        rawBlocks: [],
        content: [{ type: 'text', text: 'DeepChat dim integration' }]
      })
      expect(receipt).toMatchObject({ inputId: expect.any(String), sequence: expect.any(Number) })
      await client.call('deepchat.host.idle', ref)
      expect(await client.call('deepchat.host.lookup', { ...ref, submissionId })).toMatchObject({
        status: 'accepted',
        ...(receipt as object)
      })
      type History = {
        through: number
        events: Array<{ type: string; name: string; data: { delta?: string } }>
      }
      const history = await client.call<History>('deepchat.storage.history', {
        ...ref,
        after: 0,
        limit: 100
      })
      expect(
        history.events.some(
          (event) =>
            event.name === 'text' && event.data.delta?.includes('Echo: DeepChat dim integration')
        )
      ).toBe(true)
      expect(history.events.at(-1)).toMatchObject({
        type: 'turn',
        name: 'end',
        data: { status: 'completed' }
      })
      await expect
        .poll(() => events.some((event) => event.type === 'turn' && event.name === 'end'))
        .toBe(true)
      const query = { scope: 'branch', query: { select: { kind: 'events' } }, page: { limit: 3 } }
      const raw = await client.call<{
        through: number
        next: unknown
        result: { events: unknown[] }
      }>('session.deepchat_storage.query', { ...ref, query })
      expect(raw.result.events).toHaveLength(3)
      expect(raw.next).toBeTruthy()
      const next = await client.call<{ result: { events: unknown[] } }>(
        'session.deepchat_storage.query',
        {
          ...ref,
          query: { ...query, through: String(raw.through), page: { limit: 3, after: raw.next } }
        }
      )
      expect(next.result.events).toHaveLength(3)
      await expect(
        client.call('deepchat.storage.history', { ...ref, limit: 1000 })
      ).rejects.toMatchObject({ data: { appError: 'invalid_params' } })
      await client.call('deepchat.host.unsubscribe', { watchId })
      client.close()
      const reconnected = await runtime.start()
      expect(
        await reconnected.call('deepchat.host.lookup', { ...ref, submissionId })
      ).toMatchObject({ status: 'accepted' })
      await runtime.stop()
      const restored = await runtime.start()
      const page = await restored.call('deepchat.storage.history', {
        ...ref,
        after: 0,
        through: history.through,
        limit: 100
      })
      expect(page).toEqual(history)
      expect(await restored.call('deepchat.host.lookup', { ...ref, submissionId })).toMatchObject({
        status: 'accepted'
      })
      await restored.call('deepchat.host.stop', ref)
    } finally {
      await runtime.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'executes product tools inside dim and reloads their scoped catalog with cancellation',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-tools-'))
    let version = 'one'
    let names = ['deepchat_echo', 'deepchat_hold']
    const calls: DimProductToolCall[] = []
    let cancelled = false
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version,
        tools: names.map((name) => ({
          name,
          description: 'DeepChat native bridge fixture',
          inputSchema: { type: 'object' },
          source: 'extension',
          risk: 'session'
        })),
        execute: async (call, signal) => {
          calls.push(call)
          if (call.name === 'deepchat_hold') {
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve()
              else
                signal.addEventListener(
                  'abort',
                  () => {
                    cancelled = true
                    resolve()
                  },
                  { once: true }
                )
            })
          }
          return { content: `product: ${call.arguments.text ?? 'done'}` }
        }
      })
    })
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      profile: 'mock',
      gatewayAddress: await gateway.start()
    })
    try {
      const client = await host.start()
      const { agentId } = await client.call<{ agentId: string }>('agent.create', {
        profile: { name: 'DeepChat tools fixture', description: '', systemPrompt: '' }
      })
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        agent: agentId,
        policy: { preset: 'full-access' }
      })
      const ref = { sessionId, branchId: 'main' }
      const send = (text: string) =>
        client.call('deepchat.host.input', {
          ...ref,
          mode: 'queue',
          submissionId: randomUUID(),
          rawBlocks: [],
          content: [{ type: 'text', text }]
        })
      await client.call('session.deepchat_tools.refresh', ref)
      await send('tool:deepchat_echo {"text":"first"}')
      await client.call('deepchat.host.idle', ref)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        ...ref,
        name: 'deepchat_echo',
        arguments: { text: 'first' },
        turnId: expect.any(String),
        callId: expect.any(String)
      })
      const history = await client.call<{
        events: import('@/agent/dim/sessionConnection').DimEvent[]
      }>('deepchat.storage.history', { ...ref, limit: 100 })
      let projected: DimSessionBinding = {
        sessionId: 'desktop',
        dimSessionId: sessionId,
        branchId: 'main',
        generation: 1,
        cursor: '0',
        nextOrderSeq: 1,
        activeTurnId: null,
        assistantMessageId: null,
        status: 'idle'
      }
      const transcript = new Map<string, ChatMessageRecord>()
      for (const event of history.events) {
        const update = projectDimEvent(projected, event, (id) => transcript.get(id) ?? null)
        for (const message of update.messages) transcript.set(message.id, message)
        projected = update.binding
      }
      expect(JSON.parse([...transcript.values()][1].content)).toContainEqual(
        expect.objectContaining({
          type: 'tool_call',
          status: 'success',
          tool_call: expect.objectContaining({
            name: 'deepchat_echo',
            response: expect.stringContaining('product: first')
          })
        })
      )
      version = 'two'
      names = ['deepchat_changed', 'deepchat_hold']
      expect(await client.call('session.deepchat_tools.refresh', ref)).toEqual({
        version,
        count: 2
      })
      await send('tool:deepchat_changed {"text":"second"}')
      await client.call('deepchat.host.idle', ref)
      expect(calls.at(-1)?.name).toBe('deepchat_changed')
      await send('tool:deepchat_hold {}')
      await expect.poll(() => calls.at(-1)?.name).toBe('deepchat_hold')
      await client.call('deepchat.host.stop', ref)
      await client.call('deepchat.host.idle', ref)
      await expect.poll(() => cancelled).toBe(true)
      await host.stop()
      const restored = await host.start()
      await restored.call('deepchat.host.input', {
        ...ref,
        mode: 'queue',
        submissionId: randomUUID(),
        rawBlocks: [],
        content: [{ type: 'text', text: 'tool:deepchat_changed {"text":"restored"}' }]
      })
      await restored.call('deepchat.host.idle', ref)
      expect(calls.at(-1)).toMatchObject({
        name: 'deepchat_changed',
        arguments: { text: 'restored' }
      })
    } finally {
      await host.stop()
      await gateway.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'durably admits an input once and restores the native binding and transcript after restart',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-durable-'))
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      profile: 'mock'
    })
    let db = dimDatabase(path.join(profile, 'desktop.sqlite'))
    const errors: unknown[] = []
    const open = () =>
      new DimSessionRuntime({
        database: db.data,
        host,
        launch: async () => ({ cwd: profile }),
        projected: () => {},
        failed: (_, error) => errors.push(error)
      })
    let runtime = open()
    try {
      const content = [{ type: 'text', text: 'durable once' }]
      const receipt = await runtime.submit('desktop', content, { submissionId: 'stable-input' })
      await runtime.waitIdle('desktop')
      const identity = db.data.dimSessionBindingsTable.get('desktop')!.dimSessionId
      expect(db.data.deepchatMessagesTable.getBySession('desktop')).toHaveLength(2)
      await runtime.stop()
      db.sqlite.close()
      db = dimDatabase(path.join(profile, 'desktop.sqlite'))
      runtime = open()
      expect(await runtime.submit('desktop', content, { submissionId: 'stable-input' })).toEqual(
        receipt
      )
      await runtime.waitIdle('desktop')
      expect(db.data.dimSessionBindingsTable.get('desktop')!.dimSessionId).toBe(identity)
      expect(db.data.deepchatMessagesTable.getBySession('desktop')).toHaveLength(2)
      await expect(
        runtime.submit('desktop', [{ type: 'text', text: 'conflict' }], {
          submissionId: 'stable-input'
        })
      ).rejects.toThrow('already bound')
      await runtime.submit('desktop', [{ type: 'text', text: 'next turn' }])
      await runtime.waitIdle('desktop')
      expect(db.data.deepchatMessagesTable.getBySession('desktop')).toHaveLength(4)
      expect(errors).toEqual([])
    } finally {
      await runtime.stop()
      db.sqlite.close()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'boots the production profile with its injected plugins without an account login',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-product-'))
    const runtime = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      )
    })
    try {
      const client = await runtime.start()
      expect(await client.call('deepchat.host.capabilities')).toMatchObject({
        plugin: 'deepchat-host',
        apiVersion: 1
      })
      expect(await client.call('deepchat.storage.capabilities')).toMatchObject({
        plugin: 'deepchat-storage',
        apiVersion: 1
      })
    } finally {
      await runtime.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'projects live native messages and resumes the same cursor after reader and host restart',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-conversation-'))
    const runtime = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      profile: 'mock'
    })
    let reader: DimSessionConnection | undefined
    try {
      let client = await runtime.start()
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile
      })
      let binding: DimSessionBinding = {
        sessionId: 'desktop-session',
        dimSessionId: sessionId,
        branchId: 'main',
        generation: 1,
        cursor: '0',
        nextOrderSeq: 1,
        activeTurnId: null,
        assistantMessageId: null,
        status: 'idle'
      }
      const messages = new Map<string, ChatMessageRecord>()
      const failures: unknown[] = []
      let failOnce = false
      const consume = (event: import('@/agent/dim/sessionConnection').DimEvent) => {
        if (failOnce && event.type === 'input' && event.name === 'message') {
          failOnce = false
          throw new Error('projection temporarily unavailable')
        }
        const projection = projectDimEvent(binding, event, (id) => messages.get(id) ?? null)
        for (const message of projection.messages) messages.set(message.id, message)
        binding = projection.binding
      }
      const openReader = async () => {
        reader = new DimSessionConnection(
          client,
          { sessionId, branchId: 'main' },
          consume,
          (error) => failures.push(error),
          binding.cursor
        )
        await reader.start()
        return reader
      }
      await openReader()
      await reader!.send('first turn')
      await reader!.waitIdle()
      expect([...messages.values()].map((message) => message.role)).toEqual(['user', 'assistant'])
      expect(JSON.parse([...messages.values()][1].content)).toMatchObject([
        { type: 'content', content: 'Echo: first turn', status: 'success' }
      ])
      expect(binding.status).toBe('idle')
      await reader!.close()
      await runtime.stop()
      client = await runtime.start()
      await openReader()
      expect(messages.size).toBe(2)
      await reader!.send('second turn')
      await reader!.waitIdle()
      expect(messages.size).toBe(4)
      expect(failures).toEqual([])
      failOnce = true
      const submissionId = randomUUID()
      await reader!.send('third turn', { submissionId })
      await client.call('deepchat.host.idle', { sessionId, branchId: 'main' })
      await expect.poll(() => failures.length).toBe(1)
      expect(await reader!.lookup(submissionId)).toMatchObject({ status: 'accepted' })
      await reader!.close()
      await openReader()
      await reader!.waitIdle()
      expect(messages.size).toBe(6)
      expect(binding.status).toBe('idle')
    } finally {
      await reader?.close()
      await runtime.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)
