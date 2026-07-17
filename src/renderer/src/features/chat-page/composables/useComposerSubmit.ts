import { computed, ref, toRaw, type ComputedRef, type Ref } from 'vue'
import type { useMessageStore } from '@/stores/ui/message'
import type { useSessionStore } from '@/stores/ui/session'
import type { useModelStore } from '@/stores/modelStore'
import type { usePendingInputStore } from '@/stores/ui/pendingInput'
import { isManualCompactionCommand } from '@/components/chat/mentions/utils'
import { filterUnsupportedAudioAttachments } from '@/lib/audioInputSupport'
import type {
  MessageFile,
  SendMessageInput,
  UserMessageInlineItem
} from '@shared/types/agent-interface'

type MessageStore = ReturnType<typeof useMessageStore>
type SessionStore = ReturnType<typeof useSessionStore>
type ModelStore = ReturnType<typeof useModelStore>
type PendingInputStore = ReturnType<typeof usePendingInputStore>

type ChatClientLike = {
  sendMessage: (sessionId: string, payload: SendMessageInput) => Promise<unknown>
  steerActiveTurn: (sessionId: string, payload: SendMessageInput) => Promise<unknown>
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
  let attachmentFilterToken = 0

  const hasInputText = computed(() => Boolean(message.value.trim()))
  const hasAttachments = computed(() => attachedFiles.value.length > 0)
  const hasDraftInput = computed(() => hasInputText.value || hasAttachments.value)
  const isQueueSubmitDisabled = computed(
    () =>
      isSessionViewPreparing.value ||
      isAcpWorkdirMissing.value ||
      !hasDraftInput.value ||
      options.hasBlockingInteraction() ||
      pendingInputStore.isAtCapacity
  )
  const isInputSubmitDisabled = computed(
    () =>
      isSessionViewPreparing.value ||
      isAcpWorkdirMissing.value ||
      options.hasBlockingInteraction() ||
      (isGenerating.value && pendingInputStore.isAtCapacity) ||
      !hasDraftInput.value
  )
  const disableQueueSteerAction = computed(
    () =>
      isSessionViewPreparing.value ||
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
    if (options.hasBlockingInteraction()) return false
    return true
  }

  function beginOutgoingTurnFeedback(sessionId: string, payload: SendMessageInput) {
    const optimisticUserMessageId = messageStore.addOptimisticUserMessage(sessionId, payload)
    if (!optimisticUserMessageId) return null

    const pendingAssistantPlaceholderId = options.createPendingAssistantPlaceholder(sessionId)
    options.beginPlanTurn(sessionId)
    return { optimisticUserMessageId, pendingAssistantPlaceholderId }
  }

  async function sendMessageWithOutgoingTurnFeedback(
    sessionId: string,
    payload: SendMessageInput,
    feedback: NonNullable<ReturnType<typeof beginOutgoingTurnFeedback>>
  ) {
    try {
      await chatClient.sendMessage(sessionId, payload)
    } catch (error) {
      options.clearPendingAssistantPlaceholder(feedback.pendingAssistantPlaceholderId)
      messageStore.removeOptimisticMessage(feedback.optimisticUserMessageId, sessionId)
      console.error('[ChatPage] send message failed:', error)
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
    const restoreRequestId = options.currentRestoreRequestId()
    const text = message.value.trim()
    const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) => toRaw(f))
    if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
    if (!text && files.length === 0) return
    const handledCompaction = await handleManualCompactionCommand(text, sessionId, restoreRequestId)
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
      const feedback = beginOutgoingTurnFeedback(sessionId, payload)
      if (!feedback) return
      message.value = ''
      attachedFiles.value = []
      clearComposerSkills()
      options.schedulePostSubmitScrollToBottom()
      await sendMessageWithOutgoingTurnFeedback(sessionId, payload, feedback)
    }
  }

  async function onCommandSubmit(command: string) {
    if (!canSubmitNow()) return
    const sessionId = options.sessionId()
    const restoreRequestId = options.currentRestoreRequestId()
    const text = command.trim()
    if (!text) return

    const handledCompaction = await handleManualCompactionCommand(text, sessionId, restoreRequestId)
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
    const feedback = beginOutgoingTurnFeedback(sessionId, payload)
    if (!feedback) return
    attachedFiles.value = []
    clearComposerSkills()
    options.schedulePostSubmitScrollToBottom()
    await sendMessageWithOutgoingTurnFeedback(sessionId, payload, feedback)
  }

  async function onQueueSubmit() {
    if (!canSubmitNow()) return
    const sessionId = options.sessionId()
    const restoreRequestId = options.currentRestoreRequestId()
    const text = message.value.trim()
    const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) => toRaw(f))
    if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
    if (!text && files.length === 0) return
    const handledCompaction = await handleManualCompactionCommand(text, sessionId, restoreRequestId)
    if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
    if (handledCompaction) {
      return
    }
    await pendingInputStore.queueInput(sessionId, withMessageSkills(text, files))
    if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
    message.value = ''
    attachedFiles.value = []
    clearComposerSkills()
  }

  async function onSteer() {
    if (!canSubmitNow()) return
    const sessionId = options.sessionId()
    const restoreRequestId = options.currentRestoreRequestId()
    const text = message.value.trim()
    const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) => toRaw(f))
    if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
    if (!text && files.length === 0) return
    const handledCompaction = await handleManualCompactionCommand(text, sessionId, restoreRequestId)
    if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
    if (handledCompaction) {
      return
    }
    options.beginPlanTurn(sessionId)
    await chatClient.steerActiveTurn(sessionId, withMessageSkills(text, files))
    if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
    message.value = ''
    attachedFiles.value = []
    clearComposerSkills()
  }

  async function onFilesChange(files: MessageFile[]) {
    const token = ++attachmentFilterToken
    const filteredFiles = await prepareFilesForCurrentModel(files)
    if (token !== attachmentFilterToken) {
      return
    }

    attachedFiles.value = filteredFiles
  }

  /** Drops in-flight attachment filtering when the page unmounts. */
  function invalidatePendingAttachmentFilter(): void {
    attachmentFilterToken += 1
  }

  return {
    message,
    attachedFiles,
    hasDraftInput,
    isQueueSubmitDisabled,
    isInputSubmitDisabled,
    disableQueueSteerAction,
    onSubmit,
    onCommandSubmit,
    onQueueSubmit,
    onSteer,
    onFilesChange,
    invalidatePendingAttachmentFilter
  }
}
