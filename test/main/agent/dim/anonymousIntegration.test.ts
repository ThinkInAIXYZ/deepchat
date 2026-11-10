import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ModelConfig } from '@shared/types/provider'
import type { ProviderSettingsPort } from '@/provider/settings'
import { DimAuxiliaryModels } from '@/agent/dim/auxiliaryModels'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimModelCatalog } from '@/agent/dim/modelCatalog'
import { DimProductGateway } from '@/agent/dim/productGateway'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { dimDatabase } from './fixtures/database'

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1').each([
  { apiType: 'ollama', apiKey: '' },
  { apiType: 'openai-completions', apiKey: '' },
  { apiType: 'ollama', apiKey: 'ollama-cloud-key' }
])(
  'reauthorizes cached $apiType connections with key=$apiKey without leaking product admission',
  async ({ apiType, apiKey }) => {
    let calls = 0
    let grants = 0
    let apiKeyLookups = 0
    let modelEnabled = true
    const fixture = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      calls++
      expect(request.url).toBe('/v1/chat/completions')
      expect(request.headers.authorization).toBe(
        body.includes('DRAFT_MODEL_TEST')
          ? 'Bearer draft-only-key'
          : apiKey
            ? `Bearer ${apiKey}`
            : undefined
      )
      expect(JSON.stringify({ headers: request.headers, body })).not.toContain(
        'deepchat-admission-v1'
      )
      response
        .writeHead(200, { 'Content-Type': 'text/event-stream' })
        .end(
          `data: ${JSON.stringify({ id: 'local', object: 'chat.completion.chunk', created: 0, model: 'local', choices: [{ index: 0, delta: { content: 'anonymous native answer' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
        )
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-anonymous-'))
    const database = dimDatabase()
    const provider = {
      id: 'local-fixture',
      name: 'Local',
      apiType,
      apiKey,
      enable: true,
      baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`
    }
    let catalog!: DimModelCatalog
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version: 'none',
        tools: [],
        execute: async () => {
          throw new Error('No product tools')
        }
      }),
      credential: async (id, reference, signal) => {
        grants++
        return catalog.credential(id, reference, signal)
      }
    })
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      nativePlugins: true,
      gatewayAddress: await gateway.start()
    })
    const bridge = new DimModelBridge(host)
    catalog = new DimModelCatalog({
      settings: {
        getProviderById: () => provider,
        getModelStatus: () => modelEnabled,
        getModelConfig: () =>
          ({
            contextLength: 8192,
            maxTokens: 1024,
            functionCall: false,
            vision: false,
            reasoning: false
          }) as ModelConfig,
        getProviderModelRouteMetadata: () => undefined,
        getCapabilitySnapshot: () =>
          ({
            supportsAudioInput: false,
            supportsReasoning: false,
            reasoningPortrait: null
          }) as ReturnType<ProviderSettingsPort['getCapabilitySnapshot']>
      },
      models: bridge,
      grants: database.data.dimProviderGrantsTable,
      credential: async (current) => {
        apiKeyLookups++
        if (!current.apiKey) throw new Error('Local connection has no API key')
        return current.apiKey
      }
    })
    try {
      const model = await catalog.admit(provider.id, 'local')
      // Bypass subsequent TS admission deliberately: an already configured native
      // connection must still consult the current desktop owner on every request.
      const complete = () =>
        bridge.complete(
          model,
          { messages: [{ role: 'user', content: [{ type: 'text', text: 'local input' }] }] },
          undefined,
          {}
        )
      const streamed = []
      for await (const event of bridge.stream(model, {
        messages: [{ role: 'user', content: 'local input' }]
      }))
        streamed.push(event)
      expect(
        streamed
          .filter((event) => event.type === 'text')
          .map((event) => event.content)
          .join('')
      ).toBe('anonymous native answer')
      expect(streamed.at(-1)).toEqual({ type: 'stop', stop_reason: 'complete' })
      expect(calls).toBe(1)
      provider.enable = false
      await expect(complete()).rejects.toThrow()
      provider.enable = true
      modelEnabled = false
      await expect(complete()).rejects.toThrow()
      modelEnabled = true
      const originalUrl = provider.baseUrl
      provider.baseUrl += '/replaced'
      await expect(complete()).rejects.toThrow()
      expect(calls).toBe(1)
      provider.baseUrl = originalUrl
      const previous = await host.start()
      if (apiType === 'ollama' && !apiKey) {
        const active = await host.openConnection()
        let accessedProfile = false
        await expect(
          host.withStopped(
            async () => {
              accessedProfile = true
            },
            { ifIdle: true }
          )
        ).rejects.toMatchObject({ data: { appError: 'daemon_busy' } })
        expect(accessedProfile).toBe(false)
        expect(await active.call('deepchat.native.capabilities')).toMatchObject({
          plugin: 'deepchat-native'
        })
        active.close()
      }
      await expect
        .poll(
          async () => (await previous.call<{ connections: number }>('daemon.ping')).connections,
          { timeout: 5_000 }
        )
        .toBe(1)
      let queuedStart!: ReturnType<DimRuntimeSupervisor['start']>
      let restarted = false
      await host.withStopped(
        async () => {
          queuedStart = host.start().then((client) => {
            restarted = true
            return client
          })
          await expect(previous.call('deepchat.native.capabilities')).rejects.toThrow(
            'disconnected'
          )
          await readdir(path.join(profile, 'dim', 'rust'))
          expect(restarted).toBe(false)
        },
        { ifIdle: true }
      )
      await queuedStart
      expect(restarted).toBe(true)
      expect((await complete()).text).toBe('anonymous native answer')
      expect(calls).toBe(2)
      expect(grants).toBeGreaterThanOrEqual(5)
      expect(apiKeyLookups).toBe(apiKey ? 2 : 0)
      const client = await host.start()
      const before = await client.call<{ providers: Array<{ providerId: string }> }>(
        'provider.management',
        {}
      )
      await expect(
        new DimAuxiliaryModels({ models: catalog, bridge }).completeDraft(
          { ...provider, apiKey: 'draft-only-key' },
          'local',
          'DRAFT_MODEL_TEST'
        )
      ).resolves.toMatchObject({ text: 'anonymous native answer' })
      const after = await client.call<{ providers: Array<{ providerId: string }> }>(
        'provider.management',
        {}
      )
      expect(after.providers.map((item) => item.providerId).sort()).toEqual(
        before.providers.map((item) => item.providerId).sort()
      )
      expect(provider.apiKey).toBe(apiKey)
      expect(provider.enable).toBe(true)
      if (apiType === 'ollama' && !apiKey) {
        const id = randomUUID()
        // Simulate an exit after owner creation, before the caller can release its draft.
        const orphan = await client.call<{ providerId: string }>('deepchat.model.configure', {
          key: `deepchat/draft/v1/${id}/interrupted`,
          displayName: `DeepChat draft validation ${id}`,
          connection: {
            driverKind: 'openai-compatible',
            baseUrl: provider.baseUrl,
            auth: { type: 'anonymous' },
            credential: { action: 'set_ref', reference: 'revoked-orphan-draft' }
          },
          model: {
            modelId: 'orphan',
            displayName: 'Orphan',
            status: 'active',
            capabilities: {
              modalities: ['text'],
              toolCalling: false,
              streaming: true,
              structuredOutput: false,
              vision: false,
              audio: false,
              reasoning: false,
              contextWindow: 8192,
              maxOutputTokens: 1024
            },
            metadata: {
              metadataSource: 'deepchat',
              raw: { deepchatDraftId: id },
              reasoning: { supported: false }
            }
          }
        })
        await host.stop()
        await catalog.admit(provider.id, 'local')
        const restored = await (
          await host.start()
        )
          .call<{ providers: Array<{ providerId: string }> }>('provider.management', {
            providerId: orphan.providerId
          })
          .catch(() => ({ providers: [] }))
        expect(restored.providers.some((item) => item.providerId === orphan.providerId)).toBe(false)
      }
      await host.stop()
      for (const name of await readdir(path.join(profile, 'dim', 'rust'), { recursive: true })) {
        const file = path.join(profile, 'dim', 'rust', name)
        if ((await stat(file)).isFile())
          expect((await readFile(file)).includes(Buffer.from('draft-only-key')), file).toBe(false)
      }
    } finally {
      await host.stop()
      await gateway.stop()
      database.sqlite.close()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)
