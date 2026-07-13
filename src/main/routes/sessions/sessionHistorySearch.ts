import type { AppSessionService } from '@/agent/shared/appSessionService'
import type { SQLitePresenter } from '@/presenter/sqlitePresenter'
import type {
  HistorySearchHit,
  HistorySearchMessageHit,
  HistorySearchOptions,
  HistorySearchSessionHit
} from '@shared/contracts/routes/sessions.routes'

type SearchableSessionRow = {
  id: string
  title: string
  projectDir: string | null
  updatedAt: number
}

type SearchableMessageRow = {
  id: string
  sessionId: string
  title: string
  role: 'user' | 'assistant'
  content: string
  updatedAt: number
}

const clampLimit = (value: number | undefined): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 12
  return Math.min(Math.max(Math.floor(value), 1), 50)
}

const buildSnippet = (content: string, query: string, maxLength = 120): string => {
  const normalizedContent = content.trim()
  if (!normalizedContent) return ''
  const index = normalizedContent.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) {
    return normalizedContent.length > maxLength
      ? normalizedContent.slice(0, maxLength).trimEnd() + '…'
      : normalizedContent
  }
  const start = Math.max(0, index - 48)
  const end = Math.min(normalizedContent.length, index + query.length + 48)
  let snippet = normalizedContent.slice(start, end).trim()
  if (start > 0) snippet = '…' + snippet
  if (end < normalizedContent.length) snippet += '…'
  return snippet
}

const extractMessageContent = (rawContent: string): string => {
  try {
    const parsed = JSON.parse(rawContent) as
      | { text?: string; content?: Array<{ text?: string }> }
      | Array<{ content?: string; text?: string; error?: string }>
    if (Array.isArray(parsed)) {
      const segments = parsed
        .flatMap((block) => [block?.content, block?.text, block?.error])
        .filter((value): value is string => typeof value === 'string' && !!value.trim())
        .map((value) => value.trim())
      if (segments.length > 0) return segments.join('\n')
    } else if (parsed && typeof parsed === 'object') {
      if (typeof parsed.text === 'string' && parsed.text.trim()) return parsed.text.trim()
      if (Array.isArray(parsed.content)) {
        const segments = parsed.content
          .filter((item) => typeof item?.text === 'string' && item.text.trim().length > 0)
          .map((item) => item.text!.trim())
        if (segments.length > 0) return segments.join('\n')
      }
    }
  } catch {}
  return rawContent
}

const scoreSession = (row: SearchableSessionRow, query: string): number => {
  const title = row.title.toLowerCase()
  if (title.startsWith(query)) return 400
  if (title.includes(query)) return 320
  return 0
}

const scoreMessage = (row: SearchableMessageRow, query: string): number => {
  const title = row.title.toLowerCase()
  const content = row.content.toLowerCase()
  if (title.startsWith(query)) return 280
  if (title.includes(query)) return 220
  if (content.startsWith(query)) return 180
  if (content.includes(query)) return 140
  return 0
}

export class SessionHistorySearch {
  constructor(
    private readonly sqlitePresenter: Pick<
      SQLitePresenter,
      'getDatabase' | 'deepchatSearchDocumentsTable'
    >,
    private readonly appSessionService: Pick<AppSessionService, 'get'>
  ) {}

  async search(query: string, options?: HistorySearchOptions): Promise<HistorySearchHit[]> {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return []
    const limit = clampLimit(options?.limit)
    const db = this.sqlitePresenter.getDatabase()
    if (!db) return []

    const documentLimit = limit * 4
    const ftsRows = this.sqlitePresenter.deepchatSearchDocumentsTable.searchFts(
      normalizedQuery,
      documentLimit
    )
    const candidateRows =
      ftsRows.length > 0
        ? ftsRows
        : this.sqlitePresenter.deepchatSearchDocumentsTable.searchLike(
            normalizedQuery,
            documentLimit
          )

    if (candidateRows.length > 0) {
      const hits = candidateRows
        .map((row) => {
          if (row.document_kind === 'session') {
            const session = this.appSessionService.get(row.session_id)
            if (!session) return null
            return {
              kind: 'session' as const,
              sessionId: session.id,
              title: row.title,
              projectDir: session.projectDir,
              updatedAt: row.updated_at,
              rank: row.rank
            }
          }
          if (!row.message_id || (row.role !== 'user' && row.role !== 'assistant')) return null
          return {
            kind: 'message' as const,
            sessionId: row.session_id,
            messageId: row.message_id,
            title: row.title,
            role: row.role,
            snippet: buildSnippet(row.content, normalizedQuery),
            updatedAt: row.updated_at,
            rank: row.rank
          }
        })
        .filter((item): item is HistorySearchHit & { rank: number } => item !== null)
      if (hits.length > 0) {
        const deduped = new Map<string, HistorySearchHit & { rank: number }>()
        for (const hit of hits) {
          const key =
            hit.kind === 'session' ? `session:${hit.sessionId}` : `message:${hit.messageId}`
          if (!deduped.has(key)) deduped.set(key, hit)
        }
        return Array.from(deduped.values())
          .sort((left, right) => left.rank - right.rank || right.updatedAt - left.updatedAt)
          .slice(0, limit)
          .map(({ rank: _rank, ...item }) => item)
      }
    }

    const likeQuery = `%${normalizedQuery}%`
    const sessionRows = db
      .prepare(
        `SELECT id, title, project_dir AS projectDir, updated_at AS updatedAt
         FROM new_sessions
         WHERE session_kind = 'regular' AND lower(title) LIKE ?
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(likeQuery, limit * 2) as SearchableSessionRow[]
    const messageRows = db
      .prepare(
        `SELECT m.id AS id, m.session_id AS sessionId, s.title AS title, m.role AS role,
                m.content AS content, m.updated_at AS updatedAt
         FROM deepchat_messages m INNER JOIN new_sessions s ON s.id = m.session_id
         WHERE s.session_kind = 'regular' AND lower(m.content) LIKE ?
         ORDER BY m.updated_at DESC LIMIT ?`
      )
      .all(likeQuery, limit * 4) as SearchableMessageRow[]
    const sessionHits: Array<HistorySearchSessionHit & { score: number }> = sessionRows
      .map((row) => ({
        kind: 'session' as const,
        sessionId: row.id,
        title: row.title,
        projectDir: row.projectDir,
        updatedAt: Number(row.updatedAt ?? 0),
        score: scoreSession(row, normalizedQuery)
      }))
      .filter((item) => item.score > 0)
    const messageHits: Array<HistorySearchMessageHit & { score: number }> = messageRows
      .map((row) => {
        const content = extractMessageContent(row.content)
        return {
          kind: 'message' as const,
          sessionId: row.sessionId,
          messageId: row.id,
          title: row.title,
          role: row.role,
          snippet: buildSnippet(content, normalizedQuery),
          updatedAt: Number(row.updatedAt ?? 0),
          score: scoreMessage({ ...row, content }, normalizedQuery)
        }
      })
      .filter((item) => item.score > 0)
    return [...sessionHits, ...messageHits]
      .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
      .slice(0, limit)
      .map(({ score: _score, ...item }) => item)
  }
}
