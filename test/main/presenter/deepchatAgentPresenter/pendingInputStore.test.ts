import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nanoid } from 'nanoid'
import { DeepChatPendingInputStore } from '@/presenter/deepchatAgentPresenter/pendingInputStore'
import type { DeepChatPendingInputRow } from '@/presenter/sqlitePresenter/tables/deepchatPendingInputs'

vi.mock('nanoid', () => ({
  nanoid: vi.fn()
}))

function createQueueRow(
  id: string,
  sessionId: string,
  queueOrder: number,
  state: DeepChatPendingInputRow['state']
): DeepChatPendingInputRow {
  const now = Date.now()

  return {
    id,
    session_id: sessionId,
    mode: 'queue',
    state,
    payload_json: JSON.stringify({ text: id, files: [] }),
    queue_order: queueOrder,
    claimed_at: state === 'claimed' ? now : null,
    consumed_at: state === 'consumed' ? now : null,
    created_at: now,
    updated_at: now
  }
}

function createStore(initialRows: DeepChatPendingInputRow[]) {
  const rows = new Map(initialRows.map((row) => [row.id, { ...row }]))

  const deepchatPendingInputsTable = {
    insert: vi.fn((row: any) => {
      const now = Date.now()
      rows.set(row.id, {
        id: row.id,
        session_id: row.sessionId,
        mode: row.mode,
        state: row.state ?? 'pending',
        payload_json: row.payloadJson,
        queue_order: row.queueOrder ?? null,
        claimed_at: row.claimedAt ?? null,
        consumed_at: row.consumedAt ?? null,
        created_at: row.createdAt ?? now,
        updated_at: row.updatedAt ?? row.createdAt ?? now
      })
    }),
    get: vi.fn((id: string) => rows.get(id)),
    listBySession: vi.fn((sessionId: string) =>
      Array.from(rows.values()).filter((row) => row.session_id === sessionId)
    ),
    listActiveBySession: vi.fn((sessionId: string) =>
      Array.from(rows.values()).filter(
        (row) => row.session_id === sessionId && row.state !== 'consumed'
      )
    ),
    countActiveBySession: vi.fn(
      (sessionId: string) =>
        Array.from(rows.values()).filter(
          (row) =>
            row.session_id === sessionId &&
            row.state !== 'consumed' &&
            !(row.mode === 'queue' && row.state === 'claimed')
        ).length
    ),
    update: vi.fn(),
    delete: vi.fn(),
    deleteBySession: vi.fn(),
    listClaimed: vi.fn(() => Array.from(rows.values()).filter((row) => row.state === 'claimed'))
  }

  const sqlitePresenter = {
    deepchatPendingInputsTable
  } as any

  return {
    store: new DeepChatPendingInputStore(sqlitePresenter),
    deepchatPendingInputsTable
  }
}

describe('DeepChatPendingInputStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('assigns the next queue order after claimed queue rows for pending inserts', () => {
    vi.mocked(nanoid).mockReturnValue('queued-next')
    const { store, deepchatPendingInputsTable } = createStore([
      createQueueRow('claimed-1', 'session-1', 1, 'claimed')
    ])

    const record = store.createQueueInput('session-1', 'hello')

    expect(record.queueOrder).toBe(2)
    expect(deepchatPendingInputsTable.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'queued-next',
        sessionId: 'session-1',
        state: 'pending',
        queueOrder: 2
      })
    )
  })

  it('assigns the next queue order after all queue rows for claimed inserts', () => {
    vi.mocked(nanoid).mockReturnValue('claimed-next')
    const { store, deepchatPendingInputsTable } = createStore([
      createQueueRow('pending-1', 'session-1', 1, 'pending'),
      createQueueRow('claimed-2', 'session-1', 2, 'claimed')
    ])

    const record = store.createQueueInputWithState('session-1', 'hello', 'claimed')

    expect(record.queueOrder).toBe(3)
    expect(deepchatPendingInputsTable.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'claimed-next',
        sessionId: 'session-1',
        state: 'claimed',
        queueOrder: 3
      })
    )
  })
})
