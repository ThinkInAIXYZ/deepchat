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
  'sends Anthropic, Gemini and Vertex reasoning settings through native HTTP',
  async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fixtureErrors: unknown[] = []
    const fixture = createServer(async (request, response) => {
      try {
        let body = ''
        for await (const chunk of request) body += chunk
        const payload = JSON.parse(body)
        requests.push({ url: request.url!, body: payload })
        if (request.url?.endsWith('/messages')) {
          const usage = { input_tokens: 8, output_tokens: 1 }
          const message = {
            id: 'msg_fixture',
            type: 'message',
            role: 'assistant',
            model: payload.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage
          }
          if (!payload.stream) {
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(
              JSON.stringify({
                ...message,
                content: [{ type: 'text', text: 'Fixture reply' }],
                stop_reason: 'end_turn'
              })
            )
            return
          }
          const events = [
            { type: 'message_start', message },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'Fixture reply' }
            },
            { type: 'content_block_stop', index: 0 },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage
            },
            { type: 'message_stop' }
          ]
          response
            .writeHead(200, { 'Content-Type': 'text/event-stream' })
            .end(
              events
                .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
                .join('')
            )
          return
        }
        if (request.url?.match(/:(?:streamGenerateContent|generateContent)(?:\?|$)/)) {
          const data = {
            candidates: [
              {
                content: { role: 'model', parts: [{ text: 'Fixture reply' }] },
                finishReason: 'STOP'
              }
            ],
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 1, totalTokenCount: 9 }
          }
          const streaming = request.url.includes(':streamGenerateContent')
          response
            .writeHead(200, {
              'Content-Type': streaming ? 'text/event-stream' : 'application/json'
            })
            .end(streaming ? `data: ${JSON.stringify(data)}\n\n` : JSON.stringify(data))
          return
        }
      } catch (error) {
        fixtureErrors.push(error)
      }
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
      reasoningEffort?: 'high' | 'none' | 'xhigh'
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
        providerKind: 'anthropic',
        modelId: 'MiniMax-M3',
        reasoningPortrait: { mode: 'effort', defaultEnabled: true },
        expected: { thinking: { type: 'adaptive' } }
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
      },
      ...['gemini', 'vertex'].map((providerKind) => ({
        providerKind,
        modelId: 'gemini-4-hydrogen',
        reasoningPortrait: { mode: 'effort' as const },
        thinkingBudget: 2048,
        reasoningEffort: 'xhigh' as const,
        expected: { generationConfig: { thinkingConfig: { thinkingLevel: 'xhigh' } } }
      }))
    ]
    try {
      for (const scenario of scenarios) {
        const { providerKind, modelId, reasoningPortrait } = scenario
        const vertex = providerKind === 'vertex'
        const model = await bridge.configure({
          key: `reasoning-fixture/${providerKind}/${modelId}`,
          displayName: 'Local reasoning fixture',
          connection: {
            driverKind: vertex ? 'gemini' : providerKind,
            baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1${vertex ? '/publishers/google' : ''}`,
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
            topP: 0.9,
            maxTokens: 8192,
            thinkingBudget: scenario.thinkingBudget,
            reasoningEffort: scenario.reasoningEffort
          },
          { providerKind, modelId, reasoningPortrait }
        )
        const before = requests.length
        const completion = bridge.complete(
          model,
          { messages: [{ role: 'user', content: 'Local reasoning fixture' }] },
          undefined,
          parameters
        )
        await expect(completion).resolves.toMatchObject({ text: 'Fixture reply' })
        expect(fixtureErrors).toEqual([])
        expect(requests).toHaveLength(before + 1)
        const captured = requests[before]
        expect(captured.url).toMatch(
          providerKind === 'anthropic'
            ? /\/messages$/
            : /:(?:streamGenerateContent|generateContent)(?:\?|$)/
        )
        expect(captured.body).toMatchObject(scenario.expected)
        if (providerKind === 'anthropic') {
          expect(captured.body).not.toHaveProperty('temperature')
          expect(captured.body).not.toHaveProperty('top_p')
        }
        if (providerKind === 'anthropic' && reasoningPortrait.mode === 'effort') {
          expect(captured.body.thinking).not.toHaveProperty('budget_tokens')
        }
        if (providerKind === 'gemini' || vertex) {
          if (vertex) expect(captured.url).toContain('/publishers/google/models/')
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
