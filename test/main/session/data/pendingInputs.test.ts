import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionPendingInputs } from '@/session/data/pendingInputs'
import type { PendingSessionInputRecord } from '@shared/types/agent-interface'

function createRecord(
  id: string,
  sessionId: string,
  mode: PendingSessionInputRecord['mode']
): PendingSessionInputRecord {
  return {
    id,
    sessionId,
    mode,
    state: 'claimed',
    payload: {
      text: id,
      files: []
    },
    messageIds: [],
    assistantMessageId: null,
    blocking: null,
    queueOrder: mode === 'queue' ? 1 : null,
    claimedAt: 1,
    consumedAt: null,
    createdAt: 1,
    updatedAt: 1
  }
}

function createCoordinator(records: Map<string, PendingSessionInputRecord>) {
  const store = {
    runInTransaction: vi.fn((operation: () => unknown) => operation()),
    getInput: vi.fn((itemId: string) => records.get(itemId) ?? null),
    releaseClaimedQueueInput: vi.fn((itemId: string) => records.get(itemId)!),
    releaseClaimedQueueInputForRetry: vi.fn((itemId: string) => records.get(itemId)!),
    retryReleasedQueueInput: vi.fn((itemId: string) => records.get(itemId)!),
    releaseClaimedInput: vi.fn((itemId: string) => records.get(itemId)!),
    consumeQueueInput: vi.fn((itemId: string) => {
      records.delete(itemId)
    }),
    consumeSteerInput: vi.fn((itemId: string) => {
      const record = records.get(itemId)
      if (record) {
        records.set(itemId, {
          ...record,
          state: 'consumed',
          consumedAt: 2
        })
      }
    })
  }

  return {
    coordinator: new SessionPendingInputs(store as any, {} as any, {
      publishPendingInputsChanged: vi.fn(),
      publishMessagesChanged: vi.fn()
    }),
    store
  }
}

describe('SessionPendingInputs claimed input ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not release a claimed queue input from another session', () => {
    const records = new Map<string, PendingSessionInputRecord>([
      ['queue-1', createRecord('queue-1', 'session-2', 'queue')]
    ])
    const { coordinator, store } = createCoordinator(records)

    expect(() => coordinator.releaseClaimedQueueInput('session-1', 'queue-1')).toThrow(
      'does not belong to session session-1'
    )
    expect(store.releaseClaimedQueueInput).not.toHaveBeenCalled()
  })

  it('does not consume a claimed steer input from another session', () => {
    const records = new Map<string, PendingSessionInputRecord>([
      ['steer-1', createRecord('steer-1', 'session-2', 'steer')]
    ])
    const { coordinator, store } = createCoordinator(records)

    expect(() => coordinator.consumeSteerInput('session-1', 'steer-1')).toThrow(
      'does not belong to session session-1'
    )
    expect(store.consumeSteerInput).not.toHaveBeenCalled()
  })

  it('does not retry a released queue input from another session', () => {
    const released = {
      ...createRecord('queue-1', 'session-2', 'queue'),
      state: 'retry_required' as const,
      claimedAt: null
    }
    const records = new Map<string, PendingSessionInputRecord>([['queue-1', released]])
    const { coordinator, store } = createCoordinator(records)

    expect(() => coordinator.retryReleasedQueueInput('session-1', 'queue-1')).toThrow(
      'does not belong to session session-1'
    )
    expect(store.retryReleasedQueueInput).not.toHaveBeenCalled()
  })
})

describe('SessionPendingInputs pending steer recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createPending(
    id: string,
    sessionId: string,
    mode: 'queue' | 'steer'
  ): PendingSessionInputRecord {
    return {
      id,
      sessionId,
      mode,
      state: 'pending',
      payload: { text: id, files: [] },
      messageIds: [],
      assistantMessageId: null,
      blocking: null,
      queueOrder: mode === 'queue' ? 1 : null,
      claimedAt: null,
      consumedAt: null,
      createdAt: 1,
      updatedAt: 1
    }
  }

  it('rejects deleting an accepted Steer message', () => {
    const steer = createPending('steer-1', 'session-1', 'steer')
    const store = {
      runInTransaction: vi.fn((operation: () => unknown) => operation()),
      listPendingInputs: vi.fn(() => [steer]),
      deleteInput: vi.fn()
    }
    const coordinator = new SessionPendingInputs(store as any, {} as any, {
      publishPendingInputsChanged: vi.fn(),
      publishMessagesChanged: vi.fn()
    })

    expect(() => coordinator.deletePendingInput('session-1', 'steer-1')).toThrow(
      'Steer messages are sent conversation facts and cannot be deleted.'
    )
    expect(store.deleteInput).not.toHaveBeenCalled()
  })

  it('rejects deleting a pending input that does not exist', () => {
    const store = {
      runInTransaction: vi.fn((operation: () => unknown) => operation()),
      listPendingInputs: vi.fn(() => []),
      deleteInput: vi.fn()
    }
    const coordinator = new SessionPendingInputs(store as any, {} as any, {
      publishPendingInputsChanged: vi.fn(),
      publishMessagesChanged: vi.fn()
    })

    expect(() => coordinator.deletePendingInput('session-1', 'missing')).toThrow(
      'Pending input not found'
    )
    expect(store.deleteInput).not.toHaveBeenCalled()
  })
})

function createRecoveryCoordinator(initialRecords: PendingSessionInputRecord[]) {
  const records = new Map(initialRecords.map((record) => [record.id, { ...record }]))
  let createdMessage = 0
  const replace = (itemId: string, patch: Partial<PendingSessionInputRecord>) => {
    const current = records.get(itemId)
    if (!current) throw new Error(`Missing input ${itemId}`)
    const next = { ...current, ...patch }
    records.set(itemId, next)
    return next
  }
  const store = {
    runInTransaction: vi.fn((operation: () => unknown) => operation()),
    listActiveInputs: vi.fn(() =>
      Array.from(records.values()).filter((record) => record.state !== 'consumed')
    ),
    consumeQueueInput: vi.fn((itemId: string) => records.delete(itemId)),
    consumeSteerInput: vi.fn((itemId: string) =>
      replace(itemId, { state: 'consumed', consumedAt: 2 })
    ),
    releaseClaimedQueueInput: vi.fn((itemId: string) =>
      replace(itemId, { state: 'pending', claimedAt: null, messageIds: [] })
    ),
    releaseClaimedQueueInputForRetry: vi.fn((itemId: string) =>
      replace(itemId, { state: 'retry_required', claimedAt: null, messageIds: [] })
    ),
    retryReleasedQueueInput: vi.fn((itemId: string) => replace(itemId, { state: 'pending' })),
    releaseClaimedInput: vi.fn((itemId: string) =>
      replace(itemId, { state: 'pending', claimedAt: null })
    ),
    convertSteerInputToQueue: vi.fn((itemId: string) =>
      replace(itemId, { mode: 'queue', queueOrder: 1 })
    ),
    linkSteerMessage: vi.fn((itemId: string, messageId: string) =>
      replace(itemId, { messageIds: [messageId] })
    )
  }
  const transcript = {
    settleSteerMessages: vi.fn(() => []),
    failPendingSteerMessages: vi.fn(() => []),
    getMessage: vi.fn((messageId: string) =>
      messageId === 'user-1'
        ? {
            id: messageId,
            sessionId: 'session-1',
            role: 'user'
          }
        : null
    ),
    getNextOrderSeq: vi.fn(() => 1),
    createUserMessage: vi.fn(() => `recovered-${++createdMessage}`)
  }
  const coordinator = new SessionPendingInputs(store as any, transcript as any, {
    publishPendingInputsChanged: vi.fn(),
    publishMessagesChanged: vi.fn()
  })
  return { coordinator, records, store, transcript }
}

describe('SessionPendingInputs restart reconciliation', () => {
  it('preserves retry-required Queue inputs without adding a restart hold', () => {
    const released = {
      ...createRecord('queue-retry', 'session-1', 'queue'),
      state: 'retry_required' as const,
      claimedAt: null
    }
    const { coordinator, records, store } = createRecoveryCoordinator([released])

    const recovery = coordinator.recoverInputsAfterRestart()

    expect(recovery.heldQueueInputIds).toEqual(new Set())
    expect(recovery.affectedSessionIds).toEqual(new Set(['session-1']))
    expect(records.get(released.id)?.state).toBe('retry_required')
    expect(store.releaseClaimedQueueInput).not.toHaveBeenCalled()
  })

  it('holds retained Queue drafts and consumes only a Queue with a materialized user fact', () => {
    const pending = {
      ...createRecord('queue-pending', 'session-1', 'queue'),
      state: 'pending' as const
    }
    const claimed = createRecord('queue-claimed', 'session-1', 'queue')
    const materialized = {
      ...createRecord('queue-materialized', 'session-1', 'queue'),
      messageIds: ['user-1']
    }
    const dangling = {
      ...createRecord('queue-dangling', 'session-1', 'queue'),
      messageIds: ['missing-user']
    }
    const { coordinator, records, store } = createRecoveryCoordinator([
      pending,
      claimed,
      materialized,
      dangling
    ])

    const recovery = coordinator.recoverInputsAfterRestart()

    expect(recovery.heldQueueInputIds).toEqual(
      new Set(['queue-pending', 'queue-claimed', 'queue-dangling'])
    )
    expect(recovery.affectedSessionIds).toEqual(new Set(['session-1']))
    expect(records.get('queue-claimed')?.state).toBe('pending')
    expect(records.get('queue-dangling')).toMatchObject({ state: 'pending', messageIds: [] })
    expect(records.has('queue-materialized')).toBe(false)
    expect(store.consumeQueueInput).toHaveBeenCalledWith('queue-materialized')
  })

  it('terminalizes unread Steer messages while preserving a claimed Steer user fact', () => {
    const pending = {
      ...createRecord('steer-pending', 'session-1', 'steer'),
      state: 'pending' as const,
      messageIds: ['user-1', 'user-2']
    }
    const missingMessage = {
      ...createRecord('steer-missing', 'session-1', 'steer'),
      state: 'pending' as const
    }
    const claimed = {
      ...createRecord('steer-claimed', 'session-1', 'steer'),
      messageIds: ['user-read'],
      assistantMessageId: 'assistant-1'
    }
    const { coordinator, records, store, transcript } = createRecoveryCoordinator([
      pending,
      missingMessage,
      claimed
    ])

    coordinator.recoverInputsAfterRestart()

    expect(transcript.failPendingSteerMessages).toHaveBeenNthCalledWith(1, ['user-1', 'user-2'])
    expect(transcript.failPendingSteerMessages).toHaveBeenNthCalledWith(2, ['recovered-1'])
    expect(transcript.settleSteerMessages).toHaveBeenCalledWith(['user-read'])
    expect(store.linkSteerMessage).toHaveBeenCalledWith('steer-missing', 'recovered-1')
    expect(records.get('steer-pending')?.state).toBe('consumed')
    expect(records.get('steer-missing')?.state).toBe('consumed')
    expect(records.get('steer-claimed')?.state).toBe('consumed')

    const repeated = coordinator.recoverInputsAfterRestart()
    expect(repeated.affectedSessionIds.size).toBe(0)
  })
})
