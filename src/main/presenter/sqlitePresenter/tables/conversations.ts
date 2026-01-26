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
  systemPromptId: string | null
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
  context_chain: string | null
  active_skills: string | null
  parent_conversation_id: string | null
  parent_message_id: string | null
  parent_selection: string | null
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
        system_prompt_id TEXT DEFAULT NULL,
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
    if (version === 8) {
      return `
        -- 添加 agent_workspace_path 字段
        ALTER TABLE conversations ADD COLUMN agent_workspace_path TEXT DEFAULT NULL;
        -- 添加 acp_workdir_map 字段
        ALTER TABLE conversations ADD COLUMN acp_workdir_map TEXT DEFAULT NULL;
      `
    }
    if (version === 9) {
      return `
        -- 添加 parent 相关字段
        ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT DEFAULT NULL;
        ALTER TABLE conversations ADD COLUMN parent_message_id TEXT DEFAULT NULL;
        ALTER TABLE conversations ADD COLUMN parent_selection TEXT DEFAULT NULL;
        CREATE INDEX idx_conversations_parent ON conversations(parent_conversation_id);
        CREATE INDEX idx_conversations_parent_message ON conversations(parent_message_id);
      `
    }
    if (version === 10) {
      return `
        -- 添加 active_skills 字段
        ALTER TABLE conversations ADD COLUMN active_skills TEXT DEFAULT '[]';
        UPDATE conversations SET active_skills = '[]' WHERE active_skills IS NULL;
      `
    }
    if (version === 11) {
      return `
        -- 添加 system_prompt_id 字段
        ALTER TABLE conversations ADD COLUMN system_prompt_id TEXT DEFAULT NULL;
      `
    }
    if (version === 12) {
      return `
        -- 删除 acp_workdir_map 字段（ACP 模块已独立）
        ALTER TABLE conversations DROP COLUMN acp_workdir_map;
      `
    }

    return null
  }

  getLatestVersion(): number {
    return 12
  }

  /**
   * Phase 6 Migration Note: chatConfig removal
   *
   * The following columns are deprecated but kept in the database for backward compatibility:
   * - system_prompt, system_prompt_id (use agent defaults)
   * - temperature (use agent defaults)
   * - context_length, max_tokens (use agent defaults)
   * - artifacts (feature removed)
   * - enabled_mcp_tools (all tools now enabled by default)
   * - thinking_budget, reasoning_effort, verbosity (use agent defaults)
   * - enable_search, forced_search, search_strategy (use agent defaults)
   * - context_chain (selectedVariantsMap - variant management removed)
   * - active_skills (feature removed)
   *
   * The following columns are still actively used:
   * - provider_id, model_id (essential for session identification)
   * - agent_workspace_path (workspace path for ACP agents)
   *
   * Runtime session state (modelId, agentId, modeId, workspace) now comes from SessionInfo
   * provided by the agent, not from stored configuration.
   */

  async create(title: string, settings: Partial<CONVERSATION_SETTINGS> = {}): Promise<string> {
    const insert = this.db.prepare(`
      INSERT INTO conversations (
        conv_id,
        title,
        created_at,
        updated_at,
        system_prompt,
        system_prompt_id,
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
        search_strategy,
        context_chain,
        active_skills,
        agent_workspace_path,
        parent_conversation_id,
        parent_message_id,
        parent_selection
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const conv_id = nanoid()
    const now = Date.now()
    insert.run(
      conv_id,
      title,
      now,
      now,
      '', // system_prompt (deprecated, use agent default)
      null, // system_prompt_id (deprecated)
      0.7, // temperature (deprecated, use agent default)
      4000, // context_length (deprecated, use agent default)
      2000, // max_tokens (deprecated, use agent default)
      settings.providerId || 'openai',
      settings.modelId || 'gpt-4',
      1,
      0, // artifacts (deprecated)
      0, // Default is_pinned to 0
      null, // enabled_mcp_tools (deprecated, all tools enabled)
      null, // thinking_budget (deprecated, use agent default)
      null, // reasoning_effort (deprecated, use agent default)
      null, // verbosity (deprecated, use agent default)
      null, // enable_search (deprecated, use agent default)
      null, // forced_search (deprecated, use agent default)
      null, // search_strategy (deprecated, use agent default)
      '{}', // context_chain (deprecated, variant management removed)
      '[]', // active_skills (deprecated)
      settings.agentWorkspacePath !== undefined && settings.agentWorkspacePath !== null
        ? settings.agentWorkspacePath
        : null,
      null,
      null,
      null
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
        system_prompt_id as systemPromptId,
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
        search_strategy,
        context_chain,
        active_skills,
        agent_workspace_path,
        parent_conversation_id,
        parent_message_id,
        parent_selection
      FROM conversations
      WHERE conv_id = ?
    `
      )
      .get(conversationId) as ConversationRow & {
      is_pinned: number
      agent_workspace_path: string | null
    }

    if (!result) {
      throw new Error(`Conversation ${conversationId} not found`)
    }

    // Phase 6: Only return essential fields in settings
    const settings: CONVERSATION_SETTINGS = {
      providerId: result.providerId,
      modelId: result.modelId,
      agentWorkspacePath:
        result.agent_workspace_path !== null && result.agent_workspace_path !== undefined
          ? result.agent_workspace_path
          : undefined
    }
    return {
      id: result.id,
      title: result.title,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      is_new: result.is_new,
      is_pinned: result.is_pinned,
      settings,
      parentConversationId: result.parent_conversation_id,
      parentMessageId: result.parent_message_id,
      parentSelection: getJsonField(result.parent_selection, undefined)
    }
  }

  async update(conversationId: string, data: Partial<CONVERSATION>): Promise<void> {
    const updates: string[] = []
    const params: (string | number | null)[] = []

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
      // Phase 6: Only update essential fields
      if (data.settings.providerId !== undefined) {
        updates.push('provider_id = ?')
        params.push(data.settings.providerId)
      }
      if (data.settings.modelId !== undefined) {
        updates.push('model_id = ?')
        params.push(data.settings.modelId)
      }
      if (data.settings.agentWorkspacePath !== undefined) {
        updates.push('agent_workspace_path = ?')
        params.push(
          data.settings.agentWorkspacePath !== null ? data.settings.agentWorkspacePath : null
        )
      }
    }
    if (data.parentConversationId !== undefined) {
      updates.push('parent_conversation_id = ?')
      params.push(data.parentConversationId ?? null)
    }
    if (data.parentMessageId !== undefined) {
      updates.push('parent_message_id = ?')
      params.push(data.parentMessageId ?? null)
    }
    if (data.parentSelection !== undefined) {
      updates.push('parent_selection = ?')
      if (data.parentSelection === null) {
        params.push(null)
      } else if (typeof data.parentSelection === 'string') {
        params.push(data.parentSelection)
      } else {
        params.push(JSON.stringify(data.parentSelection))
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
        system_prompt_id as systemPromptId,
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
        search_strategy,
        context_chain,
        active_skills,
        agent_workspace_path,
        parent_conversation_id,
        parent_message_id,
        parent_selection
      FROM conversations
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(pageSize, offset) as (ConversationRow & {
      agent_workspace_path: string | null
    })[]

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
          systemPromptId: row.systemPromptId ?? undefined,
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
          searchStrategy: row.search_strategy
            ? (row.search_strategy as 'turbo' | 'max')
            : undefined,
          selectedVariantsMap: getJsonField(row.context_chain, undefined),
          activeSkills: getJsonField(row.active_skills, []),
          agentWorkspacePath:
            row.agent_workspace_path !== null && row.agent_workspace_path !== undefined
              ? row.agent_workspace_path
              : undefined
        },
        parentConversationId: row.parent_conversation_id,
        parentMessageId: row.parent_message_id,
        parentSelection: getJsonField(row.parent_selection, undefined)
      }))
    }
  }

  async listByParentConversationId(parentConversationId: string): Promise<CONVERSATION[]> {
    const results = this.db
      .prepare(
        `
      SELECT
        conv_id as id,
        title,
        created_at as createdAt,
        updated_at as updatedAt,
        system_prompt as systemPrompt,
        system_prompt_id as systemPromptId,
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
        search_strategy,
        context_chain,
        active_skills,
        agent_workspace_path,
        parent_conversation_id,
        parent_message_id,
        parent_selection
      FROM conversations
      WHERE parent_conversation_id = ?
      ORDER BY updated_at DESC
    `
      )
      .all(parentConversationId) as (ConversationRow & {
      agent_workspace_path: string | null
    })[]

    return results.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      is_new: row.is_new,
      is_pinned: row.is_pinned,
      settings: {
        systemPrompt: row.systemPrompt,
        systemPromptId: row.systemPromptId ?? undefined,
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
        searchStrategy: row.search_strategy ? (row.search_strategy as 'turbo' | 'max') : undefined,
        selectedVariantsMap: getJsonField(row.context_chain, undefined),
        activeSkills: getJsonField(row.active_skills, []),
        agentWorkspacePath:
          row.agent_workspace_path !== null && row.agent_workspace_path !== undefined
            ? row.agent_workspace_path
            : undefined
      },
      parentConversationId: row.parent_conversation_id,
      parentMessageId: row.parent_message_id,
      parentSelection: getJsonField(row.parent_selection, undefined)
    }))
  }

  async listByParentMessageIds(parentMessageIds: string[]): Promise<CONVERSATION[]> {
    if (parentMessageIds.length === 0) {
      return []
    }

    const placeholders = parentMessageIds.map(() => '?').join(', ')
    const results = this.db
      .prepare(
        `
      SELECT
        conv_id as id,
        title,
        created_at as createdAt,
        updated_at as updatedAt,
        system_prompt as systemPrompt,
        system_prompt_id as systemPromptId,
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
        search_strategy,
        context_chain,
        active_skills,
        agent_workspace_path,
        parent_conversation_id,
        parent_message_id,
        parent_selection
      FROM conversations
      WHERE parent_message_id IN (${placeholders})
      ORDER BY updated_at DESC
    `
      )
      .all(...parentMessageIds) as (ConversationRow & {
      agent_workspace_path: string | null
    })[]

    return results.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      is_new: row.is_new,
      is_pinned: row.is_pinned,
      settings: {
        systemPrompt: row.systemPrompt,
        systemPromptId: row.systemPromptId ?? undefined,
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
        searchStrategy: row.search_strategy ? (row.search_strategy as 'turbo' | 'max') : undefined,
        selectedVariantsMap: getJsonField(row.context_chain, undefined),
        activeSkills: getJsonField(row.active_skills, []),
        agentWorkspacePath:
          row.agent_workspace_path !== null && row.agent_workspace_path !== undefined
            ? row.agent_workspace_path
            : undefined
      },
      parentConversationId: row.parent_conversation_id,
      parentMessageId: row.parent_message_id,
      parentSelection: getJsonField(row.parent_selection, undefined)
    }))
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
