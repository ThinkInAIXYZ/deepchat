import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

import { getReasoningEffortOptions, type ReasoningPortrait } from '@shared/types/model-db'
import { resolveModelRequestPolicy } from '@shared/modelRequestPolicy'
import { runAiSdkGenerateText } from '@/provider/aiSdk/runtime'

const providerSettings = {
  getAzureApiVersion: () => undefined
} as any

async function captureRequestBody(run: () => Promise<unknown>): Promise<Record<string, any>> {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: { message: 'request captured' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
  )
  vi.stubGlobal('fetch', fetchMock)

  await expect(run()).rejects.toThrow()
  expect(fetchMock).toHaveBeenCalledTimes(1)

  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
  expect(init?.body).toBeTypeOf('string')
  return JSON.parse(init?.body as string)
}

describe('AI SDK reasoning wire payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['kimi-k3', 'kimi-k3-free', 'coding-kimi-k3', 'coding-kimi-k3-free', 'kimi_k3'])(
    'emits K3 reasoning effort while omitting unsupported fields for %s',
    async (modelId) => {
      const body = await captureRequestBody(() =>
        runAiSdkGenerateText(
          {
            providerKind: 'openai-compatible',
            provider: {
              id: 'new-api',
              name: 'New API',
              apiType: 'new-api',
              apiKey: 'test-key',
              baseUrl: 'https://new-api.example.com/v1',
              enable: true
            } as any,
            capabilitySnapshot: {
              identity: {
                providerId: 'moonshot',
                requestModelId: modelId,
                catalogMatched: true,
                catalogModelId: 'kimi-k3'
              },
              requestPolicy: {
                temperature: { mode: 'omit' },
                topP: { mode: 'omit' },
                reasoning: { mode: 'fixed', value: true },
                legacyThinking: { mode: 'omit' }
              },
              supportsAudioInput: false,
              supportsReasoning: true,
              reasoningPortrait: {
                supported: true,
                defaultEnabled: true,
                mode: 'effort',
                effort: 'max',
                effortOptions: ['low', 'high', 'max']
              },
              thinkingBudgetRange: {},
              supportsSearch: false,
              searchDefaults: {},
              temperatureCapability: false,
              supportsTemperatureControl: false,
              supportsReasoningEffort: true,
              reasoningEffortDefault: 'max',
              supportsVerbosity: false,
              verbosityDefault: undefined
            },
            providerSettings,
            defaultHeaders: {}
          },
          [{ role: 'user', content: 'Hello' }],
          modelId,
          {
            apiEndpoint: 'chat',
            reasoning: false,
            reasoningEffort: 'medium',
            temperature: 0.6,
            topP: 0.8,
            functionCall: false
          } as any,
          0.6,
          1024
        )
      )

      expect(body.reasoning_effort).toBe('max')
      expect(body).not.toHaveProperty('temperature')
      expect(body).not.toHaveProperty('top_p')
      expect(body).not.toHaveProperty('n')
      expect(body).not.toHaveProperty('presence_penalty')
      expect(body).not.toHaveProperty('frequency_penalty')
      expect(body).not.toHaveProperty('thinking')
    }
  )

  it('emits Grok Mini reasoning effort through the standard adapter option', async () => {
    const body = await captureRequestBody(() =>
      runAiSdkGenerateText(
        {
          providerKind: 'openai-compatible',
          provider: {
            id: 'grok',
            name: 'Grok',
            apiType: 'grok',
            apiKey: 'test-key',
            baseUrl: 'https://grok-compatible.example.com/v1',
            enable: true
          } as any,
          providerSettings,
          defaultHeaders: {}
        },
        [{ role: 'user', content: 'Hello' }],
        'grok-3-mini',
        {
          apiEndpoint: 'chat',
          reasoning: true,
          reasoningEffort: 'high',
          functionCall: false
        } as any,
        0.6,
        1024
      )
    )

    expect(body.reasoning_effort).toBe('high')
  })

  it.each([
    ['zhipu', 'glm-5.2', 'max', 'chat'],
    ['zhipu', 'glm-5.3', 'low', 'chat'],
    ['zhipu', 'glm-5.3-flash', 'high', 'chat'],
    ['deepseek', 'deepseek-flash', 'max', 'chat'],
    ['grok', 'grok-4.5', 'medium', 'chat'],
    ['grok', 'grok-4.6', 'xhigh', 'chat'],
    ['grok', 'grok-4.5', 'medium', 'responses'],
    ['grok', 'grok-4.6', 'xhigh', 'responses'],
    ['gemini', 'gemini-3-flash-preview', 'minimal', 'gemini'],
    ['vertex', 'gemini-3-flash-preview', 'low', 'vertex']
  ] as const)(
    'serializes %s %s effort %s through %s',
    async (providerId, modelId, effort, endpoint) => {
      const portrait: ReasoningPortrait =
        endpoint === 'gemini' || endpoint === 'vertex'
          ? {
              supported: true,
              defaultEnabled: true,
              mode: 'level',
              level: 'high',
              levelOptions: ['minimal', 'low', 'medium', 'high']
            }
          : { supported: true, defaultEnabled: true, effortOptions: [effort] }
      const body = await captureRequestBody(() =>
        runAiSdkGenerateText(
          {
            providerKind:
              endpoint === 'vertex'
                ? 'vertex'
                : endpoint === 'gemini'
                  ? 'gemini'
                  : endpoint === 'responses'
                    ? 'openai-responses'
                    : 'openai-compatible',
            provider: {
              id: providerId,
              name: providerId,
              apiType: providerId,
              apiKey: 'test-key',
              baseUrl: 'https://provider.example.com/v1',
              enable: true
            } as any,
            providerSettings,
            defaultHeaders: {},
            capabilitySnapshot: {
              identity: {
                providerId,
                requestModelId: modelId,
                catalogMatched: true,
                catalogModelId: modelId
              },
              requestPolicy: resolveModelRequestPolicy(providerId, modelId, true),
              supportsAudioInput: false,
              supportsReasoning: true,
              reasoningPortrait: portrait,
              thinkingBudgetRange: {},
              supportsSearch: false,
              searchDefaults: {},
              temperatureCapability: undefined,
              supportsTemperatureControl: true,
              supportsReasoningEffort: getReasoningEffortOptions(portrait).length > 0,
              reasoningEffortDefault: undefined,
              supportsVerbosity: false,
              verbosityDefault: undefined
            }
          },
          [{ role: 'user', content: 'Hello' }],
          modelId,
          {
            reasoning: true,
            reasoningEffort: effort,
            thinkingBudget: 2048,
            functionCall: false
          },
          undefined,
          1024
        )
      )

      if (endpoint === 'gemini' || endpoint === 'vertex') {
        expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe(effort)
        expect(body.generationConfig.thinkingConfig).not.toHaveProperty('thinkingBudget')
      } else if (endpoint === 'responses') {
        expect(body.reasoning).toEqual({ effort })
      } else {
        expect(body.reasoning_effort).toBe(effort)
      }
    }
  )

  it('does not emit reasoning effort for unsupported Grok models', async () => {
    const body = await captureRequestBody(() =>
      runAiSdkGenerateText(
        {
          providerKind: 'openai-compatible',
          provider: {
            id: 'grok',
            name: 'Grok',
            apiType: 'grok',
            apiKey: 'test-key',
            baseUrl: 'https://grok-compatible.example.com/v1',
            enable: true
          } as any,
          providerSettings,
          defaultHeaders: {}
        },
        [{ role: 'user', content: 'Hello' }],
        'grok-4',
        {
          apiEndpoint: 'chat',
          reasoning: true,
          reasoningEffort: 'high',
          functionCall: false
        } as any,
        0.6,
        1024
      )
    )

    expect(body).not.toHaveProperty('reasoning_effort')
  })
})
