import { describe, expect, it } from 'vitest'
import {
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
})
