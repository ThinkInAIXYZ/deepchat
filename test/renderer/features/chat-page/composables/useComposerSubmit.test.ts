import { computed, effectScope, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerSubmit } from '@/features/chat-page/composables/useComposerSubmit'
import type {
  AttachmentPreparationSummary,
  MessageFile,
  UserMessageInlineItem
} from '@shared/types/agent-interface'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function createHarness() {
  const sessionId = ref('s1')
  const restoreRequestId = ref(1)
  const isReadOnly = ref(false)
  const isPreparingSession = ref(false)
  const isAcpWorkdirMissing = ref(false)
  const isGenerating = ref(false)
  const pendingSkills = ref<string[]>(['ocr-skill'])
  const inlineItems = ref<UserMessageInlineItem[]>([])
  const clearPendingSkills = vi.fn(() => {
    pendingSkills.value = []
  })
  const setPendingSkills = vi.fn((skills: string[]) => {
    pendingSkills.value = [...skills]
  })
  const chatInputRef = ref({
    getPendingSkillsSnapshot: () => [...pendingSkills.value],
    getInlineItemsSnapshot: () => inlineItems.value.map((item) => ({ ...item })),
    clearPendingSkills,
    setPendingSkills
  })
  const messageStore = {
    addOptimisticUserMessage: vi.fn(() => 'optimistic-user'),
    removeOptimisticMessage: vi.fn()
  }
  const sessionStore = { activeSession: { providerId: 'openai' } }
  const modelStore = { findChatSelectableModel: vi.fn(() => null) }
  const pendingInputStore = {
    isAtCapacity: false,
    queueInput: vi.fn().mockResolvedValue(undefined)
  }
  const chatClient = {
    sendMessage: vi.fn().mockResolvedValue({ accepted: true }),
    steerActiveTurn: vi.fn().mockResolvedValue({ accepted: true })
  }
  const sessionClient = { compactSession: vi.fn().mockResolvedValue({ compacted: true }) }
  const modelClient = {
    getCapabilities: vi.fn().mockResolvedValue({ supportsAudioInput: true })
  }
  const createPendingAssistantPlaceholder = vi.fn(() => 'pending-assistant')
  const clearPendingAssistantPlaceholder = vi.fn()
  const beginPlanTurn = vi.fn()
  const schedulePostSubmitScrollToBottom = vi.fn()
  const openModelPicker = vi.fn()
  const scope = effectScope()
  let actions!: ReturnType<typeof useComposerSubmit>

  scope.run(() => {
    actions = useComposerSubmit({
      sessionId: () => sessionId.value,
      currentRestoreRequestId: () => restoreRequestId.value,
      canWriteSessionView: (targetSessionId, requestId) =>
        targetSessionId === sessionId.value && requestId === restoreRequestId.value,
      messageStore: messageStore as any,
      sessionStore: sessionStore as any,
      modelStore: modelStore as any,
      pendingInputStore: pendingInputStore as any,
      chatClient,
      sessionClient,
      modelClient,
      chatInputRef,
      isReadOnlySession: computed(() => isReadOnly.value),
      isSessionViewPreparing: computed(() => isPreparingSession.value),
      isAcpWorkdirMissing: computed(() => isAcpWorkdirMissing.value),
      isGenerating: computed(() => isGenerating.value),
      hasBlockingInteraction: () => false,
      getActiveModelSelection: () => null,
      createPendingAssistantPlaceholder,
      clearPendingAssistantPlaceholder,
      beginPlanTurn,
      schedulePostSubmitScrollToBottom,
      loadMessagesForSession: vi.fn().mockResolvedValue({}),
      applyRestoredSessionSummary: vi.fn(),
      openModelPicker,
      toast: vi.fn(),
      t: (key) => key
    })
  })

  return {
    actions,
    sessionId,
    restoreRequestId,
    pendingSkills,
    inlineItems,
    messageStore,
    chatClient,
    clearPendingSkills,
    setPendingSkills,
    clearPendingAssistantPlaceholder,
    beginPlanTurn,
    schedulePostSubmitScrollToBottom,
    openModelPicker,
    stop: () => scope.stop()
  }
}

const imageFile = (): MessageFile => ({
  name: 'scan.png',
  path: '/tmp/scan.png',
  mimeType: 'image/png',
  requestedRepresentation: 'auto'
})

const blockedSummary = (): AttachmentPreparationSummary => ({
  status: 'needs_user_action',
  issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
  suggestedActions: ['retry', 'send_without_image_content', 'switch_to_vision_model']
})

describe('useComposerSubmit attachment preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves a rejected draft and sends only after explicit degradation', async () => {
    const harness = createHarness()
    const summary = blockedSummary()
    harness.actions.message.value = 'read this'
    harness.actions.attachedFiles.value = [imageFile()]
    harness.chatClient.sendMessage
      .mockResolvedValueOnce({ accepted: false, attachmentPreparation: summary })
      .mockResolvedValueOnce({ accepted: true })

    await harness.actions.onSubmit()

    expect(harness.actions.message.value).toBe('read this')
    expect(harness.actions.attachedFiles.value).toHaveLength(1)
    expect(harness.actions.attachmentPreparationSummary.value).toEqual(summary)
    expect(harness.messageStore.removeOptimisticMessage).toHaveBeenCalledWith(
      'optimistic-user',
      's1'
    )
    expect(harness.clearPendingAssistantPlaceholder).toHaveBeenCalledWith('pending-assistant')
    expect(harness.beginPlanTurn).not.toHaveBeenCalled()

    await harness.actions.sendWithoutImageContent()

    expect(harness.chatClient.sendMessage).toHaveBeenLastCalledWith(
      's1',
      expect.objectContaining({
        text: 'read this',
        attachmentFallbackPolicy: 'send_without_image_content'
      })
    )
    expect(harness.actions.message.value).toBe('')
    expect(harness.actions.attachedFiles.value).toEqual([])
    expect(harness.clearPendingSkills).toHaveBeenCalledTimes(1)
    expect(harness.actions.attachmentPreparationSummary.value).toBeNull()
    expect(harness.beginPlanTurn).toHaveBeenCalledWith('s1')
    harness.stop()
  })

  it('does not clear edits made while image preparation is in flight', async () => {
    const harness = createHarness()
    const deferred = createDeferred<{ accepted: boolean }>()
    harness.chatClient.sendMessage.mockReturnValueOnce(deferred.promise)
    harness.actions.message.value = 'original'
    harness.actions.attachedFiles.value = [imageFile()]
    harness.inlineItems.value = [
      {
        type: 'file',
        offset: 0,
        fileName: 'scan.png',
        filePath: '/tmp/scan.png',
        mimeType: 'image/png'
      }
    ]

    const submit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.chatClient.sendMessage).toHaveBeenCalledTimes(1))
    expect(harness.actions.isPreparingAttachments.value).toBe(true)

    harness.actions.message.value = 'new draft'
    harness.inlineItems.value = []
    deferred.resolve({ accepted: true })
    await submit

    expect(harness.actions.message.value).toBe('new draft')
    expect(harness.actions.attachedFiles.value).toHaveLength(1)
    expect(harness.clearPendingSkills).not.toHaveBeenCalled()
    expect(harness.actions.isPreparingAttachments.value).toBe(false)
    harness.stop()
  })

  it('coalesces rapid duplicate submissions before local attachment checks finish', async () => {
    const harness = createHarness()
    harness.actions.message.value = 'send once'

    await Promise.all([harness.actions.onSubmit(), harness.actions.onSubmit()])

    expect(harness.chatClient.sendMessage).toHaveBeenCalledTimes(1)
    expect(harness.beginPlanTurn).toHaveBeenCalledTimes(1)
    harness.stop()
  })

  it('scopes in-flight preparation and blocked retries to their originating session', async () => {
    const harness = createHarness()
    const first = createDeferred<{ accepted: boolean }>()
    const secondSummary = blockedSummary()
    harness.chatClient.sendMessage.mockImplementation((targetSessionId) =>
      targetSessionId === 's1'
        ? first.promise
        : Promise.resolve({ accepted: false, attachmentPreparation: secondSummary })
    )
    harness.actions.message.value = 'session one'
    harness.actions.attachedFiles.value = [imageFile()]

    const firstSubmit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.chatClient.sendMessage).toHaveBeenCalledTimes(1))
    expect(harness.actions.isPreparingAttachments.value).toBe(true)

    harness.sessionId.value = 's2'
    harness.actions.clearAttachmentPreparationForSessionChange()
    harness.actions.message.value = 'session two'
    harness.actions.attachedFiles.value = []
    expect(harness.actions.isPreparingAttachments.value).toBe(false)

    await harness.actions.onSubmit()
    expect(harness.chatClient.sendMessage).toHaveBeenCalledWith(
      's2',
      expect.objectContaining({ text: 'session two' })
    )
    expect(harness.actions.message.value).toBe('session two')
    expect(harness.actions.attachmentPreparationSummary.value).toEqual(secondSummary)

    first.resolve({ accepted: true })
    await firstSubmit
    expect(harness.actions.attachmentPreparationSummary.value).toEqual(secondSummary)
    harness.stop()
  })

  it('restores a blocked initial draft but refuses to retry it after a session change', async () => {
    const harness = createHarness()
    const summary = blockedSummary()
    harness.actions.restoreInitialBlockedDraft(
      {
        text: 'initial',
        files: [imageFile()],
        activeSkills: ['restored-skill']
      },
      summary
    )

    expect(harness.actions.message.value).toBe('initial')
    expect(harness.setPendingSkills).toHaveBeenCalledWith(['restored-skill'])
    expect(harness.actions.attachmentPreparationSummary.value).toEqual(summary)

    harness.sessionId.value = 's2'
    await harness.actions.sendWithoutImageContent()

    expect(harness.chatClient.sendMessage).not.toHaveBeenCalled()
    expect(harness.actions.attachmentPreparationSummary.value).toBeNull()
    harness.stop()
  })
})
