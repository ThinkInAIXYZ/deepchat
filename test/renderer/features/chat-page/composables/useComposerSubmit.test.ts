import { computed, effectScope, nextTick, ref, shallowReactive } from 'vue'
import type { JSONContent } from '@tiptap/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerSubmit } from '@/features/chat-page/composables/useComposerSubmit'
import {
  loadComposerDraftFromStorage,
  saveComposerDraftToStorage
} from '@/features/chat-page/model/composerDraftPersistence'
import type {
  AttachmentPreparationSummary,
  ChatMessageRecord,
  MessageFile,
  UserMessageInlineItem
} from '@shared/types/agent-interface'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

function createSteerMessage(): ChatMessageRecord {
  return {
    id: 'steer-user',
    sessionId: 's1',
    orderSeq: 3,
    role: 'user',
    content: JSON.stringify({ text: 'tighten the answer', files: [] }),
    status: 'pending',
    isContextEdge: 0,
    metadata: JSON.stringify({ inputReceipt: { mode: 'steer', readAt: null } }),
    createdAt: 1,
    updatedAt: 1
  }
}

function createHarness(options: { composerMounted?: boolean } = {}) {
  const sessionId = ref('s1')
  const restoreRequestId = ref(1)
  const isReadOnly = ref(false)
  const isPreparingSession = ref(false)
  const isAcpWorkdirMissing = ref(false)
  const isGenerating = ref(false)
  const activeModelSelection = ref<{ providerId: string; modelId: string } | null>(null)
  const pendingSkills = ref<string[]>(['ocr-skill'])
  const inlineItems = ref<UserMessageInlineItem[]>([])
  const document = ref<JSONContent>({ type: 'doc', content: [{ type: 'paragraph' }] })
  const clearPendingSkills = vi.fn(() => {
    pendingSkills.value = []
  })
  const setPendingSkills = vi.fn((skills: string[]) => {
    pendingSkills.value = [...skills]
  })
  const restoreDocumentSnapshot = vi.fn((snapshot: JSONContent) => {
    document.value = JSON.parse(JSON.stringify(snapshot)) as JSONContent
  })
  const inputHandle = {
    getPendingSkillsSnapshot: () => [...pendingSkills.value],
    getInlineItemsSnapshot: () => inlineItems.value.map((item) => ({ ...item })),
    clearPendingSkills,
    setPendingSkills,
    getDocumentSnapshot: () => JSON.parse(JSON.stringify(document.value)) as JSONContent,
    restoreDocumentSnapshot
  }
  const chatInputRef = ref<typeof inputHandle | null>(
    options.composerMounted === false ? null : inputHandle
  )
  const messageStore = {
    currentStreamMessageId: 'assistant-1',
    committedSessionId: 's1',
    messageCache: new Map([
      [
        'assistant-1',
        {
          id: 'assistant-1',
          sessionId: 's1',
          role: 'assistant'
        }
      ]
    ]),
    addOptimisticUserMessage: vi.fn(() => 'optimistic-user'),
    removeOptimisticMessage: vi.fn(),
    applyPersistedMessageRecords: vi.fn(),
    invalidateRecentSessionView: vi.fn()
  }
  const searchIntents = shallowReactive(new Map<string, boolean>())
  const sessionStore = {
    activeSession: { providerId: 'openai' },
    getSearchIntent: (targetSessionId: string) => searchIntents.get(targetSessionId) === true,
    setSearchIntent: (targetSessionId: string, enabled: boolean) => {
      if (enabled) searchIntents.set(targetSessionId, true)
      else searchIntents.delete(targetSessionId)
    },
    toggleSearchIntent: (targetSessionId: string) => {
      const enabled = searchIntents.get(targetSessionId) !== true
      if (enabled) searchIntents.set(targetSessionId, true)
      else searchIntents.delete(targetSessionId)
      return enabled
    }
  }
  const modelStore = { findChatSelectableModel: vi.fn(() => null) }
  const pendingInputStore = {
    isAtCapacity: false,
    queueInput: vi.fn().mockResolvedValue(undefined)
  }
  const chatClient = {
    sendMessage: vi.fn().mockResolvedValue({ accepted: true }),
    steerActiveTurn: vi.fn().mockResolvedValue({
      accepted: true,
      message: createSteerMessage()
    }),
    cancelSubmission: vi.fn().mockResolvedValue({ cancelled: true })
  }
  const sessionClient = { compactSession: vi.fn().mockResolvedValue({ compacted: true }) }
  let providersChangedListener: ((payload: { providerIds?: string[] }) => void) | null = null
  const modelClient = {
    getCapabilities: vi.fn().mockResolvedValue({ supportsAudioInput: true })
  }
  const providerClient = {
    onProvidersChanged: vi.fn((listener: (payload: { providerIds?: string[] }) => void) => {
      providersChangedListener = listener
      return vi.fn()
    })
  }
  const createPendingAssistantPlaceholder = vi.fn(() => 'pending-assistant')
  const clearPendingAssistantPlaceholder = vi.fn()
  const beginPlanTurn = vi.fn()
  const schedulePostSubmitScrollToBottom = vi.fn()
  const openModelPicker = vi.fn()
  const notify = vi.fn()
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
      providerClient,
      chatInputRef,
      isReadOnlySession: computed(() => isReadOnly.value),
      isSessionViewPreparing: computed(() => isPreparingSession.value),
      isAcpWorkdirMissing: computed(() => isAcpWorkdirMissing.value),
      isGenerating: computed(() => isGenerating.value),
      hasBlockingInteraction: () => false,
      getActiveModelSelection: () => activeModelSelection.value,
      createPendingAssistantPlaceholder,
      clearPendingAssistantPlaceholder,
      beginPlanTurn,
      schedulePostSubmitScrollToBottom,
      loadMessagesForSession: vi.fn().mockResolvedValue({}),
      applyRestoredSessionSummary: vi.fn(),
      openModelPicker,
      notify,
      t: (key) => key
    })
  })

  return {
    actions,
    chatInputRef,
    inputHandle,
    sessionId,
    restoreRequestId,
    isGenerating,
    activeModelSelection,
    pendingSkills,
    inlineItems,
    document,
    messageStore,
    sessionStore,
    pendingInputStore,
    chatClient,
    modelClient,
    providerClient,
    emitProvidersChanged: (payload: { providerIds?: string[] }) =>
      providersChangedListener?.(payload),
    clearPendingSkills,
    setPendingSkills,
    restoreDocumentSnapshot,
    clearPendingAssistantPlaceholder,
    beginPlanTurn,
    schedulePostSubmitScrollToBottom,
    openModelPicker,
    notify,
    stop: () => {
      actions.dispose()
      scope.stop()
    }
  }
}

const imageFile = (): MessageFile => ({
  name: 'scan.png',
  path: '/tmp/scan.png',
  mimeType: 'image/png',
  requestedRepresentation: 'auto'
})

const pdfFile = (): MessageFile => ({
  name: 'scan.pdf',
  path: '/tmp/scan.pdf',
  mimeType: 'application/pdf',
  requestedRepresentation: 'ocr_text'
})

const blockedSummary = (): AttachmentPreparationSummary => ({
  status: 'needs_user_action',
  issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
  suggestedActions: ['retry', 'send_without_image_content', 'switch_to_vision_model']
})

describe('useComposerSubmit attachment preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
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
      }),
      { submissionId: expect.any(String) }
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
    expect(harness.actions.attachedFiles.value).toEqual([])
    expect(harness.clearPendingSkills).not.toHaveBeenCalled()
    expect(harness.actions.isPreparingAttachments.value).toBe(false)
    harness.stop()
  })

  it('cancels main-owned image preparation before opening the model picker', async () => {
    const harness = createHarness()
    const deferred = createDeferred<{ accepted: boolean }>()
    harness.chatClient.sendMessage.mockReturnValueOnce(deferred.promise)
    harness.actions.message.value = 'keep this draft'
    harness.actions.attachedFiles.value = [imageFile()]

    const submit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.chatClient.sendMessage).toHaveBeenCalledTimes(1))
    const submissionOptions = harness.chatClient.sendMessage.mock.calls[0]?.[2]

    harness.actions.switchToVisionModel()
    expect(harness.chatClient.cancelSubmission).toHaveBeenCalledWith(
      submissionOptions?.submissionId
    )
    expect(harness.openModelPicker).toHaveBeenCalledOnce()
    expect(harness.chatClient.cancelSubmission.mock.invocationCallOrder[0]).toBeLessThan(
      harness.openModelPicker.mock.invocationCallOrder[0]!
    )
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    deferred.reject(abortError)
    await submit

    expect(harness.actions.message.value).toBe('keep this draft')
    expect(harness.actions.attachedFiles.value).toEqual([imageFile()])
    expect(harness.notify).not.toHaveBeenCalled()
    expect(harness.actions.isPreparingAttachments.value).toBe(false)
    harness.stop()
  })

  it('keeps PDF preparation visible and cancellable through the main process', async () => {
    const harness = createHarness()
    const deferred = createDeferred<{ accepted: boolean }>()
    harness.chatClient.sendMessage.mockReturnValueOnce(deferred.promise)
    harness.actions.message.value = 'read this PDF'
    harness.actions.attachedFiles.value = [pdfFile()]

    const submit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.chatClient.sendMessage).toHaveBeenCalledTimes(1))
    const submissionOptions = harness.chatClient.sendMessage.mock.calls[0]?.[2]

    expect(harness.actions.isPreparingAttachments.value).toBe(true)
    expect(submissionOptions).toEqual({ submissionId: expect.any(String) })

    harness.actions.cancelAttachmentPreparation()
    expect(harness.chatClient.cancelSubmission).toHaveBeenCalledWith(
      submissionOptions?.submissionId
    )
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    deferred.reject(abortError)
    await submit

    expect(harness.actions.message.value).toBe('read this PDF')
    expect(harness.actions.attachedFiles.value).toEqual([pdfFile()])
    expect(harness.notify).not.toHaveBeenCalled()
    expect(harness.actions.isPreparingAttachments.value).toBe(false)
    harness.stop()
  })

  it('does not expose submission cancellation for ACP image attachments', async () => {
    const harness = createHarness()
    const deferred = createDeferred<{ accepted: boolean }>()
    harness.sessionStore.activeSession.providerId = 'acp'
    harness.chatClient.sendMessage.mockReturnValueOnce(deferred.promise)
    harness.actions.message.value = 'ACP prompt'
    harness.actions.attachedFiles.value = [imageFile()]

    const submit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.chatClient.sendMessage).toHaveBeenCalledOnce())

    expect(harness.actions.isPreparingAttachments.value).toBe(false)
    expect(harness.chatClient.sendMessage).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ text: 'ACP prompt' })
    )
    deferred.resolve({ accepted: true })
    await submit
    harness.stop()
  })

  it('cancels local capability preparation before invoking main', async () => {
    const harness = createHarness()
    const capabilities = createDeferred<{ supportsAudioInput: boolean }>()
    harness.activeModelSelection.value = { providerId: 'openai', modelId: 'gpt-4' }
    harness.modelClient.getCapabilities.mockReturnValueOnce(capabilities.promise)
    harness.actions.message.value = 'keep local draft'
    harness.actions.attachedFiles.value = [imageFile()]

    const submit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.modelClient.getCapabilities).toHaveBeenCalledOnce())
    harness.actions.cancelAttachmentPreparation()
    capabilities.resolve({ supportsAudioInput: true })
    await submit

    expect(harness.chatClient.sendMessage).not.toHaveBeenCalled()
    expect(harness.chatClient.cancelSubmission).not.toHaveBeenCalled()
    expect(harness.actions.message.value).toBe('keep local draft')
    expect(harness.actions.attachedFiles.value).toEqual([imageFile()])
    harness.stop()
  })

  it('cancels main-owned preparation when the composer is disposed', async () => {
    const harness = createHarness()
    const deferred = createDeferred<{ accepted: boolean }>()
    harness.chatClient.sendMessage.mockReturnValueOnce(deferred.promise)
    harness.actions.message.value = 'leave this page'
    harness.actions.attachedFiles.value = [imageFile()]

    const submit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.chatClient.sendMessage).toHaveBeenCalledOnce())
    const submissionOptions = harness.chatClient.sendMessage.mock.calls[0]?.[2]
    harness.actions.dispose()

    expect(harness.chatClient.cancelSubmission).toHaveBeenCalledWith(
      submissionOptions?.submissionId
    )
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    deferred.reject(abortError)
    await submit
    harness.stop()
  })

  it('reports a semantic attachment error for non-cancellation failures', async () => {
    const harness = createHarness()
    harness.chatClient.sendMessage.mockRejectedValueOnce(new Error('OCR runtime unavailable'))
    harness.actions.message.value = 'read this'
    harness.actions.attachedFiles.value = [imageFile()]

    await harness.actions.onSubmit()

    expect(harness.notify).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.attachment.uploadFailed',
      title: 'chat.input.fileUploadFailed',
      description: 'OCR runtime unavailable'
    })
    expect(harness.actions.message.value).toBe('read this')
    expect(harness.actions.attachedFiles.value).toEqual([imageFile()])
    harness.stop()
  })

  it('reports a real failure even after cancellation was requested', async () => {
    const harness = createHarness()
    const deferred = createDeferred<{ accepted: boolean }>()
    harness.chatClient.sendMessage.mockReturnValueOnce(deferred.promise)
    harness.actions.message.value = 'keep this draft'
    harness.actions.attachedFiles.value = [imageFile()]

    const submit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.chatClient.sendMessage).toHaveBeenCalledOnce())
    harness.actions.cancelAttachmentPreparation()
    deferred.reject(new Error('OCR runtime unavailable'))
    await submit

    expect(harness.notify).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.attachment.uploadFailed',
      title: 'chat.input.fileUploadFailed',
      description: 'OCR runtime unavailable'
    })
    expect(harness.actions.message.value).toBe('keep this draft')
    expect(harness.actions.attachedFiles.value).toEqual([imageFile()])
    harness.stop()
  })

  it('preserves an edit-and-revert made during local capability preparation', async () => {
    const harness = createHarness()
    const capabilities = createDeferred<{ supportsAudioInput: boolean }>()
    harness.activeModelSelection.value = { providerId: 'openai', modelId: 'gpt-4' }
    harness.modelClient.getCapabilities.mockReturnValueOnce(capabilities.promise)
    harness.actions.message.value = 'original'
    harness.actions.attachedFiles.value = [imageFile()]

    const submit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.modelClient.getCapabilities).toHaveBeenCalledTimes(1))

    harness.actions.message.value = 'edited'
    harness.actions.message.value = 'original'
    harness.pendingSkills.value = ['new-skill']
    harness.actions.recordComposerSkillsChange(['new-skill'])
    capabilities.resolve({ supportsAudioInput: true })
    await submit

    expect(harness.chatClient.sendMessage).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ text: 'original', activeSkills: ['ocr-skill'] }),
      { submissionId: expect.any(String) }
    )
    expect(harness.actions.message.value).toBe('original')
    expect(harness.actions.attachedFiles.value).toEqual([])
    expect(harness.pendingSkills.value).toEqual(['new-skill'])
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
    harness.actions.switchComposerSession('s1', 's2')
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

    harness.sessionId.value = 's1'
    harness.actions.switchComposerSession('s2', 's1')
    expect(harness.actions.message.value).toBe('')
    expect(harness.actions.attachedFiles.value).toEqual([])
    harness.stop()
  })

  it('reconciles acceptance that races ahead of the session-switch watcher', async () => {
    const harness = createHarness()
    const accepted = createDeferred<{ accepted: boolean }>()
    harness.chatClient.sendMessage.mockReturnValueOnce(accepted.promise)
    harness.sessionId.value = 's2'
    harness.actions.switchComposerSession('s1', 's2')
    harness.sessionId.value = 's1'
    harness.actions.switchComposerSession('s2', 's1')
    await nextTick()
    harness.actions.message.value = 'session one'
    harness.actions.attachedFiles.value = [imageFile()]

    const submit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.chatClient.sendMessage).toHaveBeenCalledTimes(1))

    harness.sessionId.value = 's2'
    accepted.resolve({ accepted: true })
    await submit
    harness.actions.switchComposerSession('s1', 's2')

    harness.sessionId.value = 's1'
    harness.actions.switchComposerSession('s2', 's1')
    expect(harness.actions.message.value).toBe('')
    expect(harness.actions.attachedFiles.value).toEqual([])
    harness.stop()
  })

  it('restores a blocked initial draft but refuses to retry it after a session change', async () => {
    const harness = createHarness()
    const summary = blockedSummary()
    harness.pendingSkills.value = []
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
    harness.actions.switchComposerSession('s1', 's2')
    await harness.actions.sendWithoutImageContent()

    expect(harness.chatClient.sendMessage).not.toHaveBeenCalled()
    expect(harness.actions.attachmentPreparationSummary.value).toBeNull()
    harness.stop()
  })

  it('restores initial skills and document after the composer handle mounts', async () => {
    const harness = createHarness({ composerMounted: false })

    harness.actions.restoreInitialBlockedDraft(
      {
        text: 'initial',
        files: [imageFile()],
        activeSkills: ['restored-skill']
      },
      blockedSummary()
    )

    expect(harness.actions.message.value).toBe('initial')
    expect(harness.setPendingSkills).not.toHaveBeenCalled()
    harness.chatInputRef.value = harness.inputHandle
    await vi.waitFor(() => {
      expect(harness.setPendingSkills).toHaveBeenCalledWith(['restored-skill'])
    })
    expect(harness.restoreDocumentSnapshot).toHaveBeenCalledWith({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'initial' }] }]
    })
    harness.stop()
  })

  it('keeps a blocked attempt scoped to its session across navigation', async () => {
    const harness = createHarness()
    const summary = blockedSummary()
    harness.actions.message.value = 'blocked in one'
    harness.actions.attachedFiles.value = [imageFile()]
    harness.chatClient.sendMessage
      .mockResolvedValueOnce({ accepted: false, attachmentPreparation: summary })
      .mockResolvedValueOnce({ accepted: true })

    await harness.actions.onSubmit()
    expect(harness.actions.attachmentPreparationSummary.value).toEqual(summary)

    harness.sessionId.value = 's2'
    harness.actions.switchComposerSession('s1', 's2')
    expect(harness.actions.attachmentPreparationSummary.value).toBeNull()

    harness.sessionId.value = 's1'
    harness.actions.switchComposerSession('s2', 's1')
    expect(harness.actions.attachmentPreparationSummary.value).toEqual(summary)

    await harness.actions.retryAttachmentPreparation()
    expect(harness.actions.attachmentPreparationSummary.value).toBeNull()
    expect(harness.actions.message.value).toBe('')
    harness.stop()
  })

  it('finishes an attachment filter into the originating session draft', async () => {
    const harness = createHarness()
    const capabilities = createDeferred<{ supportsAudioInput: boolean }>()
    harness.activeModelSelection.value = { providerId: 'openai', modelId: 'gpt-4' }
    harness.modelClient.getCapabilities.mockReturnValueOnce(capabilities.promise)

    const filtering = harness.actions.onFilesChange([imageFile()])
    harness.sessionId.value = 's2'
    harness.actions.switchComposerSession('s1', 's2')
    capabilities.resolve({ supportsAudioInput: true })
    await filtering

    expect(harness.actions.attachedFiles.value).toEqual([])
    harness.sessionId.value = 's1'
    harness.actions.switchComposerSession('s2', 's1')
    expect(harness.actions.attachedFiles.value).toEqual([imageFile()])
    harness.stop()
  })

  it('restores text, duplicate files, skills, and the editor document per session', async () => {
    const harness = createHarness()
    const firstDocument: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'session one' }, { type: 'skillChip' }]
        }
      ]
    }
    harness.actions.message.value = 'session one'
    harness.actions.attachedFiles.value = [imageFile(), imageFile()]
    harness.pendingSkills.value = ['ocr-skill', 'review']
    harness.document.value = firstDocument
    harness.actions.recordComposerDocumentChange()

    harness.sessionId.value = 's2'
    harness.actions.switchComposerSession('s1', 's2')
    expect(harness.actions.message.value).toBe('')
    expect(harness.actions.attachedFiles.value).toEqual([])
    expect(harness.pendingSkills.value).toEqual([])

    harness.actions.message.value = 'session two'
    harness.document.value = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'session two' }] }]
    }
    harness.actions.recordComposerDocumentChange()

    harness.sessionId.value = 's1'
    harness.actions.switchComposerSession('s2', 's1')
    expect(harness.actions.message.value).toBe('session one')
    expect(harness.actions.attachedFiles.value).toHaveLength(2)
    expect(harness.pendingSkills.value).toEqual(['ocr-skill', 'review'])
    expect(harness.restoreDocumentSnapshot).toHaveBeenLastCalledWith(firstDocument)
    harness.stop()
  })

  it('subtracts only sent attachment multiplicities from a newer A-B-A draft', async () => {
    const harness = createHarness()
    const deferred = createDeferred<{ accepted: boolean }>()
    const duplicate = imageFile()
    const newFile: MessageFile = {
      name: 'new.png',
      path: '/tmp/new.png',
      mimeType: 'image/png'
    }
    harness.chatClient.sendMessage.mockReturnValueOnce(deferred.promise)
    harness.actions.message.value = 'original'
    harness.actions.attachedFiles.value = [duplicate, duplicate]

    const submit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.chatClient.sendMessage).toHaveBeenCalledTimes(1))

    harness.sessionId.value = 's2'
    harness.actions.switchComposerSession('s1', 's2')
    harness.sessionId.value = 's1'
    harness.actions.switchComposerSession('s2', 's1')
    harness.actions.message.value = 'new draft'
    harness.actions.attachedFiles.value = [duplicate, newFile, duplicate]

    deferred.resolve({ accepted: true })
    await submit

    expect(harness.actions.message.value).toBe('new draft')
    expect(harness.actions.attachedFiles.value).toEqual([newFile])
    harness.stop()
  })

  it('keeps a newer draft when an initial blocked recovery arrives late', async () => {
    const harness = createHarness()
    harness.actions.message.value = 'newer draft'
    harness.document.value = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'newer draft' }] }]
    }
    harness.actions.recordComposerDocumentChange()
    harness.chatClient.sendMessage.mockResolvedValueOnce({ accepted: true })

    harness.actions.restoreInitialBlockedDraft(
      { text: 'older recovery', files: [imageFile()], activeSkills: ['older-skill'] },
      blockedSummary()
    )

    expect(harness.actions.message.value).toBe('newer draft')
    expect(harness.actions.attachedFiles.value).toEqual([])
    expect(harness.actions.attachmentPreparationSummary.value).toEqual(blockedSummary())

    await harness.actions.sendWithoutImageContent()
    expect(harness.chatClient.sendMessage).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ text: 'older recovery' }),
      { submissionId: expect.any(String) }
    )
    expect(harness.actions.message.value).toBe('newer draft')
    harness.stop()
  })

  it('blocks duplicates and clears the draft only after acceptance', async () => {
    const steering = createDeferred<{ accepted: true; message: ChatMessageRecord }>()
    const harness = createHarness()
    harness.isGenerating.value = true
    harness.chatClient.steerActiveTurn.mockReturnValueOnce(steering.promise)
    harness.actions.message.value = 'tighten the answer'

    const request = harness.actions.onSteer()
    await vi.waitFor(() => expect(harness.chatClient.steerActiveTurn).toHaveBeenCalledTimes(1))

    expect(harness.actions.disableQueueSteerAction.value).toBe(true)
    expect(harness.actions.isQueueSubmitDisabled.value).toBe(true)

    await harness.actions.onSteer()
    expect(harness.chatClient.steerActiveTurn).toHaveBeenCalledTimes(1)

    const steerMessage = createSteerMessage()
    steering.resolve({ accepted: true, message: steerMessage })
    await request

    expect(harness.chatClient.steerActiveTurn).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ text: 'tighten the answer', files: [] })
    )
    expect(harness.messageStore.applyPersistedMessageRecords).toHaveBeenCalledWith([steerMessage])
    expect(harness.beginPlanTurn).toHaveBeenCalledWith('s1')
    expect(harness.actions.message.value).toBe('')
    harness.stop()
  })

  it('retains the draft and reports a failed request', async () => {
    const harness = createHarness()
    harness.isGenerating.value = true
    harness.chatClient.steerActiveTurn.mockRejectedValueOnce(new Error('boom'))
    harness.actions.message.value = 'keep this draft'

    await harness.actions.onSteer()

    expect(harness.beginPlanTurn).not.toHaveBeenCalled()
    expect(harness.actions.message.value).toBe('keep this draft')
    expect(harness.notify).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.attachment.uploadFailed',
      title: 'chat.input.fileUploadFailed',
      description: 'boom'
    })
    harness.stop()
  })

  it('does not clear a new draft when an old A-B-A request resolves', async () => {
    const steering = createDeferred<{ accepted: true; message: ChatMessageRecord }>()
    const harness = createHarness()
    harness.isGenerating.value = true
    harness.chatClient.steerActiveTurn.mockReturnValueOnce(steering.promise)
    harness.actions.message.value = 'old draft'

    const request = harness.actions.onSteer()
    await vi.waitFor(() => expect(harness.chatClient.steerActiveTurn).toHaveBeenCalledTimes(1))

    harness.sessionId.value = 's2'
    harness.actions.switchComposerSession('s1', 's2')
    harness.restoreRequestId.value += 1
    harness.sessionId.value = 's1'
    harness.actions.switchComposerSession('s2', 's1')
    harness.restoreRequestId.value += 1
    harness.actions.message.value = 'new draft'

    steering.resolve({ accepted: true, message: createSteerMessage() })
    await request

    expect(harness.beginPlanTurn).toHaveBeenCalledWith('s1')
    expect(harness.actions.message.value).toBe('new draft')
    harness.stop()
  })

  it('captures provider search intent before asynchronous attachment preparation', async () => {
    const harness = createHarness()
    harness.modelClient.getCapabilities.mockResolvedValue({
      supportsAudioInput: true,
      supportsSearch: true,
      searchExecution: 'provider'
    })
    harness.activeModelSelection.value = {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash'
    }
    await vi.waitFor(() => expect(harness.actions.isSearchAvailable.value).toBe(true))
    harness.actions.toggleSearch()

    const attachmentCapabilities = createDeferred<{
      supportsAudioInput: boolean
      supportsSearch: boolean
      searchExecution: 'provider'
    }>()
    harness.modelClient.getCapabilities.mockReturnValueOnce(attachmentCapabilities.promise)
    harness.actions.message.value = 'search this'
    harness.actions.attachedFiles.value = [imageFile()]

    const submit = harness.actions.onSubmit()
    await vi.waitFor(() => expect(harness.modelClient.getCapabilities).toHaveBeenCalledTimes(2))
    harness.actions.toggleSearch()
    attachmentCapabilities.resolve({
      supportsAudioInput: true,
      supportsSearch: true,
      searchExecution: 'provider'
    })
    await submit

    expect(harness.actions.isSearchEnabled.value).toBe(false)
    expect(harness.chatClient.sendMessage).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ text: 'search this', search: true }),
      { submissionId: expect.any(String) }
    )
    expect(harness.messageStore.addOptimisticUserMessage).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ search: true })
    )
    harness.stop()
  })

  it('observes the new-session search intent and retains it when the composer unmounts', async () => {
    const harness = createHarness()
    harness.sessionStore.setSearchIntent('s1', true)
    harness.modelClient.getCapabilities.mockResolvedValue({
      supportsAudioInput: true,
      supportsSearch: true,
      searchExecution: 'provider'
    })
    harness.activeModelSelection.value = {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash'
    }

    await vi.waitFor(() => expect(harness.actions.isSearchEnabled.value).toBe(true))
    harness.actions.dispose()

    expect(harness.sessionStore.getSearchIntent('s1')).toBe(true)
    harness.stop()
  })

  it('keeps search intent per session and ignores stale capability responses', async () => {
    const harness = createHarness()
    const first = createDeferred<{
      supportsAudioInput: boolean
      supportsSearch: boolean
      searchExecution?: 'provider'
    }>()
    const second = createDeferred<{
      supportsAudioInput: boolean
      supportsSearch: boolean
      searchExecution?: 'provider'
    }>()
    harness.modelClient.getCapabilities
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue({
        supportsAudioInput: true,
        supportsSearch: true,
        searchExecution: 'provider'
      })
    harness.activeModelSelection.value = {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash'
    }
    await vi.waitFor(() => expect(harness.modelClient.getCapabilities).toHaveBeenCalledTimes(1))

    harness.sessionId.value = 's2'
    harness.actions.switchComposerSession('s1', 's2')
    await vi.waitFor(() => expect(harness.modelClient.getCapabilities).toHaveBeenCalledTimes(2))
    second.resolve({
      supportsAudioInput: true,
      supportsSearch: true,
      searchExecution: 'provider'
    })
    await vi.waitFor(() => expect(harness.actions.isSearchAvailable.value).toBe(true))
    harness.actions.toggleSearch()

    first.resolve({ supportsAudioInput: true, supportsSearch: false })
    await nextTick()
    expect(harness.actions.isSearchAvailable.value).toBe(true)
    expect(harness.actions.isSearchEnabled.value).toBe(true)

    harness.sessionId.value = 's1'
    harness.actions.switchComposerSession('s2', 's1')
    await vi.waitFor(() => expect(harness.modelClient.getCapabilities).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(harness.actions.isSearchAvailable.value).toBe(true))
    expect(harness.actions.isSearchEnabled.value).toBe(false)
    harness.actions.toggleSearch()

    harness.sessionId.value = 's2'
    harness.actions.switchComposerSession('s1', 's2')
    await vi.waitFor(() => expect(harness.modelClient.getCapabilities).toHaveBeenCalledTimes(4))
    await vi.waitFor(() => expect(harness.actions.isSearchAvailable.value).toBe(true))
    expect(harness.actions.isSearchEnabled.value).toBe(true)
    harness.stop()
  })

  it('does not expose catalog-only search support without a provider execution path', async () => {
    const harness = createHarness()
    harness.modelClient.getCapabilities.mockResolvedValue({
      supportsAudioInput: true,
      supportsSearch: true
    })
    harness.activeModelSelection.value = {
      providerId: 'google',
      modelId: 'gemini-search-model'
    }

    await vi.waitFor(() => expect(harness.modelClient.getCapabilities).toHaveBeenCalledTimes(1))
    await nextTick()
    expect(harness.actions.isSearchAvailable.value).toBe(false)
    harness.actions.toggleSearch()
    harness.actions.message.value = 'do not search'
    await harness.actions.onSubmit()

    const payload = harness.chatClient.sendMessage.mock.calls[0]?.[1]
    expect(payload).not.toHaveProperty('search')
    harness.stop()
  })

  it('refreshes search capability when the active provider configuration changes', async () => {
    const harness = createHarness()
    const refreshedCapability = createDeferred<{
      supportsAudioInput: boolean
      supportsSearch: boolean
    }>()
    harness.modelClient.getCapabilities
      .mockResolvedValueOnce({
        supportsAudioInput: true,
        supportsSearch: true,
        searchExecution: 'provider'
      })
      .mockReturnValueOnce(refreshedCapability.promise)
    harness.activeModelSelection.value = {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash'
    }
    await vi.waitFor(() => expect(harness.actions.isSearchAvailable.value).toBe(true))

    harness.emitProvidersChanged({ providerIds: ['other-provider'] })
    expect(harness.modelClient.getCapabilities).toHaveBeenCalledTimes(1)

    harness.emitProvidersChanged({ providerIds: ['deepseek'] })
    await vi.waitFor(() => expect(harness.modelClient.getCapabilities).toHaveBeenCalledTimes(2))
    expect(harness.actions.isSearchAvailable.value).toBe(true)

    refreshedCapability.resolve({ supportsAudioInput: true, supportsSearch: false })
    await vi.waitFor(() => expect(harness.actions.isSearchAvailable.value).toBe(false))
    harness.stop()
  })

  it('persists the typed draft to storage after the debounce', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    try {
      harness.actions.message.value = 'persist me'
      await vi.advanceTimersByTimeAsync(400)

      const stored = JSON.parse(localStorage.getItem('deepchat.composerDraft.v1.s1') ?? 'null')
      expect(stored?.rawMessage).toBe('persist me')
    } finally {
      harness.stop()
      vi.useRealTimers()
    }
  })

  it('restores a persisted draft during initial mount', () => {
    saveComposerDraftToStorage('s1', {
      revision: 2,
      rawMessage: 'draft from previous mount',
      files: [],
      activeSkills: [],
      document: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'draft from previous mount' }] }
        ]
      }
    })

    const harness = createHarness()

    expect(harness.actions.message.value).toBe('draft from previous mount')
    harness.stop()
    expect(loadComposerDraftFromStorage('s1')?.rawMessage).toBe('draft from previous mount')
  })

  it('restores a persisted draft when switching to its session', () => {
    const harness = createHarness()
    saveComposerDraftToStorage('s2', {
      revision: 2,
      rawMessage: 'draft from previous run',
      files: [],
      activeSkills: [],
      document: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'draft from previous run' }] }
        ]
      }
    })

    harness.actions.switchComposerSession('s1', 's2')

    expect(harness.actions.message.value).toBe('draft from previous run')
    harness.stop()
  })

  it('persists the outgoing draft when switching away from a session', () => {
    const harness = createHarness()
    harness.actions.message.value = 'switch away'
    harness.actions.attachedFiles.value = []

    harness.actions.switchComposerSession('s1', 's2')

    const stored = JSON.parse(localStorage.getItem('deepchat.composerDraft.v1.s1') ?? 'null')
    expect(stored?.rawMessage).toBe('switch away')
    harness.stop()
  })

  it('restores a draft flushed on unmount when the same session is mounted again', () => {
    // ChatPage is keyed by sessionId, so switching conversations unmounts the old page. The
    // dispose() flush must persist the draft so a later mount of the same session restores it.
    const first = createHarness()
    first.actions.message.value = 'draft before unmount'
    first.stop()

    const second = createHarness()
    second.actions.switchComposerSession(undefined, 's1')

    expect(second.actions.message.value).toBe('draft before unmount')
    second.stop()
  })

  it('removes the stored draft after an accepted submission clears the composer', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    try {
      saveComposerDraftToStorage('s1', {
        revision: 1,
        rawMessage: 'to be sent',
        files: [],
        activeSkills: [],
        document: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'to be sent' }] }]
        }
      })
      harness.actions.message.value = 'to be sent'

      await harness.actions.onSubmit()

      expect(harness.actions.message.value).toBe('')
      await vi.advanceTimersByTimeAsync(400)
      expect(localStorage.getItem('deepchat.composerDraft.v1.s1')).toBeNull()
    } finally {
      harness.stop()
      vi.useRealTimers()
    }
  })
})
