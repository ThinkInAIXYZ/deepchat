import type {
  ChatMessageRecord,
  DeepChatSessionState,
  PendingSessionInputRecord,
  SendMessageInput
} from '@shared/types/agent-interface'
import logger from '@shared/logger'
import { describe, expect, it, vi } from 'vitest'
import {
  PendingInputAdmissionCoordinator,
  type PendingInputAdmissionCoordinatorPorts,
  type PendingInputAdmissionPumpPort,
  type PendingInputAdmissionStorePort
} from '@/agent/deepchat/runtime/pendingInputAdmissionCoordinator'
import type {
  ClaimedInputDisposition,
  ClaimedPendingInputHandle
} from '@/agent/deepchat/runtime/pendingInputContracts'

const SESSION_ID = 'session'

function createInput(
  id = 'input',
  mode: PendingSessionInputRecord['mode'] = 'queue'
): PendingSessionInputRecord {
  return {
    id,
    sessionId: SESSION_ID,
    mode,
    state: 'pending',
    payload: { text: 'Promote me', files: [] },
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

function createScopeRegistry(
  instance: unknown
): PendingInputAdmissionCoordinatorPorts['registry'] {
  return {
    getOrHydrateScope: vi.fn(),
    getHydratedScope: vi.fn((sessionId: string) => ({ sessionId, instance })),
    scopeFor: vi.fn()
  } as unknown as PendingInputAdmissionCoordinatorPorts['registry']
}

function createHarness(onDrain?: (harness: HarnessState) => void) {
  const state: DeepChatSessionState = {
    status: 'idle',
    providerId: 'openai',
    modelId: 'gpt-5',
    permissionMode: 'full_access'
  }
  const harness: HarnessState = {
    activeSteerInputId: undefined,
    draining: false,
    input: createInput(),
    preStreamController: undefined
  }
  const replaceInput = (
    patch: Partial<PendingSessionInputRecord>
  ): PendingSessionInputRecord => {
    if (!harness.input) throw new Error('Pending input not found')
    harness.input = {
      ...harness.input,
      ...patch,
      updatedAt: harness.input.updatedAt + 1
    }
    return harness.input
  }
  const createUserMessage = (id: string, content: SendMessageInput): ChatMessageRecord => ({
    id,
    sessionId: SESSION_ID,
    orderSeq: 2,
    role: 'user',
    content: JSON.stringify(content),
    status: 'pending',
    isContextEdge: 0,
    metadata: JSON.stringify({
      inputReceipt: {
        mode: 'steer',
        readAt: null
      }
    }),
    createdAt: 1,
    updatedAt: 1
  })

  let disposition: ClaimedInputDisposition | null = null
  const claim: ClaimedPendingInputHandle = {
    id: 'input',
    source: 'queue',
    messageIds: [],
    assistantMessageId: null,
    get disposition() {
      return disposition
    },
    settle(nextDisposition) {
      if (disposition) throw new Error('Claim already settled')
      disposition = nextDisposition
      switch (nextDisposition.kind) {
        case 'consume':
          replaceInput({ state: 'consumed', consumedAt: 2 })
          return null
        case 'block':
          return replaceInput({
            state: 'blocked',
            claimedAt: null,
            blocking: nextDisposition.attachmentPreparation
          })
        case 'release-before-user-fact':
        case 'release-after-rollback':
          return replaceInput({ state: 'pending', claimedAt: null })
      }
    }
  }

  const pendingInputs: PendingInputAdmissionStorePort = {
    degradeBlockedInput: vi.fn(() => replaceInput({ state: 'pending', blocking: null })),
    deletePendingInput: vi.fn(() => {
      harness.input = null
    }),
    getInput: vi.fn((_sessionId, itemId) =>
      harness.input?.id === itemId ? harness.input : null
    ),
    hasActiveInputs: vi.fn(() => harness.input !== null),
    hasBlockingInput: vi.fn(() => harness.input?.state === 'blocked'),
    isAtCapacity: vi.fn(() => false),
    listPendingInputs: vi.fn(() =>
      harness.input && harness.input.state !== 'claimed' && harness.input.state !== 'consumed'
        ? [harness.input]
        : []
    ),
    moveQueuedInput: vi.fn(() => (harness.input ? [harness.input] : [])),
    acceptSteerMessage: vi.fn((_sessionId, input) => {
      const message = createUserMessage('direct-steer-message', input)
      harness.input = {
        ...createInput('direct-steer', 'steer'),
        payload: input,
        messageIds: [message.id]
      }
      return { pendingInput: harness.input, message }
    }),
    promoteQueuedInputToSteerMessage: vi.fn(() => {
      const message = createUserMessage('promoted-steer-message', harness.input!.payload)
      return {
        pendingInput: replaceInput({
          mode: 'steer',
          queueOrder: null,
          messageIds: [message.id]
        }),
        message
      }
    }),
    queuePendingInput: vi.fn((_sessionId, input, options) => {
      harness.input = {
        ...createInput(),
        payload: input,
        state: options?.state ?? 'pending'
      }
      return harness.input
    }),
    retryBlockedInput: vi.fn(() => replaceInput({ state: 'pending', blocking: null })),
    updateQueuedInput: vi.fn((_sessionId, _itemId, input) => replaceInput({ payload: input }))
  }

  const pump: PendingInputAdmissionPumpPort = {
    shouldClaimImmediately: vi.fn(() => false),
    startAcceptedInput: vi.fn(),
    schedule: vi.fn(),
    hasInteractionBlocker: vi.fn(() => false),
    canDrain: vi.fn(() => true),
    drain: vi.fn(async () => {
      onDrain?.(harness)
      return false
    }),
    claimQueuedInputForPreparation: vi.fn(() => {
      replaceInput({ state: 'claimed', claimedAt: 2 })
      return claim
    })
  }

  const ports: PendingInputAdmissionCoordinatorPorts = {
    providerSettings: {
      getModelConfig: vi.fn(() => undefined)
    },
    pendingInputs,
    pump,
    transcript: {
      getMessage: vi.fn((messageId: string) =>
        messageId === 'assistant'
          ? ({
              id: messageId,
              sessionId: SESSION_ID,
              role: 'assistant'
            } as ChatMessageRecord)
          : null
      )
    },
    attachmentRouter: {
      prepare: vi.fn(async ({ content }) => ({
        content,
        summary: { status: 'ready', issues: [], suggestedActions: [] }
      }))
    },
    sessionState: { get: vi.fn(async () => state) },
    registry: createScopeRegistry({
      clearActiveSteerPendingInputId: (expectedItemId?: string) => {
        if (
          !harness.activeSteerInputId ||
          (expectedItemId && harness.activeSteerInputId !== expectedItemId)
        ) {
          return false
        }
        harness.activeSteerInputId = undefined
        return true
      },
      getAbortController: () => harness.preStreamController,
      getActiveGeneration: () => undefined,
      getActiveSteerPendingInputId: () => harness.activeSteerInputId,
      getPreStreamTranscriptAnchorId: () => undefined,
      isPendingQueueDraining: () => harness.draining,
      setActiveSteerPendingInputId: (itemId: string) => {
        harness.activeSteerInputId = itemId
      }
    }),
    sessionSettings: { resolveProjectDir: vi.fn(() => null) }
  }

  return {
    coordinator: new PendingInputAdmissionCoordinator(ports),
    harness,
    pendingInputs,
    ports,
    pump
  }
}

interface HarnessState {
  activeSteerInputId: string | undefined
  draining: boolean
  input: PendingSessionInputRecord | null
  preStreamController: AbortController | undefined
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('PendingInputAdmissionCoordinator', () => {
  it('accepts steer before the assistant stream starts and ends preparation', async () => {
    const test = createHarness()
    test.harness.preStreamController = new AbortController()
    test.harness.input = {
      ...test.harness.input!,
      state: 'claimed',
      claimedAt: 1
    }

    await expect(test.coordinator.steerActiveTurn(SESSION_ID, 'Steer now')).resolves.toMatchObject({
      userMessage: { id: 'direct-steer-message', status: 'pending' }
    })
    expect(test.pendingInputs.acceptSteerMessage).toHaveBeenCalledWith(
      SESSION_ID,
      { text: 'Steer now', files: [] },
      { mergeItemId: null, preStreamAnchorMessageId: null }
    )
    expect(test.harness.preStreamController.signal).toMatchObject({
      aborted: true,
      reason: 'pending_input'
    })
  })

  it('rejects a send before attachment preparation when the lane is at capacity', async () => {
    const test = createHarness()
    vi.mocked(test.pendingInputs.isAtCapacity).mockReturnValueOnce(true)

    await expect(
      test.coordinator.sendQueuedMessage(
        SESSION_ID,
        { text: 'At capacity', files: [] },
        { source: 'send' }
      )
    ).rejects.toThrow('Pending input limit reached for this session.')

    expect(test.ports.attachmentRouter.prepare).not.toHaveBeenCalled()
    expect(test.pendingInputs.queuePendingInput).not.toHaveBeenCalled()
  })

  it('returns attachment user action without queueing the send', async () => {
    const test = createHarness()
    vi.mocked(test.ports.attachmentRouter.prepare).mockResolvedValueOnce({
      content: { text: 'Needs OCR', files: [] },
      summary: {
        status: 'needs_user_action',
        issues: [{ attachmentIndex: 0, reason: 'ocr_failed' }],
        suggestedActions: ['retry']
      }
    })

    await expect(
      test.coordinator.sendQueuedMessage(
        SESSION_ID,
        { text: 'Needs OCR', files: [] },
        { source: 'send' }
      )
    ).resolves.toMatchObject({
      requestId: null,
      messageId: null,
      attachmentPreparation: { status: 'needs_user_action' }
    })

    expect(test.pendingInputs.queuePendingInput).not.toHaveBeenCalled()
  })

  it('does not queue a send aborted after attachment preparation', async () => {
    const test = createHarness()
    const controller = new AbortController()
    vi.mocked(test.ports.attachmentRouter.prepare).mockImplementationOnce(async ({ content }) => {
      controller.abort()
      return {
        content,
        summary: { status: 'ready', issues: [], suggestedActions: [] }
      }
    })

    await expect(
      test.coordinator.sendQueuedMessage(
        SESSION_ID,
        { text: 'Abort me', files: [] },
        { source: 'send' },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(test.pendingInputs.queuePendingInput).not.toHaveBeenCalled()
  })

  it('serializes overlapping send preparation through durable queue admission', async () => {
    const test = createHarness()
    const firstPreparation = createDeferred<{
      content: SendMessageInput
      summary: { status: 'ready'; issues: []; suggestedActions: [] }
    }>()
    const prepare = vi.mocked(test.ports.attachmentRouter.prepare)
    prepare
      .mockImplementationOnce(async () => await firstPreparation.promise)
      .mockImplementationOnce(async ({ content }) => ({
        content,
        summary: { status: 'ready', issues: [], suggestedActions: [] }
      }))

    const firstSend = test.coordinator.sendQueuedMessage(
      SESSION_ID,
      { text: 'First', files: [] },
      { source: 'send' }
    )
    const secondSend = test.coordinator.sendQueuedMessage(
      SESSION_ID,
      { text: 'Second', files: [] },
      { source: 'send' }
    )

    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())
    expect(test.pendingInputs.queuePendingInput).not.toHaveBeenCalled()

    firstPreparation.resolve({
      content: { text: 'First', files: [] },
      summary: { status: 'ready', issues: [], suggestedActions: [] }
    })
    await Promise.all([firstSend, secondSend])

    expect(prepare).toHaveBeenCalledTimes(2)
    expect(test.pendingInputs.queuePendingInput).toHaveBeenCalledTimes(2)
    expect(prepare.mock.invocationCallOrder[1]).toBeGreaterThan(
      vi.mocked(test.pendingInputs.queuePendingInput).mock.invocationCallOrder[0]
    )
    expect(
      vi.mocked(test.pendingInputs.queuePendingInput).mock.calls.map(([, input]) => input.text)
    ).toEqual(['First', 'Second'])
  })

  it('keeps a promoted steer when another drain has already claimed it', async () => {
    const test = createHarness((harness) => {
      if (!harness.input) throw new Error('Pending input not found')
      harness.input = {
        ...harness.input,
        state: 'claimed',
        claimedAt: 3
      }
    })

    await expect(test.coordinator.steerPendingInput(SESSION_ID, 'input')).resolves.toMatchObject({
      id: 'input',
      mode: 'steer'
    })

    expect(test.harness.input).toMatchObject({ mode: 'steer', state: 'claimed' })
  })

  it('keeps a promoted steer behind another in-flight drain', async () => {
    const test = createHarness((harness) => {
      harness.draining = true
    })

    await expect(test.coordinator.steerPendingInput(SESSION_ID, 'input')).resolves.toMatchObject({
      id: 'input',
      mode: 'steer'
    })

    expect(test.harness.input).toMatchObject({ mode: 'steer', state: 'pending' })
  })

  it('accepts a direct steer that completed before its drain result was observed', async () => {
    const test = createHarness((harness) => {
      if (!harness.input) throw new Error('Pending input not found')
      harness.input = {
        ...harness.input,
        state: 'consumed',
        consumedAt: 3
      }
    })

    await expect(
      test.coordinator.steerActiveTurn(SESSION_ID, {
        text: 'Steer now',
        files: []
      } satisfies SendMessageInput)
    ).resolves.toMatchObject({
      requestId: null,
      messageId: null,
      userMessage: {
        id: 'direct-steer-message',
        status: 'pending'
      },
      attachmentPreparation: { status: 'ready' }
    })

    expect(test.pendingInputs.deletePendingInput).not.toHaveBeenCalled()
  })

  it('keeps a promoted steer durable when its drain is deferred', async () => {
    const test = createHarness()

    await expect(test.coordinator.steerPendingInput(SESSION_ID, 'input')).resolves.toMatchObject({
      id: 'input',
      mode: 'steer',
      state: 'pending'
    })

    expect(test.pump.schedule).toHaveBeenCalledWith(SESSION_ID, 'enqueue')
    expect(test.harness.input).toMatchObject({ mode: 'steer', state: 'pending' })
  })

  it('classifies a missing hydrated steer owner as a stale runtime instance', async () => {
    const test = createHarness()
    vi.mocked(test.ports.registry.getHydratedScope).mockReturnValue(undefined)

    await expect(test.coordinator.steerActiveTurn(SESSION_ID, 'Steer now')).rejects.toMatchObject({
      name: 'StaleDeepChatAgentInstanceError'
    })

    expect(test.pendingInputs.acceptSteerMessage).not.toHaveBeenCalled()
  })

  it('returns the durable blocked record without a nullable settlement branch', async () => {
    const test = createHarness()
    vi.mocked(test.ports.attachmentRouter.prepare).mockResolvedValueOnce({
      content: { text: 'Promote me', files: [] },
      summary: {
        status: 'needs_user_action',
        issues: [{ attachmentIndex: 0, reason: 'ocr_failed' }],
        suggestedActions: ['retry']
      }
    })

    await expect(test.coordinator.steerPendingInput(SESSION_ID, 'input')).resolves.toMatchObject({
      id: 'input',
      state: 'blocked',
      blocking: { status: 'needs_user_action' }
    })

    expect(test.harness.input?.state).toBe('blocked')
  })

  it('does not mask an attachment preparation error when claim release also fails', async () => {
    const test = createHarness()
    const preparationError = new Error('preparation failed')
    const releaseError = new Error('release failed')
    const claim: ClaimedPendingInputHandle = {
      id: 'input',
      source: 'queue',
      disposition: null,
      settle: vi.fn(() => {
        throw releaseError
      })
    }
    vi.mocked(test.pump.claimQueuedInputForPreparation).mockReturnValueOnce(claim)
    vi.mocked(test.ports.attachmentRouter.prepare).mockRejectedValueOnce(preparationError)
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    await expect(test.coordinator.steerPendingInput(SESSION_ID, 'input')).rejects.toBe(
      preparationError
    )

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('failed to release pending input after admission failure'),
      { name: 'Error' }
    )
  })
})
