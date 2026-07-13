import { describe, expect, it, vi } from 'vitest'
import { SessionHistorySearch } from '@/routes/sessions/sessionHistorySearch'

function createFixture() {
  const sessionRows: unknown[] = []
  const messageRows: unknown[] = []
  const searchFts = vi.fn(() => [] as any[])
  const searchLike = vi.fn(() => [] as any[])
  const sessionAll = vi.fn(() => sessionRows)
  const messageAll = vi.fn(() => messageRows)
  const prepare = vi.fn((sql: string) => ({
    all: sql.includes('FROM new_sessions') ? sessionAll : messageAll
  }))
  const getDatabase = vi.fn(() => ({ prepare }))
  const sessions = new Map<string, { id: string; projectDir: string | null }>()
  const service = new SessionHistorySearch(
    {
      getDatabase,
      deepchatSearchDocumentsTable: { searchFts, searchLike }
    } as never,
    { get: vi.fn((id: string) => sessions.get(id) ?? null) } as never
  )
  return {
    service,
    sessionRows,
    messageRows,
    searchFts,
    searchLike,
    getDatabase,
    sessionAll,
    messageAll,
    sessions
  }
}

describe('SessionHistorySearch', () => {
  it('returns no hits for an empty normalized query', async () => {
    const fixture = createFixture()
    await expect(fixture.service.search('   ')).resolves.toEqual([])
    expect(fixture.getDatabase).not.toHaveBeenCalled()
  })

  it('prefers FTS rows, deduplicates, ranks, builds snippets, and clamps limits', async () => {
    const fixture = createFixture()
    fixture.sessions.set('session-1', { id: 'session-1', projectDir: '/repo' })
    fixture.searchFts.mockReturnValue([
      {
        document_kind: 'message',
        session_id: 'session-1',
        message_id: 'message-1',
        role: 'assistant',
        title: 'Release notes',
        content: `${'x'.repeat(60)} release ${'y'.repeat(60)}`,
        updated_at: 20,
        rank: 2
      },
      {
        document_kind: 'session',
        session_id: 'session-1',
        message_id: null,
        role: null,
        title: 'Release plan',
        content: '',
        updated_at: 10,
        rank: 1
      },
      {
        document_kind: 'message',
        session_id: 'session-1',
        message_id: 'message-1',
        role: 'assistant',
        title: 'duplicate',
        content: 'duplicate',
        updated_at: 30,
        rank: 3
      }
    ])

    const hits = await fixture.service.search(' Release ', { limit: 99 })

    expect(fixture.searchFts).toHaveBeenCalledWith('release', 200)
    expect(fixture.searchLike).not.toHaveBeenCalled()
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ kind: 'session', sessionId: 'session-1' })
    expect(hits[1]).toMatchObject({ kind: 'message', messageId: 'message-1' })
    expect((hits[1] as { snippet: string }).snippet).toMatch(/^….*release.*…$/)
  })

  it('uses indexed LIKE rows only when FTS has no rows', async () => {
    const fixture = createFixture()
    fixture.searchLike.mockReturnValue([
      {
        document_kind: 'message',
        session_id: 'session-1',
        message_id: 'message-1',
        role: 'user',
        title: 'Title',
        content: 'indexed fallback',
        updated_at: 1,
        rank: 0
      }
    ])

    const hits = await fixture.service.search('fallback')

    expect(fixture.searchLike).toHaveBeenCalledWith('fallback', 48)
    expect(hits).toEqual([expect.objectContaining({ kind: 'message', messageId: 'message-1' })])
  })

  it('uses the default limit and orders equal-score legacy hits by updatedAt descending', async () => {
    const fixture = createFixture()
    for (let index = 1; index <= 13; index += 1) {
      fixture.sessionRows.push({
        id: `session-${index}`,
        title: `release plan ${index}`,
        projectDir: '/repo',
        updatedAt: index
      })
    }
    fixture.messageRows.push({
      id: 'message-1',
      sessionId: 'session-1',
      title: 'Other',
      role: 'user',
      content: JSON.stringify({ text: 'release details' }),
      updatedAt: 20
    })

    const hits = await fixture.service.search('release')

    expect(fixture.sessionAll).toHaveBeenCalledWith('%release%', 24)
    expect(fixture.messageAll).toHaveBeenCalledWith('%release%', 48)
    expect(hits).toHaveLength(12)
    expect(hits[0]).toMatchObject({ kind: 'session', sessionId: 'session-13', updatedAt: 13 })
    expect(hits.at(-1)).toMatchObject({ kind: 'session', sessionId: 'session-2', updatedAt: 2 })
  })
})
