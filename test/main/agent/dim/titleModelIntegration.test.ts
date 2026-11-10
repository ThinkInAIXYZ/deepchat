import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimModelBridge, type DimModelId } from '@/agent/dim/modelBridge'
import { DimProductGateway } from '@/agent/dim/productGateway'

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'uses each Session title model preference while keeping conversation inference and restart native',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-title-model-'))
    const calls: Array<{ model: string; title: boolean }> = []
    const preferences = new Map<string, DimModelId | null>()
    let blocked: string | null = null
    let preferenceStarted = false
    let preferenceCancelled = false
    const fixture = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const title = JSON.stringify(body.messages).includes(
        'Write a short title for this conversation:'
      )
      calls.push({ model: body.model, title })
      const text = title
        ? body.model === 'assistant-title'
          ? 'Preferred model title'
          : 'Current model title'
        : 'Conversation reply'
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'title-model', object: 'chat.completion.chunk', model: body.model, created: 0, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version: 'empty',
        tools: [],
        execute: async () => {
          throw new Error('No product tools')
        }
      }),
      titleModel: async (id, signal) => {
        signal.throwIfAborted()
        if (id === blocked) {
          preferenceStarted = true
          return new Promise<DimModelId | null>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                preferenceCancelled = true
                reject(new Error('Native title preference cancelled'))
              },
              { once: true }
            )
          })
        }
        if (!preferences.has(id)) throw new Error('Unknown native title owner')
        return preferences.get(id)!
      }
    })
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nativePlugins: true,
      gatewayAddress: await gateway.start(),
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      )
    })
    try {
      const bridge = new DimModelBridge(host)
      const configure = (modelId: string) =>
        bridge.configure({
          key: `title-model-${modelId}`,
          displayName: modelId,
          connection: {
            driverKind: 'openai-compatible',
            auth: { type: 'anonymous' },
            baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`
          },
          model: {
            modelId,
            displayName: modelId,
            status: 'active',
            capabilities: {
              modalities: ['text'],
              toolCalling: false,
              streaming: true,
              structuredOutput: true,
              vision: false,
              audio: false,
              reasoning: false,
              contextWindow: 8192,
              maxOutputTokens: 1024
            }
          }
        })
      const conversation = await configure('main-chat')
      const helper = await configure('assistant-title')
      const client = await host.start()
      const ids: string[] = []
      for (const preference of [helper, null]) {
        const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
          model: { ...conversation },
          cwd: profile,
          tools: []
        })
        ids.push(sessionId)
        preferences.set(sessionId, preference)
        await client.call('deepchat.host.input', {
          sessionId,
          branchId: 'main',
          mode: 'queue',
          submissionId: `title-${ids.length}`,
          rawBlocks: [],
          content: [{ type: 'text', text: 'Use this conversation title fixture' }]
        })
        await client.call('deepchat.host.idle', { sessionId, branchId: 'main' })
        await expect
          .poll(
            async () =>
              (
                await client.call<{ title: { text: string } | null }>('deepchat.storage.scope', {
                  sessionId
                })
              ).title?.text
          )
          .toBe(preference ? 'Preferred model title' : 'Current model title')
      }
      expect(
        calls
          .filter((call) => call.title)
          .map((call) => call.model)
          .sort()
      ).toEqual(['assistant-title', 'main-chat'])
      expect(calls.filter((call) => !call.title).map((call) => call.model)).toEqual([
        'main-chat',
        'main-chat'
      ])
      const waiting = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        model: { ...conversation },
        cwd: profile,
        tools: []
      })
      blocked = waiting.sessionId
      await client.call('deepchat.host.input', {
        sessionId: blocked,
        branchId: 'main',
        mode: 'queue',
        submissionId: 'blocked-preference',
        rawBlocks: [],
        content: [{ type: 'text', text: 'Hold the title preference request' }]
      })
      await client.call('deepchat.host.idle', { sessionId: blocked, branchId: 'main' })
      await expect.poll(() => preferenceStarted).toBe(true)
      await expect(host.stop({ ifIdle: true })).rejects.toMatchObject({
        data: { appError: 'daemon_busy' }
      })
      expect(preferenceCancelled).toBe(false)
      await host.stop()
      await expect.poll(() => preferenceCancelled).toBe(true)
      const before = calls.length
      const reopened = await host.start()
      expect(
        (
          await reopened.call<{ title: { text: string } }>('deepchat.storage.scope', {
            sessionId: ids[0]
          })
        ).title.text
      ).toBe('Preferred model title')
      expect(calls).toHaveLength(before)
    } finally {
      await host.stop()
      await gateway.stop()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)
