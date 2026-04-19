import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'
import type { SessionGenerationSettings } from '@shared/types/agent-interface'
import {
  isReasoningEffort,
  isReasoningVisibility,
  isVerbosity,
  type ReasoningEffort,
  type ReasoningVisibility
} from '@shared/types/model-db'

type DeepChatSessionGenerationSettings = Pick<
  SessionGenerationSettings,
  | 'systemPrompt'
  | 'temperature'
  | 'contextLength'
  | 'maxTokens'
  | 'thinkingBudget'
  | 'reasoningEffort'
  | 'reasoningVisibility'
  | 'verbosity'
  | 'forceInterleavedThinkingCompat'
>

export interface DeepChatSessionRow {
  id: string
  provider_id: string
  model_id: string
  permission_mode: 'default' | 'full_access'
  system_prompt: string | null
  temperature: number | null
  context_length: number | null
  max_tokens: number | null
  thinking_budget: number | null
  reasoning_effort: ReasoningEffort | null
  reasoning_visibility: ReasoningVisibility | null
  verbosity: 'low' | 'medium' | 'high' | null
  force_interleaved_thinking_compat: number | null
  summary_text: string | null
  summary_cursor_order_seq: number | null
  summary_updated_at: number | null
}

export interface DeepChatSessionSummaryRow {
  summary_text: string | null
  summary_cursor_order_seq: number | null
  summary_updated_at: number | null
}

export class DeepChatSessionsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_sessions')
  }

  getCreateTableSQL(): string {
    return this.getCreateTableSQLForVersion(this.getLatestVersion())
  }

  override createTable(): void {
    if (this.tableExists()) {
      return
    }

    const recordedVersion = this.getRecordedSchemaVersion()
    const latestVersion = this.getLatestVersion()

    if (recordedVersion > latestVersion) {
      const message = `Recorded deepchat_sessions schema version ${recordedVersion} exceeds supported version ${latestVersion}. Refusing to create table from a downgraded schema.`
      console.error(message)
      throw new Error(message)
    }

    this.db.exec(this.getCreateTableSQLForVersion(recordedVersion))
  }

  private getCreateTableSQLForVersion(version: number): string {
    const columns = [
      'id TEXT PRIMARY KEY',
      'provider_id TEXT NOT NULL',
      'model_id TEXT NOT NULL',
      "permission_mode TEXT NOT NULL DEFAULT 'full_access'"
    ]

    if (version >= 12) {
      columns.push(
        'system_prompt TEXT',
        'temperature REAL',
        'context_length INTEGER',
        'max_tokens INTEGER',
        'thinking_budget INTEGER',
        'reasoning_effort TEXT',
        'verbosity TEXT'
      )
    }

    if (version >= 14) {
      columns.push(
        'summary_text TEXT',
        'summary_cursor_order_seq INTEGER NOT NULL DEFAULT 1',
        'summary_updated_at INTEGER'
      )
    }

    if (version >= 19) {
      columns.push('force_interleaved_thinking_compat INTEGER')
    }

    if (version >= 20) {
      columns.push('reasoning_visibility TEXT')
    }

    return `
      CREATE TABLE IF NOT EXISTS deepchat_sessions (
        ${columns.join(',\n        ')}
      );
    `
  }

  private getRecoveryMigrationStatements(): string[] {
    if (!this.tableExists()) {
      return []
    }

    const statements: string[] = []

    if (!this.hasColumn('system_prompt')) {
      statements.push('ALTER TABLE deepchat_sessions ADD COLUMN system_prompt TEXT;')
    }
    if (!this.hasColumn('temperature')) {
      statements.push('ALTER TABLE deepchat_sessions ADD COLUMN temperature REAL;')
    }
    if (!this.hasColumn('context_length')) {
      statements.push('ALTER TABLE deepchat_sessions ADD COLUMN context_length INTEGER;')
    }
    if (!this.hasColumn('max_tokens')) {
      statements.push('ALTER TABLE deepchat_sessions ADD COLUMN max_tokens INTEGER;')
    }
    if (!this.hasColumn('thinking_budget')) {
      statements.push('ALTER TABLE deepchat_sessions ADD COLUMN thinking_budget INTEGER;')
    }
    if (!this.hasColumn('reasoning_effort')) {
      statements.push('ALTER TABLE deepchat_sessions ADD COLUMN reasoning_effort TEXT;')
    }
    if (!this.hasColumn('verbosity')) {
      statements.push('ALTER TABLE deepchat_sessions ADD COLUMN verbosity TEXT;')
    }
    if (!this.hasColumn('summary_text')) {
      statements.push('ALTER TABLE deepchat_sessions ADD COLUMN summary_text TEXT;')
    }
    if (!this.hasColumn('summary_cursor_order_seq')) {
      statements.push(
        'ALTER TABLE deepchat_sessions ADD COLUMN summary_cursor_order_seq INTEGER NOT NULL DEFAULT 1;'
      )
    }
    if (!this.hasColumn('summary_updated_at')) {
      statements.push('ALTER TABLE deepchat_sessions ADD COLUMN summary_updated_at INTEGER;')
    }
    if (!this.hasColumn('force_interleaved_thinking_compat')) {
      statements.push(
        'ALTER TABLE deepchat_sessions ADD COLUMN force_interleaved_thinking_compat INTEGER;'
      )
    }
    if (!this.hasColumn('reasoning_visibility')) {
      statements.push('ALTER TABLE deepchat_sessions ADD COLUMN reasoning_visibility TEXT;')
    }

    return statements
  }

  getMigrationSQL(version: number): string | null {
    if (version === 12) {
      return `
        ALTER TABLE deepchat_sessions ADD COLUMN system_prompt TEXT;
        ALTER TABLE deepchat_sessions ADD COLUMN temperature REAL;
        ALTER TABLE deepchat_sessions ADD COLUMN context_length INTEGER;
        ALTER TABLE deepchat_sessions ADD COLUMN max_tokens INTEGER;
        ALTER TABLE deepchat_sessions ADD COLUMN thinking_budget INTEGER;
        ALTER TABLE deepchat_sessions ADD COLUMN reasoning_effort TEXT;
        ALTER TABLE deepchat_sessions ADD COLUMN verbosity TEXT;
      `
    }
    if (version === 14) {
      return `
        ALTER TABLE deepchat_sessions ADD COLUMN summary_text TEXT;
        ALTER TABLE deepchat_sessions ADD COLUMN summary_cursor_order_seq INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE deepchat_sessions ADD COLUMN summary_updated_at INTEGER;
      `
    }
    if (version === 19) {
      return `
        ALTER TABLE deepchat_sessions ADD COLUMN force_interleaved_thinking_compat INTEGER;
      `
    }
    if (version === 20) {
      return `
        ALTER TABLE deepchat_sessions ADD COLUMN reasoning_visibility TEXT;
      `
    }
    if (version === 23) {
      const statements = this.getRecoveryMigrationStatements()
      return statements.length > 0 ? statements.join('\n') : null
    }
    return null
  }

  getLatestVersion(): number {
    return 23
  }

  create(
    id: string,
    providerId: string,
    modelId: string,
    permissionMode: 'default' | 'full_access' = 'full_access',
    generationSettings?: Partial<DeepChatSessionGenerationSettings>
  ): void {
    this.db
      .prepare(
        `INSERT INTO deepchat_sessions (
           id,
           provider_id,
           model_id,
           permission_mode,
           system_prompt,
           temperature,
           context_length,
           max_tokens,
           thinking_budget,
           reasoning_effort,
           reasoning_visibility,
           verbosity,
           force_interleaved_thinking_compat,
           summary_text,
           summary_cursor_order_seq,
           summary_updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        providerId,
        modelId,
        permissionMode,
        generationSettings?.systemPrompt ?? null,
        generationSettings?.temperature ?? null,
        generationSettings?.contextLength ?? null,
        generationSettings?.maxTokens ?? null,
        generationSettings?.thinkingBudget ?? null,
        generationSettings?.reasoningEffort ?? null,
        generationSettings?.reasoningVisibility ?? null,
        generationSettings?.verbosity ?? null,
        generationSettings?.forceInterleavedThinkingCompat === undefined
          ? null
          : generationSettings.forceInterleavedThinkingCompat
            ? 1
            : 0,
        null,
        1,
        null
      )
  }

  get(id: string): DeepChatSessionRow | undefined {
    return this.db.prepare('SELECT * FROM deepchat_sessions WHERE id = ?').get(id) as
      | DeepChatSessionRow
      | undefined
  }

  getGenerationSettings(id: string): Partial<DeepChatSessionGenerationSettings> | null {
    const row = this.get(id)
    if (!row) {
      return null
    }

    const settings: Partial<DeepChatSessionGenerationSettings> = {}

    if (row.system_prompt !== null) {
      settings.systemPrompt = row.system_prompt
    }
    if (row.temperature !== null) {
      settings.temperature = row.temperature
    }
    if (row.context_length !== null) {
      settings.contextLength = row.context_length
    }
    if (row.max_tokens !== null) {
      settings.maxTokens = row.max_tokens
    }
    if (row.thinking_budget !== null) {
      settings.thinkingBudget = row.thinking_budget
    }
    if (row.reasoning_effort !== null && isReasoningEffort(row.reasoning_effort)) {
      settings.reasoningEffort = row.reasoning_effort
    }
    if (row.reasoning_visibility !== null && isReasoningVisibility(row.reasoning_visibility)) {
      settings.reasoningVisibility = row.reasoning_visibility
    }
    if (row.verbosity !== null && isVerbosity(row.verbosity)) {
      settings.verbosity = row.verbosity
    }
    if (typeof row.force_interleaved_thinking_compat === 'number') {
      settings.forceInterleavedThinkingCompat = row.force_interleaved_thinking_compat === 1
    }

    return settings
  }

  updatePermissionMode(id: string, mode: 'default' | 'full_access'): void {
    this.db.prepare('UPDATE deepchat_sessions SET permission_mode = ? WHERE id = ?').run(mode, id)
  }

  updateSessionModel(id: string, providerId: string, modelId: string): void {
    this.db
      .prepare('UPDATE deepchat_sessions SET provider_id = ?, model_id = ? WHERE id = ?')
      .run(providerId, modelId, id)
  }

  updateGenerationSettings(id: string, settings: Partial<DeepChatSessionGenerationSettings>): void {
    const updates: string[] = []
    const params: unknown[] = []

    if (Object.prototype.hasOwnProperty.call(settings, 'systemPrompt')) {
      updates.push('system_prompt = ?')
      params.push(settings.systemPrompt ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'temperature')) {
      updates.push('temperature = ?')
      params.push(settings.temperature ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'contextLength')) {
      updates.push('context_length = ?')
      params.push(settings.contextLength ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'maxTokens')) {
      updates.push('max_tokens = ?')
      params.push(settings.maxTokens ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'thinkingBudget')) {
      updates.push('thinking_budget = ?')
      params.push(settings.thinkingBudget ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'reasoningEffort')) {
      updates.push('reasoning_effort = ?')
      params.push(settings.reasoningEffort ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'reasoningVisibility')) {
      updates.push('reasoning_visibility = ?')
      params.push(settings.reasoningVisibility ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'verbosity')) {
      updates.push('verbosity = ?')
      params.push(settings.verbosity ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'forceInterleavedThinkingCompat')) {
      updates.push('force_interleaved_thinking_compat = ?')
      params.push(
        settings.forceInterleavedThinkingCompat === undefined
          ? null
          : settings.forceInterleavedThinkingCompat
            ? 1
            : 0
      )
    }

    if (updates.length === 0) {
      return
    }

    params.push(id)
    this.db
      .prepare(`UPDATE deepchat_sessions SET ${updates.join(', ')} WHERE id = ?`)
      .run(...params)
  }

  getSummaryState(id: string): DeepChatSessionSummaryRow | null {
    const row = this.db
      .prepare(
        'SELECT summary_text, summary_cursor_order_seq, summary_updated_at FROM deepchat_sessions WHERE id = ?'
      )
      .get(id) as DeepChatSessionSummaryRow | undefined

    return row ?? null
  }

  updateSummaryState(
    id: string,
    state: {
      summaryText: string | null
      summaryCursorOrderSeq: number
      summaryUpdatedAt: number | null
    }
  ): void {
    this.db
      .prepare(
        `UPDATE deepchat_sessions
         SET summary_text = ?, summary_cursor_order_seq = ?, summary_updated_at = ?
         WHERE id = ?`
      )
      .run(
        state.summaryText ?? null,
        Math.max(1, state.summaryCursorOrderSeq),
        state.summaryUpdatedAt ?? null,
        id
      )
  }

  updateSummaryStateIfMatches(
    id: string,
    state: {
      summaryText: string | null
      summaryCursorOrderSeq: number
      summaryUpdatedAt: number | null
    },
    expectedState: {
      summaryText: string | null
      summaryCursorOrderSeq: number
      summaryUpdatedAt: number | null
    }
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE deepchat_sessions
         SET summary_text = ?, summary_cursor_order_seq = ?, summary_updated_at = ?
         WHERE id = ?
           AND summary_cursor_order_seq = ?
           AND ((summary_text = ?) OR (summary_text IS NULL AND ? IS NULL))
           AND ((summary_updated_at = ?) OR (summary_updated_at IS NULL AND ? IS NULL))`
      )
      .run(
        state.summaryText ?? null,
        Math.max(1, state.summaryCursorOrderSeq),
        state.summaryUpdatedAt ?? null,
        id,
        Math.max(1, expectedState.summaryCursorOrderSeq),
        expectedState.summaryText ?? null,
        expectedState.summaryText ?? null,
        expectedState.summaryUpdatedAt ?? null,
        expectedState.summaryUpdatedAt ?? null
      )

    return result.changes > 0
  }

  resetSummaryState(id: string): void {
    this.db
      .prepare(
        `UPDATE deepchat_sessions
         SET summary_text = NULL, summary_cursor_order_seq = 1, summary_updated_at = NULL
         WHERE id = ?`
      )
      .run(id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM deepchat_sessions WHERE id = ?').run(id)
  }
}
