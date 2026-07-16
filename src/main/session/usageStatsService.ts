import type { ProviderSettingsPort } from '@/provider/settings'
import logger from '@shared/logger'

import type {
  UsageDashboardBreakdownItem,
  UsageDashboardData,
  UsageStatsBackfillStatus
} from '@shared/types/agent-interface'
import {
  RTK_ENABLED_SETTING_KEY,
  rtkRuntimeService
} from '@/agent/shared/process/rtkRuntimeService'
import type { SessionDatabase } from '@/session/data/database'
import type { DeepChatMessageUsageCandidateRow } from '@/session/data/tables/deepchatMessages'
import type { StartupWorkloadTaskContext } from '@/app/startupWorkloadCoordinator'
import type { SettingsStore } from '@/config/settingsStore'
import {
  DASHBOARD_STATS_BACKFILL_KEY,
  buildUsageDashboardCalendar,
  buildUsageStatsRecord,
  getModelLabel,
  getProviderLabel,
  isUsageBackfillRunningStale,
  normalizeUsageStatsBackfillStatus,
  parseMessageMetadata,
  resolveUsageModelId,
  resolveUsageProviderId
} from './usageStats'

export class UsageStatsService {
  private backfillPromise: Promise<void> | null = null

  constructor(
    private readonly database: SessionDatabase,
    private readonly providerCatalog: Pick<
      ProviderSettingsPort,
      'getProviders' | 'getProviderById'
    >,
    private readonly settings: Pick<SettingsStore, 'get' | 'set'>
  ) {}

  async startBackfill(taskContext?: StartupWorkloadTaskContext): Promise<void> {
    const currentStatus = this.getBackfillStatus()
    if (currentStatus.status === 'completed') return
    if (currentStatus.status === 'running' && !isUsageBackfillRunningStale(currentStatus)) return
    if (this.backfillPromise) return await this.backfillPromise

    this.backfillPromise = this.runBackfill(taskContext).finally(() => {
      this.backfillPromise = null
    })
    return await this.backfillPromise
  }

  async getDashboard(): Promise<UsageDashboardData> {
    const backfillStatus = this.getBackfillStatus()
    const usageStatsTable = this.database.deepchatUsageStatsTable
    const summaryRow = usageStatsTable.getSummary()
    const mostActiveDay = usageStatsTable.getMostActiveDay()
    const recordingStartedAt = usageStatsTable.getRecordingStartedAt()
    const cacheHitRate =
      summaryRow.inputTokens > 0 ? summaryRow.cachedInputTokens / summaryRow.inputTokens : 0

    const dateFrom = new Date()
    dateFrom.setHours(0, 0, 0, 0)
    dateFrom.setDate(dateFrom.getDate() - 364)
    const calendar = buildUsageDashboardCalendar(
      usageStatsTable.getDailyCalendarRows(this.toLocalDateKey(dateFrom.getTime()))
    )
    const providerBreakdown = this.sortUsageBreakdown(
      usageStatsTable.getProviderBreakdownRows().map((row) => ({
        id: row.id,
        label: getProviderLabel(this.providerCatalog, row.id),
        messageCount: row.messageCount,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cachedInputTokens: row.cachedInputTokens,
        estimatedCostUsd: row.estimatedCostUsd
      }))
    )
    const modelBreakdown = this.sortUsageBreakdown(
      usageStatsTable.getModelBreakdownRows(10).map((row) => ({
        id: row.id,
        label: getModelLabel('', row.id),
        messageCount: row.messageCount,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cachedInputTokens: row.cachedInputTokens,
        estimatedCostUsd: row.estimatedCostUsd
      }))
    )

    return {
      recordingStartedAt,
      backfillStatus,
      summary: {
        messageCount: summaryRow.messageCount,
        sessionCount: summaryRow.sessionCount,
        inputTokens: summaryRow.inputTokens,
        outputTokens: summaryRow.outputTokens,
        totalTokens: summaryRow.totalTokens,
        cachedInputTokens: summaryRow.cachedInputTokens,
        cacheHitRate,
        estimatedCostUsd: summaryRow.estimatedCostUsd,
        mostActiveDay
      },
      calendar,
      providerBreakdown,
      modelBreakdown,
      rtk: await rtkRuntimeService.getDashboardData(
        this.settings.get<boolean>(RTK_ENABLED_SETTING_KEY) !== false
      )
    }
  }

  private async runBackfill(taskContext?: StartupWorkloadTaskContext): Promise<void> {
    const startedAt = Date.now()
    const batchSize = 50
    this.setBackfillStatus({
      status: 'running',
      startedAt,
      finishedAt: null,
      error: null,
      updatedAt: startedAt,
      processedCount: 0
    })

    try {
      const usageStatsTable = this.database.deepchatUsageStatsTable
      let processedCount = 0
      let scannedSinceYield = 0
      const yieldProgress = async (): Promise<void> => {
        this.setBackfillStatus({
          status: 'running',
          startedAt,
          finishedAt: null,
          error: null,
          updatedAt: Date.now(),
          processedCount
        })
        await (taskContext?.yield() ?? this.yieldToEventLoop())
      }

      let candidateCursor: { createdAt: number; id: string } | null = null
      while (true) {
        const candidates = this.listAssistantUsageCandidatePage(candidateCursor, batchSize)
        if (candidates.length === 0) break
        for (const row of candidates) {
          candidateCursor = { createdAt: row.created_at, id: row.id }
          scannedSinceYield += 1
          const metadata = parseMessageMetadata(row.metadata)
          if (metadata.messageType === 'compaction') continue
          const providerId = resolveUsageProviderId(metadata, row.provider_id)
          const modelId = resolveUsageModelId(metadata, row.model_id)
          if (!providerId || !modelId) continue
          const usageRecord = buildUsageStatsRecord({
            messageId: row.id,
            sessionId: row.session_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            providerId,
            modelId,
            metadata: {
              ...metadata,
              cachedInputTokens: metadata.cachedInputTokens ?? 0,
              cacheWriteInputTokens: metadata.cacheWriteInputTokens ?? 0
            },
            source: 'backfill'
          })
          if (!usageRecord) continue
          usageStatsTable.upsert(usageRecord)
          processedCount += 1
        }
        if (scannedSinceYield >= batchSize) {
          scannedSinceYield = 0
          await yieldProgress()
        }
      }

      const finishedAt = Date.now()
      const durationMs = finishedAt - startedAt
      this.setBackfillStatus({
        status: 'completed',
        startedAt,
        finishedAt,
        error: null,
        updatedAt: finishedAt,
        processedCount,
        durationMs
      })
      logger.info('[UsageStatsBackfill] Backfill completed', { processedCount, durationMs })
    } catch (error) {
      const finishedAt = Date.now()
      this.setBackfillStatus({
        status: 'failed',
        startedAt,
        finishedAt,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: finishedAt,
        durationMs: finishedAt - startedAt
      })
      throw error
    }
  }

  private listAssistantUsageCandidatePage(
    cursor: { createdAt: number; id: string } | null,
    limit: number
  ): DeepChatMessageUsageCandidateRow[] {
    const table = this.database.deepchatMessagesTable as {
      listAssistantUsageCandidatesPage?: (
        cursor: { createdAt: number; id: string } | null,
        limit: number
      ) => DeepChatMessageUsageCandidateRow[]
      listAssistantUsageCandidates: () => DeepChatMessageUsageCandidateRow[]
    }
    if (table.listAssistantUsageCandidatesPage) {
      return table.listAssistantUsageCandidatesPage(cursor, limit)
    }
    const candidates = [...table.listAssistantUsageCandidates()].sort(
      (left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id)
    )
    if (!cursor) return candidates.slice(0, limit)
    return candidates
      .filter(
        (row) =>
          row.created_at > cursor.createdAt ||
          (row.created_at === cursor.createdAt && row.id > cursor.id)
      )
      .slice(0, limit)
  }

  private getBackfillStatus(): UsageStatsBackfillStatus {
    const normalized = this.normalizeBackfillStatus(
      this.settings.get<UsageStatsBackfillStatus>(DASHBOARD_STATS_BACKFILL_KEY)
    )
    if (normalized.status === 'failed' && normalized.error === 'Usage stats backfill timed out') {
      this.settings.set(DASHBOARD_STATS_BACKFILL_KEY, normalized)
    }
    return normalized
  }

  private setBackfillStatus(status: UsageStatsBackfillStatus): void {
    this.settings.set(DASHBOARD_STATS_BACKFILL_KEY, status)
  }

  private normalizeBackfillStatus(status: unknown): UsageStatsBackfillStatus {
    const normalized = normalizeUsageStatsBackfillStatus(status)
    if (isUsageBackfillRunningStale(normalized)) {
      return {
        status: 'failed',
        startedAt: normalized.startedAt,
        finishedAt: normalized.finishedAt,
        error: normalized.error ?? 'Usage stats backfill timed out',
        updatedAt: Date.now()
      }
    }
    return normalized
  }

  private sortUsageBreakdown(items: UsageDashboardBreakdownItem[]): UsageDashboardBreakdownItem[] {
    return [...items].sort((left, right) => {
      const leftCost = left.estimatedCostUsd ?? -1
      const rightCost = right.estimatedCostUsd ?? -1
      if (rightCost !== leftCost) return rightCost - leftCost
      if (right.totalTokens !== left.totalTokens) return right.totalTokens - left.totalTokens
      return left.label.localeCompare(right.label)
    })
  }

  private toLocalDateKey(timestamp: number): string {
    const date = new Date(timestamp)
    const year = date.getFullYear()
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}
