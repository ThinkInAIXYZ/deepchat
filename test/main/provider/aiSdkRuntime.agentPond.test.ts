import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-node'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, expect, it, vi } from 'vitest'

const { createSpanExporter, createProviderContext } = vi.hoisted(() => ({
  createSpanExporter: vi.fn(),
  createProviderContext: vi.fn()
}))

vi.mock('@agentpond/files-sdk/otel', () => ({
  createFilesSpanExporterFromRuntimeEnv: createSpanExporter
}))

vi.mock('@/provider/aiSdk/providerFactory', () => ({
  createAiSdkProviderContext: createProviderContext,
  normalizeGeminiBaseUrl: vi.fn()
}))

const tracingStateKey = Symbol.for('deepchat.agentpond-tracing')
let temporaryRoot: string | undefined

afterEach(async () => {
  const tracingState = (
    globalThis as Record<symbol, { provider?: { shutdown(): Promise<void> } } | undefined>
  )[tracingStateKey]
  await tracingState?.provider?.shutdown()
  delete (globalThis as Record<symbol, unknown>)[tracingStateKey]
  vi.unstubAllEnvs()
  vi.resetModules()
  createSpanExporter.mockReset()
  createProviderContext.mockReset()

  if (temporaryRoot) {
    await rm(temporaryRoot, { force: true, recursive: true })
    temporaryRoot = undefined
  }
})

it('exports content-free spans from the generateText runtime path', async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'deepchat-agentpond-'))
  vi.stubEnv('FILES_SDK_PROVIDER', 'fs')
  vi.stubEnv('FILES_SDK_ROOT', temporaryRoot)

  const exporter = new InMemorySpanExporter()
  createSpanExporter.mockReturnValue(exporter)
  createProviderContext.mockReturnValue({
    apiType: 'openai_chat',
    endpoint: 'https://fixture.invalid/v1/chat/completions',
    model: new MockLanguageModelV3({
      provider: 'deepchat-agentpond-test',
      modelId: 'fixture-model',
      doGenerate: {
        content: [{ type: 'text', text: 'PRIVATE_RESPONSE_SENTINEL' }],
        finishReason: { raw: 'stop', unified: 'stop' },
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 7, total: 7 },
          outputTokens: { reasoning: 0, text: 4, total: 4 }
        },
        warnings: []
      }
    }),
    providerOptionsKey: 'openaiCompatible',
    resolvedModelId: 'fixture-model'
  })

  const { runAiSdkGenerateText } = await import('@/provider/aiSdk/runtime')
  const { flushAgentPondTracing } = await import('@/provider/aiSdk/agentPondTracing')
  const result = await runAiSdkGenerateText(
    {
      defaultHeaders: {},
      provider: { apiType: 'openai-compatible', id: 'openai' },
      providerKind: 'openai-compatible',
      providerSettings: {}
    } as any,
    [{ role: 'user', content: 'PRIVATE_PROMPT_SENTINEL' }],
    'fixture-model',
    { apiEndpoint: 'chat' } as any
  )

  expect(result.content).toBe('PRIVATE_RESPONSE_SENTINEL')
  await flushAgentPondTracing()

  const spans = exporter.getFinishedSpans()
  expect(spans.length).toBeGreaterThan(0)

  const modelSpan = spans.find((span) => span.attributes['openinference.span.kind'] === 'LLM')
  expect(modelSpan?.attributes).toMatchObject({
    'llm.token_count.completion': 4,
    'llm.token_count.prompt': 7,
    'llm.token_count.total': 11
  })
  expect(modelSpan?.startTime).toHaveLength(2)
  expect(modelSpan?.endTime).toHaveLength(2)
  expect(modelSpan?.duration).toHaveLength(2)
  const toNanoseconds = ([seconds, nanoseconds]: [number, number]): bigint =>
    BigInt(seconds) * 1_000_000_000n + BigInt(nanoseconds)
  expect(toNanoseconds(modelSpan!.endTime) - toNanoseconds(modelSpan!.startTime)).toBe(
    toNanoseconds(modelSpan!.duration)
  )

  const exported = JSON.stringify(
    spans.map((span) => ({
      attributes: span.attributes,
      events: span.events,
      name: span.name
    }))
  )
  expect(exported).toContain('fixture-model')
  expect(exported).not.toContain('PRIVATE_PROMPT_SENTINEL')
  expect(exported).not.toContain('PRIVATE_RESPONSE_SENTINEL')
})
