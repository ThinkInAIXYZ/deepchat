import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionReferences } from '@/session/data/sessionReferences'
import { SessionDatabase } from '@/session/data/database'
import { DeepChatMessagesTable } from '@/session/data/tables/deepchatMessages'
import { DeepChatSearchDocumentsTable } from '@/session/data/tables/deepchatSearchDocuments'
import { DeepChatSessionsTable } from '@/session/data/tables/deepchatSessions'
import { NewSessionsTable } from '@/session/data/tables/newSessions'
import { Database, nativeSqliteDescribeIf } from '../../nativeSqliteHarness'

const DatabaseCtor = Database!
const describeIfNativeSqlite = nativeSqliteDescribeIf()

type PageItem = {
  messageId: string
  orderSeq: number
  role: string
  createdAt: number
  preview: string
  truncated: boolean
}

type Page = {
  source: { sessionId: string; tapeIncarnationId: string }
  items: PageItem[]
  hasMore: boolean
  nextCursor: string | null
  previewFormat: string
  previewMaxCharacters: number
}

describeIfNativeSqlite('SessionReferences', () => {
  let db: InstanceType<typeof DatabaseCtor>
  let database: SessionDatabase
  let messages: DeepChatMessagesTable
  let search: DeepChatSearchDocumentsTable
  let incarnations: Map<string, string>
  let reader: SessionReferences
  let grantSequence: number

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    new NewSessionsTable(db).createTable()
    new DeepChatSessionsTable(db).createTable()
    messages = new DeepChatMessagesTable(db)
    messages.createTable()
    search = new DeepChatSearchDocumentsTable(db)
    search.createTable()
    database = new SessionDatabase({ getDatabase: () => db } as never)
    incarnations = new Map()
    grantSequence = 0
    reader = makeReader()
  })

  afterEach(() => db.close())

  function makeReader() {
    return new SessionReferences(
      database,
      {
        getTapeIncarnationId(sessionId: string) {
          const incarnation = incarnations.get(sessionId)
          if (!incarnation) throw new Error('missing tape')
          return incarnation
        }
      },
      async (sessionId) => {
        incarnations.set(sessionId, `initialized-${sessionId}`)
      }
    )
  }

  function addSession(
    id: string,
    options: { title?: string; projectDir?: string | null; updatedAt?: number } = {}
  ) {
    const now = options.updatedAt ?? 1
    db.prepare(
      `INSERT INTO new_sessions
       (id, agent_id, title, project_dir, is_draft, session_kind, created_at, updated_at)
       VALUES (?, 'agent', ?, ?, 0, 'regular', ?, ?)`
    ).run(
      id,
      options.title ?? id,
      options.projectDir === undefined ? '/workspace' : options.projectDir,
      now,
      now
    )
    db.prepare(
      `INSERT INTO deepchat_sessions (id, provider_id, model_id, permission_mode)
       VALUES (?, 'provider', 'model', 'default')`
    ).run(id)
    incarnations.set(id, `inc-${id}`)
  }

  function addMessage(options: {
    id: string
    sessionId?: string
    orderSeq: number
    role?: 'user' | 'assistant'
    content?: unknown
    status?: 'pending' | 'sent' | 'error'
    metadata?: unknown
    searchText?: string
  }) {
    const role = options.role ?? 'user'
    const content =
      typeof options.content === 'string'
        ? options.content
        : JSON.stringify(options.content ?? { text: options.id })
    messages.insert({
      id: options.id,
      sessionId: options.sessionId ?? 'source',
      orderSeq: options.orderSeq,
      role,
      content,
      status: options.status ?? 'sent',
      metadata: JSON.stringify(options.metadata ?? {}),
      createdAt: options.orderSeq,
      updatedAt: options.orderSeq
    })
    if (options.searchText !== undefined) {
      search.upsert({
        documentKey: `message:${options.id}`,
        sessionId: options.sessionId ?? 'source',
        messageId: options.id,
        documentKind: 'message',
        role,
        title: '',
        content: options.searchText,
        updatedAt: options.orderSeq
      })
    }
  }

  function grant(source = 'source', incarnation = `inc-${source}`, caller = 'caller') {
    addMessage({
      id: `grant-${source}-${caller}-${grantSequence++}`,
      sessionId: caller,
      orderSeq: 1,
      content: {
        text: 'explicit reference',
        inlineItems: [{ type: 'session', sessionId: source, tapeIncarnationId: incarnation }]
      }
    })
  }

  beforeEach(() => {
    addSession('caller')
    addSession('source')
  })

  it('authorizes only a structured persisted user grant and revokes it on reset or deletion', async () => {
    addSession('other')
    addMessage({ id: 'source-message', orderSeq: 1, searchText: 'source projection' })
    addMessage({
      id: 'text-only',
      sessionId: 'caller',
      orderSeq: 1,
      content: { text: 'source inc-source' }
    })
    addMessage({
      id: 'assistant-grant',
      sessionId: 'caller',
      orderSeq: 2,
      role: 'assistant',
      content: JSON.stringify({
        inlineItems: [{ type: 'session', sessionId: 'source', tapeIncarnationId: 'inc-source' }]
      })
    })
    addMessage({
      id: 'transitive',
      sessionId: 'caller',
      orderSeq: 3,
      content: {
        inlineItems: [{ type: 'session', sessionId: 'other', tapeIncarnationId: 'inc-other' }]
      }
    })
    addMessage({
      id: 'malformed',
      sessionId: 'caller',
      orderSeq: 4,
      content: {
        inlineItems: ['not JSON', null, { type: 'session', sessionId: 'source' }]
      }
    })
    grant('source', 'inc-source', 'other')

    await expect(
      reader.read('caller', { sessionId: 'source', action: 'messages' })
    ).rejects.toThrow(/not authorized/i)
    grant()
    await expect(
      reader.read('caller', { sessionId: 'source', action: 'messages' })
    ).resolves.toMatchObject({ source: { sessionId: 'source' } })

    incarnations.set('source', 'inc-source-reset')
    await expect(
      reader.read('caller', { sessionId: 'source', action: 'messages' })
    ).rejects.toThrow(/not authorized|reset|stale/i)
    db.prepare('DELETE FROM new_sessions WHERE id = ?').run('source')
    await expect(
      reader.read('caller', { sessionId: 'source', action: 'messages' })
    ).rejects.toThrow(/not found/i)
  })

  it('binds cursors to source, incarnation, action, role and query and preserves append high-water', async () => {
    addSession('other')
    grant()
    grant('other')
    for (let index = 1; index <= 4; index++) {
      addMessage({ id: `m${index}`, orderSeq: index, searchText: `needle ${index}` })
    }
    addMessage({ id: 'other-1', sessionId: 'other', orderSeq: 1, searchText: 'needle other' })
    const first = (await reader.read('caller', {
      sessionId: 'source',
      action: 'search',
      query: 'needle',
      role: 'user',
      limit: 2
    })) as Page
    expect(first.nextCursor).toEqual(expect.any(String))

    const mismatches = [
      { sessionId: 'other', action: 'search', query: 'needle', role: 'user' },
      { sessionId: 'source', action: 'messages', role: 'user' },
      { sessionId: 'source', action: 'search', query: 'changed', role: 'user' },
      { sessionId: 'source', action: 'search', query: 'needle', role: 'assistant' }
    ] as const
    for (const mismatch of mismatches) {
      await expect(
        reader.read('caller', { ...mismatch, cursor: first.nextCursor! })
      ).rejects.toThrow(/cursor/i)
    }
    incarnations.set('source', 'new-incarnation')
    grant('source', 'new-incarnation')
    await expect(
      reader.read('caller', {
        sessionId: 'source',
        action: 'search',
        query: 'needle',
        role: 'user',
        cursor: first.nextCursor!
      })
    ).rejects.toThrow(/cursor|reset|stale/i)

    incarnations.set('source', 'inc-source')
    addMessage({ id: 'appended', orderSeq: 5, searchText: 'needle appended' })
    const resumed = (await makeReader().read('caller', {
      sessionId: 'source',
      action: 'search',
      query: 'needle',
      role: 'user',
      cursor: first.nextCursor!
    })) as Page
    expect(resumed.items.map((item) => item.messageId)).toEqual(['m3', 'm4'])
    expect(resumed.items.map((item) => item.messageId)).not.toContain('appended')
  })

  it.each([
    ['messages', 1],
    ['messages', 3],
    ['search', 1],
    ['search', 3]
  ] as const)('rejects %s continuation after compaction shifts from %i', async (action, from) => {
    grant()
    for (let index = 1; index <= 4; index++) {
      addMessage({ id: `m${index}`, orderSeq: index, searchText: `needle ${index}` })
    }
    const input = {
      sessionId: 'source',
      action,
      ...(action === 'search' ? { query: 'needle' } : {}),
      limit: 2
    }
    const first = (await reader.read('caller', input)) as Page
    expect(first.items.map((item) => item.messageId)).toEqual(['m1', 'm2'])
    expect(first.nextCursor).toEqual(expect.any(String))

    // Use the same mutation as SessionTranscript.shiftMessagesFrom. Shifting only unread
    // messages also invalidates the high-water, even if the last returned message stays put.
    messages.incrementOrderSeqFrom('source', from, 100)
    await expect(
      makeReader().read('caller', { ...input, cursor: first.nextCursor! })
    ).rejects.toThrow(/order changed.*without a cursor/i)
    const restarted = (await reader.read('caller', { ...input, limit: 20 })) as Page
    expect(restarted.items.map((item) => item.messageId)).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('allows non-boundary deletion but rejects a removed high-water even if its position is reused', async () => {
    grant()
    for (let index = 1; index <= 4; index++) {
      addMessage({ id: `m${index}`, orderSeq: index, searchText: `needle ${index}` })
    }
    const input = { sessionId: 'source', action: 'messages', limit: 2 } as const
    const first = (await reader.read('caller', input)) as Page
    db.prepare('DELETE FROM deepchat_messages WHERE id = ?').run('m3')
    const continued = (await reader.read('caller', {
      ...input,
      cursor: first.nextCursor!
    })) as Page
    expect(continued.items.map((item) => item.messageId)).toEqual(['m4'])

    db.prepare('DELETE FROM deepchat_messages WHERE id = ?').run('m4')
    addMessage({ id: 'replacement', orderSeq: 4, searchText: 'new evidence' })
    await expect(reader.read('caller', { ...input, cursor: first.nextCursor! })).rejects.toThrow(
      /order changed.*without a cursor/i
    )
  })

  it('paginates equal order sequences without gaps or duplicates in ascending id order', async () => {
    grant()
    for (const id of ['z', 'a', 'm', 'b']) addMessage({ id, orderSeq: 7, searchText: id })
    const first = (await reader.read('caller', {
      sessionId: 'source',
      action: 'messages',
      limit: 2
    })) as Page
    const second = (await reader.read('caller', {
      sessionId: 'source',
      action: 'messages',
      limit: 2,
      cursor: first.nextCursor!
    })) as Page
    expect(first.items.map((item) => item.messageId)).toEqual(['a', 'b'])
    expect(second.items.map((item) => item.messageId)).toEqual(['m', 'z'])
    expect(second.hasMore).toBe(false)
  })

  it('filters search target and role before limit and uses scoped literal fallback for Unicode punctuation', async () => {
    grant()
    for (let index = 0; index < 21; index++) {
      addMessage({
        id: `noise-${index}`,
        sessionId: 'caller',
        orderSeq: index + 10,
        searchText: '共有，片段'
      })
    }
    addMessage({ id: 'assistant-hit', orderSeq: 1, role: 'assistant', searchText: '共有，片段' })
    addMessage({ id: 'user-hit', orderSeq: 2, searchText: '共有，片段' })

    const result = (await reader.read('caller', {
      sessionId: 'source',
      action: 'search',
      query: '有，片',
      role: 'user',
      limit: 1
    })) as Page
    expect(result.items.map((item) => item.messageId)).toEqual(['user-hit'])
    expect(result.items.every((item) => item.role === 'user')).toBe(true)
  })

  it('returns search projections for lists/context without leaking raw assistant JSON or roles', async () => {
    grant()
    addMessage({
      id: 'u1',
      orderSeq: 1,
      content: { text: 'raw user' },
      searchText: 'user projection'
    })
    addMessage({
      id: 'a1',
      orderSeq: 2,
      role: 'assistant',
      content: JSON.stringify([{ type: 'text', content: 'SECRET RAW JSON' }]),
      searchText: 'assistant projection'
    })
    addMessage({
      id: 'u2',
      orderSeq: 3,
      content: { text: 'raw user 2' },
      searchText: 'second projection'
    })

    const page = (await reader.read('caller', {
      sessionId: 'source',
      action: 'messages',
      role: 'assistant'
    })) as Page
    expect(page.items).toEqual([
      expect.objectContaining({
        messageId: 'a1',
        role: 'assistant',
        preview: 'assistant projection'
      })
    ])
    expect(JSON.stringify(page)).not.toContain('SECRET RAW JSON')

    const context = (await reader.read('caller', {
      sessionId: 'source',
      action: 'context',
      messageId: 'u2',
      role: 'user',
      before: 5,
      after: 5
    })) as { items: PageItem[]; previewFormat: string }
    expect(
      context.items.map(({ messageId, role, preview }) => ({ messageId, role, preview }))
    ).toEqual([
      { messageId: 'u1', role: 'user', preview: 'user projection' },
      { messageId: 'u2', role: 'user', preview: 'second projection' }
    ])
    expect(context.previewFormat).toBe('search_text')
  })

  it('marks 800-codepoint previews and reconstructs raw detail from 8192-codepoint chunks', async () => {
    grant()
    const raw = JSON.stringify([{ type: 'text', content: `${'😀'.repeat(9000)}终` }])
    addMessage({ id: 'long', orderSeq: 1, role: 'assistant', content: raw, searchText: raw })

    const page = (await reader.read('caller', {
      sessionId: 'source',
      action: 'messages'
    })) as Page
    expect(page.previewMaxCharacters).toBe(800)
    expect([...page.items[0]!.preview]).toHaveLength(800)

    let offset = 0
    let reconstructed = ''
    let hasMore = true
    while (hasMore) {
      const detail = (await reader.read('caller', {
        sessionId: 'source',
        action: 'message',
        messageId: 'long',
        offset
      })) as {
        message: { content: string; format: string; offset: number; nextOffset: number }
        hasMore: boolean
        offsetUnit: string
      }
      expect(detail.message.format).toBe('stored_message_json')
      expect(detail.message.offset).toBe(offset)
      expect([...detail.message.content].length).toBeLessThanOrEqual(8192)
      expect(detail.message.nextOffset).toBeGreaterThan(offset)
      expect(detail.offsetUnit).toBe('unicode_code_points')
      reconstructed += detail.message.content
      offset = detail.message.nextOffset
      hasMore = detail.hasMore
    }
    expect(reconstructed).toBe(raw)
    expect(page.items[0]!.truncated).toBe(true)
  })

  it('includes sent and error terminals but excludes pending and control compaction messages', async () => {
    grant()
    addMessage({ id: 'sent', orderSeq: 1, status: 'sent', searchText: 'sent' })
    addMessage({ id: 'error', orderSeq: 2, status: 'error', searchText: 'error' })
    addMessage({ id: 'pending', orderSeq: 3, status: 'pending', searchText: 'pending' })
    addMessage({
      id: 'compaction',
      orderSeq: 4,
      role: 'assistant',
      metadata: { messageType: 'compaction' },
      searchText: 'compaction'
    })
    const page = (await reader.read('caller', {
      sessionId: 'source',
      action: 'messages'
    })) as Page
    expect(page.items.map((item) => item.messageId)).toEqual(['sent', 'error'])
  })

  it('matches candidate titles before limit in the exact workspace and treats percent literally', () => {
    for (let index = 0; index < 25; index++) {
      addSession(`recent-${index}`, {
        title: `unrelated ${index}`,
        projectDir: '/workspace',
        updatedAt: 100 + index
      })
    }
    addSession('older-match', {
      title: 'Roadmap 100% done',
      projectDir: '/workspace',
      updatedAt: 2
    })
    addSession('not-literal', { title: 'Roadmap 100 done', projectDir: '/workspace' })
    addSession('other-workspace', {
      title: 'Roadmap 100% done',
      projectDir: '/elsewhere',
      updatedAt: 500
    })
    addSession('null-match', { title: 'Roadmap 100% done', projectDir: null, updatedAt: 3 })

    expect(reader.searchCandidates({ projectDir: '/workspace', query: '100%' })).toEqual([
      expect.objectContaining({ sessionId: 'older-match' })
    ])
    expect(reader.searchCandidates({ projectDir: null, query: '100%' })).toEqual([
      expect.objectContaining({ sessionId: 'null-match' })
    ])
  })

  it('bounds huge-message materialization and rejects invalid action arguments', async () => {
    grant()
    const long = `${'irrelevant '.repeat(100_000)}needle at end`
    addMessage({ id: 'huge', orderSeq: 1, role: 'assistant', content: long, searchText: long })
    const result = (await reader.read('caller', {
      sessionId: 'source',
      action: 'search',
      query: 'needle'
    })) as Page
    expect(result.items[0].preview).toContain('needle')
    expect(JSON.stringify(result).length).toBeLessThan(2500)
    for (const input of [
      { action: 'messages', limit: 21 },
      { action: 'context', messageId: 'huge', before: 100 },
      { action: 'message', messageId: 'huge', offset: -1 },
      { action: 'messages', offset: 1 },
      { action: 'messages', cursor: 'not-a-cursor' }
    ] as const) {
      await expect(reader.read('caller', { sessionId: 'source', ...input })).rejects.toThrow()
    }
    const detail = await reader.read('caller', {
      sessionId: 'source',
      action: 'message',
      messageId: 'huge'
    })
    expect(JSON.stringify(detail).length).toBeLessThan(9000)
  })
})
