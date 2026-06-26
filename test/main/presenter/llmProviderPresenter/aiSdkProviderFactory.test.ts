import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { streamText } from 'ai'

vi.mock('../../../../src/main/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

import {
  createAiSdkProviderContext,
  normalizeAzureBaseUrl,
  normalizeAnthropicBaseUrl,
  normalizeGeminiBaseUrl,
  normalizeOllamaOpenAIBaseUrl,
  normalizeOllamaSdkHost,
  normalizeVertexRequestBody,
  normalizeVertexBaseUrl
} from '@/presenter/llmProviderPresenter/aiSdk/providerFactory'

describe('AI SDK provider factory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes anthropic-style base urls to a v1 prefix', () => {
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1'
    )
    expect(normalizeAnthropicBaseUrl('https://api.minimaxi.com/anthropic')).toBe(
      'https://api.minimaxi.com/anthropic/v1'
    )
    expect(normalizeAnthropicBaseUrl('https://zenmux.ai/api/anthropic/')).toBe(
      'https://zenmux.ai/api/anthropic/v1'
    )
    expect(normalizeAnthropicBaseUrl('https://api.kimi.com/coding/')).toBe(
      'https://api.kimi.com/coding/v1'
    )
  })

  it('avoids duplicating the messages suffix', () => {
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1'
    )
    expect(normalizeAnthropicBaseUrl('https://zenmux.ai/api/anthropic/v1/messages')).toBe(
      'https://zenmux.ai/api/anthropic/v1'
    )
    expect(normalizeAnthropicBaseUrl('https://proxy.example.com/messages')).toBe(
      'https://proxy.example.com'
    )
  })

  it('normalizes vertex express-mode base urls to the publishers/google prefix', () => {
    expect(normalizeVertexBaseUrl('https://zenmux.ai/api/vertex-ai', 'api-key', 'v1')).toBe(
      'https://zenmux.ai/api/vertex-ai/v1/publishers/google'
    )
    expect(normalizeVertexBaseUrl('https://zenmux.ai/api/vertex-ai/v1', 'api-key', 'v1')).toBe(
      'https://zenmux.ai/api/vertex-ai/v1/publishers/google'
    )
    expect(
      normalizeVertexBaseUrl(
        'https://zenmux.ai/api/vertex-ai/v1/publishers/google',
        'api-key',
        'v1'
      )
    ).toBe('https://zenmux.ai/api/vertex-ai/v1/publishers/google')
  })

  it('normalizes gemini base urls to a v1beta prefix', () => {
    expect(normalizeGeminiBaseUrl(undefined)).toBe(
      'https://generativelanguage.googleapis.com/v1beta'
    )
    expect(normalizeGeminiBaseUrl('https://api.newapi.ai')).toBe('https://api.newapi.ai/v1beta')
    expect(normalizeGeminiBaseUrl('https://api.newapi.ai/v1')).toBe('https://api.newapi.ai/v1beta')
    expect(normalizeGeminiBaseUrl('https://api.newapi.ai/v1beta')).toBe(
      'https://api.newapi.ai/v1beta'
    )
    expect(normalizeGeminiBaseUrl('https://api.newapi.ai/v1beta1')).toBe(
      'https://api.newapi.ai/v1beta1'
    )
  })

  it('normalizes Ollama base urls for SDK and OpenAI-compatible endpoints', () => {
    expect(normalizeOllamaSdkHost('http://localhost:11434')).toBe('http://localhost:11434')
    expect(normalizeOllamaSdkHost('http://localhost:11434/api')).toBe('http://localhost:11434')
    expect(normalizeOllamaSdkHost('http://localhost:11434/v1')).toBe('http://localhost:11434')
    expect(normalizeOllamaSdkHost('http://example.com/ollama/api')).toBe(
      'http://example.com/ollama'
    )

    expect(normalizeOllamaOpenAIBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1')
    expect(normalizeOllamaOpenAIBaseUrl('http://localhost:11434/api')).toBe(
      'http://localhost:11434/v1'
    )
    expect(normalizeOllamaOpenAIBaseUrl('http://localhost:11434/v1')).toBe(
      'http://localhost:11434/v1'
    )
    expect(normalizeOllamaOpenAIBaseUrl('http://example.com/ollama/api')).toBe(
      'http://example.com/ollama/v1'
    )
  })

  it('removes default AUTO tool config from vertex request bodies', () => {
    expect(
      normalizeVertexRequestBody({
        contents: [],
        tools: [],
        toolConfig: {
          functionCallingConfig: {
            mode: 'AUTO'
          }
        }
      })
    ).toEqual({
      contents: [],
      tools: []
    })
  })

  it('normalizes vertex system instructions and tool schemas to google genai wire format', () => {
    expect(
      normalizeVertexRequestBody({
        systemInstruction: {
          parts: [{ text: 'sys' }]
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: 'skill_manage',
                parameters: {
                  type: 'object',
                  properties: {
                    action: { type: 'string' },
                    enabled: { type: 'boolean' }
                  },
                  required: ['action']
                }
              }
            ]
          }
        ]
      })
    ).toEqual({
      systemInstruction: {
        role: 'user',
        parts: [{ text: 'sys' }]
      },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'skill_manage',
              parameters: {
                type: 'OBJECT',
                properties: {
                  action: { type: 'STRING' },
                  enabled: { type: 'BOOLEAN' }
                },
                required: ['action']
              }
            }
          ]
        }
      ]
    })
  })

  it('normalizes azure resource base urls to the openai prefix with v1 semantics', () => {
    expect(normalizeAzureBaseUrl('https://example.openai.azure.com', undefined)).toEqual({
      baseURL: 'https://example.openai.azure.com/openai',
      apiVersion: 'v1',
      useDeploymentBasedUrls: false
    })

    expect(normalizeAzureBaseUrl('https://example.openai.azure.com/openai/v1', undefined)).toEqual({
      baseURL: 'https://example.openai.azure.com/openai',
      apiVersion: 'v1',
      useDeploymentBasedUrls: false
    })
  })

  it('preserves deployment-based azure urls and legacy api versions', () => {
    expect(
      normalizeAzureBaseUrl(
        'https://example.openai.azure.com/openai/deployments/deepchat-prod',
        undefined
      )
    ).toEqual({
      baseURL: 'https://example.openai.azure.com/openai',
      apiVersion: '2024-02-01',
      useDeploymentBasedUrls: true,
      deploymentName: 'deepchat-prod'
    })

    expect(
      normalizeAzureBaseUrl(
        'https://example.openai.azure.com/openai/deployments/deepchat-prod',
        '2025-04-01-preview'
      )
    ).toEqual({
      baseURL: 'https://example.openai.azure.com/openai',
      apiVersion: '2025-04-01-preview',
      useDeploymentBasedUrls: true,
      deploymentName: 'deepchat-prod'
    })
  })

  it('builds azure responses endpoints without duplicating v1 segments', () => {
    const context = createAiSdkProviderContext({
      providerKind: 'azure',
      provider: {
        id: 'azure-openai',
        name: 'Azure OpenAI',
        apiKey: 'test-key',
        baseUrl: 'https://example.openai.azure.com/openai/v1',
        enable: false
      } as any,
      configPresenter: {
        getSetting: () => undefined
      } as any,
      defaultHeaders: {},
      modelId: 'my-gpt-4.1-deployment'
    })

    expect(context.apiType).toBe('azure_responses')
    expect(context.providerOptionsKey).toBe('azure')
    expect(context.endpoint).toBe(
      'https://example.openai.azure.com/openai/v1/responses?api-version=v1'
    )
    expect(context.embeddingEndpoint).toBe(
      'https://example.openai.azure.com/openai/v1/embeddings?api-version=v1'
    )
    expect(context.imageEndpoint).toBe(
      'https://example.openai.azure.com/openai/v1/images/generations?api-version=v1'
    )
    expect(context.resolvedModelId).toBe('my-gpt-4.1-deployment')
  })

  it('uses deployment ids from azure deployment-scoped urls', () => {
    const context = createAiSdkProviderContext({
      providerKind: 'azure',
      provider: {
        id: 'azure-openai',
        name: 'Azure OpenAI',
        apiKey: 'test-key',
        baseUrl: 'https://example.openai.azure.com/openai/deployments/deepchat-prod',
        enable: false
      } as any,
      configPresenter: {
        getSetting: () => undefined
      } as any,
      defaultHeaders: {},
      modelId: 'ignored-model-id'
    })

    expect(context.endpoint).toBe(
      'https://example.openai.azure.com/openai/deployments/deepchat-prod/responses?api-version=2024-02-01'
    )
    expect(context.resolvedModelId).toBe('deepchat-prod')
  })

  it.each([
    [
      'OpenAI',
      'openai-compatible',
      {
        id: 'openai',
        name: 'OpenAI',
        apiType: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        enable: true
      },
      'openai',
      'openai_chat',
      'https://api.openai.com/v1/chat/completions'
    ],
    [
      'GitHub Copilot',
      'openai-compatible',
      {
        id: 'github-copilot',
        name: 'GitHub Copilot',
        apiType: 'github-copilot',
        apiKey: 'test-key',
        baseUrl: 'https://api.githubcopilot.com',
        enable: true
      },
      'github-copilot',
      'openai_chat',
      'https://api.githubcopilot.com/chat/completions'
    ],
    [
      'custom OpenAI-compatible provider',
      'openai-compatible',
      {
        id: 'custom-provider',
        name: 'Custom Provider',
        apiType: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://proxy.example.com/v1',
        enable: true,
        custom: true
      },
      'custom-provider',
      'openai_chat',
      'https://proxy.example.com/v1/chat/completions'
    ],
    [
      'Anthropic',
      'anthropic',
      {
        id: 'anthropic',
        name: 'Anthropic',
        apiType: 'anthropic',
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com',
        enable: true
      },
      'anthropic',
      'anthropic',
      'https://api.anthropic.com/v1/messages'
    ],
    [
      'Kimi For Coding',
      'anthropic',
      {
        id: 'kimi-for-coding',
        name: 'Kimi For Coding',
        apiType: 'anthropic',
        apiKey: 'test-key',
        baseUrl: 'https://api.kimi.com/coding/',
        enable: true
      },
      'anthropic',
      'anthropic',
      'https://api.kimi.com/coding/v1/messages'
    ],
    [
      'Gemini',
      'gemini',
      {
        id: 'gemini',
        name: 'Gemini',
        apiType: 'gemini',
        apiKey: 'test-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
        enable: true
      },
      'google',
      'google',
      'https://generativelanguage.googleapis.com/v1beta'
    ],
    [
      'Azure OpenAI',
      'azure',
      {
        id: 'azure-openai',
        name: 'Azure OpenAI',
        apiType: 'azure-openai',
        apiKey: 'test-key',
        baseUrl: 'https://example.openai.azure.com/openai/v1',
        enable: true
      },
      'azure',
      'azure_responses',
      'https://example.openai.azure.com/openai/v1/responses?api-version=v1'
    ],
    [
      'Vertex',
      'vertex',
      {
        id: 'vertex',
        name: 'Vertex',
        apiType: 'vertex',
        apiKey: 'test-key',
        projectId: 'project',
        location: 'us-central1',
        enable: true
      },
      'vertex',
      'vertex',
      'https://aiplatform.googleapis.com/v1/publishers/google'
    ],
    [
      'AWS Bedrock',
      'aws-bedrock',
      {
        id: 'aws-bedrock',
        name: 'AWS Bedrock',
        apiType: 'aws-bedrock',
        apiKey: '',
        enable: true,
        credential: {
          authMode: 'accessKeys',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          region: 'us-east-1'
        }
      },
      'bedrock',
      'bedrock',
      'https://bedrock-runtime.amazonaws.com'
    ]
  ])(
    'keeps the %s provider factory branch stable',
    (_label, providerKind, provider, providerOptionsKey, apiType, endpoint) => {
      const context = createAiSdkProviderContext({
        providerKind: providerKind as any,
        provider: provider as any,
        configPresenter: {
          getSetting: () => undefined
        } as any,
        defaultHeaders: {},
        modelId: 'test-model',
        wrapThinkReasoning: false
      })

      expect(context.providerOptionsKey).toBe(providerOptionsKey)
      expect(context.apiType).toBe(apiType)
      expect(context.endpoint).toBe(endpoint)
    }
  )

  it('maps Kimi For Coding Anthropic aliases to the stable upstream model ID', () => {
    const context = createAiSdkProviderContext({
      providerKind: 'anthropic',
      provider: {
        id: 'kimi-for-coding',
        name: 'Kimi For Coding',
        apiType: 'anthropic',
        apiKey: 'test-key',
        baseUrl: 'https://api.kimi.com/coding/',
        enable: true
      } as any,
      configPresenter: {
        getSetting: () => undefined
      } as any,
      defaultHeaders: {},
      modelId: 'k2p7',
      wrapThinkReasoning: false
    })

    expect(context.resolvedModelId).toBe('kimi-for-coding')
    expect(context.endpoint).toBe('https://api.kimi.com/coding/v1/messages')
  })

  it('uses normalized gemini urls with google auth headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"hello"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}\n\n',
        {
          status: 200,
          headers: {
            'content-type': 'text/event-stream'
          }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const context = createAiSdkProviderContext({
      providerKind: 'gemini',
      provider: {
        id: 'new-api',
        name: 'New API',
        apiType: 'gemini',
        apiKey: 'test-key-1234',
        baseUrl: 'https://api.newapi.ai',
        enable: false
      } as any,
      configPresenter: {} as any,
      defaultHeaders: {
        'HTTP-Referer': 'https://deepchatai.cn',
        'X-Title': 'DeepChat'
      },
      modelId: 'gemini-3.1-flash-lite-preview',
      cleanHeaders: true
    })

    expect(context.endpoint).toBe('https://api.newapi.ai/v1beta')

    const result = streamText({
      model: context.model,
      messages: [{ role: 'user', content: '你好' }],
      maxOutputTokens: 16
    })
    for await (const _part of result.stream) {
      continue
    }

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.newapi.ai/v1beta/models/gemini-3.1-flash-lite-preview:streamGenerateContent?alt=sse',
      expect.any(Object)
    )

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(requestInit.headers)
    expect(headers.get('x-goog-api-key')).toBe('test-key-1234')
    expect(headers.has('authorization')).toBe(false)
  })
})
