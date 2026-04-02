import type {
  MessageMetadata,
  UsageDashboardCalendarDay,
  UsageStatsBackfillStatus
} from '@shared/types/agent-interface'
import type { IConfigPresenter } from '@shared/presenter'
import type { ProviderModel } from '@shared/types/model-db'
import { providerDbLoader } from './configPresenter/providerDbLoader'

export const DASHBOARD_STATS_BACKFILL_KEY = 'dashboardStatsBackfillV1'
export const DASHBOARD_BACKFILL_STALE_MS = 10 * 60 * 1000

export type UsageStatsSource = 'backfill' | 'live'

export interface UsageStatsRecordInput {
  messageId: string
  sessionId: string
  usageDate: string
  providerId: string
  modelId: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  estimatedCostUsd: number | null
  source: UsageStatsSource
  createdAt: number
  updatedAt: number
}

export interface UsageCalendarBucket {
  date: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  estimatedCostUsd: number | null
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toNonNegativeInteger(value: unknown): number | undefined {
  const normalized = toFiniteNumber(value)
  if (normalized === undefined) {
    return undefined
  }
  return Math.max(0, Math.round(normalized))
}

function normalizeTextId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function getCostNumber(model: ProviderModel | undefined, key: string): number | undefined {
  const raw = model?.cost?.[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function resolvePricedModel(providerId: string, modelId: string): ProviderModel | undefined {
  return (
    providerDbLoader.getModel(providerId, modelId) ?? providerDbLoader.getModel('aihubmix', modelId)
  )
}

function getPercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) {
    return 0
  }
  const index = Math.min(sorted.length - 1, Math.floor(percentile * (sorted.length - 1)))
  return sorted[index]
}

export function getDefaultUsageStatsBackfillStatus(): UsageStatsBackfillStatus {
  return {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    error: null,
    updatedAt: 0
  }
}

export function normalizeUsageStatsBackfillStatus(value: unknown): UsageStatsBackfillStatus {
  if (!value || typeof value !== 'object') {
    return getDefaultUsageStatsBackfillStatus()
  }

  const input = value as Record<string, unknown>
  const status =
    input.status === 'running' ||
    input.status === 'completed' ||
    input.status === 'failed' ||
    input.status === 'idle'
      ? input.status
      : 'idle'

  return {
    status,
    startedAt: toFiniteNumber(input.startedAt) ?? null,
    finishedAt: toFiniteNumber(input.finishedAt) ?? null,
    error: typeof input.error === 'string' ? input.error : null,
    updatedAt: toFiniteNumber(input.updatedAt) ?? 0
  }
}

export function isUsageBackfillRunningStale(
  status: UsageStatsBackfillStatus,
  now = Date.now()
): boolean {
  return status.status === 'running' && now - status.updatedAt > DASHBOARD_BACKFILL_STALE_MS
}

export function parseMessageMetadata(raw: string | MessageMetadata): MessageMetadata {
  if (typeof raw !== 'string') {
    return raw ?? {}
  }

  try {
    const parsed = JSON.parse(raw) as MessageMetadata
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function hasUsageNumbers(metadata: MessageMetadata): boolean {
  return (
    toFiniteNumber(metadata.totalTokens) !== undefined ||
    toFiniteNumber(metadata.inputTokens) !== undefined ||
    toFiniteNumber(metadata.outputTokens) !== undefined
  )
}

export function normalizeUsageCounts(metadata: MessageMetadata): {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
} {
  const inputTokens = toNonNegativeInteger(metadata.inputTokens) ?? 0
  const outputTokens = toNonNegativeInteger(metadata.outputTokens) ?? 0
  const totalTokens = toNonNegativeInteger(metadata.totalTokens) ?? inputTokens + outputTokens
  const rawCached = toNonNegativeInteger(metadata.cachedInputTokens) ?? 0
  const rawCacheWrite = toNonNegativeInteger(metadata.cacheWriteInputTokens) ?? 0
  const cappedCachedInputTokens = inputTokens > 0 ? Math.min(rawCached, inputTokens) : rawCached
  const remainingInputTokens = Math.max(inputTokens - cappedCachedInputTokens, 0)
  const cacheWriteInputTokens =
    inputTokens > 0 ? Math.min(rawCacheWrite, remainingInputTokens) : rawCacheWrite

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: cappedCachedInputTokens,
    cacheWriteInputTokens
  }
}

export function getLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function resolveUsageProviderId(
  metadata: MessageMetadata,
  fallbackProviderId?: string | null
): string | null {
  return normalizeTextId(metadata.provider) ?? normalizeTextId(fallbackProviderId) ?? null
}

export function resolveUsageModelId(
  metadata: MessageMetadata,
  fallbackModelId?: string | null
): string | null {
  return normalizeTextId(metadata.model) ?? normalizeTextId(fallbackModelId) ?? null
}

export function estimateUsageCostUsd(params: {
  providerId: string
  modelId: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
}): number | null {
  const model = resolvePricedModel(params.providerId, params.modelId)
  const inputRate = getCostNumber(model, 'input')
  const outputRate = getCostNumber(model, 'output')

  if (inputRate === undefined || outputRate === undefined) {
    return null
  }

  const cacheReadRate = getCostNumber(model, 'cache_read')
  const cacheWriteRate = getCostNumber(model, 'cache_write')
  const uncachedInput = Math.max(
    params.inputTokens - params.cachedInputTokens - params.cacheWriteInputTokens,
    0
  )

  return (
    (uncachedInput * inputRate +
      params.outputTokens * outputRate +
      params.cachedInputTokens * (cacheReadRate ?? inputRate) +
      params.cacheWriteInputTokens * (cacheWriteRate ?? inputRate)) /
    1_000_000
  )
}

export function buildUsageStatsRecord(params: {
  messageId: string
  sessionId: string
  createdAt: number
  updatedAt: number
  providerId: string
  modelId: string
  metadata: MessageMetadata
  source: UsageStatsSource
}): UsageStatsRecordInput | null {
  if (!hasUsageNumbers(params.metadata)) {
    return null
  }

  const usage = normalizeUsageCounts(params.metadata)
  const providerId = normalizeTextId(params.providerId)
  const modelId = normalizeTextId(params.modelId)

  if (!providerId || !modelId) {
    return null
  }

  return {
    messageId: params.messageId,
    sessionId: params.sessionId,
    usageDate: getLocalDateKey(params.createdAt),
    providerId,
    modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    estimatedCostUsd: estimateUsageCostUsd({
      providerId,
      modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteInputTokens: usage.cacheWriteInputTokens
    }),
    source: params.source,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt
  }
}

export function getProviderLabel(configPresenter: IConfigPresenter, providerId: string): string {
  const provider =
    configPresenter.getProviders().find((item) => item.id === providerId) ??
    configPresenter.getProviderById(providerId)

  if (provider?.name?.trim()) {
    return provider.name.trim()
  }

  const dbProvider = providerDbLoader.getProvider(providerId)
  return dbProvider?.display_name || dbProvider?.name || providerId
}

export function getModelLabel(providerId: string, modelId: string): string {
  const model =
    providerDbLoader.getModel(providerId, modelId) ?? providerDbLoader.getModel('aihubmix', modelId)
  return model?.display_name || model?.name || modelId
}

export function buildUsageDashboardCalendar(
  buckets: UsageCalendarBucket[],
  totalDays = 365
): UsageDashboardCalendarDay[] {
  const today = new Date()
  const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  startDate.setDate(startDate.getDate() - (totalDays - 1))

  const bucketMap = new Map(buckets.map((item) => [item.date, item]))
  const days: UsageDashboardCalendarDay[] = []

  for (let offset = 0; offset < totalDays; offset += 1) {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + offset)
    const dateKey = getLocalDateKey(date.getTime())
    const bucket = bucketMap.get(dateKey)
    days.push({
      date: dateKey,
      messageCount: bucket?.messageCount ?? 0,
      inputTokens: bucket?.inputTokens ?? 0,
      outputTokens: bucket?.outputTokens ?? 0,
      totalTokens: bucket?.totalTokens ?? 0,
      cachedInputTokens: bucket?.cachedInputTokens ?? 0,
      estimatedCostUsd: bucket?.estimatedCostUsd ?? null,
      level: 0
    })
  }

  const nonZeroTotals = days
    .map((item) => item.totalTokens)
    .filter((value) => value > 0)
    .sort((a, b) => a - b)

  const q1 = getPercentile(nonZeroTotals, 0.25)
  const q2 = getPercentile(nonZeroTotals, 0.5)
  const q3 = getPercentile(nonZeroTotals, 0.75)

  return days.map((item) => {
    if (item.totalTokens <= 0) {
      return item
    }
    if (item.totalTokens <= q1) {
      return { ...item, level: 1 }
    }
    if (item.totalTokens <= q2) {
      return { ...item, level: 2 }
    }
    if (item.totalTokens <= q3) {
      return { ...item, level: 3 }
    }
    return { ...item, level: 4 }
  })
}
