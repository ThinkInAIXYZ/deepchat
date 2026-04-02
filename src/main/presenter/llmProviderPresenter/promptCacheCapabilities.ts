export type PromptCacheMode =
  | 'disabled'
  | 'openai_implicit'
  | 'anthropic_auto'
  | 'anthropic_explicit'

function normalizeId(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function isClaudeModel(modelId: string): boolean {
  return modelId.includes('claude')
}

export function resolvePromptCacheMode(providerId: string, modelId: string): PromptCacheMode {
  const normalizedProviderId = normalizeId(providerId)
  const normalizedModelId = normalizeId(modelId)

  if (normalizedProviderId === 'openai') {
    return 'openai_implicit'
  }

  if (normalizedProviderId === 'anthropic' && isClaudeModel(normalizedModelId)) {
    return 'anthropic_auto'
  }

  if (
    normalizedProviderId === 'zenmux' &&
    normalizedModelId.startsWith('anthropic/') &&
    isClaudeModel(normalizedModelId)
  ) {
    return 'anthropic_explicit'
  }

  if (
    normalizedProviderId === 'aws-bedrock' &&
    (normalizedModelId.includes('anthropic.claude') || isClaudeModel(normalizedModelId))
  ) {
    return 'anthropic_explicit'
  }

  if (
    normalizedProviderId === 'openrouter' &&
    (normalizedModelId.startsWith('anthropic/') || isClaudeModel(normalizedModelId))
  ) {
    return 'anthropic_explicit'
  }

  return 'disabled'
}
