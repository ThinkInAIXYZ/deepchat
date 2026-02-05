import type { LLM_PROVIDER } from '@shared/presenter'

export type ProviderValidationResult = {
  isValid: boolean
  errors: string[]
}

const trimString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  return value.trim()
}

export const normalizeProviderUpdates = (updates: Partial<LLM_PROVIDER>): Partial<LLM_PROVIDER> => {
  const normalized = { ...updates }

  if (typeof normalized.name === 'string') {
    normalized.name = normalized.name.trim()
  }

  if (typeof normalized.baseUrl === 'string') {
    normalized.baseUrl = normalized.baseUrl.trim()
  }

  if (typeof normalized.apiKey === 'string') {
    normalized.apiKey = normalized.apiKey.trim()
  }

  if (typeof normalized.id === 'string') {
    normalized.id = normalized.id.trim()
  }

  if (typeof normalized.apiType === 'string') {
    normalized.apiType = normalized.apiType.trim()
  }

  return normalized
}

export const normalizeNewProvider = (provider: LLM_PROVIDER): LLM_PROVIDER => {
  return normalizeProviderUpdates(provider) as LLM_PROVIDER
}

export const validateNewProvider = (provider: LLM_PROVIDER): ProviderValidationResult => {
  const errors: string[] = []
  const id = trimString(provider.id)
  const name = trimString(provider.name)
  const apiType = trimString(provider.apiType)
  const baseUrl = trimString(provider.baseUrl)
  const apiKey = trimString(provider.apiKey)

  if (!id) errors.push('Provider id is required')
  if (!name) errors.push('Provider name is required')
  if (!apiType) errors.push('Provider apiType is required')
  if (!baseUrl) errors.push('Provider baseUrl is required')

  if (apiType !== 'ollama' && !apiKey) {
    errors.push('Provider apiKey is required')
  }

  return { isValid: errors.length === 0, errors }
}
