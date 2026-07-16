import { describe, expect, it } from 'vitest'
import {
  createDebugMockChatSession,
  type DebugMockChatDatabase
} from '@/app/debug/createMockChatSession'

type FakeDeepchatSession = {
  id: string
  provider_id: string
  model_id: string
  permission_mode: string
  system_prompt?: string | null
}

type FakeDeepchatMessage = {
  id: string
  session_id: string
  order_seq: number
  role: 'user' | 'assistant'
  content: string
  status: string
  is_context_edge?: number
  metadata?: string
  created_at: number
  updated_at: number
}

class FakeDebugDb implements DebugMockChatDatabase {
  newSessions: Array<{ id: string; agent_id: string; title: string }> = []
  deepchatSessions: FakeDeepchatSession[] = []
  deepchatMessages: FakeDeepchatMessage[] = []

  prepare(sql: string) {
    if (sql.includes('SELECT role, content')) {
      return this.statement({
        all: () =>
          this.deepchatMessages
            .filter((row) => !row.session_id.startsWith('debug-long-chat-'))
            .sort((left, right) => right.updated_at - left.updated_at)
            .slice(0, 80)
            .map((row) => ({ role: row.role, content: row.content }))
      })
    }

    if (sql.includes('SELECT provider_id, model_id')) {
      return this.statement({
        get: () => this.deepchatSessions.at(-1)
      })
    }

    if (sql.includes('INSERT INTO new_sessions')) {
      return this.statement({
        run: (id, agentId, title) => {
          this.newSessions.push({
            id: String(id),
            agent_id: String(agentId),
            title: String(title)
          })
        }
      })
    }

    if (sql.includes('INSERT INTO deepchat_sessions')) {
      return this.statement({
        run: (id, providerId, modelId, permissionMode, systemPrompt) => {
          this.deepchatSessions.push({
            id: String(id),
            provider_id: String(providerId),
            model_id: String(modelId),
            permission_mode: String(permissionMode),
            system_prompt: systemPrompt == null ? null : String(systemPrompt)
          })
        }
      })
    }

    if (sql.includes('INSERT INTO deepchat_messages')) {
      return this.statement({
        run: (
          id,
          sessionId,
          orderSeq,
          role,
          content,
          status,
          isContextEdge,
          metadata,
          createdAt,
          updatedAt
        ) => {
          this.deepchatMessages.push({
            id: String(id),
            session_id: String(sessionId),
            order_seq: Number(orderSeq),
            role: role === 'assistant' ? 'assistant' : 'user',
            content: String(content),
            status: String(status),
            is_context_edge: Number(isContextEdge),
            metadata: String(metadata),
            created_at: Number(createdAt),
            updated_at: Number(updatedAt)
          })
        }
      })
    }

    return this.statement()
  }

  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    return fn
  }

  private statement(overrides?: {
    all?: (...params: unknown[]) => unknown[]
    get?: (...params: unknown[]) => unknown
    run?: (...params: unknown[]) => unknown
  }) {
    return {
      all: overrides?.all ?? (() => []),
      get: overrides?.get ?? (() => undefined),
      run: overrides?.run ?? (() => undefined)
    }
  }
}

describe('createDebugMockChatSession', () => {
  it('creates a rewritten 100-round session with varied assistant blocks', () => {
    const db = new FakeDebugDb()
    db.deepchatSessions.push({
      id: 'existing-session',
      provider_id: 'sample-provider',
      model_id: 'sample-model',
      permission_mode: 'full_access'
    })
    db.deepchatMessages.push(
      {
        id: 'sample-user',
        session_id: 'existing-session',
        order_seq: 1,
        role: 'user',
        content: JSON.stringify({
          text: 'secret-current-db-text',
          files: [],
          links: [],
          think: false,
          search: false,
          content: [{ type: 'code', language: 'ts', content: 'secret-current-db-text' }]
        }),
        status: 'sent',
        created_at: 10,
        updated_at: 10
      },
      {
        id: 'sample-assistant',
        session_id: 'existing-session',
        order_seq: 2,
        role: 'assistant',
        content: JSON.stringify([
          {
            type: 'tool_call',
            content: 'secret-current-db-text',
            status: 'success',
            timestamp: 10
          },
          { type: 'content', content: 'secret-current-db-text', status: 'success', timestamp: 11 }
        ]),
        status: 'sent',
        created_at: 11,
        updated_at: 11
      }
    )

    const result = createDebugMockChatSession(db)

    expect(result.created).toBe(true)
    expect(result.sessionId).toMatch(/^debug-long-chat-/)
    expect(result.messageCount).toBe(200)
    expect(db.newSessions).toEqual([
      expect.objectContaining({ id: result.sessionId, agent_id: 'deepchat' })
    ])

    const insertedSession = db.deepchatSessions.find((session) => session.id === result.sessionId)
    expect(insertedSession).toMatchObject({
      provider_id: 'sample-provider',
      model_id: 'sample-model'
    })

    const createdMessages = db.deepchatMessages.filter(
      (message) => message.session_id === result.sessionId
    )
    expect(createdMessages).toHaveLength(200)
    expect(createdMessages.filter((message) => message.role === 'user')).toHaveLength(100)
    expect(createdMessages.filter((message) => message.role === 'assistant')).toHaveLength(100)

    const combinedContent = createdMessages.map((message) => message.content).join('\n')
    expect(combinedContent).toContain('mock-long-chat-alpha')
    expect(combinedContent).toContain('windowing-search-target-100')
    expect(combinedContent).not.toContain('secret-current-db-text')

    const blockTypes = new Set(
      createdMessages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => JSON.parse(message.content) as Array<{ type: string }>)
        .map((block) => block.type)
    )
    expect([...blockTypes]).toEqual(
      expect.arrayContaining([
        'content',
        'reasoning_content',
        'search',
        'tool_call',
        'action',
        'image',
        'artifact-thinking',
        'error'
      ])
    )
  })
})
