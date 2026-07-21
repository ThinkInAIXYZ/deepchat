import { computed, ref, shallowReactive, toRaw, type ComputedRef, type Ref } from 'vue'
import type { useMessageStore } from '@/stores/ui/message'
import type { useSessionStore } from '@/stores/ui/session'
import type { useModelStore } from '@/stores/modelStore'
import type { usePendingInputStore } from '@/stores/ui/pendingInput'
import { isManualCompactionCommand } from '@/components/chat/mentions/utils'
import { filterUnsupportedAudioAttachments } from '@/lib/audioInputSupport'
import type {
  AttachmentFallbackPolicy,
  AttachmentPreparationSummary,
  MessageFile,
  SendMessageInput,
  UserMessageInlineItem
} from '@shared/types/agent-interface'
import { isImageAttachment } from '@shared/utils/attachmentRepresentation'

type MessageStore = ReturnType<typeof useMessageStore>
type SessionStore = ReturnType<typeof useSessionStore>
type ModelStore = ReturnType<typeof useModelStore>
type PendingInputStore = ReturnType<typeof usePendingInputStore>

type ChatClientLike = {
  sendMessage: (
    sessionId: string,
    payload: SendMessageInput
  ) => Promise<{
    accepted: boolean
    attachmentPreparation?: AttachmentPreparationSummary
  }>
  steerActiveTurn: (
    sessionId: string,
    payload: SendMessageInput
  ) => Promise<{
    accepted: boolean
    attachmentPreparation?: AttachmentPreparationSummary
  }>
}

type SessionClientLike = {
  compactSession: (sessionId: string) => Promise<{ compacted: boolean }>
}

type ModelClientLike = {
  getCapabilities: (
    providerId: string,
    modelId: string
  ) => Promise<{ supportsAudioInput?: boolean | null }>
}

type ComposerInputHandle = {
  getInlineItemsSnapshot?: () => UserMessageInlineItem[]
  getPendingSkillsSnapshot?: () => string[]
  clearPendingSkills?: () => void
  setPendingSkills?: (skillNames: string[]) => void
}

type ComposerAttemptMode = 'send' | 'steer'

type ComposerDraftSnapshot = {
  rawMessage: string
  files: MessageFile[]
  activeSkills: string[]
  inlineItems: UserMessageInlineItem[]
  clearText: boolean
}

type BlockedComposerAttempt = {
  sessionId: string
  mode: ComposerAttemptMode
  payload: SendMessageInput
  draft: ComposerDraftSnapshot
}

type ToastFn = (options: {
  title: string
  description?: string
  variant?: 'destructive'
}) => unknown

type UseComposerSubmitOptions = {
  sessionId: () => string
  /** Session-view write gate; both values captured before every await chain. */
  currentRestoreRequestId: () => number
  canWriteSessionView: (sessionId: string, restoreRequestId: number) => boolean
  messageStore: MessageStore
  sessionStore: SessionStore
  modelStore: ModelStore
  pendingInputStore: PendingInputStore
  chatClient: ChatClientLike
  sessionClient: SessionClientLike
  modelClient: ModelClientLike
  chatInputRef: Ref<ComposerInputHandle | null>
  isReadOnlySession: ComputedRef<boolean>
  isSessionViewPreparing: ComputedRef<boolean>
  isAcpWorkdirMissing: ComputedRef<boolean>
  isGenerating: ComputedRef<boolean>
  hasBlockingInteraction: () => boolean
  getActiveModelSelection: () => { providerId: string; modelId: string } | null
  /** Outgoing-turn UX: pending-assistant placeholder + plan turn reset. */
  createPendingAssistantPlaceholder: (sessionId: string) => string
  clearPendingAssistantPlaceholder: (id?: string) => void
  beginPlanTurn: (sessionId: string) => void
  schedulePostSubmitScrollToBottom: () => void
  loadMessagesForSession: (sessionId: string, count?: number) => Promise<unknown>
  applyRestoredSessionSummary: (session: unknown) => void
  openModelPicker: () => void
  toast: ToastFn
  t: (key: string, params?: Record<string, unknown>) => string
}

/**
 * Owns the composer draft (text + attachments) and every submit path — send,
 * queue, steer, slash-command, manual compaction — with the session-view write
 * gate re-checked after every await so a mid-flight session switch can never
 * write into the wrong session. Send-vs-queue-vs-steer priority given
 * `isGenerating` is decided here, in one place.
 */
export function useComposerSubmit(options: UseComposerSubmitOptions) {
  const {
    messageStore,
    sessionStore,
    modelStore,
    pendingInputStore,
    chatClient,
    sessionClient,
    modelClient,
    chatInputRef,
    isReadOnlySession,
    isSessionViewPreparing,
    isAcpWorkdirMissing,
    isGenerating,
    toast,
    t
  } = options

  const message = ref('')
  const attachedFiles = ref<MessageFile[]>([])
  const attachmentPreparationSummary = ref<AttachmentPreparationSummary | null>(null)
  const blockedComposerAttempt = ref<BlockedComposerAttempt | null>(null)
  const activeDispatches = shallowReactive(
    new Map<string, { token: number; preparesAttachments: boolean }>()
  )
  const activeSubmissionPreparations = shallowReactive(new Map<string, boolean>())
  let nextDispatchToken = 0
  let attachmentFilterToken = 0

  const isDispatchingInput = computed(
    () =>
      activeDispatches.has(options.sessionId()) ||
      activeSubmissionPreparations.has(options.sessionId())
  )
  const isPreparingAttachments = computed(
    () =>
      (activeDispatches.get(options.sessionId())?.preparesAttachments ?? false) ||
      (activeSubmissionPreparations.get(options.sessionId()) ?? false)
  )

  const hasInputText = computed(() => Boolean(message.value.trim()))
  const hasAttachments = computed(() => attachedFiles.value.length > 0)
  const hasDraftInput = computed(() => hasInputText.value || hasAttachments.value)
  const isQueueSubmitDisabled = computed(
    () =>
      isSessionViewPreparing.value ||
      isDispatchingInput.value ||
      isAcpWorkdirMissing.value ||
      !hasDraftInput.value ||
      options.hasBlockingInteraction() ||
      pendingInputStore.isAtCapacity
  )
  const isInputSubmitDisabled = computed(
    () =>
      isSessionViewPreparing.value ||
      isDispatchingInput.value ||
      isAcpWorkdirMissing.value ||
      options.hasBlockingInteraction() ||
      (isGenerating.value && pendingInputStore.isAtCapacity) ||
      !hasDraftInput.value
  )
  const disableQueueSteerAction = computed(
    () =>
      isSessionViewPreparing.value ||
      isDispatchingInput.value ||
      !isGenerating.value ||
      isAcpWorkdirMissing.value ||
      options.hasBlockingInteraction()
  )

  function notifyUnsupportedAudioAttachments(
    selection: { providerId: string; modelId: string },
    rejectedAudioFiles: MessageFile[]
  ) {
    if (rejectedAudioFiles.length === 0) {
      return
    }

    const modelLabel =
      modelStore.findChatSelectableModel(selection.providerId, selection.modelId)?.model.name ??
      selection.modelId

    toast({
      title: t('chat.input.audioInputUnsupportedTitle'),
      description: t('chat.input.audioInputUnsupportedDescription', {
        count: rejectedAudioFiles.length,
        model: modelLabel
      })
    })
  }

  async function prepareFilesForCurrentModel(files: MessageFile[]): Promise<MessageFile[]> {
    const selection = options.getActiveModelSelection()
    if (!selection || files.length === 0) {
      return files
    }

    try {
      const capabilities = await modelClient.getCapabilities(
        selection.providerId,
        selection.modelId
      )
      if (capabilities.supportsAudioInput !== false) {
        return files
      }

      const { acceptedFiles, rejectedAudioFiles } = filterUnsupportedAudioAttachments(files, false)
      notifyUnsupportedAudioAttachments(selection, rejectedAudioFiles)
      return acceptedFiles
    } catch (error) {
      console.warn('[ChatPage] Failed to resolve audio input capability:', error)
      return files
    }
  }

  const getComposerSkillsSnapshot = (): string[] => {
    return Array.from(new Set(chatInputRef.value?.getPendingSkillsSnapshot?.() ?? []))
  }

  const clearComposerSkills = () => {
    chatInputRef.value?.clearPendingSkills?.()
  }

  const getComposerInlineItemsSnapshot = (): UserMessageInlineItem[] => {
    return chatInputRef.value?.getInlineItemsSnapshot?.() ?? []
  }

  const withMessageSkills = (text: string, files: MessageFile[]) => {
    const activeSkills = getComposerSkillsSnapshot()
    const inlineItems = getComposerInlineItemsSnapshot()
    return {
      text,
      files,
      ...(activeSkills.length > 0 ? { activeSkills } : {}),
      ...(inlineItems.length > 0 ? { inlineItems } : {})
    }
  }

  function canSubmitNow(): boolean {
    if (isReadOnlySession.value) return false
    if (isSessionViewPreparing.value) return false
    if (isAcpWorkdirMissing.value) return false
    if (isDispatchingInput.value) return false
    if (options.hasBlockingInteraction()) return false
    return true
  }

  function beginSubmissionPreparation(sessionId: string): boolean {
    if (activeSubmissionPreparations.has(sessionId) || activeDispatches.has(sessionId)) {
      return false
    }
    activeSubmissionPreparations.set(sessionId, attachedFiles.value.some(isImageAttachment))
    return true
  }

  function endSubmissionPreparation(sessionId: string): void {
    activeSubmissionPreparations.delete(sessionId)
  }

  function copyFiles(files: MessageFile[]): MessageFile[] {
    return files.map((file) => ({
      ...file,
      ...(file.metadata ? { metadata: { ...file.metadata } } : {})
    }))
  }

  function filesMatch(left: MessageFile[], right: MessageFile[]): boolean {
    if (left.length !== right.length) return false
    return left.every((file, index) => {
      const other = right[index]
      return (
        Boolean(other) &&
        file.name === other.name &&
        file.path === other.path &&
        (file.mimeType ?? '') === (other.mimeType ?? '') &&
        (file.requestedRepresentation ?? 'auto') === (other.requestedRepresentation ?? 'auto')
      )
    })
  }

  function stringArraysMatch(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }

  function copyInlineItems(items: UserMessageInlineItem[]): UserMessageInlineItem[] {
    return items.map((item) => ({ ...item }))
  }

  function inlineItemsMatch(
    left: UserMessageInlineItem[],
    right: UserMessageInlineItem[]
  ): boolean {
    if (left.length !== right.length) return false
    return left.every((item, index) => {
      const other = right[index]
      if (!other || item.type !== other.type || item.offset !== other.offset) return false
      if (item.type === 'skill' && other.type === 'skill') {
        return item.skillName === other.skillName
      }
      if (item.type === 'file' && other.type === 'file') {
        return (
          item.fileName === other.fileName &&
          item.filePath === other.filePath &&
          (item.mimeType ?? '') === (other.mimeType ?? '')
        )
      }
      return false
    })
  }

  function createDraftSnapshot(
    rawMessage: string,
    payload: SendMessageInput,
    clearText: boolean
  ): ComposerDraftSnapshot {
    return {
      rawMessage,
      files: copyFiles(payload.files ?? []),
      activeSkills: [...(payload.activeSkills ?? [])],
      inlineItems: copyInlineItems(payload.inlineItems ?? []),
      clearText
    }
  }

  function currentDraftMatches(snapshot: ComposerDraftSnapshot): boolean {
    return (
      message.value === snapshot.rawMessage &&
      filesMatch(attachedFiles.value, snapshot.files) &&
      stringArraysMatch(getComposerSkillsSnapshot(), snapshot.activeSkills) &&
      inlineItemsMatch(getComposerInlineItemsSnapshot(), snapshot.inlineItems)
    )
  }

  function clearAcceptedDraft(snapshot: ComposerDraftSnapshot): void {
    if (!currentDraftMatches(snapshot)) {
      return
    }

    if (snapshot.clearText) {
      message.value = ''
    }
    attachedFiles.value = []
    clearComposerSkills()
  }

  function fallbackPreparationSummary(): AttachmentPreparationSummary {
    return {
      status: 'needs_user_action',
      issues: [],
      suggestedActions: ['retry', 'send_without_image_content']
    }
  }

  function beginOutgoingTurnFeedback(sessionId: string, payload: SendMessageInput) {
    const optimisticUserMessageId = messageStore.addOptimisticUserMessage(sessionId, payload)
    if (!optimisticUserMessageId) return null

    const pendingAssistantPlaceholderId = options.createPendingAssistantPlaceholder(sessionId)
    return { optimisticUserMessageId, pendingAssistantPlaceholderId }
  }

  function clearOutgoingTurnFeedback(
    sessionId: string,
    feedback: NonNullable<ReturnType<typeof beginOutgoingTurnFeedback>>
  ): void {
    options.clearPendingAssistantPlaceholder(feedback.pendingAssistantPlaceholderId)
    messageStore.removeOptimisticMessage(feedback.optimisticUserMessageId, sessionId)
  }

  async function dispatchComposerAttempt(
    attempt: BlockedComposerAttempt,
    fallbackPolicy?: AttachmentFallbackPolicy
  ): Promise<boolean> {
    const sessionId = attempt.sessionId
    if (activeDispatches.has(sessionId)) {
      return false
    }

    const restoreRequestId = options.currentRestoreRequestId()
    const payload: SendMessageInput = {
      ...attempt.payload,
      files: copyFiles(attempt.payload.files ?? []),
      ...(fallbackPolicy ? { attachmentFallbackPolicy: fallbackPolicy } : {})
    }
    const hasImageAttachment = (payload.files ?? []).some(isImageAttachment)
    const dispatchToken = ++nextDispatchToken
    activeDispatches.set(sessionId, {
      token: dispatchToken,
      preparesAttachments: hasImageAttachment
    })

    const feedback = attempt.mode === 'send' ? beginOutgoingTurnFeedback(sessionId, payload) : null
    if (attempt.mode === 'send' && !feedback) {
      activeDispatches.delete(sessionId)
      return false
    }

    try {
      const result =
        attempt.mode === 'send'
          ? await chatClient.sendMessage(sessionId, payload)
          : await chatClient.steerActiveTurn(sessionId, payload)

      if (!result.accepted) {
        if (feedback) {
          clearOutgoingTurnFeedback(sessionId, feedback)
        }
        if (options.canWriteSessionView(sessionId, restoreRequestId)) {
          blockedComposerAttempt.value = attempt
          attachmentPreparationSummary.value =
            result.attachmentPreparation ?? fallbackPreparationSummary()
        }
        return false
      }

      options.beginPlanTurn(sessionId)
      if (options.canWriteSessionView(sessionId, restoreRequestId)) {
        blockedComposerAttempt.value = null
        attachmentPreparationSummary.value = null
        clearAcceptedDraft(attempt.draft)
        options.schedulePostSubmitScrollToBottom()
      }
      return true
    } catch (error) {
      if (feedback) {
        clearOutgoingTurnFeedback(sessionId, feedback)
      }
      console.error(
        attempt.mode === 'send'
          ? '[ChatPage] send message failed:'
          : '[ChatPage] steer message failed:',
        error
      )
      return false
    } finally {
      if (activeDispatches.get(sessionId)?.token === dispatchToken) {
        activeDispatches.delete(sessionId)
      }
    }
  }

  async function handleManualCompactionCommand(
    text: string,
    sessionId: string,
    restoreRequestId: number
  ): Promise<boolean> {
    if (!isManualCompactionCommand(text)) {
      return false
    }
    if (sessionStore.activeSession?.providerId === 'acp') {
      return false
    }
    if (isGenerating.value) {
      return true
    }
    if (!options.canWriteSessionView(sessionId, restoreRequestId)) {
      return true
    }

    try {
      const result = await sessionClient.compactSession(sessionId)
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return true
      const restoredSession = await options.loadMessagesForSession(sessionId)
      if (!options.canWriteSessionView(sessionId, restoreRequestId) || restoredSession === null) {
        return true
      }
      options.applyRestoredSessionSummary(restoredSession)
      if (!result.compacted) {
        toast({
          title: t('chat.compaction.noopTitle'),
          description: t('chat.compaction.noopDescription')
        })
      }
    } catch (error) {
      console.error('[ChatPage] manual compaction failed:', error)
      toast({
        title: t('chat.compaction.failedTitle'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      })
    }
    return true
  }

  async function onSubmit() {
    if (!canSubmitNow()) return
    const sessionId = options.sessionId()
    if (!beginSubmissionPreparation(sessionId)) return
    try {
      const restoreRequestId = options.currentRestoreRequestId()
      const rawMessage = message.value
      const text = message.value.trim()
      const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) =>
        toRaw(f)
      )
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (!text && files.length === 0) return
      const handledCompaction = await handleManualCompactionCommand(
        text,
        sessionId,
        restoreRequestId
      )
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (handledCompaction) {
        if (!isGenerating.value) {
          message.value = ''
        }
        return
      }
      const payload = withMessageSkills(text, files)
      if (isGenerating.value) {
        await pendingInputStore.queueInput(sessionId, payload)
        if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
        message.value = ''
        attachedFiles.value = []
        clearComposerSkills()
        options.schedulePostSubmitScrollToBottom()
      } else {
        await dispatchComposerAttempt({
          sessionId,
          mode: 'send',
          payload,
          draft: createDraftSnapshot(rawMessage, payload, true)
        })
      }
    } finally {
      endSubmissionPreparation(sessionId)
    }
  }

  async function onCommandSubmit(command: string) {
    if (!canSubmitNow()) return
    const sessionId = options.sessionId()
    const text = command.trim()
    if (!text) return
    if (!beginSubmissionPreparation(sessionId)) return
    try {
      const restoreRequestId = options.currentRestoreRequestId()
      const handledCompaction = await handleManualCompactionCommand(
        text,
        sessionId,
        restoreRequestId
      )
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (handledCompaction) {
        return
      }

      const files = await prepareFilesForCurrentModel([...attachedFiles.value])
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      const payload = withMessageSkills(text, files)
      if (isGenerating.value) {
        await pendingInputStore.queueInput(sessionId, payload)
        if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
        attachedFiles.value = []
        clearComposerSkills()
        options.schedulePostSubmitScrollToBottom()
        return
      }
      await dispatchComposerAttempt({
        sessionId,
        mode: 'send',
        payload,
        draft: createDraftSnapshot(message.value, payload, false)
      })
    } finally {
      endSubmissionPreparation(sessionId)
    }
  }

  async function onQueueSubmit() {
    if (!canSubmitNow()) return
    const sessionId = options.sessionId()
    if (!beginSubmissionPreparation(sessionId)) return
    try {
      const restoreRequestId = options.currentRestoreRequestId()
      const text = message.value.trim()
      const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) =>
        toRaw(f)
      )
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (!text && files.length === 0) return
      const handledCompaction = await handleManualCompactionCommand(
        text,
        sessionId,
        restoreRequestId
      )
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (handledCompaction) {
        return
      }
      await pendingInputStore.queueInput(sessionId, withMessageSkills(text, files))
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      message.value = ''
      attachedFiles.value = []
      clearComposerSkills()
    } finally {
      endSubmissionPreparation(sessionId)
    }
  }

  async function onSteer() {
    if (!canSubmitNow()) return
    const sessionId = options.sessionId()
    if (!beginSubmissionPreparation(sessionId)) return
    try {
      const restoreRequestId = options.currentRestoreRequestId()
      const rawMessage = message.value
      const text = message.value.trim()
      const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) =>
        toRaw(f)
      )
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (!text && files.length === 0) return
      const handledCompaction = await handleManualCompactionCommand(
        text,
        sessionId,
        restoreRequestId
      )
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (handledCompaction) {
        return
      }
      const payload = withMessageSkills(text, files)
      await dispatchComposerAttempt({
        sessionId,
        mode: 'steer',
        payload,
        draft: createDraftSnapshot(rawMessage, payload, true)
      })
    } finally {
      endSubmissionPreparation(sessionId)
    }
  }

  async function onFilesChange(files: MessageFile[]) {
    const token = ++attachmentFilterToken
    const filteredFiles = await prepareFilesForCurrentModel(files)
    if (token !== attachmentFilterToken) {
      return
    }

    attachedFiles.value = filteredFiles
  }

  function restoreInitialBlockedDraft(
    input: SendMessageInput,
    summary: AttachmentPreparationSummary
  ): void {
    const payload: SendMessageInput = {
      text: input.text,
      files: copyFiles(input.files ?? []),
      ...(input.activeSkills ? { activeSkills: [...input.activeSkills] } : {}),
      ...(input.inlineItems ? { inlineItems: input.inlineItems.map((item) => ({ ...item })) } : {})
    }
    message.value = input.text
    attachedFiles.value = copyFiles(payload.files ?? [])
    chatInputRef.value?.setPendingSkills?.(payload.activeSkills ?? [])
    blockedComposerAttempt.value = {
      sessionId: options.sessionId(),
      mode: 'send',
      payload,
      draft: createDraftSnapshot(input.text, payload, true)
    }
    attachmentPreparationSummary.value = summary
  }

  function cancelAttachmentPreparation(): void {
    if (isDispatchingInput.value) {
      return
    }
    blockedComposerAttempt.value = null
    attachmentPreparationSummary.value = null
  }

  function clearAttachmentPreparationForSessionChange(): void {
    blockedComposerAttempt.value = null
    attachmentPreparationSummary.value = null
  }

  async function retryAttachmentPreparation(): Promise<void> {
    const attempt = blockedComposerAttempt.value
    if (!attempt || attempt.sessionId !== options.sessionId()) {
      clearAttachmentPreparationForSessionChange()
      return
    }
    await dispatchComposerAttempt(attempt)
  }

  async function sendWithoutImageContent(): Promise<void> {
    const attempt = blockedComposerAttempt.value
    if (!attempt || attempt.sessionId !== options.sessionId()) {
      clearAttachmentPreparationForSessionChange()
      return
    }
    await dispatchComposerAttempt(attempt, 'send_without_image_content')
  }

  function switchToVisionModel(): void {
    cancelAttachmentPreparation()
    options.openModelPicker()
  }

  /** Drops in-flight attachment filtering when the page unmounts. */
  function invalidatePendingAttachmentFilter(): void {
    attachmentFilterToken += 1
  }

  return {
    message,
    attachedFiles,
    attachmentPreparationSummary,
    isPreparingAttachments,
    hasDraftInput,
    isQueueSubmitDisabled,
    isInputSubmitDisabled,
    disableQueueSteerAction,
    onSubmit,
    onCommandSubmit,
    onQueueSubmit,
    onSteer,
    onFilesChange,
    restoreInitialBlockedDraft,
    cancelAttachmentPreparation,
    retryAttachmentPreparation,
    sendWithoutImageContent,
    switchToVisionModel,
    clearAttachmentPreparationForSessionChange,
    invalidatePendingAttachmentFilter
  }
}
