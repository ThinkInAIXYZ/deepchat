import { describe, expect, it } from 'vitest'
import {
  ModelType,
  isClaudeOpus47FamilyModelId,
  resolveNewApiEndpointTypeFromRoute,
  resolveProviderCapabilityProviderId
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

  it('recognizes claude-opus-4-7 family after stripping provider prefixes', () => {
    expect(isClaudeOpus47FamilyModelId('claude-opus-4-7')).toBe(true)
    expect(isClaudeOpus47FamilyModelId('anthropic/claude-opus-4-7')).toBe(true)
    expect(isClaudeOpus47FamilyModelId('claude-opus-4-7-think')).toBe(true)
    expect(isClaudeOpus47FamilyModelId('claude-opus-4-6')).toBe(false)
  })
})
