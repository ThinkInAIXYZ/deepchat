import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ModelType } from '@shared/model'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import type { ProviderSettingsPort } from '@/provider/settings'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimModelCatalog } from '@/agent/dim/modelCatalog'
import { DimProviderCredentials } from '@/agent/dim/providerCredentials'
import { DimProductGateway } from '@/agent/dim/productGateway'
import { dimDatabase } from './fixtures/database'

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'uses native Codex wire semantics and credential recovery for product OAuth without moving its account into dim',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-codex-'))
    const database = dimDatabase(path.join(profile, 'desktop.sqlite'))
    const requests: Array<{
      body: Record<string, unknown>
      authorization?: string
      account?: string
    }> = []
    let credential = { accessToken: 'codex-first-secret', accountId: 'account-first' }
    let refreshes = 0
    let hold = false
    let cancelled = false
    let blockAuth = false
    let profileRequested = false
    let resumeProfile: (() => void) | undefined
    const owner = new DimProviderCredentials({
      codexAuth: () => ({
        getBackendAuth: async () => credential,
        forceRefreshBackendAuth: async (rejected) => {
          if (
            !rejected ||
            rejected === createHash('sha256').update(credential.accessToken).digest('hex')
          ) {
            refreshes++
            credential = { accessToken: 'codex-second-secret', accountId: 'account-second' }
          }
          return credential
        }
      })
    })
    const fixture = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push({
        body,
        authorization: request.headers.authorization,
        account: request.headers['chatgpt-account-id'] as string | undefined
      })
      expect(request.url).toBe('/backend-api/codex/responses')
      expect(request.headers.originator).toBe('codex_cli_rs')
      expect(request.headers.version).toBe('0.144.1')
      expect(body).toMatchObject({ stream: true, store: false })
      expect(body).not.toHaveProperty('max_output_tokens')
      if (request.headers.authorization === 'Bearer codex-first-secret') {
        response.writeHead(401, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'expired fixture credential' } }))
        return
      }
      const title = JSON.stringify(body).includes('Write a short title for this conversation:')
      const text = title ? 'Codex native title' : 'Native Codex reply'
      const frames = [
        {
          type: 'response.created',
          response: { id: 'response-native', model: 'codex-fixture', created_at: 1 }
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'message-native', role: 'assistant', content: [] }
        },
        {
          type: 'response.output_text.delta',
          item_id: 'message-native',
          output_index: 0,
          content_index: 0,
          delta: text
        }
      ]
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''))
      if (hold && !title) {
        response.once('close', () => {
          if (!response.writableFinished) cancelled = true
        })
        return
      }
      response.end(
        [
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              type: 'message',
              id: 'message-native',
              content: [{ type: 'output_text', text }]
            }
          },
          {
            type: 'response.completed',
            response: {
              id: 'response-native',
              status: 'completed',
              usage: { input_tokens: 3, output_tokens: 3 }
            }
          }
        ]
          .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
          .join('')
      )
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    const provider: LLM_PROVIDER = {
      id: 'openai',
      name: 'ChatGPT fixture',
      apiType: 'openai',
      apiKey: '',
      openaiAuthMode: 'chatgpt',
      enable: true,
      baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/backend-api/codex`
    }
    let catalog!: DimModelCatalog
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version: 'empty',
        tools: [],
        execute: async () => {
          throw new Error('No product tools')
        }
      }),
      credential: (id, reference, signal) => catalog.credential(id, reference, signal),
      connectionAuth: (id, modelId, rejected, signal) =>
        catalog.connectionAuth(id, modelId, rejected, signal)
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
    const bridge = new DimModelBridge(host)
    catalog = new DimModelCatalog({
      settings: {
        getProviderById: () => provider,
        getModelStatus: () => true,
        getModelConfig: () =>
          ({
            type: ModelType.Chat,
            contextLength: 32000,
            maxTokens: 1024,
            functionCall: true,
            vision: false,
            reasoning: false
          }) as ModelConfig,
        getProviderModelRouteMetadata: () => undefined,
        getCapabilitySnapshot: () =>
          ({ supportsAudioInput: false, supportsReasoning: false }) as ReturnType<
            ProviderSettingsPort['getCapabilitySnapshot']
          >
      },
      models: bridge,
      grants: database.data.dimProviderGrantsTable,
      credential: (provider, signal) => owner.resolve(provider, signal),
      connectionAuth: async (_provider, rejected, signal) => {
        const auth = await owner.codexConnection(signal, rejected)
        if (blockAuth) {
          profileRequested = true
          await new Promise<void>((resolve) => {
            resumeProfile = resolve
          })
        }
        return auth
      }
    })
    const input = {
      system: 'Codex native fixture instructions',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Codex fixture input' }] }]
    }
    try {
      const model = await catalog.admit('openai', 'codex-fixture')
      expect((await bridge.complete(model, input, undefined, { maxTokens: 17 })).text).toBe(
        'Native Codex reply'
      )
      expect(
        requests.slice(0, 2).map((request) => [request.authorization, request.account])
      ).toEqual([
        ['Bearer codex-first-secret', 'account-first'],
        ['Bearer codex-second-secret', 'account-second']
      ])
      expect(refreshes).toBe(1)
      expect(JSON.stringify(requests[1].body.input)).toContain('Codex native fixture instructions')
      const client = await host.start()
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        model: { ...model },
        tools: []
      })
      const send = async (
        client: Awaited<ReturnType<DimRuntimeSupervisor['start']>>,
        id: string
      ) => {
        await client.call('deepchat.host.input', {
          sessionId,
          branchId: 'main',
          mode: 'queue',
          submissionId: id,
          rawBlocks: [],
          content: [{ type: 'text', text: 'Native Codex agent input' }]
        })
        await client.call('deepchat.host.idle', { sessionId, branchId: 'main' })
      }
      await send(client, 'codex-agent-first')
      await expect
        .poll(
          async () =>
            (
              await client.call<{ title: { text: string } | null }>('deepchat.storage.scope', {
                sessionId
              })
            ).title?.text
        )
        .toBe('Codex native title')
      type History = { events: Array<{ type: string; name: string; data: unknown }> }
      const before = await client.call<History>('deepchat.storage.history', {
        sessionId,
        branchId: 'main',
        limit: 100
      })
      expect(before.events.length).toBeGreaterThan(0)
      expect(JSON.stringify(before)).not.toContain('codex-second-secret')
      await host.stop()
      const reopened = await host.start()
      const after = await reopened.call<History>('deepchat.storage.history', {
        sessionId,
        branchId: 'main',
        limit: 100
      })
      expect(after.events.slice(0, before.events.length)).toEqual(before.events)
      // Context usage can finish recovering before the shutdown interrupt is published.
      expect(
        after.events
          .slice(before.events.length)
          .filter(({ type, name }) => type !== 'context-usage' || name !== 'recovered')
      ).toEqual([
        expect.objectContaining({
          type: 'stop',
          name: 'interrupt',
          data: { reason: 'timeline closed', scope: 'branch' }
        })
      ])
      await send(reopened, 'codex-agent-second')
      expect(refreshes).toBe(1)
      blockAuth = true
      const beforeRevoked = requests.length
      const revoked = expect(bridge.complete(model, input)).rejects.toThrow()
      await expect.poll(() => profileRequested).toBe(true)
      provider.enable = false
      resumeProfile!()
      await revoked
      expect(requests).toHaveLength(beforeRevoked)
      provider.enable = true
      blockAuth = false
      hold = true
      const controller = new AbortController()
      const count = requests.length
      const pending = bridge.complete(model, input, controller.signal)
      const stopped = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await expect.poll(() => requests.length).toBe(count + 1)
      controller.abort()
      await stopped
      await expect.poll(() => cancelled).toBe(true)
      hold = false
      provider.enable = false
      const beforeDisabled = requests.length
      await expect(bridge.complete(model, input)).rejects.toThrow()
      expect(requests).toHaveLength(beforeDisabled)
      expect(refreshes).toBe(1)
    } finally {
      resumeProfile?.()
      await host.stop()
      await gateway.stop()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      database.sqlite.close()
      await rm(profile, { recursive: true, force: true })
    }
  },
  90_000
)
