import { describe, expect, it } from 'vitest'

import {
  getDottedProviderUnqualifiedModelId,
  normalizeCanonicalModelId
} from '../../../src/shared/modelId'

describe('model ID normalization', () => {
  it.each([
    ['anthropic.claude-3-5-sonnet', 'claude-3-5-sonnet'],
    ['meta-llama.llama-3-70b', 'llama-3-70b'],
    ['us.meta-llama.llama-3-70b', 'llama-3-70b']
  ])('strips recognized dotted namespaces from %s', (modelId, expected) => {
    expect(getDottedProviderUnqualifiedModelId(modelId)).toBe(expected)
  })

  it.each([
    ['gpt-4.1-mini', 'gpt-4-1-mini'],
    ['custom-model.2-preview', 'custom-model.2-preview']
  ])('preserves unqualified versioned model ID %s', (modelId, expected) => {
    expect(normalizeCanonicalModelId(modelId)).toBe(expected)
  })
})
