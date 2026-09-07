import Database from 'better-sqlite3-multiple-ciphers'
import { isDeepStrictEqual } from 'node:util'
import { BaseTable } from '@/data/baseTable'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { McpAppDescriptor } from '@shared/types/mcp'
import { toAssistantBlockRowInput, type PersistedBlockExtra } from '../messageContent'

export interface DeepChatAssistantBlockRow {
  message_id: string
  block_index: number
  block_type: string
  status: string
  text_content: string | null
  tool_call_id: string | null
  tool_name: string | null
  tool_params: string | null
  tool_response: string | null
  action_type: string | null
  image_mime_type: string | null
  reasoning_start_at: number | null
  reasoning_end_at: number | null
  extra_json: string | null
  updated_at: number
}

export interface DeepChatAssistantResultBlockRow {
  block_index: number
  block_type: AssistantMessageBlock['type']
  status: AssistantMessageBlock['status']
  text_content: string | null
  updated_at: number
}

const NORMALIZATION_SCHEMA_VERSION = 26

type McpAppSourceRow = Pick<
  DeepChatAssistantBlockRow,
  'tool_call_id' | 'tool_params' | 'extra_json'
>

export class DeepChatAssistantBlocksTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_assistant_blocks')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_assistant_blocks (
        message_id TEXT NOT NULL,
        block_index INTEGER NOT NULL,
        block_type TEXT NOT NULL,
        status TEXT NOT NULL,
        text_content TEXT,
        tool_call_id TEXT,
        tool_name TEXT,
        tool_params TEXT,
        tool_response TEXT,
        action_type TEXT,
        image_mime_type TEXT,
        reasoning_start_at INTEGER,
        reasoning_end_at INTEGER,
        extra_json TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, block_index)
      );
      CREATE INDEX IF NOT EXISTS idx_deepchat_assistant_blocks_message
        ON deepchat_assistant_blocks(message_id, block_index);
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === NORMALIZATION_SCHEMA_VERSION) {
      return this.getCreateTableSQL()
    }
    return null
  }

  getLatestVersion(): number {
    return NORMALIZATION_SCHEMA_VERSION
  }

  /**
   * `updatedAt` is what a block without its own timestamp reports back; the projection passes the
   * record's time so replaying a fact reproduces the rows it wrote the first time.
   */
  replaceForMessage(
    messageId: string,
    blocks: AssistantMessageBlock[],
    updatedAt: number = Date.now()
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO deepchat_assistant_blocks (
        message_id,
        block_index,
        block_type,
        status,
        text_content,
        tool_call_id,
        tool_name,
        tool_params,
        tool_response,
        action_type,
        image_mime_type,
        reasoning_start_at,
        reasoning_end_at,
        extra_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    this.db.transaction(() => {
      this.delete(messageId)
      blocks.forEach((block, index) => {
        const row = toAssistantBlockRowInput(block, updatedAt)
        insert.run(
          messageId,
          index,
          row.block_type,
          row.status,
          row.text_content,
          row.tool_call_id,
          row.tool_name,
          row.tool_params,
          row.tool_response,
          row.action_type,
          row.image_mime_type,
          row.reasoning_start_at,
          row.reasoning_end_at,
          row.extra_json,
          row.updated_at
        )
      })
    })()
  }

  listByMessageIds(messageIds: string[]): DeepChatAssistantBlockRow[] {
    if (messageIds.length === 0) {
      return []
    }

    const placeholders = messageIds.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT * FROM deepchat_assistant_blocks
         WHERE message_id IN (${placeholders})
         ORDER BY message_id, block_index`
      )
      .all(...messageIds) as DeepChatAssistantBlockRow[]
  }

  listByMessageId(messageId: string): DeepChatAssistantBlockRow[] {
    return this.db
      .prepare(
        `SELECT * FROM deepchat_assistant_blocks
         WHERE message_id = ?
         ORDER BY block_index`
      )
      .all(messageId) as DeepChatAssistantBlockRow[]
  }

  listResultProjectionByMessageId(messageId: string): DeepChatAssistantResultBlockRow[] {
    return this.db
      .prepare(
        `SELECT block_index, block_type, status,
                CASE WHEN block_type = 'content' THEN text_content ELSE NULL END AS text_content,
                updated_at
         FROM deepchat_assistant_blocks
         WHERE message_id = ?
         ORDER BY block_index`
      )
      .all(messageId) as DeepChatAssistantResultBlockRow[]
  }

  matchesMcpAppSource(
    messageId: string,
    blockId: string,
    descriptor: McpAppDescriptor,
    toolInput: Record<string, unknown>
  ): boolean {
    for (const row of this.listByMessageId(messageId)) {
      if (row.block_type !== 'tool_call') {
        continue
      }
      if (this.matchMcpAppSourceRow(row, blockId, descriptor, toolInput)) {
        return true
      }
    }
    return false
  }

  updateMcpAppModelContext(
    messageId: string,
    blockId: string,
    descriptor: McpAppDescriptor,
    toolInput: Record<string, unknown>,
    modelContext: {
      content?: NonNullable<NonNullable<AssistantMessageBlock['tool_call']>['mcpResult']>['content']
      structuredContent?: Record<string, unknown>
      approvedHash: string
    }
  ): boolean {
    const rows = this.db
      .prepare(
        `SELECT block_index, tool_call_id, tool_params, extra_json
         FROM deepchat_assistant_blocks
         WHERE message_id = ? AND block_type = 'tool_call'`
      )
      .all(messageId) as Array<{
      block_index: number
      tool_call_id: string | null
      tool_params: string | null
      extra_json: string | null
    }>

    for (const row of rows) {
      const extra = this.matchMcpAppSourceRow(row, blockId, descriptor, toolInput)
      if (!extra) {
        continue
      }
      const toolCallExtra = extra.toolCallExtra
      const mcpResult = toolCallExtra?.mcpResult
      if (!mcpResult) {
        continue
      }
      toolCallExtra.mcpResult = {
        ...mcpResult,
        modelContext
      }
      this.db
        .prepare(
          `UPDATE deepchat_assistant_blocks
           SET extra_json = ?, updated_at = ?
           WHERE message_id = ? AND block_index = ?`
        )
        .run(JSON.stringify(extra), Date.now(), messageId, row.block_index)
      return true
    }
    return false
  }

  private matchMcpAppSourceRow(
    row: McpAppSourceRow,
    blockId: string,
    descriptor: McpAppDescriptor,
    toolInput: Record<string, unknown>
  ): PersistedBlockExtra | null {
    try {
      const extra = row.extra_json ? (JSON.parse(row.extra_json) as PersistedBlockExtra) : {}
      const persistedInput = row.tool_params ? JSON.parse(row.tool_params) : {}
      return (extra.id ?? row.tool_call_id) === blockId &&
        isDeepStrictEqual(extra.toolCallExtra?.mcpResult?.app, descriptor) &&
        isDeepStrictEqual(persistedInput, toolInput)
        ? extra
        : null
    } catch {
      return null
    }
  }

  delete(messageId: string): void {
    this.db.prepare('DELETE FROM deepchat_assistant_blocks WHERE message_id = ?').run(messageId)
  }

  deleteByMessageIds(messageIds: string[]): void {
    if (messageIds.length === 0) {
      return
    }

    const placeholders = messageIds.map(() => '?').join(', ')
    this.db
      .prepare(`DELETE FROM deepchat_assistant_blocks WHERE message_id IN (${placeholders})`)
      .run(...messageIds)
  }

  deleteBySession(sessionId: string): void {
    this.db
      .prepare(
        `DELETE FROM deepchat_assistant_blocks
         WHERE message_id IN (
           SELECT id FROM deepchat_messages WHERE session_id = ?
         )`
      )
      .run(sessionId)
  }
}
