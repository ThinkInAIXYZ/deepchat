import { describe, it, expect } from 'vitest'
import {
  normalizeProviderUpdates,
  normalizeNewProvider,
  validateNewProvider
} from '@/composables/provider/providerConfig'
import type { LLM_PROVIDER } from '@shared/presenter'

describe('providerConfig', () => {
  it('normalizes provider updates by trimming fields', () => {
    const updates = normalizeProviderUpdates({
      name: '  Test  ',
      apiKey: '  key  ',
      baseUrl: '  https://example.com  '
    })

    expect(updates.name).toBe('Test')
    expect(updates.apiKey).toBe('key')
    expect(updates.baseUrl).toBe('https://example.com')
  })

  it('validates new provider requirements', () => {
    const provider = normalizeNewProvider({
      id: 'custom',
      name: 'Custom Provider',
      apiType: 'openai',
      apiKey: '',
      baseUrl: '',
      enable: true
    } as LLM_PROVIDER)

    const result = validateNewProvider(provider)
    expect(result.isValid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('allows missing apiKey for ollama', () => {
    const provider = normalizeNewProvider({
      id: 'ollama-custom',
      name: 'Ollama Local',
      apiType: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434',
      enable: true
    } as LLM_PROVIDER)

    const result = validateNewProvider(provider)
    expect(result.isValid).toBe(true)
  })
})
