import logger from '@shared/logger'
import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  AttachmentPreparationSummary,
  DeepChatSessionState,
  PendingSessionInputRecord
} from '@shared/types/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  PendingInputPump,
  type PendingInputPumpPorts,
  type PendingInputPumpStorePort,
  type PendingInputTurnContext
} from '@/agent/deepchat/runtime/pendingInputPump'
import type {
  ClaimedInputDisposition,
  TurnCompletion
} from '@/agent/deepchat/runtime/pendingInputContracts'

const SESSION_ID = 'session'

function createState(status: DeepChatSessionState['status'] = 'idle'): DeepChatSessionState {
  return {
    status,
    providerId: 'openai',
    modelId: 'gpt-5',
    permissionMode: 'full_access'
  }
}

function createInput(
  id: string,
  mode: PendingSessionInputRecord['mode'],
  queueOrder: number | null = mode === 'queue' ? 1 : null
): PendingSessionInputRecord {
  return {
    id,
    sessionId: SESSION_ID,
    mode,
    state: 'pending',
    payload: { text: id, files: [] },
    messageIds: [],
    assistantMessageId: null,
    blocking: null,
    queueOrder,
    claimedAt: null,
    consumedAt: null,
    createdAt: queueOrder ?? 1,
    updatedAt: 1
  }
}

function createPendingInputStore(initialRecords: PendingSessionInputRecord[]) {
  const records = new Map(initialRecords.map((record) => [record.id, { ...record }]))

  const requireRecord = (sessionId: string, itemId: string): PendingSessionInputRecord => {
    const record = records.get(itemId)
    if (!record) throw new Error(`Pending input not found: ${itemId}`)
    if (record.sessionId !== sessionId) {
      throw new Error(`Pending input ${itemId} does not belong to session ${sessionId}`)
    }
    return record
  }
  const replaceRecord = (
    itemId: string,
    patch: Partial<PendingSessionInputRecord>
  ): PendingSessionInputRecord => {
    const current = records.get(itemId)
    if (!current) throw new Error(`Pending input not found: ${itemId}`)
    const next: PendingSessionInputRecord = { ...current, ...patch, updatedAt: current.updatedAt + 1 }
    records.set(itemId, next)
    return next
  }
  const nextWaiting = (
    sessionId: string,
    mode: PendingSessionInputRecord['mode']
  ): PendingSessionInputRecord | null => {
    const waiting = Array.from(records.values())
      .filter(
        (record) =>
          record.sessionId === sessionId &&
          record.mode === mode &&
          (record.state === 'pending' ||
            record.state === 'blocked' ||
            record.state === 'retry_required')
      )
      .sort((left, right) => {
        if (mode === 'queue') {
          return (left.queueOrder ?? Number.MAX_SAFE_INTEGER) -
            (right.queueOrder ?? Number.MAX_SAFE_INTEGER)
        }
        return left.createdAt - right.createdAt
      })
    return waiting[0]?.state === 'pending' ? waiting[0] : null
  }
  const claim = (
    sessionId: string,
    itemId: string,
    mode: PendingSessionInputRecord['mode']
  ): PendingSessionInputRecord => {
    const record = requireRecord(sessionId, itemId)
    if (record.mode !== mode || record.state !== 'pending') {
      throw new Error(`Pending input ${itemId} is not claimable.`)
    }
    return replaceRecord(itemId, { state: 'claimed', claimedAt: 2 })
  }
  const release = (sessionId: string, itemId: string): PendingSessionInputRecord => {
    const record = requireRecord(sessionId, itemId)
    if (record.state !== 'claimed') throw new Error(`Pending input ${itemId} is not claimed.`)
    return replaceRecord(itemId, { state: 'pending', claimedAt: null, blocking: null })
  }
  const releaseForRetry = (sessionId: string, itemId: string): PendingSessionInputRecord => {
    const record = requireRecord(sessionId, itemId)
    if (record.state !== 'claimed') throw new Error(`Pending input ${itemId} is not claimed.`)
    return replaceRecord(itemId, {
      state: 'retry_required',
      claimedAt: null,
      blocking: null
    })
  }
  const consumeQueue = (sessionId: string, itemId: string): void => {
    const record = requireRecord(sessionId, itemId)
    if (record.mode !== 'queue' || record.state !== 'claimed') {
      throw new Error(`Pending input ${itemId} is not a claimed queue input.`)
    }
    records.delete(itemId)
  }
  const consumeSteer = (sessionId: string, itemId: string): void => {
    const record = requireRecord(sessionId, itemId)
    if (record.mode !== 'steer' || record.state !== 'claimed') {
      throw new Error(`Pending input ${itemId} is not a claimed steer input.`)
    }
    replaceRecord(itemId, { state: 'consumed', consumedAt: 2 })
  }

  const store: PendingInputPumpStorePort = {
    blockClaimedInput: vi.fn(
      (sessionId: string, itemId: string, blocking: AttachmentPreparationSummary) => {
        const record = requireRecord(sessionId, itemId)
        if (record.state !== 'claimed') throw new Error(`Pending input ${itemId} is not claimed.`)
        return replaceRecord(itemId, {
          state: 'blocked',
          claimedAt: null,
          blocking
        })
      }
    ),
    claimQueuedInput: vi.fn((sessionId: string, itemId: string) =>
      claim(sessionId, itemId, 'queue')
    ),
    claimSteerInput: vi.fn((sessionId: string, itemId: string) =>
      claim(sessionId, itemId, 'steer')
    ),
    consumeQueuedInput: vi.fn(consumeQueue),
    consumeSteerInput: vi.fn(consumeSteer),
    getInput: vi.fn((sessionId: string, itemId: string) => {
      const record = records.get(itemId) ?? null
      if (record && record.sessionId !== sessionId) {
        throw new Error(`Pending input ${itemId} does not belong to session ${sessionId}`)
      }
      return record
    }),
    getNextQueuedInput: vi.fn((sessionId: string) => nextWaiting(sessionId, 'queue')),
    getNextSteerInput: vi.fn((sessionId: string) => nextWaiting(sessionId, 'steer')),
    hasBlockingInput: vi.fn((sessionId: string) =>
      Array.from(records.values()).some(
        (record) => record.sessionId === sessionId && record.state === 'blocked'
      )
    ),
    hasClaimedInput: vi.fn((sessionId: string) =>
      Array.from(records.values()).some(
        (record) => record.sessionId === sessionId && record.state === 'claimed'
      )
    ),
    hasPendingTurnInput: vi.fn(
      (sessionId: string) =>
        Boolean(nextWaiting(sessionId, 'steer')) || Boolean(nextWaiting(sessionId, 'queue'))
    ),
    listPendingInputs: vi.fn((sessionId: string) =>
      Array.from(records.values()).filter(
        (record) =>
          record.sessionId === sessionId &&
          record.state !== 'claimed' &&
          record.state !== 'consumed'
      )
    ),
    releaseClaimedInput: vi.fn(release),
    releaseClaimedQueueInput: vi.fn((sessionId: string, itemId: string) => {
      const record = requireRecord(sessionId, itemId)
      if (record.mode !== 'queue') throw new Error(`Pending input ${itemId} is not a queue input.`)
      return release(sessionId, itemId)
    }),
    releaseClaimedQueueInputForRetry: vi.fn((sessionId: string, itemId: string) => {
      const record = requireRecord(sessionId, itemId)
      if (record.mode !== 'queue') throw new Error(`Pending input ${itemId} is not a queue input.`)
      return releaseForRetry(sessionId, itemId)
    })
  }

  return { consumeQueue, records, store, claim }
}

function completion(
  context: PendingInputTurnContext,
  disposition: ClaimedInputDisposition
): TurnCompletion {
  context.claimedInput?.settle(disposition)
  return {
    messageStart: { requestId: 'request', messageId: 'message' },
    claimedInputDisposition: disposition
  }
}

function createHarness(
  inputs: PendingSessionInputRecord[],
  start?: PendingInputPumpPorts['turnStarter']['start']
) {
  const runtime = new DeepChatAgentRuntime()
  const scope = runtime.getOrHydrateScope(toAppSessionId(SESSION_ID))
  scope.instance.setRuntimeState(createState())
  const pendingInputs = createPendingInputStore(inputs)
  const hasPendingInteractions = vi.fn(() => false)
  const messages: ChatMessageRecord[] = []
  const turnStarter: PendingInputPumpPorts['turnStarter'] = {
    start:
      start ??
      vi.fn(async (_sessionId, _content, context) =>
        completion(context, { kind: 'consume' })
      )
  }
  const ports: PendingInputPumpPorts = {
    pendingInputs: pendingInputs.store,
    transcript: { getMessages: vi.fn(() => messages) },
    runLifecycle: {
      getHydratedScope: (sessionId: string) =>
        runtime.getHydratedScope(toAppSessionId(sessionId)),
      reconcilePendingInteractions: hasPendingInteractions
    },
    turnStarter,
    sessionState: {
      get: vi.fn(async (sessionId: string) =>
        runtime.getHydratedScope(toAppSessionId(sessionId))?.state() ?? null
      )
    },
    sessionSettings: { resolveProjectDir: vi.fn(() => '/workspace') }
  }

  return {
    hasPendingInteractions,
    messages,
    pendingInputs,
    ports,
    pump: new PendingInputPump(ports),
    runtime,
    scope,
    turnStarter
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('PendingInputPump', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a restarted Queue head held across automatic wakeups until manual resume', async () => {
    const queue = createInput('queue', 'queue')
    const test = createHarness([queue])
    test.pump.holdRestartedQueueInputs([queue.id])

    await expect(test.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(false)
    await expect(test.pump.drain(SESSION_ID, 'completed')).resolves.toBe(false)
    expect(test.pendingInputs.store.claimQueuedInput).not.toHaveBeenCalled()
    expect(test.pump.hasRestartHeldQueueInputs(SESSION_ID)).toBe(true)
    expect(test.pump.hasOnlyRestartHeldQueueInputs(SESSION_ID)).toBe(true)

    expect(test.pump.releaseRestartHoldForSession(SESSION_ID)).toBe(true)
    expect(test.pump.hasRestartHeldQueueInputs(SESSION_ID)).toBe(false)
    await expect(test.pump.drain(SESSION_ID, 'manual')).resolves.toBe(true)
    expect(test.pendingInputs.store.claimQueuedInput).toHaveBeenCalledWith(SESSION_ID, queue.id)
  })

  it('keeps a restart-held tail behind a retry-required Queue head', async () => {
    const released = {
      ...createInput('released', 'queue', 1),
      state: 'retry_required' as const
    }
    const heldTail = createInput('held-tail', 'queue', 2)
    const test = createHarness([released, heldTail])
    test.pump.holdRestartedQueueInputs([heldTail.id])

    expect(test.pump.hasRestartHeldQueueInputs(SESSION_ID)).toBe(false)
    expect(test.pump.releaseRestartHoldForSession(SESSION_ID)).toBe(false)
    await expect(test.pump.drain(SESSION_ID, 'completed')).resolves.toBe(false)

    test.pendingInputs.records.set(released.id, { ...released, state: 'pending' })
    await expect(test.pump.drain(SESSION_ID, 'manual')).resolves.toBe(true)
    await vi.waitFor(() => expect(test.scope.instance.isPendingQueueDraining()).toBe(false))

    expect(test.turnStarter.start).toHaveBeenCalledOnce()
    expect(test.pendingInputs.records.has(released.id)).toBe(false)
    expect(test.pendingInputs.records.get(heldTail.id)?.state).toBe('pending')
    expect(test.pump.hasRestartHeldQueueInputs(SESSION_ID)).toBe(true)
  })

  it('keeps manual Queue consumption semantics after an attachment-resolution wake', async () => {
    const attachmentPreparation: AttachmentPreparationSummary = {
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'ocr_failed' }],
      suggestedActions: ['retry', 'send_without_image_content']
    }
    const contexts: PendingInputTurnContext[] = []
    const start: PendingInputPumpPorts['turnStarter']['start'] = vi.fn(
      async (_sessionId, _content, context) => {
        contexts.push(context)
        return contexts.length === 1
          ? completion(context, { kind: 'block', attachmentPreparation })
          : completion(context, { kind: 'consume' })
      }
    )
    const queue = createInput('queue', 'queue')
    const test = createHarness([queue], start)
    test.pump.holdRestartedQueueInputs([queue.id])
    expect(test.pump.releaseRestartHoldForSession(SESSION_ID)).toBe(true)

    await expect(test.pump.drain(SESSION_ID, 'manual')).resolves.toBe(true)
    await vi.waitFor(() => expect(test.pendingInputs.records.get(queue.id)?.state).toBe('blocked'))
    expect(contexts[0].consumeClaimBeforeProviderStream).toBe(true)

    const blocked = test.pendingInputs.records.get(queue.id)!
    test.pendingInputs.records.set(queue.id, {
      ...blocked,
      state: 'pending',
      blocking: null
    })
    await expect(test.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))

    expect(contexts[1].consumeClaimBeforeProviderStream).toBe(true)
    await vi.waitFor(() => expect(test.pendingInputs.records.has(queue.id)).toBe(false))
  })

  it('lets an explicit composer Send start without releasing a restarted Queue hold', () => {
    const queue = createInput('queue', 'queue')
    const test = createHarness([queue])
    test.pump.holdRestartedQueueInputs([queue.id])

    expect(test.pump.shouldClaimImmediately(SESSION_ID, 'idle', 'send')).toBe(true)
    expect(test.pump.shouldClaimImmediately(SESSION_ID, 'idle', 'queue')).toBe(false)
    expect(test.pump.hasOnlyRestartHeldQueueInputs(SESSION_ID)).toBe(true)
  })

  it('does not let new input bypass a retry-required Queue head', () => {
    const retryRequired = {
      ...createInput('retry', 'queue'),
      state: 'retry_required' as const
    }
    const test = createHarness([retryRequired])
    const followUpBlock: AssistantMessageBlock = {
      type: 'action',
      action_type: 'question_request',
      status: 'success',
      timestamp: 2,
      content: 'Answer in chat',
      extra: {
        needsUserAction: false,
        questionResolution: 'replied',
        questionFollowUpPending: true
      }
    }
    test.messages.push(
      {
        id: 'user-before-question',
        sessionId: SESSION_ID,
        orderSeq: 1,
        role: 'user',
        content: 'Ask me',
        status: 'sent',
        isContextEdge: 0,
        metadata: '{}',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'question',
        sessionId: SESSION_ID,
        orderSeq: 2,
        role: 'assistant',
        content: JSON.stringify([followUpBlock]),
        status: 'sent',
        isContextEdge: 0,
        metadata: '{}',
        createdAt: 2,
        updatedAt: 2
      }
    )

    expect(test.pump.shouldClaimImmediately(SESSION_ID, 'idle', 'send')).toBe(false)
    expect(test.pump.shouldClaimImmediately(SESSION_ID, 'idle', 'queue')).toBe(false)
  })

  it('claims steer input before an older queued input', async () => {
    const deferred = createDeferred<TurnCompletion>()
    let executionContext: PendingInputTurnContext | undefined
    const start: PendingInputPumpPorts['turnStarter']['start'] = vi.fn(
      async (_sessionId, _content, context) => {
        executionContext = context
        return await deferred.promise
      }
    )
    const harness = createHarness(
      [createInput('queue', 'queue', 1), createInput('steer', 'steer')],
      start
    )

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)

    expect(harness.pendingInputs.store.claimSteerInput).toHaveBeenCalledWith(SESSION_ID, 'steer')
    expect(harness.pendingInputs.store.claimQueuedInput).not.toHaveBeenCalled()
    expect(harness.pendingInputs.records.get('steer')?.state).toBe('claimed')
    expect(harness.pendingInputs.records.get('queue')?.state).toBe('pending')

    harness.hasPendingInteractions.mockReturnValue(true)
    const disposition = { kind: 'consume' } as const
    executionContext?.claimedInput?.settle(disposition)
    deferred.resolve({
      messageStart: { requestId: 'request', messageId: 'message' },
      claimedInputDisposition: disposition
    })
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))
  })

  it('propagates a rejected session-state read and releases the drain lease', async () => {
    const harness = createHarness([createInput('queue', 'queue')])
    const failure = new Error('session state unavailable')
    vi.mocked(harness.ports.sessionState.get).mockRejectedValueOnce(failure)

    await expect(harness.pump.drain(SESSION_ID, 'completed')).rejects.toBe(failure)

    expect(harness.scope.instance.isPendingQueueDraining()).toBe(false)
    expect(harness.pendingInputs.store.claimQueuedInput).not.toHaveBeenCalled()
    expect(harness.turnStarter.start).not.toHaveBeenCalled()
  })

  it('acquires the single-flight lease before the first async state read', async () => {
    const harness = createHarness([createInput('queue', 'queue')])
    const stateRead = createDeferred<DeepChatSessionState | null>()
    vi.mocked(harness.ports.sessionState.get).mockImplementation(
      async () => await stateRead.promise
    )

    const firstDrain = harness.pump.drain(SESSION_ID, 'enqueue')
    const concurrentDrain = harness.pump.drain(SESSION_ID, 'enqueue')

    await expect(concurrentDrain).resolves.toBe(false)
    expect(harness.ports.sessionState.get).toHaveBeenCalledOnce()
    expect(harness.pendingInputs.store.claimQueuedInput).not.toHaveBeenCalled()

    stateRead.resolve(createState())
    await expect(firstDrain).resolves.toBe(true)
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))

    expect(harness.turnStarter.start).toHaveBeenCalledOnce()
    expect(harness.pendingInputs.store.claimQueuedInput).toHaveBeenCalledOnce()
  })

  it('keeps one drain in flight per session', async () => {
    const deferred = createDeferred<TurnCompletion>()
    let executionContext: PendingInputTurnContext | undefined
    const start: PendingInputPumpPorts['turnStarter']['start'] = vi.fn(
      async (_sessionId, _content, context) => {
        executionContext = context
        return await deferred.promise
      }
    )
    const harness = createHarness([createInput('queue', 'queue')], start)

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(false)
    expect(start).toHaveBeenCalledOnce()

    const disposition = { kind: 'consume' } as const
    executionContext?.claimedInput?.settle(disposition)
    deferred.resolve({
      messageStart: { requestId: 'request', messageId: 'message' },
      claimedInputDisposition: disposition
    })
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))
    expect(harness.scope.instance.isPendingQueueDraining()).toBe(false)
  })

  it('does not replay a deferred wake through a retry-required Queue head', async () => {
    const firstTurn = createDeferred<TurnCompletion>()
    let firstContext: PendingInputTurnContext | undefined
    const start: PendingInputPumpPorts['turnStarter']['start'] = vi
      .fn()
      .mockImplementationOnce(async (_sessionId, _content, context) => {
        firstContext = context
        return await firstTurn.promise
      })
      .mockImplementationOnce(async (_sessionId, _content, context) =>
        completion(context, { kind: 'consume' })
      )
    const harness = createHarness([createInput('retry', 'queue')], start)

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    const disposition = { kind: 'release-after-rollback' } as const
    firstContext?.claimedInput?.settle(disposition)
    harness.pump.schedule(SESSION_ID, 'enqueue')
    expect(start).toHaveBeenCalledOnce()

    firstTurn.resolve({
      messageStart: { requestId: null, messageId: null },
      claimedInputDisposition: disposition
    })

    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))
    expect(start).toHaveBeenCalledOnce()
    expect(harness.pendingInputs.records.get('retry')?.state).toBe('retry_required')
  })

  it('does not replay an enqueue accepted while the active turn is still generating', async () => {
    const firstTurn = createDeferred<TurnCompletion>()
    let firstContext: PendingInputTurnContext | undefined
    const start: PendingInputPumpPorts['turnStarter']['start'] = vi.fn(
      async (_sessionId, _content, context) => {
        firstContext = context
        return await firstTurn.promise
      }
    )
    const harness = createHarness([createInput('active', 'queue')], start)

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    const disposition = { kind: 'consume' } as const
    firstContext?.claimedInput?.settle(disposition)
    harness.scope.instance.setRuntimeState(createState('generating'))
    harness.pendingInputs.records.set('queued', createInput('queued', 'queue', 2))

    harness.pump.schedule(SESSION_ID, 'enqueue')
    expect(start).toHaveBeenCalledOnce()

    harness.scope.instance.setRuntimeState(createState('error'))
    firstTurn.resolve({
      messageStart: { requestId: 'request', messageId: 'message' },
      claimedInputDisposition: disposition
    })

    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))
    expect(start).toHaveBeenCalledOnce()
    expect(harness.pendingInputs.records.get('queued')?.state).toBe('pending')
  })

  it('starts a send deferred behind a draining question follow-up', async () => {
    const harness = createHarness([createInput('follow-up', 'queue')])
    const followUpBlock: AssistantMessageBlock = {
      type: 'action',
      action_type: 'question_request',
      status: 'success',
      timestamp: 2,
      content: 'Answer in chat',
      extra: {
        needsUserAction: false,
        questionResolution: 'replied',
        questionFollowUpPending: true
      }
    }
    harness.messages.push(
      {
        id: 'user-before-question',
        sessionId: SESSION_ID,
        orderSeq: 1,
        role: 'user',
        content: 'Ask me',
        status: 'sent',
        isContextEdge: 0,
        metadata: '{}',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'question',
        sessionId: SESSION_ID,
        orderSeq: 2,
        role: 'assistant',
        content: JSON.stringify([followUpBlock]),
        status: 'sent',
        isContextEdge: 0,
        metadata: '{}',
        createdAt: 2,
        updatedAt: 2
      }
    )
    const overlapLease = harness.scope.instance.tryAcquirePendingQueueDrain()
    if (!overlapLease) throw new Error('Expected the overlap drain lease')

    expect(harness.pump.shouldClaimImmediately(SESSION_ID, 'idle', 'send')).toBe(false)
    expect(harness.turnStarter.start).not.toHaveBeenCalled()
    expect(harness.ports.transcript.getMessages).toHaveBeenCalledOnce()

    harness.messages.push({
      id: 'accepted-follow-up',
      sessionId: SESSION_ID,
      orderSeq: 3,
      role: 'user',
      content: 'My answer',
      status: 'sent',
      isContextEdge: 0,
      metadata: '{}',
      createdAt: 3,
      updatedAt: 3
    })
    expect(harness.scope.instance.releasePendingQueueDrain(overlapLease)).toBe(true)

    await expect(harness.pump.drain(SESSION_ID, 'completed')).resolves.toBe(true)
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))

    expect(harness.turnStarter.start).toHaveBeenCalledOnce()
    expect(harness.pendingInputs.records.has('follow-up')).toBe(false)
  })

  it('does not scan the transcript when a queue-origin input cannot drain from status', () => {
    const harness = createHarness([createInput('queue', 'queue')])

    expect(harness.pump.shouldClaimImmediately(SESSION_ID, 'generating', 'queue')).toBe(false)

    expect(harness.ports.transcript.getMessages).not.toHaveBeenCalled()
    expect(harness.hasPendingInteractions).not.toHaveBeenCalled()
  })

  it('releases a durable claim when claim publication throws', async () => {
    const harness = createHarness([createInput('queue', 'queue')])
    vi.mocked(harness.pendingInputs.store.claimQueuedInput).mockImplementationOnce(
      (sessionId, itemId) => {
        harness.pendingInputs.claim(sessionId, itemId, 'queue')
        throw new Error('claim publication failed')
      }
    )
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(false)

    expect(harness.pendingInputs.records.get('queue')?.state).toBe('retry_required')
    expect(harness.pendingInputs.store.releaseClaimedQueueInputForRetry).toHaveBeenCalledWith(
      SESSION_ID,
      'queue'
    )
    expect(harness.scope.instance.isPendingQueueDraining()).toBe(false)
    expect(harness.turnStarter.start).not.toHaveBeenCalled()
  })

  it('releases a claim when publication replaces the originating instance', async () => {
    const harness = createHarness([createInput('queue', 'queue')])
    const staleInstance = harness.scope.instance
    vi.mocked(harness.pendingInputs.store.claimQueuedInput).mockImplementationOnce(
      (sessionId, itemId) => {
        const claimed = harness.pendingInputs.claim(sessionId, itemId, 'queue')
        harness.runtime.evict(toAppSessionId(SESSION_ID))
        const replacement = harness.runtime.getOrHydrateScope(toAppSessionId(SESSION_ID))
        replacement.instance.setRuntimeState(createState())
        return claimed
      }
    )
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(false)

    expect(harness.pendingInputs.records.get('queue')?.state).toBe('retry_required')
    expect(harness.pendingInputs.store.releaseClaimedQueueInputForRetry).toHaveBeenCalledWith(
      SESSION_ID,
      'queue'
    )
    expect(harness.turnStarter.start).not.toHaveBeenCalled()
    expect(staleInstance.isPendingQueueDraining()).toBe(false)
  })

  it('does not clear a newer active steer marker while adopting a claim', async () => {
    const harness = createHarness([createInput('steer', 'steer')])
    harness.scope.instance.setActiveSteerPendingInputId('newer-steer')

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))

    expect(harness.scope.instance.getActiveSteerPendingInputId()).toBe('newer-steer')
  })

  it.each(['queue', 'steer'] as const)('uses the %s consume transition', async (mode) => {
    const harness = createHarness([createInput(mode, mode)])

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))

    if (mode === 'queue') {
      expect(harness.pendingInputs.store.consumeQueuedInput).toHaveBeenCalledWith(SESSION_ID, mode)
      expect(harness.pendingInputs.store.consumeSteerInput).not.toHaveBeenCalled()
    } else {
      expect(harness.pendingInputs.store.consumeSteerInput).toHaveBeenCalledWith(SESSION_ID, mode)
      expect(harness.pendingInputs.store.consumeQueuedInput).not.toHaveBeenCalled()
    }
  })

  it.each(['queue', 'steer'] as const)('uses the %s release transition', async (mode) => {
    const start: PendingInputPumpPorts['turnStarter']['start'] = vi.fn(
      async (_sessionId, _content, context) =>
        completion(context, { kind: 'release-after-rollback' })
    )
    const harness = createHarness([createInput(mode, mode)], start)

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))

    if (mode === 'queue') {
      expect(harness.pendingInputs.store.releaseClaimedQueueInputForRetry).toHaveBeenCalledWith(
        SESSION_ID,
        mode
      )
      expect(harness.pendingInputs.store.releaseClaimedInput).not.toHaveBeenCalled()
    } else {
      expect(harness.pendingInputs.store.releaseClaimedInput).toHaveBeenCalledWith(SESSION_ID, mode)
      expect(harness.pendingInputs.store.releaseClaimedQueueInputForRetry).not.toHaveBeenCalled()
    }
    expect(harness.pendingInputs.records.get(mode)?.state).toBe(
      mode === 'queue' ? 'retry_required' : 'pending'
    )
  })

  it('blocks a claimed head without draining later inputs', async () => {
    const attachmentPreparation: AttachmentPreparationSummary = {
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'ocr_failed' }],
      suggestedActions: ['retry']
    }
    const start: PendingInputPumpPorts['turnStarter']['start'] = vi.fn(
      async (_sessionId, _content, context) =>
        completion(context, { kind: 'block', attachmentPreparation })
    )
    const harness = createHarness(
      [createInput('blocked', 'queue', 1), createInput('later', 'queue', 2)],
      start
    )

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))

    expect(start).toHaveBeenCalledOnce()
    expect(harness.pendingInputs.records.get('blocked')).toMatchObject({
      state: 'blocked',
      blocking: attachmentPreparation
    })
    expect(harness.pendingInputs.records.get('later')?.state).toBe('pending')
  })

  it('leaves a released input at the head for explicit retry', async () => {
    const start: PendingInputPumpPorts['turnStarter']['start'] = vi.fn(
      async (_sessionId, _content, context) =>
        completion(context, { kind: 'release-after-rollback' })
    )
    const harness = createHarness(
      [createInput('retry', 'queue', 1), createInput('later', 'queue', 2)],
      start
    )

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))

    expect(start).toHaveBeenCalledOnce()
    expect(harness.pendingInputs.records.get('retry')?.state).toBe('retry_required')
    expect(harness.pendingInputs.records.get('later')?.state).toBe('pending')
  })

  it('continues with the next input after consuming the current head', async () => {
    const harness = createHarness([
      createInput('first', 'queue', 1),
      createInput('second', 'queue', 2)
    ])

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    await vi.waitFor(() => expect(harness.turnStarter.start).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))

    expect(harness.pendingInputs.records.has('first')).toBe(false)
    expect(harness.pendingInputs.records.has('second')).toBe(false)
    expect(harness.scope.instance.isPendingQueueDraining()).toBe(false)
  })

  it('cleans only the originating instance after replacement', async () => {
    const deferred = createDeferred<TurnCompletion>()
    let executionContext: PendingInputTurnContext | undefined
    const start: PendingInputPumpPorts['turnStarter']['start'] = vi.fn(
      async (_sessionId, _content, context) => {
        executionContext = context
        return await deferred.promise
      }
    )
    const harness = createHarness([createInput('queue', 'queue')], start)

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    const staleInstance = harness.scope.instance
    harness.runtime.evict(toAppSessionId(SESSION_ID))
    const replacement = harness.runtime.getOrHydrateScope(toAppSessionId(SESSION_ID))
    replacement.instance.setRuntimeState(createState())
    const replacementDrainLease = replacement.instance.tryAcquirePendingQueueDrain()
    if (!replacementDrainLease) throw new Error('Expected replacement drain lease')

    const disposition = { kind: 'consume' } as const
    executionContext?.claimedInput?.settle(disposition)
    deferred.resolve({
      messageStart: { requestId: 'request', messageId: 'message' },
      claimedInputDisposition: disposition
    })
    await vi.waitFor(() => expect(staleInstance.isPendingQueueDraining()).toBe(false))

    expect(staleInstance.isPendingQueueDraining()).toBe(false)
    expect(replacement.instance.isPendingQueueDraining()).toBe(true)
    expect(replacement.instance.releasePendingQueueDrain(replacementDrainLease)).toBe(true)
  })

  it('reports inconsistent turn completion without applying a second transition', async () => {
    const start: PendingInputPumpPorts['turnStarter']['start'] = vi.fn(
      async (_sessionId, _content, context) => {
        const settled = { kind: 'consume' } as const
        context.claimedInput?.settle(settled)
        return {
          messageStart: { requestId: 'request', messageId: 'message' },
          claimedInputDisposition: { kind: 'release-after-rollback' }
        }
      }
    )
    const harness = createHarness([createInput('queue', 'queue')], start)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))

    expect(harness.pendingInputs.records.has('queue')).toBe(false)
    expect(harness.pendingInputs.store.releaseClaimedQueueInput).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('stage=claim-consistency'),
      { name: 'Error' }
    )
    expect(error).not.toHaveBeenCalledWith(
      expect.stringContaining('stage=process-message'),
      expect.anything()
    )
  })

  it('keeps a claim fenced when the turn fails without a disposition', async () => {
    const start: PendingInputPumpPorts['turnStarter']['start'] = vi.fn(async () => {
      throw new Error('turn failed before reporting settlement')
    })
    const harness = createHarness(
      [createInput('failed', 'queue', 1), createInput('later', 'queue', 2)],
      start
    )
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))

    expect(harness.pendingInputs.records.get('failed')?.state).toBe('claimed')
    expect(harness.pendingInputs.records.get('later')?.state).toBe('pending')
    expect(harness.pendingInputs.store.releaseClaimedQueueInput).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledOnce()
    expect(harness.scope.instance.isPendingQueueDraining()).toBe(false)
  })

  it('does not repeat a durable consume when publication throws afterward', async () => {
    const harness = createHarness([createInput('queue', 'queue')])
    vi.mocked(harness.pendingInputs.store.consumeQueuedInput).mockImplementationOnce(
      (sessionId, itemId) => {
        harness.pendingInputs.consumeQueue(sessionId, itemId)
        throw new Error('consume publication failed')
      }
    )
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    await expect(harness.pump.drain(SESSION_ID, 'enqueue')).resolves.toBe(true)
    await vi.waitFor(() => expect(harness.scope.instance.isPendingQueueDraining()).toBe(false))

    expect(harness.pendingInputs.records.has('queue')).toBe(false)
    expect(harness.pendingInputs.store.consumeQueuedInput).toHaveBeenCalledOnce()
    expect(harness.pendingInputs.store.releaseClaimedQueueInput).not.toHaveBeenCalled()
  })

  it('preserves the primary settlement error when durable verification also fails', () => {
    const harness = createHarness([createInput('queue', 'queue')])
    const claim = harness.pump.claimQueuedInputForPreparation(SESSION_ID, 'queue')
    const primaryError = new Error('publication failed')
    const verificationError = new Error('verification failed')
    const getInput = vi.mocked(harness.pendingInputs.store.getInput).getMockImplementation()
    const blockInput = vi
      .mocked(harness.pendingInputs.store.blockClaimedInput)
      .getMockImplementation()
    if (!getInput || !blockInput) {
      throw new Error('Pending input test store is missing an implementation')
    }
    vi.mocked(harness.pendingInputs.store.getInput)
      .mockImplementationOnce(getInput)
      .mockImplementationOnce(() => {
        throw verificationError
      })
    vi.mocked(harness.pendingInputs.store.blockClaimedInput).mockImplementationOnce(
      (sessionId, itemId, attachmentPreparation) => {
        blockInput(sessionId, itemId, attachmentPreparation)
        throw primaryError
      }
    )
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    expect(() =>
      claim.settle({
        kind: 'block',
        attachmentPreparation: {
          status: 'needs_user_action',
          issues: [],
          suggestedActions: ['retry']
        }
      })
    ).toThrow(primaryError)

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to verify pending input settlement'),
      { name: 'Error' }
    )
    expect(claim.disposition).toEqual({
      kind: 'block',
      attachmentPreparation: {
        status: 'needs_user_action',
        issues: [],
        suggestedActions: ['retry']
      }
    })
  })
})
