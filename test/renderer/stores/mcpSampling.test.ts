import { describe, expect, it } from 'vitest'
import { resolveSamplingDefaultModel } from '@/stores/mcpSampling'
import type { RENDERER_MODEL_META } from '@shared/presenter'

const makeModel = (
  id: string,
  providerId: string,
  options?: { vision?: boolean }
): RENDERER_MODEL_META => ({
  id,
  name: id,
  group: 'default',
  providerId,
  vision: options?.vision ?? false
})

describe('resolveSamplingDefaultModel', () => {
  it('prefers active session model over draft model', () => {
    const openaiModel = makeModel('gpt-4o', 'openai')
    const claudeModel = makeModel('claude-sonnet', 'anthropic')

    const result = resolveSamplingDefaultModel({
      enabledModels: [
        { providerId: 'openai', models: [openaiModel] },
        { providerId: 'anthropic', models: [claudeModel] }
      ],
      providerOrder: ['openai', 'anthropic'],
      requiresVision: false,
      activeSelection: { providerId: 'openai', modelId: 'gpt-4o' },
      draftSelection: { providerId: 'anthropic', modelId: 'claude-sonnet' }
    })

    expect(result.providerId).toBe('openai')
    expect(result.model?.id).toBe('gpt-4o')
  })

  it('falls back to draft model when active selection is unavailable', () => {
    const claudeModel = makeModel('claude-sonnet', 'anthropic')

    const result = resolveSamplingDefaultModel({
      enabledModels: [{ providerId: 'anthropic', models: [claudeModel] }],
      providerOrder: ['anthropic'],
      requiresVision: false,
      activeSelection: { providerId: 'openai', modelId: 'gpt-4o' },
      draftSelection: { providerId: 'anthropic', modelId: 'claude-sonnet' }
    })

    expect(result.providerId).toBe('anthropic')
    expect(result.model?.id).toBe('claude-sonnet')
  })

  it('uses first eligible model when vision is required', () => {
    const openaiText = makeModel('gpt-4.1', 'openai', { vision: false })
    const openaiVision = makeModel('gpt-4o', 'openai', { vision: true })
    const claudeVision = makeModel('claude-3.7-sonnet', 'anthropic', { vision: true })

    const result = resolveSamplingDefaultModel({
      enabledModels: [
        { providerId: 'openai', models: [openaiText, openaiVision] },
        { providerId: 'anthropic', models: [claudeVision] }
      ],
      providerOrder: ['openai', 'anthropic'],
      requiresVision: true,
      activeSelection: { providerId: 'openai', modelId: 'gpt-4.1' },
      draftSelection: null
    })

    expect(result.providerId).toBe('openai')
    expect(result.model?.id).toBe('gpt-4o')
  })
})
