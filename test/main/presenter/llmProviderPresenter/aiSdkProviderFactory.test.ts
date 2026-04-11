import { describe, expect, it } from 'vitest'
import {
  createAiSdkProviderContext,
  normalizeAzureBaseUrl,
  normalizeAnthropicBaseUrl,
  normalizeVertexRequestBody,
  normalizeVertexBaseUrl
} from '@/presenter/llmProviderPresenter/aiSdk/providerFactory'

describe('AI SDK provider factory', () => {
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
})
