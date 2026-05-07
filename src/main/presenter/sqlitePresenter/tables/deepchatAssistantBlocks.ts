import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'

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

const NORMALIZATION_SCHEMA_VERSION = 26

type PersistedBlockExtra = {
  id?: string
  timestamp?: number
  imageData?: string
  extra?: AssistantMessageBlock['extra']
  toolCallExtra?: Omit<
    NonNullable<AssistantMessageBlock['tool_call']>,
    'id' | 'name' | 'params' | 'response'
  >
  reasoningTime?: number
}

function buildPersistedExtra(block: AssistantMessageBlock): PersistedBlockExtra {
  return {
    id: block.id,
    timestamp: block.timestamp,
    imageData: block.image_data?.data,
    extra: block.extra,
    toolCallExtra: block.tool_call
      ? {
          rtkApplied: block.tool_call.rtkApplied,
          rtkMode: block.tool_call.rtkMode,
          rtkFallbackReason: block.tool_call.rtkFallbackReason,
          imagePreviews: block.tool_call.imagePreviews,
          server_name: block.tool_call.server_name,
          server_icons: block.tool_call.server_icons,
          server_description: block.tool_call.server_description
        }
      : undefined,
    reasoningTime: typeof block.reasoning_time === 'number' ? block.reasoning_time : undefined
  }
}

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

  replaceForMessage(messageId: string, blocks: AssistantMessageBlock[]): void {
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
        const reasoningRange =
          block.reasoning_time &&
          typeof block.reasoning_time === 'object' &&
          typeof block.reasoning_time.start === 'number' &&
          typeof block.reasoning_time.end === 'number'
            ? block.reasoning_time
            : null

        insert.run(
          messageId,
          index,
          block.type,
          block.status,
          block.content ?? null,
          block.tool_call?.id ?? null,
          block.tool_call?.name ?? null,
          block.tool_call?.params ?? null,
          block.tool_call?.response ?? null,
          block.action_type ?? null,
          block.image_data?.mimeType ?? null,
          reasoningRange?.start ?? null,
          reasoningRange?.end ?? null,
          JSON.stringify(buildPersistedExtra(block)),
          Date.now()
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
