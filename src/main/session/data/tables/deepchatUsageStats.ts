import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { UsageStatsCategory, UsageStatsRecordInput } from '@/session/usageStats'

export interface DeepChatUsageStatsRow {
  usage_id: string
  message_id: string | null
  usage_category: UsageStatsCategory
  compaction_attempt_id: string | null
  provider_call_id: string | null
  provider_call_seq: number | null
  session_id: string
  usage_date: string
  provider_id: string
  model_id: string
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  cached_input_tokens: number | null
  cache_write_input_tokens: number | null
  source: 'backfill' | 'live'
  created_at: number
  updated_at: number
}

type AggregateRow = {
  message_count: number
  session_count: number
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  cached_input_tokens: number | null
  cache_measured_input_tokens: number | null
}

export interface DeepChatUsageStatsSummary {
  messageCount: number
  sessionCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheMeasuredInputTokens: number
}

export interface DeepChatUsageStatsMostActiveDay {
  date: string | null
  messageCount: number
}

export interface DeepChatUsageStatsCalendarRow {
  date: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
}

export interface DeepChatUsageStatsBreakdownRow {
  id: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
}

export interface DeepChatUsageStatsCategoryRow {
  id: UsageStatsCategory
  eventCount: number
  knownUsageCount: number
  unknownUsageCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export const USAGE_STATS_CATEGORY_SCHEMA_VERSION = 68

function normalizeAggregate(row: AggregateRow | undefined): DeepChatUsageStatsSummary {
  return {
    messageCount: row?.message_count ?? 0,
    sessionCount: row?.session_count ?? 0,
    inputTokens: row?.input_tokens ?? 0,
    outputTokens: row?.output_tokens ?? 0,
    totalTokens: row?.total_tokens ?? 0,
    cachedInputTokens: row?.cached_input_tokens ?? 0,
    cacheMeasuredInputTokens: row?.cache_measured_input_tokens ?? 0
  }
}

export class DeepChatUsageStatsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_usage_stats')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_usage_stats (
        usage_id TEXT PRIMARY KEY,
        message_id TEXT,
        usage_category TEXT NOT NULL CHECK (usage_category IN ('chat', 'compaction')),
        compaction_attempt_id TEXT,
        provider_call_id TEXT,
        provider_call_seq INTEGER,
        session_id TEXT NOT NULL,
        usage_date TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        cached_input_tokens INTEGER,
        cache_write_input_tokens INTEGER,
        source TEXT NOT NULL DEFAULT 'live',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deepchat_usage_stats_date ON deepchat_usage_stats(usage_date);
      CREATE INDEX IF NOT EXISTS idx_deepchat_usage_stats_provider_date ON deepchat_usage_stats(provider_id, usage_date);
      CREATE INDEX IF NOT EXISTS idx_deepchat_usage_stats_model_date ON deepchat_usage_stats(model_id, usage_date);
      CREATE INDEX IF NOT EXISTS idx_deepchat_usage_stats_category_date ON deepchat_usage_stats(usage_category, usage_date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_deepchat_usage_stats_compaction_call
        ON deepchat_usage_stats(session_id, compaction_attempt_id, provider_call_id)
        WHERE usage_category = 'compaction';
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === 17) {
      return this.getCreateTableSQL()
    }
    if (version === 22) {
      return `ALTER TABLE deepchat_usage_stats ADD COLUMN cache_write_input_tokens INTEGER NOT NULL DEFAULT 0;`
    }
    if (version === 32) {
      return `
        CREATE TABLE deepchat_usage_stats_v32 (
          message_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          usage_date TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          cached_input_tokens INTEGER NOT NULL DEFAULT 0,
          cache_write_input_tokens INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'live',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO deepchat_usage_stats_v32 (
          message_id,
          session_id,
          usage_date,
          provider_id,
          model_id,
          input_tokens,
          output_tokens,
          total_tokens,
          cached_input_tokens,
          cache_write_input_tokens,
          source,
          created_at,
          updated_at
        )
        SELECT
          message_id,
          session_id,
          usage_date,
          provider_id,
          model_id,
          input_tokens,
          output_tokens,
          total_tokens,
          cached_input_tokens,
          cache_write_input_tokens,
          source,
          created_at,
          updated_at
        FROM deepchat_usage_stats;
        DROP TABLE deepchat_usage_stats;
        ALTER TABLE deepchat_usage_stats_v32 RENAME TO deepchat_usage_stats;
        CREATE INDEX idx_deepchat_usage_stats_date ON deepchat_usage_stats(usage_date);
        CREATE INDEX idx_deepchat_usage_stats_provider_date ON deepchat_usage_stats(provider_id, usage_date);
        CREATE INDEX idx_deepchat_usage_stats_model_date ON deepchat_usage_stats(model_id, usage_date);
      `
    }
    if (version === USAGE_STATS_CATEGORY_SCHEMA_VERSION) {
      return `
        CREATE TABLE deepchat_usage_stats_v68 (
          usage_id TEXT PRIMARY KEY,
          message_id TEXT,
          usage_category TEXT NOT NULL CHECK (usage_category IN ('chat', 'compaction')),
          compaction_attempt_id TEXT,
          provider_call_id TEXT,
          provider_call_seq INTEGER,
          session_id TEXT NOT NULL,
          usage_date TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          input_tokens INTEGER,
          output_tokens INTEGER,
          total_tokens INTEGER,
          cached_input_tokens INTEGER,
          cache_write_input_tokens INTEGER,
          source TEXT NOT NULL DEFAULT 'live',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO deepchat_usage_stats_v68 (
          usage_id,
          message_id,
          usage_category,
          compaction_attempt_id,
          provider_call_id,
          provider_call_seq,
          session_id,
          usage_date,
          provider_id,
          model_id,
          input_tokens,
          output_tokens,
          total_tokens,
          cached_input_tokens,
          cache_write_input_tokens,
          source,
          created_at,
          updated_at
        )
        SELECT
          message_id,
          message_id,
          'chat',
          NULL,
          NULL,
          NULL,
          session_id,
          usage_date,
          provider_id,
          model_id,
          input_tokens,
          output_tokens,
          total_tokens,
          cached_input_tokens,
          cache_write_input_tokens,
          source,
          created_at,
          updated_at
        FROM deepchat_usage_stats;
        DROP TABLE deepchat_usage_stats;
        ALTER TABLE deepchat_usage_stats_v68 RENAME TO deepchat_usage_stats;
        CREATE INDEX idx_deepchat_usage_stats_date ON deepchat_usage_stats(usage_date);
        CREATE INDEX idx_deepchat_usage_stats_provider_date ON deepchat_usage_stats(provider_id, usage_date);
        CREATE INDEX idx_deepchat_usage_stats_model_date ON deepchat_usage_stats(model_id, usage_date);
        CREATE INDEX idx_deepchat_usage_stats_category_date ON deepchat_usage_stats(usage_category, usage_date);
        CREATE UNIQUE INDEX idx_deepchat_usage_stats_compaction_call
          ON deepchat_usage_stats(session_id, compaction_attempt_id, provider_call_id)
          WHERE usage_category = 'compaction';
      `
    }
    return null
  }

  getLatestVersion(): number {
    return USAGE_STATS_CATEGORY_SCHEMA_VERSION
  }

  upsert(row: UsageStatsRecordInput): void {
    this.db
      .prepare(
        `INSERT INTO deepchat_usage_stats (
          usage_id,
          message_id,
          usage_category,
          compaction_attempt_id,
          provider_call_id,
          provider_call_seq,
          session_id,
          usage_date,
          provider_id,
          model_id,
          input_tokens,
          output_tokens,
          total_tokens,
          cached_input_tokens,
          cache_write_input_tokens,
          source,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(usage_id) DO UPDATE SET
          message_id = excluded.message_id,
          usage_category = excluded.usage_category,
          compaction_attempt_id = excluded.compaction_attempt_id,
          provider_call_id = excluded.provider_call_id,
          provider_call_seq = excluded.provider_call_seq,
          session_id = excluded.session_id,
          usage_date = excluded.usage_date,
          provider_id = excluded.provider_id,
          model_id = excluded.model_id,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          total_tokens = excluded.total_tokens,
          cached_input_tokens = excluded.cached_input_tokens,
          cache_write_input_tokens = excluded.cache_write_input_tokens,
          source = excluded.source,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
        WHERE deepchat_usage_stats.source != 'live' OR excluded.source = 'live'`
      )
      .run(
        row.usageId,
        row.messageId,
        row.category,
        row.compactionAttemptId,
        row.providerCallId,
        row.providerCallSeq,
        row.sessionId,
        row.usageDate,
        row.providerId,
        row.modelId,
        row.inputTokens,
        row.outputTokens,
        row.totalTokens,
        row.cachedInputTokens,
        row.cacheWriteInputTokens,
        row.source,
        row.createdAt,
        row.updatedAt
      )
  }

  getByMessageId(messageId: string): DeepChatUsageStatsRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM deepchat_usage_stats
         WHERE message_id = ? AND usage_category = 'chat'
         LIMIT 1`
      )
      .get(messageId) as DeepChatUsageStatsRow | undefined
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM deepchat_usage_stats').get() as {
      count: number
    }
    return row.count
  }

  deleteAll(): void {
    this.db.prepare('DELETE FROM deepchat_usage_stats').run()
  }

  getRecordingStartedAt(): number | null {
    const row = this.db
      .prepare(
        "SELECT MIN(created_at) AS started_at FROM deepchat_usage_stats WHERE usage_category = 'chat'"
      )
      .get() as { started_at: number | null }
    return row.started_at ?? null
  }

  getSummary(): DeepChatUsageStatsSummary {
    const row = this.db
      .prepare(
        `SELECT
          SUM(CASE WHEN usage_category = 'chat' THEN 1 ELSE 0 END) AS message_count,
          COUNT(DISTINCT CASE WHEN usage_category = 'chat' THEN session_id END) AS session_count,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,
          SUM(total_tokens) AS total_tokens,
          SUM(cached_input_tokens) AS cached_input_tokens,
          SUM(CASE WHEN cached_input_tokens IS NOT NULL THEN input_tokens ELSE 0 END)
            AS cache_measured_input_tokens
        FROM deepchat_usage_stats`
      )
      .get() as AggregateRow | undefined

    return normalizeAggregate(row)
  }

  getMostActiveDay(): DeepChatUsageStatsMostActiveDay {
    const row = this.db
      .prepare(
        `SELECT
          usage_date AS date,
          COUNT(*) AS message_count
        FROM deepchat_usage_stats
        WHERE usage_category = 'chat'
        GROUP BY usage_date
        ORDER BY message_count DESC, usage_date ASC
        LIMIT 1`
      )
      .get() as { date: string | null; message_count: number | null } | undefined

    return {
      date: row?.date ?? null,
      messageCount: row?.message_count ?? 0
    }
  }

  getDailyCalendarRows(dateFrom: string): DeepChatUsageStatsCalendarRow[] {
    const rows = this.db
      .prepare(
        `SELECT
          usage_date AS date,
          SUM(CASE WHEN usage_category = 'chat' THEN 1 ELSE 0 END) AS message_count,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,
          SUM(total_tokens) AS total_tokens,
          SUM(cached_input_tokens) AS cached_input_tokens,
          SUM(CASE WHEN cached_input_tokens IS NOT NULL THEN input_tokens ELSE 0 END)
            AS cache_measured_input_tokens
        FROM deepchat_usage_stats
        WHERE usage_category = 'chat' AND usage_date >= ?
        GROUP BY usage_date
        ORDER BY usage_date ASC`
      )
      .all(dateFrom) as Array<AggregateRow & { date: string }>

    return rows.map((row) => ({
      date: row.date,
      messageCount: row.message_count,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      totalTokens: row.total_tokens ?? 0,
      cachedInputTokens: row.cached_input_tokens ?? 0
    }))
  }

  getProviderBreakdownRows(): DeepChatUsageStatsBreakdownRow[] {
    const rows = this.db
      .prepare(
        `SELECT
          provider_id AS id,
          SUM(CASE WHEN usage_category = 'chat' THEN 1 ELSE 0 END) AS message_count,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,
          SUM(total_tokens) AS total_tokens,
          SUM(cached_input_tokens) AS cached_input_tokens
        FROM deepchat_usage_stats
        WHERE input_tokens IS NOT NULL
          OR output_tokens IS NOT NULL
          OR total_tokens IS NOT NULL
        GROUP BY provider_id`
      )
      .all() as Array<AggregateRow & { id: string }>

    return rows.map((row) => ({
      id: row.id,
      messageCount: row.message_count,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      totalTokens: row.total_tokens ?? 0,
      cachedInputTokens: row.cached_input_tokens ?? 0
    }))
  }

  getModelBreakdownRows(limit = 10): DeepChatUsageStatsBreakdownRow[] {
    const rows = this.db
      .prepare(
        `SELECT
          model_id AS id,
          SUM(CASE WHEN usage_category = 'chat' THEN 1 ELSE 0 END) AS message_count,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,
          SUM(total_tokens) AS total_tokens,
          SUM(cached_input_tokens) AS cached_input_tokens
        FROM deepchat_usage_stats
        WHERE input_tokens IS NOT NULL
          OR output_tokens IS NOT NULL
          OR total_tokens IS NOT NULL
        GROUP BY model_id
        ORDER BY SUM(total_tokens) DESC, model_id ASC
        LIMIT ?`
      )
      .all(limit) as Array<AggregateRow & { id: string }>

    return rows.map((row) => ({
      id: row.id,
      messageCount: row.message_count,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      totalTokens: row.total_tokens ?? 0,
      cachedInputTokens: row.cached_input_tokens ?? 0
    }))
  }

  getCategoryBreakdownRows(): DeepChatUsageStatsCategoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT
          usage_category AS id,
          COUNT(*) AS event_count,
          SUM(CASE WHEN input_tokens IS NOT NULL
            OR output_tokens IS NOT NULL
            OR total_tokens IS NOT NULL THEN 1 ELSE 0 END) AS known_usage_count,
          SUM(CASE WHEN input_tokens IS NULL
            AND output_tokens IS NULL
            AND total_tokens IS NULL THEN 1 ELSE 0 END) AS unknown_usage_count,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,
          SUM(total_tokens) AS total_tokens
        FROM deepchat_usage_stats
        GROUP BY usage_category
        ORDER BY usage_category ASC`
      )
      .all() as Array<{
      id: UsageStatsCategory
      event_count: number
      known_usage_count: number
      unknown_usage_count: number
      input_tokens: number | null
      output_tokens: number | null
      total_tokens: number | null
    }>

    return rows.map((row) => ({
      id: row.id,
      eventCount: row.event_count,
      knownUsageCount: row.known_usage_count,
      unknownUsageCount: row.unknown_usage_count,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      totalTokens: row.total_tokens ?? 0
    }))
  }
}
