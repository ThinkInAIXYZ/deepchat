import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ModelType } from '@shared/model'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import type { ProviderSettingsPort } from '@/provider/settings'
import type { JevQuestion } from '@shared/jevProtocol'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimModelCatalog } from '@/agent/dim/modelCatalog'
import { DimDecisions } from '@/agent/dim/decisions'
import { DimProductGateway } from '@/agent/dim/productGateway'
import { dimDatabase } from './fixtures/database'

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'runs native Jev decisions and Workers AI envelopes with rotated credentials, validation, retries and cancellation',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-decisions-'))
    const database = dimDatabase(path.join(profile, 'desktop.sqlite'))
    const requests: Array<{ url: string; body: Record<string, unknown>; authorization?: string }> =
      []
    let hold = false
    let cancelled = false
    let malformed = false
    let transient = false
    const questions: Record<string, JevQuestion> = {
      action: { type: 'choice', instructions: 'Choose', criteria: { keep: 'Keep', drop: 'Drop' } },
      quality: { type: 'score', instructions: 'Rate', criteria: ['low', 'high'] },
      accepted: { type: 'noul', instructions: 'Accept?' }
    }
    const answers = {
      action: {
        type: 'choice',
        choice: 'keep',
        confidence: 0.8,
        probabilities: { keep: 0.8, drop: 0.2 }
      },
      quality: {
        type: 'score',
        score: 0.5,
        confidence: 0.6,
        legend: { '0': 'low', '1': 'high' },
        probabilities: { '0': 0.5, '1': 0.5 }
      },
      accepted: { type: 'noul', noul: 0.9 }
    }
    const fixture = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push({ url: request.url!, body, authorization: request.headers.authorization })
      if (hold) {
        response.once('close', () => {
          if (!response.writableFinished) cancelled = true
        })
        return
      }
      if (transient) {
        transient = false
        response.writeHead(503, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'retry fixture' } }))
        return
      }
      const result = {
        model: 'jev-1.13.0',
        answers: malformed ? { ...answers, unrequested: { type: 'noul', noul: 0.5 } } : answers,
        ...(request.url === '/systemone' ? { usage: { input_tokens: 3, output_tokens: 2 } } : {})
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify(request.url === '/systemone' ? result : { success: true, result })
      )
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`
    const providers: LLM_PROVIDER[] = [
      {
        id: 'custom-jev',
        apiType: 'jev',
        name: 'Jev fixture',
        baseUrl: `${base}/systemone`,
        apiKey: 'first',
        enable: true
      },
      {
        id: 'custom-workers',
        apiType: 'workers-ai',
        name: 'Workers fixture',
        baseUrl: `${base}/accounts/test/ai/v1`,
        apiKey: 'worker',
        enable: true
      }
    ]
    let catalog!: DimModelCatalog
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version: 'empty',
        tools: [],
        execute: async () => {
          throw new Error('No product tools')
        }
      }),
      credential: (id, reference, signal) => catalog.credential(id, reference, signal)
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
        getProviderById: (id) => providers.find((provider) => provider.id === id),
        getModelStatus: () => true,
        getModelConfig: () =>
          ({
            type: ModelType.Judgment,
            contextLength: 64000,
            maxTokens: 1024,
            functionCall: false,
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
      credential: async (provider) => provider.apiKey
    })
    const decisions = new DimDecisions({ models: catalog, bridge })
    const input = { state: { evidence: ['native decision fixture'] }, questions }
    try {
      const judgment = await catalog.admit('custom-jev', 'jev-latest')
      await expect(
        (await host.start()).call('deepchat.host.launch', { cwd: profile, model: { ...judgment } })
      ).rejects.toThrow()
      expect(requests).toHaveLength(0)
      expect(await decisions.runJudgment('custom-jev', 'jev-latest', input)).toEqual({
        model: 'jev-1.13.0',
        answers,
        usage: { input_tokens: 3, output_tokens: 2 }
      })
      expect(requests[0]).toMatchObject({
        url: '/systemone',
        authorization: 'Bearer first',
        body: { ...input, model: 'jev-latest' }
      })
      providers[0].apiKey = 'rotated'
      const native = await catalog.admit('custom-jev', 'jev-latest')
      await bridge.decide(native, input)
      expect(requests.at(-1)?.authorization).toBe('Bearer rotated')
      expect(await decisions.runJudgment('custom-workers', 'typesafe/jev', input)).toMatchObject({
        model: 'jev-1.13.0',
        answers
      })
      expect(requests.at(-1)).toMatchObject({
        url: '/accounts/test/ai/run',
        authorization: 'Bearer worker',
        body: { model: 'typesafe/jev', input }
      })
      const beforeRetry = requests.length
      transient = true
      await decisions.runJudgment('custom-jev', 'jev-latest', input)
      expect(requests).toHaveLength(beforeRetry + 2)
      malformed = true
      const beforeInvalid = requests.length
      await expect(decisions.runJudgment('custom-jev', 'jev-latest', input)).rejects.toThrow(
        'Native decision request failed'
      )
      expect(requests).toHaveLength(beforeInvalid + 1)
      malformed = false
      providers[0].enable = false
      const beforeDisabled = requests.length
      await expect(bridge.decide(native, input)).rejects.toThrow('Native decision request failed')
      expect(requests).toHaveLength(beforeDisabled)
      providers[0].enable = true
      hold = true
      const controller = new AbortController()
      const pending = decisions.runJudgment('custom-jev', 'jev-latest', input, {
        signal: controller.signal
      })
      const stopped = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await expect.poll(() => requests.length).toBe(beforeDisabled + 1)
      controller.abort()
      await stopped
      await expect.poll(() => cancelled).toBe(true)
      hold = false
      await host.stop()
      expect(await decisions.runJudgment('custom-jev', 'jev-latest', input)).toMatchObject({
        model: 'jev-1.13.0',
        answers
      })
    } finally {
      await host.stop()
      await gateway.stop()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      database.sqlite.close()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)
