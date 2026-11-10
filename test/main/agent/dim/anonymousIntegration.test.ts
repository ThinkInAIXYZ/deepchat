import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ModelConfig } from '@shared/types/provider'
import type { ProviderSettingsPort } from '@/provider/settings'
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
      expect(request.headers.authorization).toBe(apiKey ? `Bearer ${apiKey}` : undefined)
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
      credential: async () => {
        apiKeyLookups++
        if (!apiKey) throw new Error('Local connection has no API key')
        return apiKey
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
      await host.stop()
      expect((await complete()).text).toBe('anonymous native answer')
      expect(calls).toBe(2)
      expect(grants).toBeGreaterThanOrEqual(5)
      expect(apiKeyLookups).toBe(apiKey ? 2 : 0)
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
