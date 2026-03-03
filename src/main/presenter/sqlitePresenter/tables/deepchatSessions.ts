import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'
import type { SessionGenerationSettings } from '@shared/types/agent-interface'

type DeepChatSessionGenerationSettings = Pick<
  SessionGenerationSettings,
  | 'systemPrompt'
  | 'temperature'
  | 'contextLength'
  | 'maxTokens'
  | 'thinkingBudget'
  | 'reasoningEffort'
  | 'verbosity'
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
  reasoning_effort: 'minimal' | 'low' | 'medium' | 'high' | null
  verbosity: 'low' | 'medium' | 'high' | null
}

export class DeepChatSessionsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_sessions')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_sessions (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        permission_mode TEXT NOT NULL DEFAULT 'full_access'
      );
    `
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
    return null
  }

  getLatestVersion(): number {
    return 12
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
           verbosity
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        generationSettings?.verbosity ?? null
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
    if (row.reasoning_effort !== null) {
      settings.reasoningEffort = row.reasoning_effort
    }
    if (row.verbosity !== null) {
      settings.verbosity = row.verbosity
    }

    return settings
  }

  updatePermissionMode(id: string, mode: 'default' | 'full_access'): void {
    this.db.prepare('UPDATE deepchat_sessions SET permission_mode = ? WHERE id = ?').run(mode, id)
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
    if (Object.prototype.hasOwnProperty.call(settings, 'verbosity')) {
      updates.push('verbosity = ?')
      params.push(settings.verbosity ?? null)
    }

    if (updates.length === 0) {
      return
    }

    params.push(id)
    this.db
      .prepare(`UPDATE deepchat_sessions SET ${updates.join(', ')} WHERE id = ?`)
      .run(...params)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM deepchat_sessions WHERE id = ?').run(id)
  }
}
