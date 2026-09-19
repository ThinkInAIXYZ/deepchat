import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateText } from 'ai'

vi.mock('../../../src/main/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

import {
  createAiSdkProviderContext,
  transformOpenAICompatiblePromptCacheRequestBody
} from '@/provider/aiSdk/providerFactory'
import { OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER } from '@/provider/promptCacheStrategy'

const providerSettings = {
  getAzureApiVersion: () => undefined
} as any

async function captureRequestBody(run: () => Promise<unknown>): Promise<Record<string, any>> {
  const fetchMock = vi.fn(async () => {
    throw new Error('request captured')
  })
  vi.stubGlobal('fetch', fetchMock)

  await expect(run()).rejects.toThrow()
  expect(fetchMock).toHaveBeenCalledTimes(1)

  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
  expect(init?.body).toBeTypeOf('string')
  return JSON.parse(init?.body as string)
}

describe('AI SDK prompt cache wire payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['chat', 'openai-compatible' as const],
    ['responses', 'openai-responses' as const]
  ])('emits OpenAI prompt_cache_key through the %s adapter', async (_label, providerKind) => {
    const context = createAiSdkProviderContext({
      providerKind,
      provider: {
        id: 'openai',
        name: 'OpenAI',
        apiType: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        enable: true
      } as any,
      providerSettings,
      defaultHeaders: {},
      modelId: 'gpt-5',
      wrapThinkReasoning: false
    })

    const body = await captureRequestBody(() =>
      generateText({
        model: context.model,
        messages: [{ role: 'user', content: 'Hello' }],
        providerOptions: {
          openai: {
            promptCacheKey: 'deepchat:openai:gpt-5:0123456789abcdef0123'
          }
        }
      })
    )

    expect(body.prompt_cache_key).toBe('deepchat:openai:gpt-5:0123456789abcdef0123')
  })

  it('emits Anthropic automatic cache control at the top level', async () => {
    const context = createAiSdkProviderContext({
      providerKind: 'anthropic',
      provider: {
        id: 'anthropic',
        name: 'Anthropic',
        apiType: 'anthropic',
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com',
        enable: true
      } as any,
      providerSettings,
      defaultHeaders: {},
      modelId: 'claude-sonnet-4-5',
      wrapThinkReasoning: false
    })

    const body = await captureRequestBody(() =>
      generateText({
        model: context.model,
        messages: [{ role: 'user', content: 'Hello' }],
        providerOptions: {
          anthropic: {
            cacheControl: {
              type: 'ephemeral'
            }
          }
        }
      })
    )

    expect(body.cache_control).toEqual({
      type: 'ephemeral'
    })
  })

  it.each([
    ['openrouter', true],
    ['zenmux', false]
  ])(
    'applies the final content-block breakpoint for %s and strips the private marker',
    async (providerId, expectsSessionId) => {
      const modelId = 'anthropic/claude-sonnet-4-5'
      const cacheKey = `deepchat:${providerId}:anthropic/claude-sonnet-4-5:0123456789abcdef0123`
      const context = createAiSdkProviderContext({
        providerKind: 'openai-compatible',
        provider: {
          id: providerId,
          name: providerId,
          apiType: 'openai-completions',
          apiKey: 'test-key',
          baseUrl: `https://${providerId}.example.com/v1`,
          enable: true
        } as any,
        providerSettings,
        defaultHeaders: {},
        modelId,
        wrapThinkReasoning: false
      })

      const body = await captureRequestBody(() =>
        generateText({
          model: context.model,
          instructions: 'Stable system',
          messages: [
            { role: 'user', content: 'Earlier question' },
            { role: 'assistant', content: 'Stable reply' },
            { role: 'user', content: 'Latest question' }
          ],
          providerOptions: {
            [providerId]: {
              [OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER]: {
                version: 1,
                providerId,
                modelId,
                cacheKey
              }
            }
          }
        })
      )

      expect(body).not.toHaveProperty(OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER)
      expect(JSON.stringify(body)).not.toContain(OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER)
      expect(body.messages[2]).toEqual({
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Stable reply',
            cache_control: {
              type: 'ephemeral'
            }
          }
        ]
      })
      if (expectsSessionId) {
        expect(body.session_id).toBe(cacheKey)
      } else {
        expect(body).not.toHaveProperty('session_id')
      }
    }
  )

  it('emits Bedrock cachePoint blocks for structured system and history messages', async () => {
    const context = createAiSdkProviderContext({
      providerKind: 'aws-bedrock',
      provider: {
        id: 'aws-bedrock',
        name: 'AWS Bedrock',
        apiType: 'aws-bedrock',
        apiKey: '',
        enable: true,
        credential: {
          authMode: 'accessKeys',
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
          region: 'us-east-1'
        }
      } as any,
      providerSettings,
      defaultHeaders: {},
      modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      wrapThinkReasoning: false
    })

    const body = await captureRequestBody(() =>
      generateText({
        model: context.model,
        instructions: {
          role: 'system',
          content: 'Stable system',
          providerOptions: {
            bedrock: {
              cachePoint: {
                type: 'default'
              }
            }
          }
        },
        messages: [
          { role: 'user', content: 'Earlier question' },
          {
            role: 'assistant',
            content: 'Stable reply',
            providerOptions: {
              bedrock: {
                cachePoint: {
                  type: 'default'
                }
              }
            }
          },
          { role: 'user', content: 'Latest question' }
        ]
      })
    )

    expect(body.system).toEqual([
      { text: 'Stable system' },
      {
        cachePoint: {
          type: 'default'
        }
      }
    ])
    expect(body.messages[1]?.content).toEqual([
      { text: 'Stable reply' },
      {
        cachePoint: {
          type: 'default'
        }
      }
    ])
  })

  it('always strips malformed internal markers from compatible request bodies', () => {
    const transformed = transformOpenAICompatiblePromptCacheRequestBody({
      model: 'model',
      messages: [],
      [OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER]: {
        version: 999,
        providerId: 'openrouter'
      }
    })

    expect(transformed).toEqual({
      model: 'model',
      messages: []
    })
  })

  it('does not emit a sticky session for an unverified cache key', () => {
    const transformed = transformOpenAICompatiblePromptCacheRequestBody(
      {
        model: 'anthropic/claude-sonnet-4-5',
        messages: [
          { role: 'assistant', content: 'Stable reply' },
          { role: 'user', content: 'Latest question' }
        ],
        [OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER]: {
          version: 1,
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4-5',
          cacheKey: 'raw-private-session-id'
        }
      },
      'openrouter'
    )

    expect(transformed).not.toHaveProperty('session_id')
    expect(transformed).not.toHaveProperty(OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER)
  })

  it('keeps the active OpenRouter tool loop outside the final wire breakpoint', () => {
    const modelId = 'anthropic/claude-sonnet-4-5'
    const transformed = transformOpenAICompatiblePromptCacheRequestBody(
      {
        model: modelId,
        messages: [
          { role: 'system', content: 'Stable system' },
          { role: 'user', content: 'Earlier question' },
          { role: 'assistant', content: 'Stable reply' },
          { role: 'user', content: 'Active question' },
          { role: 'assistant', content: 'Active tool call' },
          { role: 'tool', content: 'Active tool result' }
        ],
        [OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER]: {
          version: 1,
          providerId: 'openrouter',
          modelId,
          cacheKey: `deepchat:openrouter:${modelId}:0123456789abcdef0123`
        }
      },
      'openrouter'
    )

    expect(transformed.messages[2].content).toEqual([
      {
        type: 'text',
        text: 'Stable reply',
        cache_control: {
          type: 'ephemeral'
        }
      }
    ])
    expect(JSON.stringify(transformed.messages.slice(3))).not.toContain('cache_control')
    expect(transformed).not.toHaveProperty(OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER)
  })
})
