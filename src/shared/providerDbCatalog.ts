const PROVIDER_DB_BACKED_PROVIDER_IDS = new Set([
  'alibaba-token-plan',
  'alibaba-token-plan-cn',
  'doubao',
  'huggingface',
  'minimax-global',
  'zhipu',
  'minimax',
  'mistral',
  'moonshot-ai',
  'nvidia',
  'o3fan',
  'stepfun',
  'upstage',
  'kimi-for-coding',
  'openai-codex'
])

export const isProviderDbBackedProvider = (providerId: string | undefined | null): boolean => {
  if (!providerId) {
    return false
  }

  return PROVIDER_DB_BACKED_PROVIDER_IDS.has(providerId.trim().toLowerCase())
}
