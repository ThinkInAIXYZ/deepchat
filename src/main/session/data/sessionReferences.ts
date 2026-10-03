import { z } from 'zod'
import {
  ReadSessionInputSchema,
  type ReadSessionInput,
  type SessionReference
} from '@shared/sessionReferences'
import type { SessionDatabase } from './database'

const PREVIEW_CHARS = 800
const DETAIL_CHARS = 8192
const cursorSchema = z.object({
  source: z.string(),
  incarnation: z.string(),
  action: z.enum(['messages', 'search']),
  role: z.enum(['user', 'assistant']).nullable(),
  query: z.string().nullable(),
  match: z.enum(['none', 'fts', 'literal']),
  highWater: z.number().int().nonnegative().safe(),
  highWaterMessageId: z.string().min(1),
  orderSeq: z.number().int().nonnegative().safe(),
  messageId: z.string().min(1)
})
type Cursor = z.infer<typeof cursorSchema>
type Preview = {
  messageId: string
  orderSeq: number
  role: 'user' | 'assistant'
  status: string
  createdAt: number
  preview: string
  totalCharacters: number | null
  previewUnavailable: number
}

const READABLE = `m.status IN ('sent', 'error') AND m.role IN ('user', 'assistant')
  AND (CASE WHEN json_valid(m.metadata) THEN json_extract(m.metadata, '$.messageType') END) IS NOT 'compaction'`
const DOCUMENT_JOIN = `LEFT JOIN deepchat_search_documents d ON d.document_key = 'message:' || m.id
  AND d.session_id = m.session_id`
const PREVIEW_COLUMNS = `m.id AS messageId, m.order_seq AS orderSeq, m.role, m.status,
  m.created_at AS createdAt, length(d.content) AS totalCharacters,
  d.message_id IS NULL AS previewUnavailable`

export class SessionReferences {
  constructor(
    private readonly database: Pick<
      SessionDatabase,
      'getDatabase' | 'deepchatSearchDocumentsTable'
    >,
    private readonly tapeIdentity: { getTapeIncarnationId(sessionId: string): string },
    private readonly initializeTape: (sessionId: string) => Promise<unknown>
  ) {}

  searchCandidates(input: { projectDir: string | null; query: string; excludeSessionId?: string }) {
    const db = this.database.getDatabase()
    // SQLite lower() only folds ASCII. Fold titles one row at a time inside the query so
    // Unicode matches still happen before LIMIT without materializing every session in JS.
    db.function('deepchat_reference_title_lower', { deterministic: true }, (title: string) =>
      title.toLowerCase()
    )
    return db
      .prepare(`
      SELECT id AS sessionId, substr(title, 1, 1024) AS title, project_dir AS projectDir, agent_id AS agentId,
             updated_at AS updatedAt
      FROM new_sessions WHERE session_kind = 'regular' AND is_draft = 0
        AND project_dir IS ? AND instr(deepchat_reference_title_lower(title), ?) > 0
        AND (? IS NULL OR id <> ?)
      ORDER BY updated_at DESC, id ASC LIMIT 20
    `)
      .all(
        input.projectDir,
        input.query.trim().toLowerCase(),
        input.excludeSessionId ?? null,
        input.excludeSessionId ?? null
      )
  }

  async resolve(sessionId: string, expectedIncarnation?: string): Promise<SessionReference> {
    this.requireRegularSession(sessionId)
    let incarnation: string
    try {
      incarnation = this.tapeIdentity.getTapeIncarnationId(sessionId)
    } catch {
      // Selection can reconcile a legacy session once; model reads never initialize another Tape.
      await this.initializeTape(sessionId)
      incarnation = this.tapeIdentity.getTapeIncarnationId(sessionId)
    }
    if (expectedIncarnation && expectedIncarnation !== incarnation) {
      throw new Error('Session reference is stale because the source session was reset.')
    }
    return { ...this.requireRegularSession(sessionId), tapeIncarnationId: incarnation }
  }

  async read(callerSessionId: string, rawInput: ReadSessionInput) {
    const input = ReadSessionInputSchema.parse(rawInput)
    const page = input.action === 'messages' || input.action === 'search'
    if (
      (input.query !== undefined && input.action !== 'search') ||
      (input.cursor !== undefined && !page) ||
      (input.limit !== undefined && !page) ||
      (input.messageId !== undefined && page) ||
      (input.offset !== undefined && input.action !== 'message') ||
      ((input.before !== undefined || input.after !== undefined) && input.action !== 'context')
    )
      throw new Error('Arguments do not match the requested read_session action.')
    const caller = this.database
      .getDatabase()
      .prepare(`
      SELECT 1 FROM new_sessions n JOIN deepchat_sessions d ON d.id = n.id
      WHERE n.id = ? AND n.session_kind = 'regular'
    `)
      .get(callerSessionId)
    if (!caller) throw new Error('read_session is available only in regular DeepChat sessions.')
    const source: SessionReference = {
      ...this.requireRegularSession(input.sessionId),
      tapeIncarnationId: this.tapeIdentity.getTapeIncarnationId(input.sessionId)
    }
    this.assertAuthorized(callerSessionId, source)
    // No await after checking authority/identity: reset and deletion cannot interleave these reads.
    if (input.action === 'message') return this.readMessage(source, input)
    if (input.action === 'context') return this.readContext(source, input)
    return this.readPage(source, input)
  }

  private readPage(source: SessionReference, input: ReadSessionInput) {
    if (input.action === 'search' && !input.query) throw new Error('Search requires query.')
    const cursor = input.cursor ? this.decodeCursor(input.cursor) : null
    const role = input.role ?? null
    const query = input.action === 'search' ? input.query! : null
    if (
      cursor &&
      (cursor.source !== source.sessionId ||
        cursor.incarnation !== source.tapeIncarnationId ||
        cursor.action !== input.action ||
        cursor.role !== role ||
        cursor.query !== query ||
        cursor.orderSeq > cursor.highWater ||
        (input.action === 'messages' ? cursor.match !== 'none' : cursor.match === 'none'))
    )
      throw new Error('Invalid read_session cursor for this request scope.')
    const db = this.database.getDatabase()
    const boundary = db
      .prepare(
        cursor
          ? `SELECT m.id, m.order_seq FROM deepchat_messages m
             WHERE m.session_id = ? AND m.id = ?`
          : `SELECT m.id, m.order_seq FROM deepchat_messages m
             WHERE m.session_id = ? AND ${READABLE}
             ORDER BY m.order_seq DESC, m.id DESC LIMIT 1`
      )
      .get(...(cursor ? [source.sessionId, cursor.highWaterMessageId] : [source.sessionId])) as
      | { id: string; order_seq: number }
      | undefined
    // Compaction shifts order_seq. A numeric high-water alone would silently repeat or omit
    // evidence. Anchor it to a message; deletion/retry or reordering requires a fresh page set.
    if (cursor && boundary?.order_seq !== cursor.highWater) {
      throw new Error('Session transcript order changed. Restart this read without a cursor.')
    }
    const highWater = boundary?.order_seq ?? 0
    const highWaterMessageId = boundary?.id ?? ''
    const limit = input.limit ?? 20
    let match: Cursor['match'] =
      cursor?.match ??
      (query === null
        ? 'none'
        : this.database.deepchatSearchDocumentsTable.isFtsAvailable()
          ? 'fts'
          : 'literal')
    const run = (mode: Cursor['match']): Preview[] => {
      const fts = mode === 'fts'
      const excerpt = fts
        ? `snippet(deepchat_search_documents_fts, 1, '', '', ' … ', 48)`
        : mode === 'literal'
          ? `substr(d.content, max(1, instr(lower(d.content), lower(@query)) - 120))`
          : 'd.content'
      return db
        .prepare(`
        SELECT ${PREVIEW_COLUMNS}, substr(coalesce(${excerpt}, ''), 1, ${PREVIEW_CHARS}) AS preview
        FROM deepchat_messages m ${DOCUMENT_JOIN}
        ${fts ? 'JOIN deepchat_search_documents_fts ON deepchat_search_documents_fts.rowid = d.rowid' : ''}
        WHERE m.session_id = @sessionId AND ${READABLE}
          AND (m.order_seq < @highWater OR (m.order_seq = @highWater AND m.id <= @highWaterMessageId))
          AND (@role IS NULL OR m.role = @role)
          ${fts ? 'AND deepchat_search_documents_fts.content MATCH @matchQuery' : mode === 'literal' ? 'AND instr(lower(d.content), lower(@query)) > 0' : ''}
          AND (m.order_seq > @seq OR (m.order_seq = @seq AND m.id > @id))
        ORDER BY m.order_seq ASC, m.id ASC LIMIT @limit
      `)
        .all({
          sessionId: source.sessionId,
          highWater,
          highWaterMessageId,
          role,
          query,
          matchQuery:
            query
              ?.split(/\s+/u)
              .map((token) => `"${token.replaceAll('"', '""')}"`)
              .join(' AND ') ?? '',
          seq: cursor?.orderSeq ?? -1,
          id: cursor?.messageId ?? '',
          limit: limit + 1
        }) as Preview[]
    }
    let rows: Preview[]
    try {
      rows = run(match)
    } catch (error) {
      if (match !== 'fts') throw error
      if (cursor) throw new Error('Search index changed. Restart this search without a cursor.')
      match = 'literal'
      rows = run(match)
    }
    if (!cursor && match === 'fts' && rows.length === 0) {
      match = 'literal'
      rows = run(match)
    }
    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map(toPreview)
    const last = items.at(-1)
    return {
      source,
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                source: source.sessionId,
                incarnation: source.tapeIncarnationId,
                action: input.action === 'search' ? 'search' : 'messages',
                role,
                query,
                match,
                highWater,
                highWaterMessageId,
                orderSeq: last.orderSeq,
                messageId: last.messageId
              } satisfies Cursor)
            ).toString('base64url')
          : null,
      previewFormat: 'search_text',
      previewMaxCharacters: PREVIEW_CHARS,
      guidance:
        'Previews locate evidence, not necessarily final conclusions. Use action=message with messageId for typed message content.'
    }
  }

  private readMessage(source: SessionReference, input: ReadSessionInput) {
    if (!input.messageId) throw new Error('Message detail requires messageId.')
    const offset = input.offset ?? 0
    const row = this.database
      .getDatabase()
      .prepare(`
      SELECT m.id AS messageId, m.role, m.status, m.order_seq AS orderSeq,
        substr(m.content, @offset + 1, ${DETAIL_CHARS}) AS content,
        length(m.content) AS totalCharacters, json_valid(m.content) AS isJson
      FROM deepchat_messages m WHERE m.session_id = @sessionId AND m.id = @messageId
        AND ${READABLE} AND (@role IS NULL OR m.role = @role)
    `)
      .get({
        offset,
        sessionId: source.sessionId,
        messageId: input.messageId,
        role: input.role ?? null
      }) as
      | {
          messageId: string
          role: string
          status: string
          orderSeq: number
          content: string
          totalCharacters: number
          isJson: number
        }
      | undefined
    if (!row) throw new Error('Referenced message was not found or is not readable.')
    if (offset > row.totalCharacters) throw new Error('Message offset exceeds content length.')
    const { isJson, ...message } = row
    const nextOffset = Math.min(offset + DETAIL_CHARS, row.totalCharacters)
    return {
      source,
      message: { ...message, format: isJson ? 'stored_message_json' : 'text', offset, nextOffset },
      hasMore: nextOffset < row.totalCharacters,
      maxCharacters: DETAIL_CHARS,
      offsetUnit: 'unicode_code_points'
    }
  }

  private readContext(source: SessionReference, input: ReadSessionInput) {
    if (!input.messageId) throw new Error('Context requires messageId.')
    const db = this.database.getDatabase()
    const select = `SELECT ${PREVIEW_COLUMNS}, substr(coalesce(d.content, ''), 1, ${PREVIEW_CHARS}) AS preview
      FROM deepchat_messages m ${DOCUMENT_JOIN} WHERE m.session_id = @sessionId AND ${READABLE}
        AND (@role IS NULL OR m.role = @role)`
    const params = { sessionId: source.sessionId, role: input.role ?? null, id: input.messageId }
    const center = db.prepare(`${select} AND m.id = @id`).get(params) as Preview | undefined
    if (!center)
      throw new Error('Context message was not found or does not match the requested role.')
    const before = db
      .prepare(`${select}
      AND (m.order_seq < @seq OR (m.order_seq = @seq AND m.id < @id))
      ORDER BY m.order_seq DESC, m.id DESC LIMIT @limit
    `)
      .all({ ...params, seq: center.orderSeq, limit: input.before ?? 3 }) as Preview[]
    const after = db
      .prepare(`${select}
      AND (m.order_seq > @seq OR (m.order_seq = @seq AND m.id > @id))
      ORDER BY m.order_seq ASC, m.id ASC LIMIT @limit
    `)
      .all({ ...params, seq: center.orderSeq, limit: input.after ?? 3 }) as Preview[]
    return {
      source,
      items: [...before.reverse(), center, ...after].map(toPreview),
      previewFormat: 'search_text',
      previewMaxCharacters: PREVIEW_CHARS
    }
  }

  private assertAuthorized(caller: string, source: SessionReference): void {
    if (caller === source.sessionId) return
    const rows = this.database
      .getDatabase()
      .prepare(`
      SELECT json_extract(CASE WHEN item.type = 'object' THEN item.value ELSE '{}' END,
                          '$.tapeIncarnationId') AS incarnation
      FROM deepchat_messages m,
        json_each(CASE WHEN json_valid(m.content) THEN m.content ELSE '{}' END, '$.inlineItems') item
      WHERE m.session_id = ? AND m.role = 'user' AND m.status = 'sent'
        AND json_extract(CASE WHEN item.type = 'object' THEN item.value ELSE '{}' END, '$.type') = 'session'
        AND json_extract(CASE WHEN item.type = 'object' THEN item.value ELSE '{}' END, '$.sessionId') = ?
        AND json_extract(CASE WHEN item.type = 'object' THEN item.value ELSE '{}' END, '$.tapeIncarnationId') = ?
      LIMIT 1
    `)
      .get(caller, source.sessionId, source.tapeIncarnationId)
    if (!rows)
      throw new Error(
        'This session is not authorized to read this source or its reference is stale after reset.'
      )
  }

  private requireRegularSession(sessionId: string) {
    const row = this.database
      .getDatabase()
      .prepare(`
      SELECT id AS sessionId, substr(title, 1, 1024) AS title, project_dir AS projectDir
      FROM new_sessions WHERE id = ? AND session_kind = 'regular' AND is_draft = 0
    `)
      .get(sessionId) as Omit<SessionReference, 'tapeIncarnationId'> | undefined
    if (!row) throw new Error('Referenced session was not found or is not a regular session.')
    return row
  }

  private decodeCursor(raw: string): Cursor {
    try {
      return cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
    } catch {
      throw new Error('Invalid read_session cursor.')
    }
  }
}

function toPreview(row: Preview) {
  return {
    ...row,
    truncated: (row.totalCharacters ?? 0) > [...row.preview].length,
    previewUnavailable: !!row.previewUnavailable
  }
}
