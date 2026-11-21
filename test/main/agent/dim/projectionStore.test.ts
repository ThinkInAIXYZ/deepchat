import { afterEach, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { dimDatabase } from './fixtures/database'
import { DimProjectionStore } from '@/agent/dim/projectionStore'
import type { DimEvent } from '@/agent/dim/sessionConnection'
import { dimHistoryPlan } from '@/agent/dim/historyImport'

vi.unmock('fs')
vi.unmock('node:fs')

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const db of handles.splice(0)) db.close()
})
function database() {
  const { data, sqlite } = dimDatabase()
  handles.push(sqlite)
  const binding = data.dimSessionBindingsTable.bind('app', 'native')
  return { data, sqlite, binding, projection: new DimProjectionStore(data) }
}
function event(sequence: number, type: string, name: string, data: DimEvent['data']): DimEvent {
  return { id: `event-${sequence}`, sequence, create_at: sequence * 1000, type, name, data }
}

it('projects terminal conversation state without creating a Tape and ignores replayed facts', () => {
  const { data, sqlite, binding, projection } = database()
  projection.apply(
    binding,
    event(1, 'input', 'message', { user: { content: [{ type: 'text', text: 'hello' }] } })
  )
  projection.apply(binding, event(2, 'input', 'applied', { input_id: 'event-1' }))
  projection.apply(binding, event(3, 'turn', 'start', { turn_id: 'turn' }))
  projection.apply(
    binding,
    event(4, 'step', 'text', { turn_id: 'turn', request_id: 'req', delta: 'answer' })
  )
  projection.apply(
    binding,
    event(5, 'turn', 'end', { turn_id: 'turn', status: 'completed', reason: 'end_turn' })
  )
  projection.apply(binding, event(4, 'step', 'text', { turn_id: 'turn', delta: 'answer' }))
  expect(data.dimSessionBindingsTable.get('app')).toMatchObject({
    cursor: '5',
    status: 'idle',
    nextOrderSeq: 3
  })
  const messages = data.deepchatMessagesTable.getBySession('app')
  expect(messages).toHaveLength(2)
  expect(JSON.parse(messages[1].content)).toMatchObject([{ content: 'answer', status: 'success' }])
  expect(JSON.parse(messages[1].metadata).dim).toMatchObject({
    sessionId: 'native',
    eventId: 'event-5',
    sequence: '5'
  })
  expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%tape%'").all()).toEqual(
    []
  )
})

it('rolls back both the message and cursor when projection persistence fails', () => {
  const { data, sqlite, binding, projection } = database()
  projection.apply(binding, event(1, 'turn', 'start', { turn_id: 'turn' }))
  sqlite.exec(
    "CREATE TRIGGER refuse_blocks BEFORE INSERT ON deepchat_assistant_blocks BEGIN SELECT RAISE(ABORT, 'fixture failure'); END"
  )
  const delta = event(2, 'step', 'text', { turn_id: 'turn', request_id: 'req', delta: 'once' })
  expect(() => projection.apply(binding, delta)).toThrow('fixture failure')
  expect(data.dimSessionBindingsTable.get('app')!.cursor).toBe('1')
  expect(data.deepchatMessagesTable.getBySession('app')[0].content).toBe('[]')
  sqlite.exec('DROP TRIGGER refuse_blocks')
  projection.apply(binding, delta)
  expect(JSON.parse(data.deepchatMessagesTable.getBySession('app')[0].content)).toMatchObject([
    { content: 'once' }
  ])
})

it('refuses a late event belonging to a replaced native session before writing content', () => {
  const { data, binding, projection } = database()
  projection.installGeneration(
    binding,
    { ...binding, dimSessionId: 'replacement', generation: 2 },
    []
  )
  expect(() =>
    projection.apply(binding, event(2, 'turn', 'start', { turn_id: 'old-turn' }))
  ).toThrow('Stale dim session binding')
  expect(data.deepchatMessagesTable.getBySession('app')).toEqual([])
  expect(data.dimSessionBindingsTable.get('app')!.cursor).toBe('0')
  expect(data.dimSessionScopesTable.list('app').map((scope) => scope.dimSessionId)).toEqual([
    'native',
    'replacement'
  ])
})

it('commits input acceptance with its projection and retains only an immutable receipt', () => {
  const { data, sqlite, binding, projection } = database()
  const intent = {
    submissionId: 'submission',
    sessionId: 'app',
    dimSessionId: 'native',
    branchId: 'main',
    payload: { content: [{ type: 'text', text: 'hello' }] }
  }
  data.dimInputIntentsTable.begin(intent)
  const message = event(1, 'input', 'message', {
    submission_id: 'submission',
    user: { content: [{ type: 'text', text: 'hello' }] }
  })
  sqlite.exec(
    "CREATE TRIGGER refuse_user BEFORE INSERT ON dim_input_projection BEGIN SELECT RAISE(ABORT, 'fixture failure'); END"
  )
  expect(() => projection.apply(binding, message)).toThrow('fixture failure')
  expect(data.dimInputIntentsTable.get('submission')!.state).toBe('sending')
  expect(data.dimSessionBindingsTable.get('app')!.cursor).toBe('0')
  sqlite.exec('DROP TRIGGER refuse_user')
  projection.apply(binding, message)
  expect(data.dimInputIntentsTable.get('submission')).toMatchObject({
    state: 'accepted',
    payload: {},
    receipt: { inputId: 'event-1', sequence: 1 }
  })
  data.dimInputIntentsTable.settle('submission', 'unknown')
  expect(data.dimInputIntentsTable.get('submission')!.state).toBe('accepted')
  expect(data.dimInputIntentsTable.begin(intent).created).toBe(false)
  expect(() => data.dimInputIntentsTable.begin({ ...intent, payload: { content: [] } })).toThrow(
    'already bound'
  )
})

it('keeps queued input out of the transcript until dim applies it, preserving conversation order', () => {
  const { data, binding, projection } = database()
  projection.apply(
    binding,
    event(1, 'input', 'message', {
      user: { content: [{ type: 'text', text: 'first' }] },
      mode: 'queue'
    })
  )
  projection.apply(binding, event(2, 'input', 'applied', { input_id: 'event-1' }))
  projection.apply(binding, event(3, 'turn', 'start', { turn_id: 'first' }))
  projection.apply(
    binding,
    event(4, 'input', 'message', {
      user: { content: [{ type: 'text', text: 'second' }] },
      mode: 'queue'
    })
  )
  expect(data.deepchatMessagesTable.getBySession('app').map((message) => message.role)).toEqual([
    'user',
    'assistant'
  ])
  projection.apply(
    binding,
    event(5, 'turn', 'end', { turn_id: 'first', status: 'completed', reason: 'end_turn' })
  )
  projection.apply(binding, event(6, 'input', 'applied', { input_id: 'event-4' }))
  projection.apply(binding, event(7, 'turn', 'start', { turn_id: 'second' }))
  expect(data.deepchatMessagesTable.getBySession('app').map((message) => message.role)).toEqual([
    'user',
    'assistant',
    'user',
    'assistant'
  ])
  projection.apply(binding, event(8, 'input', 'consumed', { input_id: 'event-4' }))
  expect(data.dimInputProjectionTable.get('app', 'event-4')).toBeNull()
  const consumed = data.deepchatMessagesTable.getBySession('app')[2]
  expect(JSON.parse(consumed.metadata).dim.turnId).toBe('second')
})

it('projects copied native event IDs into separate fork and branch message identities', () => {
  const { data, binding, projection } = database()
  const fork = data.dimSessionBindingsTable.bind('fork', 'native-fork')
  const branch = data.dimSessionBindingsTable.bind('branch', 'native', 'branch-2')
  for (const scope of [binding, fork, branch]) {
    projection.apply(
      scope,
      event(1, 'input', 'message', {
        user: { content: [{ type: 'text', text: 'shared history' }] }
      })
    )
    projection.apply(scope, event(2, 'input', 'applied', { input_id: 'event-1' }))
  }
  const rows = ['app', 'fork', 'branch'].map((id) => data.deepchatMessagesTable.getBySession(id)[0])
  expect(new Set(rows.map((message) => message.id)).size).toBe(3)
  expect(rows.every((message) => JSON.parse(message.content).text === 'shared history')).toBe(true)
})

it('refuses an imported message ID owned by another session and rolls back the view reset', () => {
  const { data, binding, projection } = database()
  for (const [id, sessionId] of [
    ['target-before', 'app'],
    ['foreign-id', 'other']
  ])
    data.deepchatMessagesTable.insert({
      id,
      sessionId,
      orderSeq: 1,
      role: 'user',
      content: JSON.stringify({ text: id, files: [], links: [], search: false, think: false }),
      status: 'sent'
    })
  const plan = dimHistoryPlan({
    formatVersion: 1,
    productSessionId: 'app',
    summary: null,
    messages: [
      {
        id: 'foreign-id',
        sessionId: 'app',
        orderSeq: 1,
        role: 'user',
        content: JSON.stringify({
          text: 'imported',
          files: [],
          links: [],
          search: false,
          think: false
        }),
        status: 'sent',
        metadata: '{}',
        isContextEdge: 0,
        createdAt: 1,
        updatedAt: 1
      }
    ]
  })
  for (const [index, payload] of plan.chunks.entries())
    projection.apply(
      binding,
      event(index + 1, 'deepchat', 'history-chunk', {
        migrationId: plan.migrationId,
        index,
        payload
      })
    )
  expect(() =>
    projection.apply(
      binding,
      event(plan.chunks.length + 1, 'deepchat', 'history-sealed', {
        migrationId: plan.migrationId,
        productSessionId: 'app',
        digest: plan.digest,
        chunks: plan.chunks.length,
        messages: 1
      })
    )
  ).toThrow('another product session')
  expect(data.deepchatMessagesTable.get('foreign-id')?.session_id).toBe('other')
  expect(data.deepchatMessagesTable.get('target-before')?.session_id).toBe('app')
  expect(data.dimSessionBindingsTable.get('app')?.cursor).toBe(String(plan.chunks.length))
  expect(data.dimInputProjectionTable.get('app', `history:${plan.migrationId}:0`)).not.toBeNull()
})

it('restores desktop tool presentation and image previews from committed native results', () => {
  const { data, binding, projection } = database()
  const response = JSON.stringify({ success: true, imageCount: 1 })
  projection.apply(binding, event(1, 'turn', 'start', { turn_id: 'turn' }))
  projection.apply(
    binding,
    event(2, 'step', 'tool-call', {
      turn_id: 'turn',
      request_id: 'request',
      calls: [{ id: 'image-call', name: 'image_generate', input: {} }]
    })
  )
  projection.apply(
    binding,
    event(3, 'step', 'tool-completed', {
      turn_id: 'turn',
      request_id: 'request',
      call_id: 'image-call',
      result: {
        content: 'native result',
        isError: false,
        structuredContent: {
          deepchatDisplay: {
            response,
            imagePreviews: [
              {
                id: 'generated',
                data: 'imgcache://generated',
                mimeType: 'image/png',
                source: 'tool_output'
              },
              { id: 'invalid', data: 12 }
            ]
          }
        }
      }
    })
  )
  const messages = data.deepchatMessagesTable.getBySession('app')
  const blocks = JSON.parse(messages[0].content)
  expect(blocks[0]).toMatchObject({
    status: 'success',
    tool_call: {
      response,
      imagePreviews: [
        {
          id: 'generated',
          data: 'imgcache://generated',
          mimeType: 'image/png',
          source: 'tool_output'
        }
      ]
    }
  })
})
