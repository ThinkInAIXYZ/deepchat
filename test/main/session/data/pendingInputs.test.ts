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
    getInput: vi.fn((itemId: string) => records.get(itemId) ?? null),
    releaseClaimedQueueInput: vi.fn((itemId: string) => records.get(itemId)!),
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
