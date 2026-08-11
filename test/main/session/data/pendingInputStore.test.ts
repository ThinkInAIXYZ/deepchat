import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nanoid } from 'nanoid'
import { SessionPendingInputStore } from '@/session/data/pendingInputStore'
import type { DeepChatPendingInputRow } from '@/session/data/tables/deepchatPendingInputs'

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
    message_ids_json: '[]',
    assistant_message_id: null,
    blocking_json: null,
    retry_required_at: null,
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
        message_ids_json: row.messageIdsJson ?? '[]',
        assistant_message_id: row.assistantMessageId ?? null,
        blocking_json: row.blockingJson ?? null,
        retry_required_at: row.retryRequiredAt ?? null,
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
    update: vi.fn((id: string, fields: Partial<DeepChatPendingInputRow>) => {
      const row = rows.get(id)
      if (!row) return
      rows.set(id, { ...row, ...fields, updated_at: Date.now() })
    }),
    delete: vi.fn((id: string) => {
      rows.delete(id)
    }),
    deleteBySession: vi.fn((sessionId: string) => {
      for (const [id, row] of rows) {
        if (row.session_id === sessionId) rows.delete(id)
      }
    }),
    listActive: vi.fn(() => Array.from(rows.values()).filter((row) => row.state !== 'consumed'))
  }

  const sqlitePresenter = {
    deepchatPendingInputsTable
  } as any

  return {
    store: new SessionPendingInputStore(sqlitePresenter),
    deepchatPendingInputsTable
  }
}

describe('SessionPendingInputStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('assigns the next queue order after claimed queue rows for pending inserts', () => {
    vi.mocked(nanoid).mockReturnValue('queued-next')
    const { store, deepchatPendingInputsTable } = createStore([
      createQueueRow('claimed-1', 'session-1', 1, 'claimed')
    ])

    const record = store.createQueueInput('session-1', { text: 'hello', files: [] })

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

    const record = store.createQueueInputWithState(
      'session-1',
      { text: 'hello', files: [] },
      'claimed'
    )

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

  it('persists the supplied canonical payload without rewriting it', () => {
    vi.mocked(nanoid).mockReturnValue('canonical-input')
    const { store, deepchatPendingInputsTable } = createStore([])
    const input = {
      text: 'hello',
      files: [],
      activeSkills: ['review']
    }

    store.createQueueInput('session-1', input)

    expect(deepchatPendingInputsTable.insert).toHaveBeenCalledWith(
      expect.objectContaining({ payloadJson: JSON.stringify(input) })
    )
  })

  it('decodes the original text-and-files payload format', () => {
    const row = createQueueRow('legacy-1', 'session-1', 1, 'pending')
    row.payload_json = JSON.stringify({ text: 'legacy', files: [] })
    const { store } = createStore([row])

    expect(store.getInput('legacy-1')?.payload).toEqual({
      text: 'legacy',
      files: [],
      search: false
    })
  })

  it.each(['claimed', 'consumed'] as const)('rejects updates to %s queue inputs', (state) => {
    const row = createQueueRow(`${state}-1`, 'session-1', 1, state)
    const { store, deepchatPendingInputsTable } = createStore([row])

    expect(() => store.updateQueueInput(row.id, { text: 'replacement', files: [] })).toThrow(
      `Pending queue item ${row.id} is not editable.`
    )
    expect(deepchatPendingInputsTable.update).not.toHaveBeenCalled()
    expect(store.getInput(row.id)?.payload.text).toBe(row.id)
  })

  it('keeps a released Queue head durable and excludes later rows from dispatch', () => {
    const { store, deepchatPendingInputsTable } = createStore([
      createQueueRow('released-1', 'session-1', 1, 'claimed'),
      createQueueRow('pending-2', 'session-1', 2, 'pending')
    ])

    const released = store.releaseClaimedQueueInputForRetry('released-1')

    expect(released).toMatchObject({ state: 'retry_required', claimedAt: null })
    expect(store.listPendingInputs('session-1').map((item) => item.id)).toEqual([
      'released-1',
      'pending-2'
    ])
    expect(store.getNextPendingQueueInput('session-1')).toBeNull()
    expect(store.countActive('session-1')).toBe(2)
    expect(deepchatPendingInputsTable.get('released-1')).toMatchObject({
      state: 'blocked',
      retry_required_at: expect.any(Number)
    })
  })

  it('accepts only one retry transition and preserves edit-as-retry compatibility', () => {
    const released = createQueueRow('released-1', 'session-1', 1, 'retry_required')
    const { store } = createStore([released])

    expect(store.retryReleasedQueueInput(released.id).state).toBe('pending')
    expect(() => store.retryReleasedQueueInput(released.id)).toThrow(
      `Pending queue item ${released.id} does not require retry.`
    )

    const rereleased = createQueueRow('released-2', 'session-1', 2, 'retry_required')
    const secondStore = createStore([rereleased]).store
    expect(
      secondStore.updateQueueInput(rereleased.id, { text: 'edited retry', files: [] })
    ).toMatchObject({ state: 'pending', payload: { text: 'edited retry' } })
  })

  it('retries a released Queue item behind an earlier Queue row without bypassing FIFO', () => {
    const { store } = createStore([
      createQueueRow('pending-1', 'session-1', 1, 'pending'),
      createQueueRow('released-2', 'session-1', 2, 'retry_required')
    ])

    expect(store.retryReleasedQueueInput('released-2').state).toBe('pending')
    expect(store.getNextPendingQueueInput('session-1')?.id).toBe('pending-1')
  })

  it.each([
    [
      'move',
      (store: SessionPendingInputStore) => store.moveQueueInput('session-1', 'pending-3', 0)
    ],
    ['delete', (store: SessionPendingInputStore) => store.deleteInput('pending-2')],
    [
      'Queue-to-Steer conversion',
      (store: SessionPendingInputStore) => store.convertQueueInputToSteer('pending-2')
    ]
  ])('preserves a claimed Queue slot across %s resequencing', (_operation, mutate) => {
    const { store } = createStore([
      createQueueRow('claimed-1', 'session-1', 1, 'claimed'),
      createQueueRow('pending-2', 'session-1', 2, 'pending'),
      createQueueRow('pending-3', 'session-1', 3, 'pending')
    ])

    mutate(store)
    store.releaseClaimedQueueInputForRetry('claimed-1')

    const queue = store.listPendingInputs('session-1').filter((item) => item.mode === 'queue')
    expect(queue[0]).toMatchObject({ id: 'claimed-1', state: 'retry_required', queueOrder: 1 })
    expect(new Set(queue.map((item) => item.queueOrder)).size).toBe(queue.length)
    expect(store.getNextPendingQueueInput('session-1')).toBeNull()
  })

  it('prevents reordering around a retry-required Queue head', () => {
    const { store } = createStore([
      createQueueRow('released-1', 'session-1', 1, 'retry_required'),
      createQueueRow('pending-2', 'session-1', 2, 'pending')
    ])

    expect(() => store.moveQueueInput('session-1', 'pending-2', 0)).toThrow(
      'Retry or edit the released queue input before reordering the queue.'
    )
    expect(() => store.convertQueueInputToSteer('released-1')).toThrow(
      'Pending queue item released-1 is not steerable.'
    )
  })

  it('rejects queue updates for steer items', () => {
    const row = createQueueRow('steer-1', 'session-1', 0, 'pending')
    row.mode = 'steer'
    row.queue_order = null
    const { store, deepchatPendingInputsTable } = createStore([row])

    expect(() => store.updateQueueInput(row.id, { text: 'replacement', files: [] })).toThrow(
      `Pending input ${row.id} is not a queue item.`
    )
    expect(deepchatPendingInputsTable.update).not.toHaveBeenCalled()
  })

  it('keeps queue ordering unique when moving pending rows around a blocked head', () => {
    const { store } = createStore([
      createQueueRow('blocked-1', 'session-1', 1, 'claimed'),
      createQueueRow('pending-2', 'session-1', 2, 'pending'),
      createQueueRow('pending-3', 'session-1', 3, 'pending')
    ])
    store.blockClaimedInput('blocked-1', {
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
      suggestedActions: ['send_without_image_content']
    })

    store.moveQueueInput('session-1', 'pending-3', 1)

    expect(
      ['blocked-1', 'pending-3', 'pending-2'].map((id) => store.getInput(id)?.queueOrder)
    ).toEqual([1, 2, 3])
    expect(store.getNextPendingQueueInput('session-1')).toBeNull()
  })

  it.each([
    [undefined, 'send_without_image_content'],
    ['auto' as const, 'auto']
  ])(
    'preserves steer fallback policy with an appended %s override',
    (nextPolicy, expectedPolicy) => {
      const row = createQueueRow('steer-1', 'session-1', 0, 'pending')
      row.mode = 'steer'
      row.queue_order = null
      row.payload_json = JSON.stringify({
        text: 'first',
        files: [],
        attachmentFallbackPolicy: 'send_without_image_content'
      })
      const { store, deepchatPendingInputsTable } = createStore([row])

      store.appendSteerInput(
        'steer-1',
        {
          text: 'second',
          files: [],
          ...(nextPolicy ? { attachmentFallbackPolicy: nextPolicy } : {})
        },
        'steer-message-2'
      )

      const update = deepchatPendingInputsTable.update.mock.calls[0][1]
      expect(JSON.parse(update.payload_json)).toMatchObject({
        text: 'first\n\nsecond',
        attachmentFallbackPolicy: expectedPolicy
      })
    }
  )

  it.each([
    [false, true, true],
    [true, false, true],
    [false, false, false]
  ])(
    'merges steer search intent with OR (%s + %s -> %s)',
    (existingSearch, nextSearch, expectedSearch) => {
      const row = createQueueRow('steer-1', 'session-1', 0, 'pending')
      row.mode = 'steer'
      row.queue_order = null
      row.payload_json = JSON.stringify({ text: 'first', files: [], search: existingSearch })
      const { store, deepchatPendingInputsTable } = createStore([row])

      store.appendSteerInput(
        'steer-1',
        { text: 'second', files: [], search: nextSearch },
        'steer-message-2'
      )

      const update = deepchatPendingInputsTable.update.mock.calls[0][1]
      expect(JSON.parse(update.payload_json)).toMatchObject({ search: expectedSearch })
    }
  )

  it.each([
    ['invalid JSON', 'not-json', 'JSON'],
    ['JSON string', JSON.stringify('legacy text'), 'shape'],
    ['invalid object', JSON.stringify({ files: [] }), 'shape']
  ])('degrades %s to raw text without blocking the queue', (_label, payloadJson, errorKind) => {
    const row = createQueueRow('corrupt-1', 'session-1', 1, 'pending')
    row.payload_json = payloadJson
    const { store } = createStore([row])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(store.getInput('corrupt-1')?.payload).toEqual({ text: payloadJson, files: [] })
      expect(consoleError).toHaveBeenCalledWith(
        `[DeepChatPendingInputStore] Invalid pending input payload ${errorKind}: corrupt-1`,
        expect.anything()
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})
