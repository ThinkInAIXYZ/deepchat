import { describe, expect, it } from 'vitest'
import {
  normalizeAnthropicBaseUrl,
  normalizeGeminiBaseUrl,
  normalizeOllamaSdkHost,
  normalizeOllamaOpenAIBaseUrl,
  normalizeAzureBaseUrl
} from '@/provider/providerEndpoints'
import { normalizeVertexBaseUrl } from '@/provider/vertexSettings'

describe('provider metadata endpoints', () => {
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
})
