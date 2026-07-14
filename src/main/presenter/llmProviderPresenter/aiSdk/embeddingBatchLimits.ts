import { normalizeCapabilityModelId } from '@/presenter/configPresenter/modelCapabilities'

export const EMBEDDING_BATCH_LIMIT_TTL_MS = 60 * 60 * 1000

const STATIC_EMBEDDING_BATCH_LIMITS: Readonly<Record<string, number>> = {
  'text-embedding-v4': 10
}

type LearnedBatchLimit = {
  limit: number
  lastUsedAt: number
}

const learnedBatchLimits = new Map<string, LearnedBatchLimit>()

const normalizeProviderId = (providerId: string): string => providerId.trim().toLowerCase()

const getCacheKey = (providerId: string, modelId: string): string =>
  `${normalizeProviderId(providerId)}:${normalizeCapabilityModelId(modelId)}`

const getLearnedBatchLimit = (
  providerId: string,
  modelId: string,
  now: number
): LearnedBatchLimit | undefined => {
  const key = getCacheKey(providerId, modelId)
  const learned = learnedBatchLimits.get(key)
  if (!learned) {
    return undefined
  }

  if (now - learned.lastUsedAt >= EMBEDDING_BATCH_LIMIT_TTL_MS) {
    learnedBatchLimits.delete(key)
    return undefined
  }

  return learned
}

export const resolveEmbeddingBatchLimit = (
  providerId: string,
  modelId: string,
  now = Date.now()
): number | undefined => {
  const canonicalModelId = normalizeCapabilityModelId(modelId)
  const staticLimit = STATIC_EMBEDDING_BATCH_LIMITS[canonicalModelId]
  const learnedLimit = getLearnedBatchLimit(providerId, modelId, now)?.limit

  if (staticLimit === undefined) {
    return learnedLimit
  }
  if (learnedLimit === undefined) {
    return staticLimit
  }
  return Math.min(staticLimit, learnedLimit)
}

export const learnEmbeddingBatchLimit = (
  providerId: string,
  modelId: string,
  limit: number,
  attemptedLimit: number,
  now = Date.now()
): number | undefined => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit >= attemptedLimit) {
    return resolveEmbeddingBatchLimit(providerId, modelId, now)
  }

  const currentLimit = resolveEmbeddingBatchLimit(providerId, modelId, now)
  if (currentLimit !== undefined && limit >= currentLimit) {
    return currentLimit
  }

  learnedBatchLimits.set(getCacheKey(providerId, modelId), {
    limit,
    lastUsedAt: now
  })
  return limit
}

export const refreshLearnedEmbeddingBatchLimit = (
  providerId: string,
  modelId: string,
  now = Date.now()
): void => {
  const learned = getLearnedBatchLimit(providerId, modelId, now)
  if (learned) {
    learned.lastUsedAt = now
  }
}

export const clearLearnedEmbeddingBatchLimits = (): void => {
  learnedBatchLimits.clear()
}
