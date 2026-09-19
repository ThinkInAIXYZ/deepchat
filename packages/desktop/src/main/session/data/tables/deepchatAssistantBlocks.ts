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

// Streaming flushes call replaceForMessage every ~600ms with the full block list, and
// projection/migration rebuilds call it with an explicit source timestamp. SessionDatabase
// exposes tables via getters that construct a fresh table instance per access, so statements
// are cached per underlying Database instance instead.
const replaceStatementsCache = new WeakMap<
  Database.Database,
  {
    upsertStream: Database.Statement
    upsertExact: Database.Statement
    pruneFromIndex: Database.Statement
  }
>()

// Null-safe (`IS NOT`) comparisons skip rewriting rows whose compared columns did not
// change, so untouched blocks produce no WAL writes.
function buildUpsertStatement(db: Database.Database, includeUpdatedAtGuard: boolean) {
  return db.prepare(
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id, block_index) DO UPDATE SET
      block_type = excluded.block_type,
      status = excluded.status,
      text_content = excluded.text_content,
      tool_call_id = excluded.tool_call_id,
      tool_name = excluded.tool_name,
      tool_params = excluded.tool_params,
      tool_response = excluded.tool_response,
      action_type = excluded.action_type,
      image_mime_type = excluded.image_mime_type,
      reasoning_start_at = excluded.reasoning_start_at,
      reasoning_end_at = excluded.reasoning_end_at,
      extra_json = excluded.extra_json,
      updated_at = excluded.updated_at
    WHERE block_type IS NOT excluded.block_type
      OR status IS NOT excluded.status
      OR text_content IS NOT excluded.text_content
      OR tool_call_id IS NOT excluded.tool_call_id
      OR tool_name IS NOT excluded.tool_name
      OR tool_params IS NOT excluded.tool_params
      OR tool_response IS NOT excluded.tool_response
      OR action_type IS NOT excluded.action_type
      OR image_mime_type IS NOT excluded.image_mime_type
      OR reasoning_start_at IS NOT excluded.reasoning_start_at
      OR reasoning_end_at IS NOT excluded.reasoning_end_at
      OR extra_json IS NOT excluded.extra_json${
        includeUpdatedAtGuard
          ? `
      OR updated_at IS NOT excluded.updated_at`
          : ''
      }`
  )
}

function getReplaceStatements(db: Database.Database) {
  const cached = replaceStatementsCache.get(db)
  if (cached) {
    return cached
  }

  const statements = {
    upsertStream: buildUpsertStatement(db, false),
    upsertExact: buildUpsertStatement(db, true),
    pruneFromIndex: db.prepare(
      'DELETE FROM deepchat_assistant_blocks WHERE message_id = ? AND block_index >= ?'
    )
  }
  replaceStatementsCache.set(db, statements)
  return statements
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

  /**
   * `updatedAt` is what a block without its own timestamp reports back; the projection passes the
   * record's time so replaying a fact reproduces the rows it wrote the first time.
   *
   * - Without `updatedAt` (streaming persistence): rows whose visible columns are unchanged keep
   *   their stored `updated_at`; changed rows are stamped with the current time.
   * - With `updatedAt` (projection/migration rebuilds): the row set reproduces the source record
   *   exactly, including `updated_at`; a fully identical rebuild writes nothing.
   */
  replaceForMessage(messageId: string, blocks: AssistantMessageBlock[], updatedAt?: number): void {
    const { upsertStream, upsertExact, pruneFromIndex } = getReplaceStatements(this.db)
    const exact = updatedAt !== undefined
    const upsert = exact ? upsertExact : upsertStream

    this.db.transaction(() => {
      blocks.forEach((block, index) => {
        const row = toAssistantBlockRowInput(block, updatedAt ?? Date.now())
        upsert.run(
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
      // Drop rows beyond the new block list (cleared rate-limit placeholder, regenerated
      // shorter content). block_index >= blocks.length also covers the empty case.
      pruneFromIndex.run(messageId, blocks.length)
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
