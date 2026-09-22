import { describe, expect, it } from 'vitest'
import {
  ModelType,
  resolveNewApiModelTypeFromMetadata,
  resolveNewApiEndpointTypeFromRoute,
  resolveNewApiSelectableEndpointTypes,
  shouldUseAnthropicClaudeRouteFromSupportedEndpoints
} from '@shared/model'
import { resolveMediaSettingsCapabilities } from '@/provider/mediaCapabilities'

describe('new-api route helpers', () => {
  it.each(['gpt-4o-all', 'gpt-4o-image'])(
    'preserves explicit chat routes for aggregator alias %s',
    (modelId) => {
      expect(
        resolveNewApiSelectableEndpointTypes(['openai-response'], modelId, { type: ModelType.Chat })
      ).toContain('openai-response')
    }
  )

  it.each(['gpt-4o-all', 'gpt-4o-image', 'dall-e-3', 'gpt-image-1'])(
    'projects the OpenAI image compatibility model %s consistently',
    (modelId) => {
      expect(resolveNewApiModelTypeFromMetadata([], modelId, undefined)).toBe(
        ModelType.ImageGeneration
      )
      expect(resolveMediaSettingsCapabilities('openai-compatible', modelId, {}).image).toBe(true)
      expect(resolveMediaSettingsCapabilities('gemini', modelId, {}).image).toBe(false)
      expect(resolveNewApiModelTypeFromMetadata([], modelId, 'chat')).toBe(ModelType.Chat)
      expect(resolveNewApiEndpointTypeFromRoute({ endpointType: 'gemini' }, modelId)).toBe('gemini')
    }
  )

  it.each(['gpt-4o', 'gpt-4o-image-chat', 'not-gpt-image-2'])(
    'does not infer image from %s',
    (modelId) => {
      expect(resolveNewApiModelTypeFromMetadata([], modelId, undefined)).toBeUndefined()
      expect(resolveMediaSettingsCapabilities('openai-compatible', modelId, {}).image).toBe(false)
    }
  )

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

  it('infers anthropic for Claude-owned models with empty supported endpoints', () => {
    expect(
      resolveNewApiEndpointTypeFromRoute(
        {
          supportedEndpointTypes: [],
          ownedBy: 'claude',
          type: ModelType.Chat
        },
        'claude-opus-4-8'
      )
    ).toBe('anthropic')
  })

  it('infers gemini for Google Gemini-owned models with empty supported endpoints', () => {
    expect(
      resolveNewApiEndpointTypeFromRoute(
        {
          supportedEndpointTypes: [],
          ownedBy: 'google gemini',
          type: ModelType.Chat
        },
        'gemini-3.5-flash'
      )
    ).toBe('gemini')
  })

  it('keeps explicit endpoint overrides ahead of owner fallback inference', () => {
    expect(
      resolveNewApiEndpointTypeFromRoute(
        {
          endpointType: 'openai',
          supportedEndpointTypes: [],
          ownedBy: 'google gemini',
          type: ModelType.Chat
        },
        'gemini-3.5-flash'
      )
    ).toBe('openai')
  })

  it('does not override openai-only supported endpoints from owner hints', () => {
    expect(
      resolveNewApiEndpointTypeFromRoute(
        {
          supportedEndpointTypes: ['openai'],
          ownedBy: 'claude',
          type: ModelType.Chat
        },
        'claude-opus-4-8'
      )
    ).toBe('openai')
  })

  it('prefers gemini when supported endpoints include gemini and the model is Gemini family', () => {
    expect(
      resolveNewApiEndpointTypeFromRoute(
        {
          supportedEndpointTypes: ['openai', 'gemini'],
          ownedBy: 'google gemini',
          type: ModelType.Chat
        },
        'gemini-3.5-flash'
      )
    ).toBe('gemini')
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

  it('adds every chat endpoint for chat selectable endpoint debugging', () => {
    expect(
      resolveNewApiSelectableEndpointTypes(['openai'], 'proxy-chat', {
        type: ModelType.Chat
      })
    ).toEqual(['openai', 'openai-response', 'anthropic', 'gemini'])

    expect(
      resolveNewApiSelectableEndpointTypes(['gemini', 'openai'], 'gpt-5.5', {
        type: ModelType.Chat
      })
    ).toEqual(['gemini', 'openai', 'openai-response', 'anthropic'])
  })

  it('filters selectable endpoints by explicit non-chat model type', () => {
    expect(
      resolveNewApiSelectableEndpointTypes(['openai', 'anthropic'], 'gpt-image-2', {
        type: ModelType.ImageGeneration
      })
    ).toEqual(['image-generation'])

    expect(
      resolveNewApiSelectableEndpointTypes(['openai', 'gemini'], 'sora-3', {
        type: ModelType.VideoGeneration
      })
    ).toEqual(['video-generation'])

    expect(
      resolveNewApiSelectableEndpointTypes(
        ['openai', 'anthropic', 'image-generation'],
        'embed-v1',
        {
          type: ModelType.Embedding
        }
      )
    ).toEqual(['openai'])
  })

  it('treats explicit raw chat type ahead of media endpoint hints for selectable endpoints', () => {
    expect(
      resolveNewApiSelectableEndpointTypes(['openai', 'image-generation'], 'gpt-4.1', {
        rawType: 'chat'
      })
    ).toEqual(['openai', 'openai-response', 'anthropic', 'gemini'])

    expect(
      resolveNewApiSelectableEndpointTypes(['image-generation'], 'gpt-image-2', {
        rawType: undefined
      })
    ).toEqual(['image-generation'])
  })

  it('infers known media model ids from sparse endpoint metadata', () => {
    expect(resolveNewApiSelectableEndpointTypes(['openai'], 'gpt-image-2')).toEqual([
      'image-generation'
    ])
    expect(resolveNewApiSelectableEndpointTypes(['openai'], 'dall-e-3')).toEqual([
      'image-generation'
    ])
    expect(resolveNewApiSelectableEndpointTypes(['openai'], 'sora-3')).toEqual(['video-generation'])
  })

  it('keeps explicit raw chat type ahead of known media model id inference', () => {
    expect(
      resolveNewApiSelectableEndpointTypes(['openai'], 'gpt-image-2', {
        rawType: 'chat'
      })
    ).toEqual(['openai'])
  })
})
