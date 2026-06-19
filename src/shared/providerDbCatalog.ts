const PROVIDER_DB_BACKED_PROVIDER_IDS = new Set([
  'doubao',
  'zhipu',
  'minimax',
  'mistral',
  'o3fan',
  'openai-codex'
])

export const isProviderDbBackedProvider = (providerId: string | undefined | null): boolean => {
  if (!providerId) {
    return false
  }

  return PROVIDER_DB_BACKED_PROVIDER_IDS.has(providerId.trim().toLowerCase())
}
