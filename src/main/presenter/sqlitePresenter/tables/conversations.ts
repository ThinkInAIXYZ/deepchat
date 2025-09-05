import { BaseTable } from './baseTable'
import type Database from 'better-sqlite3-multiple-ciphers'
import { CONVERSATION, CONVERSATION_SETTINGS } from '@shared/presenter'
import { nanoid } from 'nanoid'

type ConversationRow = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  systemPrompt: string
  temperature: number
  contextLength: number
  maxTokens: number
  providerId: string
  modelId: string
  artifacts: number
  is_new: number
  is_pinned: number
  enabled_mcp_tools: string | null
  thinking_budget: number | null
  reasoning_effort: string | null
  verbosity: string | null
  enable_search: number | null
  forced_search: number | null
  search_strategy: string | null
}

// 解析 JSON 字段
function getJsonField<T>(val: string | null | undefined, fallback: T): T {
  try {
    return val ? JSON.parse(val) : fallback
  } catch {
    return fallback
  }
}

export class ConversationsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'conversations')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conv_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        user_id INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        model_id TEXT DEFAULT 'gpt-4',
        provider_id TEXT DEFAULT 'openai',
        context_length INTEGER DEFAULT 10,
        max_tokens INTEGER DEFAULT 2000,
        temperature REAL DEFAULT 0.7,
        system_prompt TEXT DEFAULT '',
        context_chain TEXT DEFAULT '[]'
      );
      CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
      CREATE INDEX idx_conversations_pinned ON conversations(is_pinned);
    `
  }
  getMigrationSQL(version: number): string | null {
    if (version === 1) {
      return `
        -- 添加 is_new 字段
        ALTER TABLE conversations ADD COLUMN is_new INTEGER DEFAULT 1;

        -- 移除 user_id 字段
        ALTER TABLE conversations DROP COLUMN user_id;

        -- 更新所有现有会话的 is_new 为 0
        UPDATE conversations SET is_new = 0;
      `
    }
    if (version === 2) {
      return `
        -- 添加 artifacts 开关
        ALTER TABLE conversations ADD COLUMN artifacts INTEGER DEFAULT 0;
        UPDATE conversations SET artifacts = 0;
      `
    }
    if (version === 3) {
      return `
        --- 添加 enabled_mcp_tools 字段
        ALTER TABLE conversations ADD COLUMN enabled_mcp_tools TEXT DEFAULT '[]';
      `
    }
    if (version === 4) {
      return `
        -- 添加 thinking_budget 字段
        ALTER TABLE conversations ADD COLUMN thinking_budget INTEGER DEFAULT NULL;
      `
    }
    if (version === 5) {
      return `
        -- 回滚脏数据 enabled_mcp_tools
        UPDATE conversations SET enabled_mcp_tools = NULL WHERE enabled_mcp_tools = '[]';
      `
    }
    if (version === 6) {
      return `
        -- 添加 reasoning_effort 字段
        ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT DEFAULT NULL;
        
        -- 添加 verbosity 字段
        ALTER TABLE conversations ADD COLUMN verbosity TEXT DEFAULT NULL;
      `
    }
    if (version === 7) {
      return `
        -- 添加搜索相关字段
        ALTER TABLE conversations ADD COLUMN enable_search INTEGER DEFAULT NULL;
        ALTER TABLE conversations ADD COLUMN forced_search INTEGER DEFAULT NULL;
        ALTER TABLE conversations ADD COLUMN search_strategy TEXT DEFAULT NULL;
      `
    }

    return null
  }

  getLatestVersion(): number {
    return 7
  }

  async create(title: string, settings: Partial<CONVERSATION_SETTINGS> = {}): Promise<string> {
    const insert = this.db.prepare(`
      INSERT INTO conversations (
        conv_id,
        title,
        created_at,
        updated_at,
        system_prompt,
        temperature,
        context_length,
        max_tokens,
        provider_id,
        model_id,
        is_new,
        artifacts,
        is_pinned,
        enabled_mcp_tools,
        thinking_budget,
        reasoning_effort,
        verbosity,
        enable_search,
        forced_search,
        search_strategy
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const conv_id = nanoid()
    const now = Date.now()
    insert.run(
      conv_id,
      title,
      now,
      now,
      settings.systemPrompt || '',
      settings.temperature || 0.7,
      settings.contextLength || 4000,
      settings.maxTokens || 2000,
      settings.providerId || 'openai',
      settings.modelId || 'gpt-4',
      1,
      settings.artifacts || 0,
      0, // Default is_pinned to 0
      settings.enabledMcpTools ? JSON.stringify(settings.enabledMcpTools) : 'NULL',
      settings.thinkingBudget !== undefined ? settings.thinkingBudget : null,
      settings.reasoningEffort !== undefined ? settings.reasoningEffort : null,
      settings.verbosity !== undefined ? settings.verbosity : null,
      settings.enableSearch !== undefined ? (settings.enableSearch ? 1 : 0) : null,
      settings.forcedSearch !== undefined ? (settings.forcedSearch ? 1 : 0) : null,
      settings.searchStrategy !== undefined ? settings.searchStrategy : null
    )
    return conv_id
  }

  async get(conversationId: string): Promise<CONVERSATION> {
    const result = this.db
      .prepare(
        `
      SELECT
        conv_id as id,
        title,
        created_at as createdAt,
        updated_at as updatedAt,
        system_prompt as systemPrompt,
        temperature,
        context_length as contextLength,
        max_tokens as maxTokens,
        provider_id as providerId,
        model_id as modelId,
        is_new,
        artifacts,
        is_pinned,
        enabled_mcp_tools,
        thinking_budget,
        reasoning_effort,
        verbosity,
        enable_search,
        forced_search,
        search_strategy
      FROM conversations
      WHERE conv_id = ?
    `
      )
      .get(conversationId) as ConversationRow & { is_pinned: number }

    if (!result) {
      throw new Error(`Conversation ${conversationId} not found`)
    }

    return {
      id: result.id,
      title: result.title,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      is_new: result.is_new,
      is_pinned: result.is_pinned,
      settings: {
        systemPrompt: result.systemPrompt,
        temperature: result.temperature,
        contextLength: result.contextLength,
        maxTokens: result.maxTokens,
        providerId: result.providerId,
        modelId: result.modelId,
        artifacts: result.artifacts as 0 | 1,
        enabledMcpTools: getJsonField(result.enabled_mcp_tools, undefined),
        thinkingBudget: result.thinking_budget !== null ? result.thinking_budget : undefined,
        reasoningEffort: result.reasoning_effort
          ? (result.reasoning_effort as 'minimal' | 'low' | 'medium' | 'high')
          : undefined,
        verbosity: result.verbosity ? (result.verbosity as 'low' | 'medium' | 'high') : undefined,
        enableSearch: result.enable_search !== null ? Boolean(result.enable_search) : undefined,
        forcedSearch: result.forced_search !== null ? Boolean(result.forced_search) : undefined,
        searchStrategy: result.search_strategy
          ? (result.search_strategy as 'turbo' | 'max')
          : undefined
      }
    }
  }

  async update(conversationId: string, data: Partial<CONVERSATION>): Promise<void> {
    const updates: string[] = []
    const params: (string | number)[] = []

    if (data.title !== undefined) {
      updates.push('title = ?')
      params.push(data.title)
    }

    if (data.is_new !== undefined) {
      updates.push('is_new = ?')
      params.push(data.is_new)
    }

    if (data.is_pinned !== undefined) {
      updates.push('is_pinned = ?')
      params.push(data.is_pinned)
    }

    if (data.settings) {
      if (data.settings.systemPrompt !== undefined) {
        updates.push('system_prompt = ?')
        params.push(data.settings.systemPrompt)
      }
      if (data.settings.temperature !== undefined) {
        updates.push('temperature = ?')
        params.push(data.settings.temperature)
      }
      if (data.settings.contextLength !== undefined) {
        updates.push('context_length = ?')
        params.push(data.settings.contextLength)
      }
      if (data.settings.maxTokens !== undefined) {
        updates.push('max_tokens = ?')
        params.push(data.settings.maxTokens)
      }
      if (data.settings.providerId !== undefined) {
        updates.push('provider_id = ?')
        params.push(data.settings.providerId)
      }
      if (data.settings.modelId !== undefined) {
        updates.push('model_id = ?')
        params.push(data.settings.modelId)
      }
      if (data.settings.artifacts !== undefined) {
        updates.push('artifacts = ?')
        params.push(data.settings.artifacts)
      }
      if (data.settings.enabledMcpTools !== undefined) {
        updates.push('enabled_mcp_tools = ?')
        params.push(JSON.stringify(data.settings.enabledMcpTools))
      }
      if (data.settings.thinkingBudget !== undefined) {
        updates.push('thinking_budget = ?')
        params.push(data.settings.thinkingBudget)
      }
      if (data.settings.reasoningEffort !== undefined) {
        updates.push('reasoning_effort = ?')
        params.push(data.settings.reasoningEffort)
      }
      if (data.settings.verbosity !== undefined) {
        updates.push('verbosity = ?')
        params.push(data.settings.verbosity)
      }
      if (data.settings.enableSearch !== undefined) {
        updates.push('enable_search = ?')
        params.push(data.settings.enableSearch ? 1 : 0)
      }
      if (data.settings.forcedSearch !== undefined) {
        updates.push('forced_search = ?')
        params.push(data.settings.forcedSearch ? 1 : 0)
      }
      if (data.settings.searchStrategy !== undefined) {
        updates.push('search_strategy = ?')
        params.push(data.settings.searchStrategy)
      }
    }
    if (updates.length > 0 || data.updatedAt) {
      updates.push('updated_at = ?')
      params.push(data.updatedAt || Date.now())

      const updateStmt = this.db.prepare(`
        UPDATE conversations
        SET ${updates.join(', ')}
        WHERE conv_id = ?
      `)
      params.push(conversationId)
      updateStmt.run(...params)
    }
  }

  async delete(conversationId: string): Promise<void> {
    const deleteStmt = this.db.prepare('DELETE FROM conversations WHERE conv_id = ?')
    deleteStmt.run(conversationId)
  }

  async list(page: number, pageSize: number): Promise<{ total: number; list: CONVERSATION[] }> {
    const offset = (page - 1) * pageSize

    const totalResult = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get() as {
      count: number
    }

    const results = this.db
      .prepare(
        `
      SELECT
        conv_id as id,
        title,
        created_at as createdAt,
        updated_at as updatedAt,
        system_prompt as systemPrompt,
        temperature,
        context_length as contextLength,
        max_tokens as maxTokens,
        provider_id as providerId,
        model_id as modelId,
        is_new,
        artifacts,
        is_pinned,
        enabled_mcp_tools,
        thinking_budget,
        reasoning_effort,
        verbosity,
        enable_search,
        forced_search,
        search_strategy
      FROM conversations
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(pageSize, offset) as ConversationRow[]

    return {
      total: totalResult.count,
      list: results.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        is_new: row.is_new,
        is_pinned: row.is_pinned,
        settings: {
          systemPrompt: row.systemPrompt,
          temperature: row.temperature,
          contextLength: row.contextLength,
          maxTokens: row.maxTokens,
          providerId: row.providerId,
          modelId: row.modelId,
          artifacts: row.artifacts as 0 | 1,
          enabledMcpTools: getJsonField(row.enabled_mcp_tools, undefined),
          thinkingBudget: row.thinking_budget !== null ? row.thinking_budget : undefined,
          reasoningEffort: row.reasoning_effort
            ? (row.reasoning_effort as 'minimal' | 'low' | 'medium' | 'high')
            : undefined,
          verbosity: row.verbosity ? (row.verbosity as 'low' | 'medium' | 'high') : undefined,
          enableSearch: row.enable_search !== null ? Boolean(row.enable_search) : undefined,
          forcedSearch: row.forced_search !== null ? Boolean(row.forced_search) : undefined,
          searchStrategy: row.search_strategy ? (row.search_strategy as 'turbo' | 'max') : undefined
        }
      }))
    }
  }

  async rename(conversationId: string, title: string): Promise<void> {
    // 新增 updatedAt 更新
    const updateStmt = this.db.prepare(`
      UPDATE conversations
      SET title = ?, is_new = 0, updated_at = ?
      WHERE conv_id = ?
    `)
    // 传入当前时间
    updateStmt.run(title, Date.now(), conversationId)
  }

  async count(): Promise<number> {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get() as {
      count: number
    }
    return result.count
  }
}
