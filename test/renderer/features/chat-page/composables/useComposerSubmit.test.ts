import { computed, effectScope, nextTick, ref } from 'vue'
import type { JSONContent } from '@tiptap/core'
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
      getActiveModelSelection: () => activeModelSelection.value,
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
    chatInputRef,
    inputHandle,
    sessionId,
    restoreRequestId,
    activeModelSelection,
    pendingSkills,
    inlineItems,
    document,
    messageStore,
    chatClient,
    modelClient,
    clearPendingSkills,
    setPendingSkills,
    restoreDocumentSnapshot,
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
    expect(harness.actions.attachedFiles.value).toEqual([])
    expect(harness.clearPendingSkills).not.toHaveBeenCalled()
    expect(harness.actions.isPreparingAttachments.value).toBe(false)
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
      expect.objectContaining({ text: 'original', activeSkills: ['ocr-skill'] })
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
      expect.objectContaining({ text: 'older recovery' })
    )
    expect(harness.actions.message.value).toBe('newer draft')
    harness.stop()
  })
})
