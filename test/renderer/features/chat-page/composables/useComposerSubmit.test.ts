import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useComposerSubmit } from '@/features/chat-page/composables/useComposerSubmit'
import { createDeferred } from '../../../utils/deferred'

function setup() {
  const sessionId = ref('s1')
  const restoreRequestId = ref(1)
  const isAcpWorkdirMissing = ref(false)
  const steerActiveTurn = vi.fn(async () => ({ accepted: true }))
  const beginPlanTurn = vi.fn()
  const toast = vi.fn()

  const composer = useComposerSubmit({
    sessionId: () => sessionId.value,
    currentRestoreRequestId: () => restoreRequestId.value,
    canWriteSessionView: (targetSessionId, targetRequestId) =>
      targetSessionId === sessionId.value && targetRequestId === restoreRequestId.value,
    messageStore: {
      addOptimisticUserMessage: vi.fn(),
      removeOptimisticMessage: vi.fn()
    } as never,
    sessionStore: {
      activeSession: { providerId: 'openai' }
    } as never,
    modelStore: {
      findChatSelectableModel: vi.fn()
    } as never,
    pendingInputStore: {
      isAtCapacity: false,
      queueInput: vi.fn()
    } as never,
    chatClient: {
      sendMessage: vi.fn(),
      steerActiveTurn
    },
    sessionClient: {
      compactSession: vi.fn(async () => ({ compacted: true }))
    },
    modelClient: {
      getCapabilities: vi.fn(async () => ({ supportsAudioInput: true }))
    },
    chatInputRef: ref(null),
    isReadOnlySession: computed(() => false),
    isSessionViewPreparing: computed(() => false),
    isAcpWorkdirMissing: computed(() => isAcpWorkdirMissing.value),
    isGenerating: computed(() => true),
    hasBlockingInteraction: () => false,
    getActiveModelSelection: () => ({ providerId: 'openai', modelId: 'gpt-4' }),
    createPendingAssistantPlaceholder: vi.fn(() => 'pending-assistant'),
    clearPendingAssistantPlaceholder: vi.fn(),
    beginPlanTurn,
    schedulePostSubmitScrollToBottom: vi.fn(),
    loadMessagesForSession: vi.fn(async () => null),
    applyRestoredSessionSummary: vi.fn(),
    toast,
    t: (key) => key
  })

  return {
    composer,
    sessionId,
    restoreRequestId,
    isAcpWorkdirMissing,
    steerActiveTurn,
    beginPlanTurn,
    toast
  }
}

describe('useComposerSubmit steer', () => {
  it('blocks duplicates and clears the draft only after acceptance', async () => {
    const steering = createDeferred<{ accepted: boolean }>()
    const { composer, steerActiveTurn, beginPlanTurn } = setup()
    steerActiveTurn.mockReturnValueOnce(steering.promise)
    composer.message.value = 'tighten the answer'

    const request = composer.onSteer()
    await vi.waitFor(() => expect(steerActiveTurn).toHaveBeenCalledTimes(1))

    expect(composer.isSteering.value).toBe(true)
    expect(composer.disableQueueSteerAction.value).toBe(true)
    expect(composer.isQueueSubmitDisabled.value).toBe(true)

    await composer.onSteer()
    expect(steerActiveTurn).toHaveBeenCalledTimes(1)

    steering.resolve({ accepted: true })
    await request

    expect(steerActiveTurn).toHaveBeenCalledWith('s1', {
      text: 'tighten the answer',
      files: []
    })
    expect(beginPlanTurn).toHaveBeenCalledWith('s1')
    expect(composer.message.value).toBe('')
    expect(composer.isSteering.value).toBe(false)
  })

  it('retains the draft and reports a failed request', async () => {
    const { composer, steerActiveTurn, beginPlanTurn, toast } = setup()
    steerActiveTurn.mockRejectedValueOnce(new Error('boom'))
    composer.message.value = 'keep this draft'

    await composer.onSteer()

    expect(beginPlanTurn).not.toHaveBeenCalled()
    expect(composer.message.value).toBe('keep this draft')
    expect(toast).toHaveBeenCalledWith({
      title: 'chat.pendingInput.steerFailed',
      variant: 'destructive'
    })
  })

  it('does not clear a new draft when an old A-B-A request resolves', async () => {
    const steering = createDeferred<{ accepted: boolean }>()
    const { composer, sessionId, restoreRequestId, steerActiveTurn, beginPlanTurn } = setup()
    steerActiveTurn.mockReturnValueOnce(steering.promise)
    composer.message.value = 'old draft'

    const request = composer.onSteer()
    await vi.waitFor(() => expect(steerActiveTurn).toHaveBeenCalledTimes(1))

    sessionId.value = 's2'
    restoreRequestId.value += 1
    sessionId.value = 's1'
    restoreRequestId.value += 1
    composer.message.value = 'new draft'

    steering.resolve({ accepted: true })
    await request

    expect(beginPlanTurn).toHaveBeenCalledWith('s1')
    expect(composer.message.value).toBe('new draft')
  })
})
