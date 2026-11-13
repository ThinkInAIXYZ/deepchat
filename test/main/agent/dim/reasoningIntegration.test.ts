import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ReasoningPortrait } from '@shared/types/model-db'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { dimModelParameters } from '@/agent/dim/modelCatalog'
import { DimProductGateway } from '@/agent/dim/productGateway'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'sends Anthropic manual/adaptive and Gemini budget/effort reasoning through native HTTP',
  async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fixtureErrors: unknown[] = []
    const fixture = createServer(async (request, response) => {
      try {
        let body = ''
        for await (const chunk of request) body += chunk
        requests.push({ url: request.url!, body: JSON.parse(body) })
      } catch (error) {
        fixtureErrors.push(error)
      }
      // A non-retryable failure is sufficient: assertions inspect the real native wire body.
      response.writeHead(400, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          error: { type: 'invalid_request_error', message: 'Local fixture only' }
        })
      )
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-reasoning-'))
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version: 'empty',
        tools: [],
        execute: async () => {
          throw new Error('No product tools')
        }
      })
    })
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve(process.env.DEEPCHAT_DIM_TEST_RUNTIME_ROOT ?? 'runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      nativePlugins: true,
      gatewayAddress: await gateway.start()
    })
    const bridge = new DimModelBridge(host)
    const scenarios: Array<{
      providerKind: string
      modelId: string
      reasoningPortrait: ReasoningPortrait
      thinkingBudget?: number
      reasoningEffort?: 'high' | 'none'
      expected: Record<string, unknown>
    }> = [
      {
        providerKind: 'anthropic',
        modelId: 'claude-opus-4-5',
        reasoningPortrait: { mode: 'mixed', budget: { min: 1024 }, effort: 'high' },
        thinkingBudget: 2048,
        reasoningEffort: 'high',
        expected: {
          thinking: { type: 'enabled', budget_tokens: 2048 },
          output_config: { effort: 'high' }
        }
      },
      {
        providerKind: 'anthropic',
        modelId: 'claude-opus-4-7',
        reasoningPortrait: {
          mode: 'effort',
          defaultEnabled: false,
          effort: 'high',
          effortOptions: ['low', 'medium', 'high', 'xhigh', 'max']
        },
        reasoningEffort: 'high',
        expected: { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }
      },
      {
        providerKind: 'anthropic',
        modelId: 'claude-fable-5',
        reasoningPortrait: {
          mode: 'effort',
          defaultEnabled: true,
          effort: 'high',
          effortOptions: ['low', 'medium', 'high', 'xhigh', 'max']
        },
        thinkingBudget: 2048,
        reasoningEffort: 'none',
        expected: { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }
      },
      {
        providerKind: 'gemini',
        modelId: 'gemini-2.5-flash',
        reasoningPortrait: { mode: 'budget', budget: { min: 0 } },
        thinkingBudget: 2048,
        expected: { generationConfig: { thinkingConfig: { thinkingBudget: 2048 } } }
      },
      {
        providerKind: 'gemini',
        modelId: 'gemini-3-pro-preview',
        reasoningPortrait: { mode: 'effort', effort: 'high' },
        // A stale budget must not survive effort selection in the final provider body.
        thinkingBudget: 2048,
        reasoningEffort: 'high',
        expected: { generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } }
      }
    ]
    try {
      for (const scenario of scenarios) {
        const { providerKind, modelId, reasoningPortrait } = scenario
        const model = await bridge.configure({
          key: `reasoning-fixture/${modelId}`,
          displayName: 'Local reasoning fixture',
          connection: {
            driverKind: providerKind,
            baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`,
            auth: { type: 'anonymous' }
          },
          model: {
            modelId,
            displayName: modelId,
            status: 'active',
            capabilities: {
              modalities: ['text'],
              toolCalling: false,
              streaming: true,
              structuredOutput: false,
              vision: false,
              audio: false,
              reasoning: true,
              contextWindow: 32768,
              maxOutputTokens: 8192
            }
          }
        })
        const parameters = dimModelParameters(
          {
            temperature: 1,
            maxTokens: 8192,
            thinkingBudget: scenario.thinkingBudget,
            reasoningEffort: scenario.reasoningEffort
          },
          { providerKind, modelId, reasoningPortrait }
        )
        const before = requests.length
        await expect(
          bridge.complete(
            model,
            { messages: [{ role: 'user', content: 'Local reasoning fixture' }] },
            undefined,
            parameters
          )
        ).rejects.toThrow()
        expect(fixtureErrors).toEqual([])
        expect(requests).toHaveLength(before + 1)
        const captured = requests[before]
        expect(captured.url).toMatch(
          providerKind === 'anthropic'
            ? /\/messages$/
            : /:(?:streamGenerateContent|generateContent)(?:\?|$)/
        )
        expect(captured.body).toMatchObject(scenario.expected)
        if (providerKind === 'anthropic' && reasoningPortrait.mode === 'effort') {
          expect(captured.body.thinking).not.toHaveProperty('budget_tokens')
        }
        if (providerKind === 'gemini') {
          const config = captured.body.generationConfig as { thinkingConfig: object }
          expect(config.thinkingConfig).not.toHaveProperty(
            scenario.reasoningEffort ? 'thinkingBudget' : 'thinkingLevel'
          )
        }
      }
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
