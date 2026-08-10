import { computed, nextTick, ref, shallowReactive, watch, type ComputedRef, type Ref } from 'vue'
import type { JSONContent } from '@tiptap/core'
import { nanoid } from 'nanoid'
import type { useMessageStore } from '@/stores/ui/message'
import type { useSessionStore } from '@/stores/ui/session'
import type { useModelStore } from '@/stores/modelStore'
import type { usePendingInputStore } from '@/stores/ui/pendingInput'
import { isManualCompactionCommand } from '@/components/chat/mentions/utils'
import { filterUnsupportedAudioAttachments } from '@/lib/audioInputSupport'
import { isAbortError } from '@/lib/errors'
import type {
  AttachmentFallbackPolicy,
  AttachmentPreparationSummary,
  ChatMessageRecord,
  MessageFile,
  SendMessageInput,
  UserMessageInlineItem
} from '@shared/types/agent-interface'
import type { CapabilitySnapshotQuery } from '@shared/types/model-capabilities'
import { isAttachmentPreparationCandidate } from '@shared/utils/attachmentRepresentation'
import { switchAttachmentToVisionModel } from '@/components/chat/attachmentModelPicker'
import {
  applyAcceptedComposerSubmission,
  composerDraftFingerprint,
  copyComposerDocument,
  copyComposerDraft,
  copyComposerFiles,
  createComposerTextDocument,
  createEmptyComposerDraft,
  isComposerDraftEmpty,
  retainComposerDocumentFiles,
  type ComposerSessionDraft,
  type ComposerSubmissionSnapshot
} from '../model/composerDraftState'
import {
  DRAFT_PERSISTENCE_DEBOUNCE_MS,
  loadComposerDraftFromStorage,
  saveComposerDraftToStorage
} from '../model/composerDraftPersistence'
import type { RendererNotificationNotifier } from '@renderer-notifications/rendererNotificationPort'

type MessageStore = ReturnType<typeof useMessageStore>
type SessionStore = ReturnType<typeof useSessionStore>
type ModelStore = ReturnType<typeof useModelStore>
type PendingInputStore = ReturnType<typeof usePendingInputStore>

type ChatClientLike = {
  sendMessage: (
    sessionId: string,
    payload: SendMessageInput,
    options?: { submissionId?: string }
  ) => Promise<{
    accepted: boolean
    requestId: string | null
    messageId: string | null
    attachmentPreparation?: AttachmentPreparationSummary
  }>
  steerActiveTurn: (
    sessionId: string,
    payload: SendMessageInput,
    options?: { submissionId?: string }
  ) => Promise<
    | {
        accepted: true
        message: ChatMessageRecord
        attachmentPreparation?: AttachmentPreparationSummary
      }
    | {
        accepted: false
        message: null
        attachmentPreparation?: AttachmentPreparationSummary
      }
  >
  cancelSubmission: (submissionId: string) => Promise<{ cancelled: boolean }>
}

type SessionClientLike = {
  compactSession: (sessionId: string) => Promise<{ compacted: boolean }>
}

type ModelClientLike = {
  getCapabilities: (query: CapabilitySnapshotQuery) => Promise<{
    supportsAudioInput: boolean
    supportsSearch?: boolean
    searchExecution?: 'provider'
  }>
}

type ProviderClientLike = {
  onProvidersChanged: (listener: (payload: { providerIds?: string[] }) => void) => () => void
}

type ComposerInputHandle = {
  getInlineItemsSnapshot?: () => UserMessageInlineItem[]
  getPendingSkillsSnapshot?: () => string[]
  clearPendingSkills?: () => void
  setPendingSkills?: (skillNames: string[]) => void
  getDocumentSnapshot?: () => JSONContent
  restoreDocumentSnapshot?: (document: JSONContent) => void
}

type ComposerAttemptMode = 'send' | 'steer'

type BlockedComposerAttempt = {
  sessionId: string
  mode: ComposerAttemptMode
  payload: SendMessageInput
  draft: ComposerSubmissionSnapshot
}

type ComposerSubmissionSeed = {
  draft: ComposerSessionDraft
  inlineItems: UserMessageInlineItem[]
  search: boolean
}

type ActiveSearchCapability = {
  sessionId: string
  providerId: string
  modelId: string
  supported: boolean
}

type ActiveSubmissionPreparation = {
  submissionId: string
  preparesAttachments: boolean
  cancelled: boolean
  mainDispatched: boolean
}

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
  providerClient: ProviderClientLike
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
  notify: RendererNotificationNotifier
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
    providerClient,
    chatInputRef,
    isReadOnlySession,
    isSessionViewPreparing,
    isAcpWorkdirMissing,
    isGenerating,
    notify,
    t
  } = options

  const message = ref('')
  const attachedFiles = ref<MessageFile[]>([])
  const sessionDrafts = new Map<string, ComposerSessionDraft>()
  const draftRevisions = new Map<string, number>()
  const observedDraftFingerprints = new Map<string, string>()
  const observedSkillSelections = new Map<string, string[]>()
  const pendingAcceptedSubmissions = new Map<string, ComposerSubmissionSnapshot[]>()
  const blockedComposerAttempts = shallowReactive(
    new Map<string, { attempt: BlockedComposerAttempt; summary: AttachmentPreparationSummary }>()
  )
  const activeDispatches = shallowReactive(
    new Map<string, { token: number; preparesAttachments: boolean }>()
  )
  const activeSubmissionPreparations = shallowReactive(
    new Map<string, ActiveSubmissionPreparation>()
  )
  const attachmentFilterTokens = new Map<string, number>()
  const activeSearchCapability = ref<ActiveSearchCapability | null>(null)
  const steeringSessionIds = ref<Set<string>>(new Set())
  let activeDraftSessionId = options.sessionId()
  let nextDraftRevision = 0
  let nextDispatchToken = 0
  let suppressedDraftMutations = 0
  let pendingHandleRestoreSessionId: string | null = null
  let searchCapabilityRequestId = 0

  const storedInitialDraft = loadComposerDraftFromStorage(activeDraftSessionId)
  const initialDraft = storedInitialDraft ?? createEmptyComposerDraft()
  if (storedInitialDraft) {
    sessionDrafts.set(activeDraftSessionId, copyComposerDraft(storedInitialDraft))
  }
  draftRevisions.set(activeDraftSessionId, initialDraft.revision)
  observedDraftFingerprints.set(activeDraftSessionId, composerDraftFingerprint(initialDraft))
  observedSkillSelections.set(activeDraftSessionId, [...initialDraft.activeSkills])
  if (storedInitialDraft) {
    message.value = storedInitialDraft.rawMessage
    attachedFiles.value = copyComposerFiles(storedInitialDraft.files)
    if (chatInputRef.value) {
      if (storedInitialDraft.activeSkills.length === 0) {
        chatInputRef.value.clearPendingSkills?.()
      } else {
        chatInputRef.value.setPendingSkills?.([...storedInitialDraft.activeSkills])
      }
      chatInputRef.value.restoreDocumentSnapshot?.(
        copyComposerDocument(storedInitialDraft.document)
      )
    } else {
      pendingHandleRestoreSessionId = activeDraftSessionId
    }
  }

  const attachmentPreparationSummary = computed(
    () => blockedComposerAttempts.get(options.sessionId())?.summary ?? null
  )

  const isDispatchingInput = computed(
    () =>
      activeDispatches.has(options.sessionId()) ||
      activeSubmissionPreparations.has(options.sessionId())
  )
  const isPreparingAttachments = computed(
    () =>
      (activeDispatches.get(options.sessionId())?.preparesAttachments ?? false) ||
      (activeSubmissionPreparations.get(options.sessionId())?.preparesAttachments ?? false)
  )

  const hasInputText = computed(() => Boolean(message.value.trim()))
  const hasAttachments = computed(() => attachedFiles.value.length > 0)
  const hasDraftInput = computed(() => hasInputText.value || hasAttachments.value)
  const isSteering = computed(() => steeringSessionIds.value.has(options.sessionId()))
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
      options.hasBlockingInteraction() ||
      isSteering.value
  )

  const isSearchAvailable = computed(() => {
    const capability = activeSearchCapability.value
    const selection = options.getActiveModelSelection()
    return Boolean(
      capability?.supported &&
      selection &&
      capability.sessionId === options.sessionId() &&
      capability.providerId === selection.providerId &&
      capability.modelId === selection.modelId
    )
  })
  const isSearchEnabled = computed(
    () => isSearchAvailable.value && sessionStore.getSearchIntent(options.sessionId())
  )

  function refreshSearchCapability(sessionId: string, providerId: string, modelId: string): void {
    const requestId = ++searchCapabilityRequestId
    const currentCapability = activeSearchCapability.value
    const isSameSelection =
      currentCapability?.sessionId === sessionId &&
      currentCapability.providerId === providerId &&
      currentCapability.modelId === modelId
    if (!isSameSelection) {
      activeSearchCapability.value = null
    }
    if (!providerId || !modelId) return

    void modelClient
      .getCapabilities({ providerId, modelId })
      .then((capability) => {
        if (requestId !== searchCapabilityRequestId) return
        const currentSelection = options.getActiveModelSelection()
        if (
          options.sessionId() !== sessionId ||
          currentSelection?.providerId !== providerId ||
          currentSelection.modelId !== modelId
        ) {
          return
        }
        activeSearchCapability.value = {
          sessionId,
          providerId,
          modelId,
          supported: capability.supportsSearch === true && capability.searchExecution === 'provider'
        }
      })
      .catch((error) => {
        if (requestId !== searchCapabilityRequestId) return
        activeSearchCapability.value = null
        console.warn('[ChatPage] Failed to resolve provider search capability:', error)
      })
  }

  const stopSearchCapabilityWatch = watch(
    () => {
      const selection = options.getActiveModelSelection()
      return [options.sessionId(), selection?.providerId ?? '', selection?.modelId ?? ''] as const
    },
    ([sessionId, providerId, modelId]) => {
      refreshSearchCapability(sessionId, providerId, modelId)
    },
    { immediate: true }
  )
  const removeProvidersChangedListener = providerClient.onProvidersChanged((payload) => {
    const selection = options.getActiveModelSelection()
    if (
      !selection ||
      (payload.providerIds && !payload.providerIds.includes(selection.providerId))
    ) {
      return
    }
    refreshSearchCapability(options.sessionId(), selection.providerId, selection.modelId)
  })

  function toggleSearch(): void {
    if (!isSearchAvailable.value) return
    sessionStore.toggleSearchIntent(options.sessionId())
  }

  function setSteering(sessionId: string, pending: boolean): void {
    const next = new Set(steeringSessionIds.value)
    if (pending) {
      next.add(sessionId)
    } else {
      next.delete(sessionId)
    }
    steeringSessionIds.value = next
  }

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

    notify({
      kind: 'warning',
      code: 'chat.audio.unsupported',
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
      const capabilities = await modelClient.getCapabilities(selection)
      if (capabilities.supportsAudioInput) {
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

  const getComposerInlineItemsSnapshot = (): UserMessageInlineItem[] => {
    return chatInputRef.value?.getInlineItemsSnapshot?.() ?? []
  }

  const createSubmissionPayload = (
    text: string,
    files: MessageFile[],
    seed: ComposerSubmissionSeed
  ): SendMessageInput => {
    const activeSkills = seed.draft.activeSkills
    const inlineItems = seed.inlineItems
    return {
      text,
      files: copyComposerFiles(files),
      ...(seed.search ? { search: true } : {}),
      ...(activeSkills.length > 0 ? { activeSkills: [...activeSkills] } : {}),
      ...(inlineItems.length > 0 ? { inlineItems: copyInlineItems(inlineItems) } : {})
    }
  }

  function canSubmitNow(): boolean {
    if (isReadOnlySession.value) return false
    if (isSteering.value) return false
    if (isSessionViewPreparing.value) return false
    if (isAcpWorkdirMissing.value) return false
    if (isDispatchingInput.value) return false
    if (options.hasBlockingInteraction()) return false
    return true
  }

  function beginSubmissionPreparation(sessionId: string): ActiveSubmissionPreparation | null {
    if (activeSubmissionPreparations.has(sessionId) || activeDispatches.has(sessionId)) {
      return null
    }
    const preparation: ActiveSubmissionPreparation = {
      submissionId: nanoid(),
      preparesAttachments:
        sessionStore.activeSession?.providerId !== 'acp' &&
        attachedFiles.value.some(isAttachmentPreparationCandidate),
      cancelled: false,
      mainDispatched: false
    }
    activeSubmissionPreparations.set(sessionId, preparation)
    return preparation
  }

  function endSubmissionPreparation(
    sessionId: string,
    preparation: ActiveSubmissionPreparation
  ): void {
    if (activeSubmissionPreparations.get(sessionId) === preparation) {
      activeSubmissionPreparations.delete(sessionId)
    }
  }

  function stringArraysMatch(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }

  function copyInlineItems(items: UserMessageInlineItem[]): UserMessageInlineItem[] {
    return items.map((item) => ({ ...item }))
  }

  function createDraftSnapshot(
    seed: ComposerSubmissionSeed,
    payload: SendMessageInput,
    clearText: boolean
  ): ComposerSubmissionSnapshot {
    return {
      revision: seed.draft.revision,
      rawMessage: seed.draft.rawMessage,
      files: copyComposerFiles(payload.files ?? []),
      activeSkills: [...(payload.activeSkills ?? [])],
      document: copyComposerDocument(seed.draft.document),
      inlineItems: copyInlineItems(payload.inlineItems ?? []),
      clearText
    }
  }

  function nextRevision(sessionId: string): number {
    const revision = ++nextDraftRevision
    draftRevisions.set(sessionId, revision)
    return revision
  }

  function getComposerDocumentSnapshot(rawMessage: string): JSONContent {
    const document = chatInputRef.value?.getDocumentSnapshot?.()
    return copyComposerDocument(document ?? createComposerTextDocument(rawMessage))
  }

  let composerDraftPersistTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Read-only snapshot of the live composer for persistence. Unlike `captureLiveDraft` it never
   * bumps revisions or fingerprints, so a debounced background timer cannot perturb draft tracking.
   */
  function captureDraftForPersistence(sessionId: string): ComposerSessionDraft {
    const deferredDraft =
      !chatInputRef.value && pendingHandleRestoreSessionId === sessionId
        ? sessionDrafts.get(sessionId)
        : undefined
    return {
      revision: draftRevisions.get(sessionId) ?? 0,
      rawMessage: message.value,
      files: copyComposerFiles(attachedFiles.value),
      activeSkills: deferredDraft ? [...deferredDraft.activeSkills] : getComposerSkillsSnapshot(),
      document: deferredDraft
        ? copyComposerDocument(deferredDraft.document)
        : getComposerDocumentSnapshot(message.value)
    }
  }

  function persistComposerDraft(sessionId: string): void {
    if (!sessionId) {
      return
    }
    saveComposerDraftToStorage(sessionId, captureDraftForPersistence(sessionId))
  }

  function scheduleComposerDraftPersist(sessionId: string): void {
    if (!sessionId) {
      return
    }
    if (composerDraftPersistTimer) {
      clearTimeout(composerDraftPersistTimer)
    }
    composerDraftPersistTimer = setTimeout(() => {
      composerDraftPersistTimer = null
      persistComposerDraft(sessionId)
    }, DRAFT_PERSISTENCE_DEBOUNCE_MS)
  }

  function flushComposerDraftPersist(): void {
    if (composerDraftPersistTimer) {
      clearTimeout(composerDraftPersistTimer)
      composerDraftPersistTimer = null
    }
    if (activeDraftSessionId) {
      persistComposerDraft(activeDraftSessionId)
    }
  }

  // Window teardown (app close / crash-free reload) can bypass the component unmount hook in
  // Electron, so flush synchronously on pagehide/beforeunload as well.
  const flushComposerDraftOnPageHide = () => flushComposerDraftPersist()
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushComposerDraftOnPageHide)
    window.addEventListener('beforeunload', flushComposerDraftOnPageHide)
  }

  function captureLiveDraft(sessionId: string): ComposerSessionDraft {
    let revision = draftRevisions.get(sessionId) ?? 0
    const deferredDraft =
      !chatInputRef.value && pendingHandleRestoreSessionId === sessionId
        ? sessionDrafts.get(sessionId)
        : undefined
    const draft: ComposerSessionDraft = {
      revision,
      rawMessage: message.value,
      files: copyComposerFiles(attachedFiles.value),
      activeSkills: deferredDraft ? [...deferredDraft.activeSkills] : getComposerSkillsSnapshot(),
      document: deferredDraft
        ? copyComposerDocument(deferredDraft.document)
        : getComposerDocumentSnapshot(message.value)
    }
    const fingerprint = composerDraftFingerprint(draft)
    const observedFingerprint = observedDraftFingerprints.get(sessionId)
    if (
      suppressedDraftMutations === 0 &&
      observedFingerprint !== undefined &&
      observedFingerprint !== fingerprint
    ) {
      revision = nextRevision(sessionId)
      draft.revision = revision
    }
    observedDraftFingerprints.set(sessionId, fingerprint)
    draftRevisions.set(sessionId, revision)
    observedSkillSelections.set(sessionId, [...draft.activeSkills])
    return draft
  }

  function captureSubmissionSeed(sessionId: string): ComposerSubmissionSeed {
    return {
      draft: captureLiveDraft(sessionId),
      inlineItems: copyInlineItems(getComposerInlineItemsSnapshot()),
      search:
        sessionId === options.sessionId() &&
        isSearchAvailable.value &&
        sessionStore.getSearchIntent(sessionId)
    }
  }

  function applyLiveDraft(sessionId: string, draft: ComposerSessionDraft): void {
    const copiedDraft = copyComposerDraft(draft)
    suppressedDraftMutations += 1
    activeDraftSessionId = sessionId
    draftRevisions.set(sessionId, copiedDraft.revision)
    observedSkillSelections.set(sessionId, [...copiedDraft.activeSkills])
    observedDraftFingerprints.set(sessionId, composerDraftFingerprint(copiedDraft))
    sessionDrafts.set(sessionId, copyComposerDraft(copiedDraft))
    message.value = copiedDraft.rawMessage
    attachedFiles.value = copyComposerFiles(copiedDraft.files)
    const inputHandle = chatInputRef.value
    if (!inputHandle) {
      pendingHandleRestoreSessionId = sessionId
    } else {
      if (pendingHandleRestoreSessionId === sessionId) {
        pendingHandleRestoreSessionId = null
      }
      if (copiedDraft.activeSkills.length === 0) {
        inputHandle.clearPendingSkills?.()
      } else {
        inputHandle.setPendingSkills?.([...copiedDraft.activeSkills])
      }
      inputHandle.restoreDocumentSnapshot?.(copyComposerDocument(copiedDraft.document))
    }
    void nextTick(() => {
      if (activeDraftSessionId === sessionId) {
        captureLiveDraft(sessionId)
      }
      suppressedDraftMutations = Math.max(0, suppressedDraftMutations - 1)
    })
    scheduleComposerDraftPersist(sessionId)
  }

  function markCurrentDraftChanged(): void {
    if (suppressedDraftMutations > 0 || !activeDraftSessionId) return
    nextRevision(activeDraftSessionId)
    scheduleComposerDraftPersist(activeDraftSessionId)
  }

  function recordComposerDocumentChange(): void {
    markCurrentDraftChanged()
  }

  function recordComposerSkillsChange(skills: string[]): void {
    const normalizedSkills = Array.from(
      new Set(skills.map((skillName) => skillName.trim()).filter(Boolean))
    )
    const observedSkills = observedSkillSelections.get(activeDraftSessionId) ?? []
    if (stringArraysMatch(observedSkills, normalizedSkills)) return
    observedSkillSelections.set(activeDraftSessionId, normalizedSkills)
    markCurrentDraftChanged()
  }

  function switchComposerSession(previousSessionId: string | undefined, sessionId: string): void {
    // Flush any pending debounce before the editor starts to show another session's content, so a
    // late timer can never persist the incoming draft under the outgoing session's storage key.
    if (composerDraftPersistTimer) {
      clearTimeout(composerDraftPersistTimer)
      composerDraftPersistTimer = null
    }
    const outgoingSessionId = previousSessionId || activeDraftSessionId
    // On initial mount previousSessionId is undefined and outgoing === incoming, so there is no
    // draft to take away — persisting the empty initial draft there would wipe a stored draft
    // before it can be restored below.
    if (
      outgoingSessionId &&
      outgoingSessionId === activeDraftSessionId &&
      outgoingSessionId !== sessionId
    ) {
      const outgoingDraft = applyPendingAcceptedSubmissions(
        outgoingSessionId,
        captureLiveDraft(outgoingSessionId)
      )
      sessionDrafts.set(outgoingSessionId, outgoingDraft)
      observedDraftFingerprints.set(outgoingSessionId, composerDraftFingerprint(outgoingDraft))
      saveComposerDraftToStorage(outgoingSessionId, outgoingDraft)
    }

    const storedIncomingDraft =
      sessionDrafts.get(sessionId) ??
      loadComposerDraftFromStorage(sessionId) ??
      createEmptyComposerDraft(draftRevisions.get(sessionId) ?? 0)
    const incomingDraft = applyPendingAcceptedSubmissions(sessionId, storedIncomingDraft)
    applyLiveDraft(sessionId, incomingDraft)
  }

  function refreshAttemptDraftFromLive(attempt: BlockedComposerAttempt): BlockedComposerAttempt {
    if (attempt.sessionId !== activeDraftSessionId || attempt.sessionId !== options.sessionId()) {
      return attempt
    }
    const liveDraft = captureLiveDraft(attempt.sessionId)
    if (
      liveDraft.revision !== attempt.draft.revision ||
      liveDraft.rawMessage !== attempt.draft.rawMessage ||
      !stringArraysMatch(liveDraft.activeSkills, attempt.draft.activeSkills)
    ) {
      return attempt
    }
    return {
      ...attempt,
      draft: {
        ...attempt.draft,
        document: copyComposerDocument(liveDraft.document),
        inlineItems: copyInlineItems(getComposerInlineItemsSnapshot())
      }
    }
  }

  function consumeAcceptedDraft(sessionId: string, snapshot: ComposerSubmissionSnapshot): void {
    const isActiveSession = sessionId === activeDraftSessionId && sessionId === options.sessionId()
    if (!isActiveSession && sessionId === activeDraftSessionId) {
      enqueuePendingAcceptedSubmission(sessionId, snapshot)
      return
    }
    const currentDraft = isActiveSession
      ? captureLiveDraft(sessionId)
      : sessionDrafts.get(sessionId)
    if (!currentDraft) {
      enqueuePendingAcceptedSubmission(sessionId, snapshot)
      return
    }

    const nextDraft = applyAcceptedComposerSubmission(
      applyPendingAcceptedSubmissions(sessionId, currentDraft),
      snapshot
    )
    if (isActiveSession) {
      applyLiveDraft(sessionId, nextDraft)
    } else {
      sessionDrafts.set(sessionId, copyComposerDraft(nextDraft))
      observedDraftFingerprints.set(sessionId, composerDraftFingerprint(nextDraft))
      draftRevisions.set(sessionId, nextDraft.revision)
      saveComposerDraftToStorage(sessionId, nextDraft)
    }
  }

  function enqueuePendingAcceptedSubmission(
    sessionId: string,
    snapshot: ComposerSubmissionSnapshot
  ): void {
    const pending = pendingAcceptedSubmissions.get(sessionId) ?? []
    pending.push(snapshot)
    pendingAcceptedSubmissions.set(sessionId, pending)
    void nextTick(() => {
      if (
        activeDraftSessionId !== sessionId ||
        options.sessionId() !== sessionId ||
        !pendingAcceptedSubmissions.has(sessionId)
      ) {
        return
      }
      const nextDraft = applyPendingAcceptedSubmissions(sessionId, captureLiveDraft(sessionId))
      applyLiveDraft(sessionId, nextDraft)
    })
  }

  function applyPendingAcceptedSubmissions(
    sessionId: string,
    draft: ComposerSessionDraft
  ): ComposerSessionDraft {
    const pending = pendingAcceptedSubmissions.get(sessionId)
    if (!pending || pending.length === 0) return draft
    pendingAcceptedSubmissions.delete(sessionId)
    return pending.reduce(applyAcceptedComposerSubmission, draft)
  }

  watch(message, markCurrentDraftChanged, { flush: 'sync' })
  watch(attachedFiles, markCurrentDraftChanged, { deep: true, flush: 'sync' })
  watch(
    chatInputRef,
    (inputHandle) => {
      const sessionId = activeDraftSessionId
      if (
        !inputHandle ||
        pendingHandleRestoreSessionId !== sessionId ||
        sessionId !== options.sessionId()
      ) {
        return
      }
      const pendingDraft = sessionDrafts.get(sessionId)
      if (!pendingDraft) return
      applyLiveDraft(sessionId, pendingDraft)
    },
    { flush: 'post' }
  )

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
    fallbackPolicy?: AttachmentFallbackPolicy,
    existingPreparation?: ActiveSubmissionPreparation
  ): Promise<boolean> {
    const currentAttempt = refreshAttemptDraftFromLive(attempt)
    const sessionId = currentAttempt.sessionId
    if (activeDispatches.has(sessionId)) {
      return false
    }

    let preparation = existingPreparation
    let ownsPreparation = false
    if (!preparation) {
      if (activeSubmissionPreparations.has(sessionId)) return false
      preparation = {
        submissionId: nanoid(),
        preparesAttachments: (currentAttempt.payload.files ?? []).some(
          isAttachmentPreparationCandidate
        ),
        cancelled: false,
        mainDispatched: false
      }
      activeSubmissionPreparations.set(sessionId, preparation)
      ownsPreparation = true
    }
    if (preparation.cancelled) return false

    const restoreRequestId = options.currentRestoreRequestId()
    const payload: SendMessageInput = {
      ...currentAttempt.payload,
      files: copyComposerFiles(currentAttempt.payload.files ?? []),
      ...(fallbackPolicy ? { attachmentFallbackPolicy: fallbackPolicy } : {})
    }
    const hasAttachmentPreparationCandidate = (payload.files ?? []).some(
      isAttachmentPreparationCandidate
    )
    const dispatchToken = ++nextDispatchToken
    activeDispatches.set(sessionId, {
      token: dispatchToken,
      preparesAttachments: preparation.preparesAttachments && hasAttachmentPreparationCandidate
    })

    const feedback =
      currentAttempt.mode === 'send' ? beginOutgoingTurnFeedback(sessionId, payload) : null
    if (currentAttempt.mode === 'send' && !feedback) {
      activeDispatches.delete(sessionId)
      if (ownsPreparation) {
        endSubmissionPreparation(sessionId, preparation)
      }
      return false
    }

    try {
      const submissionOptions = preparation.preparesAttachments
        ? { submissionId: preparation.submissionId }
        : undefined
      preparation.mainDispatched = Boolean(submissionOptions)
      let acceptedSteerMessage: ChatMessageRecord | null = null
      const result = await (async () => {
        if (currentAttempt.mode === 'send') {
          return submissionOptions
            ? await chatClient.sendMessage(sessionId, payload, submissionOptions)
            : await chatClient.sendMessage(sessionId, payload)
        }
        const steerResult = submissionOptions
          ? await chatClient.steerActiveTurn(sessionId, payload, submissionOptions)
          : await chatClient.steerActiveTurn(sessionId, payload)
        if (steerResult.accepted) acceptedSteerMessage = steerResult.message
        return steerResult
      })()

      if (!result.accepted) {
        if (feedback) {
          clearOutgoingTurnFeedback(sessionId, feedback)
        }
        blockedComposerAttempts.set(sessionId, {
          attempt: currentAttempt,
          summary: result.attachmentPreparation ?? fallbackPreparationSummary()
        })
        return false
      }

      if (currentAttempt.mode === 'steer') {
        if (options.canWriteSessionView(sessionId, restoreRequestId)) {
          messageStore.applyPersistedMessageRecords([acceptedSteerMessage!])
        } else {
          messageStore.invalidateRecentSessionView(sessionId)
        }
      }
      options.beginPlanTurn(sessionId)
      blockedComposerAttempts.delete(sessionId)
      consumeAcceptedDraft(sessionId, currentAttempt.draft)
      if (options.canWriteSessionView(sessionId, restoreRequestId)) {
        options.schedulePostSubmitScrollToBottom()
      }
      return true
    } catch (error) {
      if (feedback) {
        clearOutgoingTurnFeedback(sessionId, feedback)
      }
      if (!(preparation.cancelled && isAbortError(error))) {
        console.error(
          currentAttempt.mode === 'send'
            ? '[ChatPage] send message failed:'
            : '[ChatPage] steer message failed:',
          error
        )
        notify({
          kind: 'error',
          code: 'chat.attachment.uploadFailed',
          title: t('chat.input.fileUploadFailed'),
          description: error instanceof Error ? error.message : String(error)
        })
      }
      return false
    } finally {
      if (activeDispatches.get(sessionId)?.token === dispatchToken) {
        activeDispatches.delete(sessionId)
      }
      if (ownsPreparation) {
        endSubmissionPreparation(sessionId, preparation)
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
        notify({
          kind: 'info',
          code: 'chat.compaction.unchanged',
          title: t('chat.compaction.noopTitle'),
          description: t('chat.compaction.noopDescription')
        })
      }
    } catch (error) {
      console.error('[ChatPage] manual compaction failed:', error)
      notify({
        kind: 'error',
        code: 'chat.compaction.failed',
        title: t('chat.compaction.failedTitle'),
        description: error instanceof Error ? error.message : String(error)
      })
    }
    return true
  }

  async function onSubmit() {
    if (!canSubmitNow()) return
    const sessionId = options.sessionId()
    const preparation = beginSubmissionPreparation(sessionId)
    if (!preparation) return
    try {
      const restoreRequestId = options.currentRestoreRequestId()
      const seed = captureSubmissionSeed(sessionId)
      const text = seed.draft.rawMessage.trim()
      const files = await prepareFilesForCurrentModel(seed.draft.files)
      if (preparation.cancelled) return
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (!text && files.length === 0) return
      const handledCompaction = await handleManualCompactionCommand(
        text,
        sessionId,
        restoreRequestId
      )
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (preparation.cancelled) return
      if (handledCompaction) {
        if (!isGenerating.value) {
          consumeAcceptedDraft(sessionId, createDraftSnapshot(seed, { text, files: [] }, true))
        }
        return
      }
      const payload = createSubmissionPayload(text, files, seed)
      const draft = createDraftSnapshot(seed, payload, true)
      if (isGenerating.value) {
        await pendingInputStore.queueInput(sessionId, payload)
        consumeAcceptedDraft(sessionId, draft)
        if (options.canWriteSessionView(sessionId, restoreRequestId)) {
          options.schedulePostSubmitScrollToBottom()
        }
      } else {
        await dispatchComposerAttempt(
          {
            sessionId,
            mode: 'send',
            payload,
            draft
          },
          undefined,
          preparation
        )
      }
    } finally {
      endSubmissionPreparation(sessionId, preparation)
    }
  }

  async function onCommandSubmit(command: string) {
    if (!canSubmitNow()) return
    const sessionId = options.sessionId()
    const text = command.trim()
    if (!text) return
    const preparation = beginSubmissionPreparation(sessionId)
    if (!preparation) return
    try {
      const restoreRequestId = options.currentRestoreRequestId()
      const seed = captureSubmissionSeed(sessionId)
      const handledCompaction = await handleManualCompactionCommand(
        text,
        sessionId,
        restoreRequestId
      )
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (preparation.cancelled) return
      if (handledCompaction) {
        return
      }

      const files = await prepareFilesForCurrentModel(seed.draft.files)
      if (preparation.cancelled) return
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      const payload = createSubmissionPayload(text, files, seed)
      const draft = createDraftSnapshot(seed, payload, false)
      if (isGenerating.value) {
        await pendingInputStore.queueInput(sessionId, payload)
        consumeAcceptedDraft(sessionId, draft)
        if (options.canWriteSessionView(sessionId, restoreRequestId)) {
          options.schedulePostSubmitScrollToBottom()
        }
        return
      }
      await dispatchComposerAttempt(
        {
          sessionId,
          mode: 'send',
          payload,
          draft
        },
        undefined,
        preparation
      )
    } finally {
      endSubmissionPreparation(sessionId, preparation)
    }
  }

  async function onQueueSubmit() {
    if (!canSubmitNow()) return
    const sessionId = options.sessionId()
    const preparation = beginSubmissionPreparation(sessionId)
    if (!preparation) return
    try {
      const restoreRequestId = options.currentRestoreRequestId()
      const seed = captureSubmissionSeed(sessionId)
      const text = seed.draft.rawMessage.trim()
      const files = await prepareFilesForCurrentModel(seed.draft.files)
      if (preparation.cancelled) return
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (!text && files.length === 0) return
      const handledCompaction = await handleManualCompactionCommand(
        text,
        sessionId,
        restoreRequestId
      )
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (preparation.cancelled) return
      if (handledCompaction) {
        return
      }
      const payload = createSubmissionPayload(text, files, seed)
      const draft = createDraftSnapshot(seed, payload, true)
      await pendingInputStore.queueInput(sessionId, payload)
      consumeAcceptedDraft(sessionId, draft)
    } finally {
      endSubmissionPreparation(sessionId, preparation)
    }
  }

  async function onSteer() {
    const sessionId = options.sessionId()
    if (!canSubmitNow() || disableQueueSteerAction.value) return
    if (steeringSessionIds.value.has(sessionId)) return
    const preparation = beginSubmissionPreparation(sessionId)
    if (!preparation) return
    setSteering(sessionId, true)
    try {
      const restoreRequestId = options.currentRestoreRequestId()
      const seed = captureSubmissionSeed(sessionId)
      const text = seed.draft.rawMessage.trim()
      const files = await prepareFilesForCurrentModel(seed.draft.files)
      if (preparation.cancelled) return
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (!text && files.length === 0) return
      const handledCompaction = await handleManualCompactionCommand(
        text,
        sessionId,
        restoreRequestId
      )
      if (!options.canWriteSessionView(sessionId, restoreRequestId)) return
      if (preparation.cancelled) return
      if (handledCompaction) {
        return
      }
      const payload = createSubmissionPayload(text, files, seed)
      await dispatchComposerAttempt(
        {
          sessionId,
          mode: 'steer',
          payload,
          draft: createDraftSnapshot(seed, payload, true)
        },
        undefined,
        preparation
      )
    } finally {
      endSubmissionPreparation(sessionId, preparation)
      setSteering(sessionId, false)
    }
  }

  async function onFilesChange(files: MessageFile[]) {
    const sessionId = activeDraftSessionId
    const token = (attachmentFilterTokens.get(sessionId) ?? 0) + 1
    attachmentFilterTokens.set(sessionId, token)
    if (suppressedDraftMutations === 0) nextRevision(sessionId)
    const filteredFiles = await prepareFilesForCurrentModel(files)
    if (token !== attachmentFilterTokens.get(sessionId)) {
      return
    }

    if (sessionId === activeDraftSessionId && sessionId === options.sessionId()) {
      attachedFiles.value = filteredFiles
      return
    }

    const savedDraft = sessionDrafts.get(sessionId)
    if (!savedDraft) return
    const nextDraft = {
      ...copyComposerDraft(savedDraft),
      revision: draftRevisions.get(sessionId) ?? savedDraft.revision,
      files: copyComposerFiles(filteredFiles),
      document: retainComposerDocumentFiles(savedDraft.document, filteredFiles)
    }
    sessionDrafts.set(sessionId, nextDraft)
    observedDraftFingerprints.set(sessionId, composerDraftFingerprint(nextDraft))
    saveComposerDraftToStorage(sessionId, nextDraft)
  }

  function restoreInitialBlockedDraft(
    input: SendMessageInput,
    summary: AttachmentPreparationSummary
  ): void {
    const sessionId = options.sessionId()
    const payload: SendMessageInput = {
      text: input.text,
      files: copyComposerFiles(input.files ?? []),
      ...(input.search === true ? { search: true } : {}),
      ...(input.activeSkills ? { activeSkills: [...input.activeSkills] } : {}),
      ...(input.inlineItems ? { inlineItems: input.inlineItems.map((item) => ({ ...item })) } : {})
    }
    const currentDraft = captureLiveDraft(sessionId)
    const canRestoreIntoComposer = currentDraft.revision === 0 && isComposerDraftEmpty(currentDraft)
    if (canRestoreIntoComposer) {
      applyLiveDraft(sessionId, {
        revision: currentDraft.revision,
        rawMessage: input.text,
        files: copyComposerFiles(payload.files ?? []),
        activeSkills: [...(payload.activeSkills ?? [])],
        document: createComposerTextDocument(input.text)
      })
    }

    const draft: ComposerSubmissionSnapshot = canRestoreIntoComposer
      ? createDraftSnapshot(captureSubmissionSeed(sessionId), payload, true)
      : {
          revision: -1,
          rawMessage: input.text,
          files: copyComposerFiles(payload.files ?? []),
          activeSkills: [...(payload.activeSkills ?? [])],
          document: createComposerTextDocument(input.text),
          inlineItems: copyInlineItems(payload.inlineItems ?? []),
          clearText: true
        }
    blockedComposerAttempts.set(sessionId, {
      attempt: {
        sessionId,
        mode: 'send',
        payload,
        draft
      },
      summary: {
        status: summary.status,
        issues: summary.issues.map((issue) => ({ ...issue })),
        suggestedActions: [...summary.suggestedActions]
      }
    })
  }

  function requestPreparationCancellation(preparation: ActiveSubmissionPreparation): void {
    if (preparation.cancelled) return
    preparation.cancelled = true
    if (preparation.mainDispatched) {
      void chatClient.cancelSubmission(preparation.submissionId).catch((error) => {
        console.warn('[ChatPage] cancel attachment preparation failed:', error)
      })
    }
  }

  function cancelAttachmentPreparation(): void {
    const sessionId = options.sessionId()
    const preparation = activeSubmissionPreparations.get(sessionId)
    if (preparation) {
      requestPreparationCancellation(preparation)
      return
    }
    blockedComposerAttempts.delete(sessionId)
  }

  async function retryAttachmentPreparation(): Promise<void> {
    const blocked = blockedComposerAttempts.get(options.sessionId())
    if (!blocked) return
    await dispatchComposerAttempt(blocked.attempt)
  }

  async function sendWithoutImageContent(): Promise<void> {
    const blocked = blockedComposerAttempts.get(options.sessionId())
    if (!blocked) return
    await dispatchComposerAttempt(blocked.attempt, 'send_without_image_content')
  }

  function switchToVisionModel(): void {
    switchAttachmentToVisionModel(cancelAttachmentPreparation, options.openModelPicker)
  }

  function dispose(): void {
    flushComposerDraftPersist()
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', flushComposerDraftOnPageHide)
      window.removeEventListener('beforeunload', flushComposerDraftOnPageHide)
    }
    searchCapabilityRequestId += 1
    stopSearchCapabilityWatch()
    removeProvidersChangedListener()
    activeSearchCapability.value = null
    attachmentFilterTokens.clear()
    for (const preparation of activeSubmissionPreparations.values()) {
      requestPreparationCancellation(preparation)
    }
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
    isSearchAvailable,
    isSearchEnabled,
    toggleSearch,
    onSubmit,
    onCommandSubmit,
    onQueueSubmit,
    onSteer,
    onFilesChange,
    recordComposerDocumentChange,
    recordComposerSkillsChange,
    switchComposerSession,
    restoreInitialBlockedDraft,
    cancelAttachmentPreparation,
    retryAttachmentPreparation,
    sendWithoutImageContent,
    switchToVisionModel,
    dispose
  }
}
