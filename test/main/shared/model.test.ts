import { describe, expect, it } from 'vitest'
import {
  ModelType,
  isClaudeOpus47FamilyModelId,
  resolveNewApiEndpointTypeFromRoute,
  resolveProviderCapabilityProviderId,
  shouldUseAnthropicClaudeRouteFromSupportedEndpoints
} from '@shared/model'

describe('new-api route helpers', () => {
  it('prefers anthropic for Claude models when supported endpoints include anthropic and chat fallbacks', () => {
    expect(
      resolveNewApiEndpointTypeFromRoute(
        {
          supportedEndpointTypes: ['openai-response', 'anthropic'],
          type: ModelType.Chat
        },
        'claude-opus-4-7'
      )
    ).toBe('anthropic')
  })

  it('keeps supported endpoint order for non-Claude models', () => {
    expect(
      resolveNewApiEndpointTypeFromRoute(
        {
          supportedEndpointTypes: ['openai-response', 'anthropic'],
          type: ModelType.Chat
        },
        'gpt-5.4'
      )
    ).toBe('openai-response')
  })

  it('keeps explicit endpoint overrides ahead of Claude family preference', () => {
    expect(
      resolveNewApiEndpointTypeFromRoute(
        {
          endpointType: 'openai-response',
          supportedEndpointTypes: ['openai-response', 'anthropic'],
          type: ModelType.Chat
        },
        'claude-opus-4-7'
      )
    ).toBe('openai-response')
  })

  it('only enables the Claude anthropic default route when supported endpoints include anthropic and a chat fallback', () => {
    expect(
      shouldUseAnthropicClaudeRouteFromSupportedEndpoints(
        {
          supportedEndpointTypes: ['openai-response', 'anthropic'],
          type: ModelType.Chat
        },
        'claude-opus-4-7'
      )
    ).toBe(true)

    expect(
      shouldUseAnthropicClaudeRouteFromSupportedEndpoints(
        {
          supportedEndpointTypes: ['openai-response', 'anthropic'],
          type: ModelType.Chat
        },
        'gpt-5.4'
      )
    ).toBe(false)

    expect(
      shouldUseAnthropicClaudeRouteFromSupportedEndpoints(
        {
          supportedEndpointTypes: ['anthropic', 'image-generation'],
          type: ModelType.ImageGeneration
        },
        'claude-image'
      )
    ).toBe(false)
  })

  it('keeps image generation routes on the image endpoint', () => {
    expect(
      resolveNewApiEndpointTypeFromRoute(
        {
          supportedEndpointTypes: ['anthropic', 'image-generation'],
          type: ModelType.ImageGeneration
        },
        'claude-image'
      )
    ).toBe('image-generation')
  })

  it('maps capability provider ids from route metadata for new-api-like forks', () => {
    expect(
      resolveProviderCapabilityProviderId(
        'fork-api',
        {
          supportedEndpointTypes: ['openai-response', 'anthropic'],
          type: ModelType.Chat
        },
        'claude-opus-4-7'
      )
    ).toBe('anthropic')
  })

  it('maps zenmux anthropic-prefixed models to anthropic capability semantics', () => {
    expect(resolveProviderCapabilityProviderId('zenmux', null, 'anthropic/claude-opus-4-7')).toBe(
      'anthropic'
    )
  })

  it('keeps transport-compatible anthropic relays on provider-local capability semantics', () => {
    expect(
      resolveProviderCapabilityProviderId(
        'my-anthropic-proxy',
        {
          providerApiType: 'anthropic'
        },
        'claude-opus-4-7'
      )
    ).toBe('my-anthropic-proxy')
  })

  it('keeps minimax on provider-local capability semantics without explicit anthropic routing', () => {
    expect(
      resolveProviderCapabilityProviderId(
        'minimax',
        {
          providerApiType: 'anthropic'
        },
        'MiniMax-M2.5'
      )
    ).toBe('minimax')
  })

  it('keeps openai transport claude carriers on their original provider id', () => {
    expect(
      resolveProviderCapabilityProviderId('openrouter', null, 'anthropic/claude-opus-4-7')
    ).toBe('openrouter')
  })

  it('recognizes claude-opus-4-7 family after stripping provider prefixes', () => {
    expect(isClaudeOpus47FamilyModelId('claude-opus-4-7')).toBe(true)
    expect(isClaudeOpus47FamilyModelId('anthropic/claude-opus-4-7')).toBe(true)
    expect(isClaudeOpus47FamilyModelId('claude-opus-4-7-think')).toBe(true)
    expect(isClaudeOpus47FamilyModelId('claude-opus-4-6')).toBe(false)
  })
})
