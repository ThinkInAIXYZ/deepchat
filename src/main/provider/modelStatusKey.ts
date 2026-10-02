export const LEGACY_MODEL_STATUS_KEY_PREFIX = 'model_status_'
export const MODEL_STATUS_KEY_PREFIX = 'model_status_v2_'

export const encodeModelStatusKey = (providerId: string, modelId: string): string =>
  `${MODEL_STATUS_KEY_PREFIX}${encodeURIComponent(providerId)}|${encodeURIComponent(modelId)}`

export const decodeModelStatusKey = (
  key: string
): { providerId: string; modelId: string } | undefined => {
  if (!key.startsWith(MODEL_STATUS_KEY_PREFIX)) return undefined

  const separatorIndex = key.indexOf('|', MODEL_STATUS_KEY_PREFIX.length)
  if (separatorIndex === -1) return undefined

  try {
    return {
      providerId: decodeURIComponent(key.slice(MODEL_STATUS_KEY_PREFIX.length, separatorIndex)),
      modelId: decodeURIComponent(key.slice(separatorIndex + 1))
    }
  } catch {
    return undefined
  }
}

export const encodeLegacyModelStatusKey = (providerId: string, modelId: string): string =>
  `${LEGACY_MODEL_STATUS_KEY_PREFIX}${providerId}_${modelId.replace(/\./g, '-')}`
